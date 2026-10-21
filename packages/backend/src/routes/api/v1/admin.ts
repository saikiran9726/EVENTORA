import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../../../db/index.js';
import { users, colleges } from '../../../db/schema.js';
import { eq, desc, count } from 'drizzle-orm';
import { logAuditEvent } from '../../../services/audit.js';
import { revokeAllUserSessions } from '../../../services/auth.js';

const updateUserRoleSchema = z.object({
  globalRole: z.enum(['student', 'reviewer', 'admin']).optional(),
  status: z.enum(['active', 'suspended', 'pending']).optional(),
});

const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. GET /api/v1/admin/users (paginated)
  fastify.get(
    '/users',
    {
      config: {
        auth: true,
        policy: 'user:manage',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const parseResult = listUsersQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid pagination query parameters',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const { page, limit } = parseResult.data;
      const offset = (page - 1) * limit;

      const [totalCountResult] = await db.select({ total: count() }).from(users);
      const total = Number(totalCountResult?.total || 0);

      const items = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          globalRole: users.globalRole,
          status: users.status,
          createdAt: users.createdAt,
          emailVerifiedAt: users.emailVerifiedAt,
          collegeName: colleges.name,
        })
        .from(users)
        .leftJoin(colleges, eq(users.collegeId, colleges.id))
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset);

      return reply.code(200).send({
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }
  );

  // 2. POST /api/v1/admin/users/:id/role
  fastify.post(
    '/users/:id/role',
    {
      config: {
        auth: true,
        policy: 'user:manage',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const parseResult = updateUserRoleSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid user role/status payload',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const targetUser = await db.query.users.findFirst({
        where: eq(users.id, id),
      });

      if (!targetUser) {
        return reply.code(404).send({
          error: {
            code: 'USER_NOT_FOUND',
            message: `User with ID ${id} was not found.`,
            details: {},
            requestId: req.id,
          },
        });
      }

      const { globalRole, status } = parseResult.data;
      const updates: Partial<typeof targetUser> = {};

      if (globalRole) updates.globalRole = globalRole;
      if (status) updates.status = status;

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({
          error: {
            code: 'EMPTY_UPDATE',
            message: 'Either globalRole or status must be provided for update.',
            details: {},
            requestId: req.id,
          },
        });
      }

      await db.update(users).set(updates).where(eq(users.id, id));

      // If user status changed to 'suspended', immediately revoke all active sessions
      if (status === 'suspended') {
        await revokeAllUserSessions(id);
      }

      // Record audit log
      await logAuditEvent({
        actorId: req.user!.id,
        action: 'admin.user_role_updated',
        resourceType: 'user',
        resourceId: id,
        collegeId: targetUser.collegeId,
        meta: {
          previousRole: targetUser.globalRole,
          newRole: globalRole || targetUser.globalRole,
          previousStatus: targetUser.status,
          newStatus: status || targetUser.status,
        },
        ip: req.ip,
      });

      const updatedUser = await db.query.users.findFirst({
        where: eq(users.id, id),
      });

      return reply.code(200).send({
        user: {
          id: updatedUser!.id,
          email: updatedUser!.email,
          displayName: updatedUser!.displayName,
          globalRole: updatedUser!.globalRole,
          status: updatedUser!.status,
        },
        message: 'User role/status successfully updated.',
      });
    }
  );
};
