import argon2 from 'argon2';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { sessions, users, type User, type Session } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';

export const ARGON2_CONFIG = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB (65536 KiB)
  timeCost: 3,       // t=3
  parallelism: 1,    // p=1
} as const;

export const SESSION_CONFIG = {
  idleTimeoutMs: 30 * 60 * 1000,          // 30 min idle
  absoluteTimeoutMs: 12 * 60 * 60 * 1000, // 12 hours absolute
  cookieName: 'eventora_session',
  csrfCookieName: 'eventora_csrf',
} as const;

/**
 * Hashes a password using Argon2id with strict parameters (64 MiB, t=3, p=1)
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_CONFIG);
}

/**
 * Verifies a password against an Argon2id hash with constant-time comparison
 */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}

/**
 * Generates an opaque random 256-bit (32 bytes) session identifier
 */
export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Computes SHA-256 hash of a session token returning a Buffer for bytea column
 */
export function hashTokenToBuffer(token: string): Buffer {
  return crypto.createHash('sha256').update(token).digest();
}

/**
 * Computes SHA-256 hex string (for IP/UA or token hashes in text columns)
 */
export function hashStringToHex(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex');
}

/**
 * Generates a random 32-byte CSRF token
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Constant time dummy compare
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Creates a new session record in DB with SHA-256 hash
 */
export async function createSession(
  userId: string,
  ip?: string,
  userAgent?: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateOpaqueToken();
  const idHash = hashTokenToBuffer(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_CONFIG.absoluteTimeoutMs);

  const ipHash = ip ? hashStringToHex(ip) : null;
  const uaHash = userAgent ? hashStringToHex(userAgent) : null;

  await db.insert(sessions).values({
    idHash,
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    ipHash,
    uaHash,
    revokedAt: null,
  });

  return { token, expiresAt };
}

/**
 * Validates a session token:
 * - Checks SHA-256 hash in DB
 * - Ensures not revoked
 * - Ensures absolute timeout not reached
 * - Ensures idle timeout not reached
 * - Ensures user is active (not suspended)
 * - Updates lastSeenAt on success
 */
export async function validateSession(
  token: string
): Promise<{ user: User; session: Session } | null> {
  if (!token || typeof token !== 'string') return null;

  const idHash = hashTokenToBuffer(token);
  const now = new Date();

  const found = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.idHash, idHash))
    .limit(1);

  if (found.length === 0) return null;

  const { session, user } = found[0];

  // 1. Check revoked
  if (session.revokedAt !== null) {
    return null;
  }

  // 2. Check absolute expiration
  if (now > session.expiresAt) {
    return null;
  }

  // 3. Check idle timeout (30 min)
  const idleElapsed = now.getTime() - new Date(session.lastSeenAt).getTime();
  if (idleElapsed > SESSION_CONFIG.idleTimeoutMs) {
    return null;
  }

  // 4. Check user status
  if (user.status !== 'active') {
    // Revoke session if user was suspended
    await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(eq(sessions.idHash, idHash));
    return null;
  }

  // 5. Update lastSeenAt (sliding idle window throttled to >= 60s)
  if (idleElapsed >= 60 * 1000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.idHash, idHash));
  }

  return { user, session };
}

/**
 * Rotates an existing session (e.g. on login or privilege change)
 */
export async function rotateSession(
  oldToken: string | undefined,
  userId: string,
  ip?: string,
  userAgent?: string
): Promise<{ token: string; expiresAt: Date }> {
  if (oldToken) {
    await revokeSession(oldToken);
  }
  return createSession(userId, ip, userAgent);
}

/**
 * Revokes a single session by token
 */
export async function revokeSession(token: string): Promise<void> {
  if (!token) return;
  const idHash = hashTokenToBuffer(token);
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.idHash, idHash));
}

/**
 * Revokes all active sessions for a user (e.g. on suspension or password reset)
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
