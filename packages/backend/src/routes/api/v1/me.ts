import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../../../db/index.js';
import { users, userPreferences, organizerMembers, eventStaffAssignments, organizerProfiles } from '../../../db/schema.js';
import { eq } from 'drizzle-orm';
import { logAuditEvent } from '../../../services/audit.js';

const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(100).optional(),
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

      const { displayName } = parseResult.data;

      if (displayName) {
        await db
          .update(users)
          .set({ displayName })
          .where(eq(users.id, user.id));

        await logAuditEvent({
          actorId: user.id,
          action: 'user.profile_updated',
          resourceType: 'user',
          resourceId: user.id,
          collegeId: user.collegeId,
          meta: { displayName },
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
};
