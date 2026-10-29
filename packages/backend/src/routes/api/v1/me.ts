import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../../../db/index.js';
import {
  users,
  userPreferences,
  organizerMembers,
  eventStaffAssignments,
  organizerProfiles,
  sessions,
} from '../../../db/schema.js';
import { eq, and, ne, isNull, gt, desc } from 'drizzle-orm';
import { logAuditEvent } from '../../../services/audit.js';
import { SESSION_CONFIG, revokeAllUserSessions } from '../../../services/auth.js';
import { getUserDataExport, anonymizeUserData } from '../../../services/privacy.js';

const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(100).optional(),
  department: z.string().max(100).nullable().optional(),
  year: z.number().int().min(1).max(10).nullable().optional(),
});

const updatePreferencesSchema = z.object({
  emailEnabled: z.boolean().optional(),
  inappEnabled: z.boolean().optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  locale: z.string().min(2).max(10).optional(),
});

export const meRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. GET /api/v1/me
  fastify.get(
    '/',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const user = req.user!;

      // Fetch college info
      const college = await db.query.colleges.findFirst({
        where: (c, { eq }) => eq(c.id, user.collegeId),
      });

      // Fetch organizer memberships
      const memberships = await db
        .select({
          organizerId: organizerMembers.organizerId,
          role: organizerMembers.role,
          status: organizerMembers.status,
          organizerName: organizerProfiles.displayName,
        })
        .from(organizerMembers)
        .innerJoin(organizerProfiles, eq(organizerMembers.organizerId, organizerProfiles.id))
        .where(eq(organizerMembers.userId, user.id));

      // Fetch staff capabilities
      const staffGrants = await db
        .select()
        .from(eventStaffAssignments)
        .where(eq(eventStaffAssignments.userId, user.id));

      // Fetch preferences
      const preferences = await db.query.userPreferences.findFirst({
        where: eq(userPreferences.userId, user.id),
      });

      return reply.code(200).send({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          globalRole: user.globalRole,
          status: user.status,
          department: user.department,
          year: user.year,
          college: college
            ? {
                id: college.id,
                name: college.name,
                domain: college.domain,
              }
            : null,
          organizerMemberships: memberships,
          staffAssignments: staffGrants,
          preferences: preferences || {
            emailEnabled: true,
            inappEnabled: true,
            theme: 'light',
            locale: 'en-IN',
          },
        },
      });
    }
  );

  // 2. PATCH /api/v1/me
  fastify.patch(
    '/',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const user = req.user!;

      const parseResult = updateProfileSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid profile update data',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const { displayName, department, year } = parseResult.data;

      const updates: Record<string, any> = {};
      if (displayName !== undefined) updates.displayName = displayName;
      if (department !== undefined) updates.department = department ? department.trim() : null;
      if (year !== undefined) updates.year = year;

      if (Object.keys(updates).length > 0) {
        await db
          .update(users)
          .set(updates)
          .where(eq(users.id, user.id));

        await logAuditEvent({
          actorId: user.id,
          action: 'user.profile_updated',
          resourceType: 'user',
          resourceId: user.id,
          collegeId: user.collegeId,
          meta: updates,
          ip: req.ip,
        });
      }

      const updated = await db.query.users.findFirst({
        where: eq(users.id, user.id),
      });

      return reply.code(200).send({
        user: {
          id: updated!.id,
          email: updated!.email,
          displayName: updated!.displayName,
          globalRole: updated!.globalRole,
          status: updated!.status,
          department: updated!.department,
          year: updated!.year,
        },
        message: 'Profile updated successfully.',
      });
    }
  );

  // 3. GET /api/v1/me/preferences
  fastify.get(
    '/preferences',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const user = req.user!;

      let prefs = await db.query.userPreferences.findFirst({
        where: eq(userPreferences.userId, user.id),
      });

      if (!prefs) {
        const [created] = await db
          .insert(userPreferences)
          .values({
            userId: user.id,
            emailEnabled: true,
            inappEnabled: true,
            theme: 'light',
            locale: 'en-IN',
          })
          .returning();
        prefs = created;
      }

      return reply.code(200).send({
        preferences: prefs,
      });
    }
  );

  // 4. PATCH /api/v1/me/preferences
  fastify.patch(
    '/preferences',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const user = req.user!;

      const parseResult = updatePreferencesSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid preferences payload',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const updates = parseResult.data;

      await db
        .insert(userPreferences)
        .values({
          userId: user.id,
          emailEnabled: updates.emailEnabled ?? true,
          inappEnabled: updates.inappEnabled ?? true,
          theme: updates.theme ?? 'light',
          locale: updates.locale ?? 'en-IN',
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: {
            ...updates,
            updatedAt: new Date(),
          },
        });

      const updatedPrefs = await db.query.userPreferences.findFirst({
        where: eq(userPreferences.userId, user.id),
      });

      return reply.code(200).send({
        preferences: updatedPrefs,
        message: 'Preferences updated successfully.',
      });
    }
  );

  // 5. GET /api/v1/me/sessions (list active devices)
  fastify.get(
    '/sessions',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const user = req.user!;
      const currentIdHash = req.session?.idHash;
      const now = new Date();

      const userSessions = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, user.id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now)
          )
        )
        .orderBy(desc(sessions.lastSeenAt));

      const deviceList = userSessions.map((s) => ({
        id: s.idHash.toString('hex'),
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        isCurrent: currentIdHash ? Buffer.compare(s.idHash, currentIdHash) === 0 : false,
      }));

      return reply.code(200).send({
        sessions: deviceList,
      });
    }
  );

  // 6. DELETE /api/v1/me/sessions (revoke other sessions or all sessions)
  fastify.delete(
    '/sessions',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const user = req.user!;
      const currentIdHash = req.session?.idHash;
      const { all } = (req.query as { all?: string }) || {};

      const now = new Date();

      if (all === 'true') {
        // Revoke all sessions including current
        await revokeAllUserSessions(user.id);
        reply.clearCookie(SESSION_CONFIG.cookieName, { path: '/' });
        reply.clearCookie(SESSION_CONFIG.csrfCookieName, { path: '/' });
      } else {
        // Revoke all other sessions, preserving current
        if (currentIdHash) {
          await db
            .update(sessions)
            .set({ revokedAt: now })
            .where(
              and(
                eq(sessions.userId, user.id),
                isNull(sessions.revokedAt),
                ne(sessions.idHash, currentIdHash)
              )
            );
        } else {
          await revokeAllUserSessions(user.id);
        }
      }

      await logAuditEvent({
        actorId: user.id,
        action: 'user.sessions_revoked',
        resourceType: 'session',
        collegeId: user.collegeId,
        ip: req.ip,
      });

      return reply.code(200).send({
        success: true,
        message: all === 'true' ? 'All sessions revoked.' : 'All other sessions revoked.',
      });
    }
  );

  // 7. DELETE /api/v1/me/sessions/:id (revoke a specific session device)
  fastify.delete(
    '/sessions/:id',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const user = req.user!;
      const { id } = req.params as { id: string };

      if (!id || !/^[0-9a-fA-F]{64}$/.test(id)) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid session identifier format',
            details: {},
            requestId: req.id,
          },
        });
      }

      const targetIdHash = Buffer.from(id, 'hex');
      const now = new Date();

      const [revoked] = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(sessions.idHash, targetIdHash),
            eq(sessions.userId, user.id),
            isNull(sessions.revokedAt)
          )
        )
        .returning();

      if (!revoked) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Session not found or already revoked.',
            details: {},
            requestId: req.id,
          },
        });
      }

      // If the revoked session was current, clear cookies
      if (req.session?.idHash && Buffer.compare(targetIdHash, req.session.idHash) === 0) {
        reply.clearCookie(SESSION_CONFIG.cookieName, { path: '/' });
        reply.clearCookie(SESSION_CONFIG.csrfCookieName, { path: '/' });
      }

      await logAuditEvent({
        actorId: user.id,
        action: 'user.session_revoked',
        resourceType: 'session',
        collegeId: user.collegeId,
        ip: req.ip,
      });

      return reply.code(200).send({
        success: true,
        message: 'Session successfully revoked.',
      });
    }
  );

  // 8. GET /api/v1/me/data-export (GDPR Art 20 / DPDP Machine-readable Data Portability)
  fastify.get(
    '/data-export',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const user = req.user!;
      const dataExport = await getUserDataExport(user.id);

      await logAuditEvent({
        actorId: user.id,
        action: 'user.data_exported',
        resourceType: 'user',
        resourceId: user.id,
        collegeId: user.collegeId,
        ip: req.ip,
      });

      return reply.code(200).send({
        dataExport,
      });
    }
  );

  // 9. DELETE /api/v1/me (Right to Erasure / GDPR Art 17 / DPDP Section 12 Anonymization)
  fastify.delete(
    '/',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const user = req.user!;
      await anonymizeUserData(user.id);

      reply.clearCookie(SESSION_CONFIG.cookieName, { path: '/' });
      reply.clearCookie(SESSION_CONFIG.csrfCookieName, { path: '/' });

      return reply.code(200).send({
        success: true,
        message: 'Account and personal data have been anonymised per privacy regulations.',
      });
    }
  );
};
