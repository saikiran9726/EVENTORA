import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../../../db/index.js';
import {
  createTeam,
  getTeam,
  updateTeam,
  inviteMember,
  acceptInvitation,
  transferLeadership,
  leaveTeam,
  registerTeamForEvent,
  submitProject,
  TeamError,
} from '../../../services/team.js';
import { checkRateLimit } from '../../../services/redis.js';

const createTeamSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(1000).optional(),
  visibility: z.enum(['private', 'discoverable']).default('private'),
  maxSize: z.number().int().min(2).max(10).default(4),
  skillsOffered: z.array(z.string()).optional(),
  skillsNeeded: z.array(z.string()).optional(),
});

const updateTeamSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  description: z.string().max(1000).optional(),
  visibility: z.enum(['private', 'discoverable']).optional(),
  maxSize: z.number().int().min(2).max(10).optional(),
});

const inviteMemberSchema = z.object({
  inviteeId: z.string().uuid().optional(),
  email: z.string().email().optional(),
});

const registerTeamSchema = z.object({
  ticketTypeId: z.string().uuid(),
});

const submitProjectSchema = z.object({
  title: z.string().min(3).max(255),
  abstract: z.string().min(10).max(5000),
  repoUrl: z.string().url().optional(),
  demoUrl: z.string().url().optional(),
});

export const teamRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. POST /api/v1/teams (Create team)
  fastify.post(
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
      const parseResult = createTeamSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid team parameters',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      try {
        const result = await createTeam({
          ...parseResult.data,
          userId: user.id,
        });

        return reply.code(201).send(result);
      } catch (err: any) {
        if (err instanceof TeamError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 2. GET /api/v1/teams (Discoverable teams)
  fastify.get(
    '/',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { mine, filter } = (req.query as { mine?: string; filter?: string }) || {};
      const client = await pool.connect();
      try {
        if ((mine === 'true' || filter === 'my') && req.user) {
          const res = await client.query(
            `SELECT t.*, u.display_name as creator_name,
                    COUNT(tm2.user_id)::int as member_count
             FROM teams t
             JOIN team_members tm ON t.id = tm.team_id
             JOIN users u ON t.created_by = u.id
             LEFT JOIN team_members tm2 ON t.id = tm2.team_id AND tm2.status = 'ACTIVE'
             WHERE tm.user_id = $1 AND tm.status = 'ACTIVE' AND t.status = 'active'
             GROUP BY t.id, u.id
             ORDER BY t.created_at DESC;`,
            [req.user.id]
          );
          return reply.code(200).send({
            teams: res.rows,
          });
        }

        const res = await client.query(
          `SELECT t.*, u.display_name as creator_name,
                  COUNT(tm.user_id)::int as member_count
           FROM teams t
           JOIN users u ON t.created_by = u.id
           LEFT JOIN team_members tm ON t.id = tm.team_id AND tm.status = 'ACTIVE'
           WHERE t.visibility = 'discoverable' AND t.status = 'active'
           GROUP BY t.id, u.id
           ORDER BY t.created_at DESC
           LIMIT 50;`
        );

        return reply.code(200).send({
          teams: res.rows,
        });
      } finally {
        client.release();
      }
    }
  );

  // 3. GET /api/v1/teams/:id (Private team returns 404 to non-members)
  fastify.get(
    '/:id',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = req.user?.id;

      try {
        const result = await getTeam(id, userId);
        return reply.code(200).send(result);
      } catch (err: any) {
        if (err instanceof TeamError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 4. PATCH /api/v1/teams/:id (Leader or co_leader)
  fastify.patch(
    '/:id',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.user!;

      const parseResult = updateTeamSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid team update parameters',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      try {
        const updated = await updateTeam(id, user.id, parseResult.data);
        return reply.code(200).send({ team: updated });
      } catch (err: any) {
        if (err instanceof TeamError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 5. POST /api/v1/teams/:id/invitations (Rate limit 20/h/user)
  fastify.post(
    '/:id/invitations',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: teamId } = req.params as { id: string };
      const user = req.user!;

      const rl = await checkRateLimit(`rate:invitations:${user.id}`, 20, 3600);
      if (!rl.allowed) {
        return reply.code(429).send({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Invitation limit exceeded (max 20 per hour).',
            details: { limit: 20, window: '1h', resetSeconds: rl.resetSeconds },
            requestId: req.id,
          },
        });
      }

      const parseResult = inviteMemberSchema.safeParse(req.body || {});
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid invitation payload',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const { inviteeId, email } = parseResult.data;
      if (!inviteeId && !email) {
        return reply.code(400).send({
          error: {
            code: 'NAMED_INVITEE_REQUIRED',
            message: 'Invitations must specify a named invitee (inviteeId or email)',
            details: {},
            requestId: req.id,
          },
        });
      }

      try {
        const result = await inviteMember({
          teamId,
          inviterId: user.id,
          inviteeId,
          email,
        });
        return reply.code(201).send(result);
      } catch (err: any) {
        if (err instanceof TeamError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 6. POST /api/v1/invitations/:id/accept
  fastify.post(
    '/invitations/:id/accept',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: invitationId } = req.params as { id: string };
      const user = req.user!;

      const body = (req.body as any) || {};
      const query = (req.query as any) || {};
      const token = body.token || query.token;

      if (!token || typeof token !== 'string' || !token.trim()) {
        return reply.code(400).send({
          error: {
            code: 'MISSING_INVITATION_TOKEN',
            message: 'Invitation token is required to accept team invitation',
            details: {},
            requestId: req.id,
          },
        });
      }

      // Rate limit invitation acceptance to prevent token brute force
      const rl = await checkRateLimit(`rate:invitations:accept:${user.id}`, 10, 60);
      if (!rl.allowed) {
        return reply.code(429).send({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many invitation acceptance attempts. Please wait.',
            details: { resetSeconds: rl.resetSeconds },
            requestId: req.id,
          },
        });
      }

      try {
        const result = await acceptInvitation(invitationId, user.id, token.trim());
        return reply.code(200).send(result);
      } catch (err: any) {
        if (err instanceof TeamError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 7. POST /api/v1/invitations/:id/decline
  fastify.post(
    '/invitations/:id/decline',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: invitationId } = req.params as { id: string };
      const user = req.user!;

      const client = await pool.connect();
      try {
        const res = await client.query(
          `UPDATE team_invitations
           SET status = 'DECLINED'
           WHERE id = $1 AND (invitee_id = $2 OR invitee_id IS NULL)
           RETURNING *;`,
          [invitationId, user.id]
        );
        if (res.rows.length === 0) {
          return reply.code(404).send({
            error: { code: 'INVITATION_NOT_FOUND', message: 'Invitation not found', details: {}, requestId: req.id },
          });
        }
        return reply.code(200).send({ success: true, status: 'DECLINED' });
      } finally {
        client.release();
      }
    }
  );

  // 8. POST /api/v1/invitations/:id/revoke
  fastify.post(
    '/invitations/:id/revoke',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: invitationId } = req.params as { id: string };
      const user = req.user!;

      const client = await pool.connect();
      try {
        // Verify user is leader or co-leader of the team
        const invRes = await client.query(`SELECT team_id FROM team_invitations WHERE id = $1;`, [invitationId]);
        if (invRes.rows.length === 0) {
          return reply.code(404).send({
            error: { code: 'INVITATION_NOT_FOUND', message: 'Invitation not found', details: {}, requestId: req.id },
          });
        }

        const teamId = invRes.rows[0].team_id;
        const memberRes = await client.query(
          `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'ACTIVE';`,
          [teamId, user.id]
        );
        if (memberRes.rows.length === 0 || !['leader', 'co_leader'].includes(memberRes.rows[0].role)) {
          return reply.code(403).send({
            error: { code: 'FORBIDDEN', message: 'Only team leaders can revoke invitations', details: {}, requestId: req.id },
          });
        }

        await client.query(
          `UPDATE team_invitations SET status = 'REVOKED', revoked_at = NOW() WHERE id = $1;`,
          [invitationId]
        );

        return reply.code(200).send({ success: true, status: 'REVOKED' });
      } finally {
        client.release();
      }
    }
  );

  // 9. POST /api/v1/teams/:id/join-requests
  fastify.post(
    '/:id/join-requests',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: teamId } = req.params as { id: string };
      const user = req.user!;

      const client = await pool.connect();
      try {
        const teamRes = await client.query(`SELECT visibility, status FROM teams WHERE id = $1;`, [teamId]);
        if (teamRes.rows.length === 0 || teamRes.rows[0].visibility === 'private') {
          return reply.code(404).send({
            error: { code: 'TEAM_NOT_FOUND', message: 'Team not found', details: {}, requestId: req.id },
          });
        }

        const res = await client.query(
          `INSERT INTO team_join_requests (team_id, user_id, status)
           VALUES ($1, $2, 'PENDING')
           ON CONFLICT DO NOTHING
           RETURNING *;`,
          [teamId, user.id]
        );

        return reply.code(201).send({ request: res.rows[0] || { status: 'PENDING' } });
      } finally {
        client.release();
      }
    }
  );

  // 10. POST /api/v1/teams/:id/members/:userId/decision (Accept or Reject join request)
  fastify.post(
    '/:id/members/:targetUserId/decision',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: teamId, targetUserId } = req.params as { id: string; targetUserId: string };
      const user = req.user!;
      const { decision } = (req.body as any) || {};

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Verify leader or co_leader
        const leadRes = await client.query(
          `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'ACTIVE';`,
          [teamId, user.id]
        );
        if (leadRes.rows.length === 0 || !['leader', 'co_leader'].includes(leadRes.rows[0].role)) {
          return reply.code(403).send({
            error: { code: 'FORBIDDEN', message: 'Only leaders can decide on join requests', details: {}, requestId: req.id },
          });
        }

        if (decision === 'accept') {
          await client.query(
            `INSERT INTO team_members (team_id, user_id, role, status)
             VALUES ($1, $2, 'member', 'ACTIVE')
             ON CONFLICT (team_id, user_id)
             DO UPDATE SET status = 'ACTIVE', role = 'member', joined_at = NOW();`,
            [teamId, targetUserId]
          );

          await client.query(
            `UPDATE team_join_requests
             SET status = 'ACCEPTED', reviewed_by = $1, reviewed_at = NOW()
             WHERE team_id = $2 AND user_id = $3 AND status = 'PENDING';`,
            [user.id, teamId, targetUserId]
          );
        } else {
          await client.query(
            `UPDATE team_join_requests
             SET status = 'REJECTED', reviewed_by = $1, reviewed_at = NOW()
             WHERE team_id = $2 AND user_id = $3 AND status = 'PENDING';`,
            [user.id, teamId, targetUserId]
          );
        }

        await client.query('COMMIT');
        return reply.code(200).send({ success: true, decision });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  );

  // 11. POST /api/v1/teams/:id/leader-transfer
  fastify.post(
    '/:id/leader-transfer',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: teamId } = req.params as { id: string };
      const user = req.user!;
      const { targetUserId } = (req.body as any) || {};

      if (!targetUserId || typeof targetUserId !== 'string') {
        return reply.code(400).send({
          error: { code: 'MISSING_FIELD', message: 'targetUserId is required', details: {}, requestId: req.id },
        });
      }

      try {
        const result = await transferLeadership(teamId, user.id, targetUserId);
        return reply.code(200).send(result);
      } catch (err: any) {
        if (err instanceof TeamError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 12. POST /api/v1/teams/:id/leave
  fastify.post(
    '/:id/leave',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: teamId } = req.params as { id: string };
      const user = req.user!;
      const { successorUserId } = (req.body as any) || {};

      try {
        const result = await leaveTeam(teamId, user.id, successorUserId);
        return reply.code(200).send(result);
      } catch (err: any) {
        if (err instanceof TeamError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 13. POST /api/v1/teams/:id/events/:eventId/register
  fastify.post(
    '/:id/events/:eventId/register',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: teamId, eventId } = req.params as { id: string; eventId: string };
      const user = req.user!;

      const idempotencyKey = (req.headers['idempotency-key'] || req.headers['Idempotency-Key']) as string;
      if (!idempotencyKey) {
        return reply.code(400).send({
          error: {
            code: 'MISSING_IDEMPOTENCY_KEY',
            message: 'Header "Idempotency-Key" is required for team registration',
            details: {},
            requestId: req.id,
          },
        });
      }

      const parseResult = registerTeamSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid registration parameters',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      try {
        const result = await registerTeamForEvent({
          teamId,
          eventId,
          requesterId: user.id,
          ticketTypeId: parseResult.data.ticketTypeId,
          idempotencyKey: idempotencyKey.trim(),
        });

        return reply.code(201).send(result);
      } catch (err: any) {
        if (err instanceof TeamError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 14. POST /api/v1/team-registrations/:id/submission
  fastify.post(
    '/team-registrations/:id/submission',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: registrationId } = req.params as { id: string };
      const user = req.user!;

      const parseResult = submitProjectSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid project deliverable payload',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      try {
        const result = await submitProject({
          teamRegistrationId: registrationId,
          userId: user.id,
          ...parseResult.data,
        });

        return reply.code(201).send({ submission: result });
      } catch (err: any) {
        if (err instanceof TeamError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );
};
