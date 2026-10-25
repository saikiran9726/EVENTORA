import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../../config.js';
import { db } from '../../../db/index.js';
import { users, colleges, passwordResets, userPreferences } from '../../../db/schema.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  revokeSession,
  revokeAllUserSessions,
  generateCsrfToken,
  generateOpaqueToken,
  hashStringToHex,
  SESSION_CONFIG,
} from '../../../services/auth.js';
import { checkRateLimit } from '../../../services/redis.js';
import { logAuditEvent } from '../../../services/audit.js';
import { eq, and, gt, isNull } from 'drizzle-orm';

// Dummy hash for constant-time comparison when email is not found
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQxMjM0NTY3OA$YfRfxz8uVw/F1v4h46Xo3s48y8E05nL57N5X9g4Mv7s';

const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password cannot exceed 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  displayName: z.string().min(2).max(100),
  collegeId: z.string().uuid().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

const forgotSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  token: z.string().min(16),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password cannot exceed 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

const resendVerificationSchema = z.object({
  email: z.string().email(),
});

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. POST /api/v1/auth/register
  fastify.post(
    '/register',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const clientIp = req.ip || '127.0.0.1';

      // Rate limit: 10 per hour per IP (configured via config.AUTH_RATE_LIMIT_REGISTER_MAX; explicitly isolated for test suites via env)
      const maxAttempts = config.AUTH_RATE_LIMIT_REGISTER_MAX;
      const rateLimit = await checkRateLimit(`register:${clientIp}`, maxAttempts, 3600);
      if (!rateLimit.allowed) {
        return reply.code(429).send({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many registration attempts. Please try again later.',
            details: { resetSeconds: rateLimit.resetSeconds },
            requestId: req.id,
          },
        });
      }

      const parseResult = registerSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid registration input',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const { email, password, displayName } = parseResult.data;
      const emailDomain = email.split('@')[1]?.toLowerCase();

      // Find college by domain
      const college = await db.query.colleges.findFirst({
        where: eq(colleges.domain, emailDomain),
      });

      if (!college || college.status !== 'active') {
        return reply.code(400).send({
          error: {
            code: 'INVALID_COLLEGE_DOMAIN',
            message: 'No registered active campus matches your email domain. Please use your official institutional email.',
            details: { emailDomain },
            requestId: req.id,
          },
        });
      }

      // Check if user already exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email.toLowerCase()),
      });

      if (existingUser) {
        return reply.code(400).send({
          error: {
            code: 'EMAIL_ALREADY_EXISTS',
            message: 'An account with this email already exists.',
            details: {},
            requestId: req.id,
          },
        });
      }

      // Hash password with Argon2id (64 MiB, t=3, p=1)
      const hashedPassword = await hashPassword(password);

      const [newUser] = await db
        .insert(users)
        .values({
          collegeId: college.id,
          email: email.toLowerCase(),
          passwordHash: hashedPassword,
          displayName,
          globalRole: 'student',
          status: 'pending',
          emailVerifiedAt: null,
        })
        .returning();

      // Create initial preferences
      await db.insert(userPreferences).values({
        userId: newUser.id,
        emailEnabled: true,
        inappEnabled: true,
        theme: 'light',
        locale: 'en-IN',
      });

      // Generate verification token (stored in passwordResets with purpose prefix for separation)
      const verificationToken = generateOpaqueToken();
      const tokenHash = hashStringToHex(`verify:${verificationToken}`);

      await db.insert(passwordResets).values({
        tokenHash,
        userId: newUser.id,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000), // 24 hours
        usedAt: null,
      });

      await logAuditEvent({
        actorId: newUser.id,
        action: 'user.registered',
        resourceType: 'user',
        resourceId: newUser.id,
        collegeId: college.id,
        ip: clientIp,
      });

      return reply.code(201).send({
        user: {
          id: newUser.id,
          email: newUser.email,
          displayName: newUser.displayName,
          globalRole: newUser.globalRole,
          status: newUser.status,
        },
        ...(process.env.NODE_ENV !== 'production' ? { verificationToken } : {}),
        message: 'Registration successful. Please verify your email.',
      });
    }
  );

  // 2. POST /api/v1/auth/login
  fastify.post(
    '/login',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const clientIp = req.ip || '127.0.0.1';
      const userAgent = (req.headers['user-agent'] as string) || '';

      const parseResult = loginSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid login credentials',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const { email, password } = parseResult.data;
      const rateLimitKey = `login:${clientIp}:${email.toLowerCase()}`;

      // Rate limit: 5 attempts per minute per IP + email
      const rateLimit = await checkRateLimit(rateLimitKey, 5, 60);
      if (!rateLimit.allowed) {
        return reply.code(429).send({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many failed login attempts. Please wait 1 minute before retrying.',
            details: { resetSeconds: rateLimit.resetSeconds },
            requestId: req.id,
          },
        });
      }

      const user = await db.query.users.findFirst({
        where: eq(users.email, email.toLowerCase()),
      });

      // Constant-time compare: execute Argon2 even if user not found to prevent timing attack
      const hashToVerify = user ? user.passwordHash : DUMMY_ARGON2_HASH;
      const isValid = await verifyPassword(hashToVerify, password);

      // Uniform error message for unknown email vs wrong password
      if (!user || !isValid) {
        return reply.code(401).send({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
            details: {},
            requestId: req.id,
          },
        });
      }

      // Check account status
      if (user.status === 'suspended') {
        return reply.code(403).send({
          error: {
            code: 'ACCOUNT_SUSPENDED',
            message: 'Your account has been suspended. Please contact campus administration.',
            details: {},
            requestId: req.id,
          },
        });
      }

      if (user.status === 'pending' || !user.emailVerifiedAt) {
        return reply.code(403).send({
          error: {
            code: 'EMAIL_NOT_VERIFIED',
            message: 'Please verify your college email address before signing in.',
            details: {},
            requestId: req.id,
          },
        });
      }

      // Session creation & fixation prevention: create new session and rotate any previous token
      const prevToken = req.cookies[SESSION_CONFIG.cookieName];
      if (prevToken) {
        await revokeSession(prevToken);
      }

      const { token, expiresAt } = await createSession(user.id, clientIp, userAgent);
      const csrfToken = generateCsrfToken();

      // Set HttpOnly, Secure, SameSite=Lax session cookie
      const isProd = process.env.NODE_ENV === 'production';
      reply.setCookie(SESSION_CONFIG.cookieName, token, {
        path: '/',
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        expires: expiresAt,
      });

      // Set CSRF cookie (accessible to client script for double-submit header)
      reply.setCookie(SESSION_CONFIG.csrfCookieName, csrfToken, {
        path: '/',
        httpOnly: false,
        secure: isProd,
        sameSite: 'lax',
        expires: expiresAt,
      });

      await logAuditEvent({
        actorId: user.id,
        action: 'user.login',
        resourceType: 'session',
        collegeId: user.collegeId,
        ip: clientIp,
      });

      return reply.code(200).send({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          globalRole: user.globalRole,
          status: user.status,
          collegeId: user.collegeId,
        },
        csrfToken,
        ...(process.env.NODE_ENV !== 'production' ? { token } : {}),
      });
    }
  );

  // 3. POST /api/v1/auth/logout
  fastify.post(
    '/logout',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      if (req.sessionToken) {
        await revokeSession(req.sessionToken);
      }

      reply.clearCookie(SESSION_CONFIG.cookieName, { path: '/' });
      reply.clearCookie(SESSION_CONFIG.csrfCookieName, { path: '/' });

      if (req.user) {
        await logAuditEvent({
          actorId: req.user.id,
          action: 'user.logout',
          resourceType: 'session',
          collegeId: req.user.collegeId,
          ip: req.ip,
        });
      }

      return reply.code(200).send({
        success: true,
        message: 'Successfully logged out.',
      });
    }
  );

  // 4. POST /api/v1/auth/verify-email
  fastify.post(
    '/verify-email',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const parseResult = verifyEmailSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid verification token format',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const { token } = parseResult.data;
      const tokenHash = hashStringToHex(`verify:${token}`);
      const now = new Date();

      // Atomic single-step consumption to prevent race conditions
      const [consumedRecord] = await db
        .update(passwordResets)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResets.tokenHash, tokenHash),
            isNull(passwordResets.usedAt),
            gt(passwordResets.expiresAt, now)
          )
        )
        .returning();

      if (!consumedRecord) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_OR_EXPIRED_TOKEN',
            message: 'Verification token is invalid or has expired.',
            details: {},
            requestId: req.id,
          },
        });
      }

      await db
        .update(users)
        .set({ status: 'active', emailVerifiedAt: now })
        .where(eq(users.id, consumedRecord.userId));

      await logAuditEvent({
        actorId: consumedRecord.userId,
        action: 'user.email_verified',
        resourceType: 'user',
        resourceId: consumedRecord.userId,
        ip: req.ip,
      });

      return reply.code(200).send({
        success: true,
        message: 'Email successfully verified. You may now sign in.',
      });
    }
  );

  // 5. POST /api/v1/auth/forgot
  fastify.post(
    '/forgot',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const parseResult = forgotSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid email address',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const { email } = parseResult.data;

      // Rate limit: 3 requests per hour per email
      const rateLimit = await checkRateLimit(`forgot:${email.toLowerCase()}`, 3, 3600);
      if (!rateLimit.allowed) {
        return reply.code(429).send({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many password reset requests. Please check your inbox or wait 1 hour.',
            details: { resetSeconds: rateLimit.resetSeconds },
            requestId: req.id,
          },
        });
      }

      const user = await db.query.users.findFirst({
        where: eq(users.email, email.toLowerCase()),
      });

      let resetToken: string | undefined = undefined;

      if (user && user.status === 'active') {
        resetToken = generateOpaqueToken();
        const tokenHash = hashStringToHex(`reset:${resetToken}`);

        await db.insert(passwordResets).values({
          tokenHash,
          userId: user.id,
          expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour
          usedAt: null,
        });

        await logAuditEvent({
          actorId: user.id,
          action: 'user.password_reset_requested',
          resourceType: 'user',
          resourceId: user.id,
          collegeId: user.collegeId,
          ip: req.ip,
        });
      }

      // Always return identical success message to prevent user enumeration
      return reply.code(200).send({
        success: true,
        message: 'If that email address is associated with an account, a reset link has been dispatched.',
        ...(process.env.NODE_ENV !== 'production' ? { resetToken } : {}),
      });
    }
  );

  // 6. POST /api/v1/auth/reset
  fastify.post(
    '/reset',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const parseResult = resetSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid password reset input',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const { token, newPassword } = parseResult.data;
      const tokenHash = hashStringToHex(`reset:${token}`);
      const now = new Date();

      // Atomic single-step consumption to prevent race conditions
      const [consumedRecord] = await db
        .update(passwordResets)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResets.tokenHash, tokenHash),
            isNull(passwordResets.usedAt),
            gt(passwordResets.expiresAt, now)
          )
        )
        .returning();

      if (!consumedRecord) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_OR_EXPIRED_TOKEN',
            message: 'Password reset link is invalid or has expired.',
            details: {},
            requestId: req.id,
          },
        });
      }

      // Hash new password with Argon2id
      const newHash = await hashPassword(newPassword);

      // Update password
      await db
        .update(users)
        .set({ passwordHash: newHash })
        .where(eq(users.id, consumedRecord.userId));

      // Revoke all existing sessions for the user
      await revokeAllUserSessions(consumedRecord.userId);

      await logAuditEvent({
        actorId: consumedRecord.userId,
        action: 'user.password_reset_completed',
        resourceType: 'user',
        resourceId: consumedRecord.userId,
        ip: req.ip,
      });

      return reply.code(200).send({
        success: true,
        message: 'Password has been successfully reset. Please log in with your new credentials.',
      });
    }
  );

  // 7. POST /api/v1/auth/resend-verification
  fastify.post(
    '/resend-verification',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const parseResult = resendVerificationSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid email address',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const { email } = parseResult.data;
      const rateLimitKey = `resend:${email.toLowerCase()}`;
      const rateLimit = await checkRateLimit(rateLimitKey, 3, 3600);
      if (!rateLimit.allowed) {
        return reply.code(429).send({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many verification requests. Please check your inbox or wait 1 hour.',
            details: { resetSeconds: rateLimit.resetSeconds },
            requestId: req.id,
          },
        });
      }

      const user = await db.query.users.findFirst({
        where: eq(users.email, email.toLowerCase()),
      });

      let verificationToken: string | undefined = undefined;

      if (user && user.status === 'pending') {
        verificationToken = generateOpaqueToken();
        const tokenHash = hashStringToHex(`verify:${verificationToken}`);

        await db.insert(passwordResets).values({
          tokenHash,
          userId: user.id,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000), // 24 hours
          usedAt: null,
        });

        await logAuditEvent({
          actorId: user.id,
          action: 'user.verification_resent',
          resourceType: 'user',
          resourceId: user.id,
          collegeId: user.collegeId,
          ip: req.ip,
        });
      }

      // Always return identical success to prevent enumeration
      return reply.code(200).send({
        success: true,
        message: 'If an unverified account exists for that email, a verification link has been dispatched.',
        ...(process.env.NODE_ENV !== 'production' ? { verificationToken } : {}),
      });
    }
  );
};
