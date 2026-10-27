import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from '../../../db/index.js';
import {
  createVolunteerRole,
  getVolunteerRoles,
  createVolunteerShift,
  applyForShift,
  approveVolunteerApplication,
  assignVolunteerApplication,
  rejectVolunteerApplication,
  cancelVolunteerApplication,
  checkInVolunteer,
  completeVolunteerShift,
  getUserVolunteering,
  getVenuePublic,
  requestEquipment,
  createSupportIssue,
  getSupportIssues,
  updateSupportIssue,
  registerGuest,
  VolunteerError,
} from '../../../services/volunteers-operations.js';

// Request Validation Schemas
const CreateRoleSchema = z.object({
  title: z.string().min(1).max(255),
  requirements: z.string().optional(),
  capacity: z.number().int().positive(),
});

const CreateShiftSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  capacity: z.number().int().positive(),
  venueId: z.string().uuid().optional().nullable(),
});

const EquipmentRequestSchema = z.object({
  itemId: z.string().uuid(),
  qty: z.number().int().positive(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

const SupportIssueSchema = z.object({
  category: z.string().min(1).max(100),
  title: z.string().min(1).max(255),
  description: z.string().min(1).max(2000),
});

const UpdateIssueSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  ownerId: z.string().uuid().optional().nullable(),
  note: z.string().min(1).max(1000),
});

const GuestRegistrationSchema = z.object({
  name: z.string().min(1).max(255),
  contact: z.string().min(1).max(100),
});

export async function volunteerRoutes(fastify: FastifyInstance) {
  // 1. Create Volunteer Role (POST /events/:id/volunteer-roles)
  fastify.post(
    '/events/:id/volunteer-roles',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const parsed = CreateRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid role attributes',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const role = await createVolunteerRole(
          { eventId: req.params.id, ...parsed.data },
          req.user!.id
        );
        return reply.code(201).send({ role });
      } catch (err: any) {
        return reply.code(500).send({
          error: { code: 'ROLE_CREATION_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 2. Get Volunteer Roles for Event (GET /events/:id/volunteer-roles)
  fastify.get(
    '/events/:id/volunteer-roles',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const roles = await getVolunteerRoles(req.params.id, req.user?.id);
        return reply.code(200).send({ roles });
      } catch (err: any) {
        if (err instanceof VolunteerError) {
          return reply.code(err.status).send({
            error: { code: err.code, message: err.message, details: err.details || {}, requestId: req.id },
          });
        }
        return reply.code(500).send({
          error: { code: 'FETCH_ROLES_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 3. Create Volunteer Shift (POST /volunteer-roles/:id/shifts)
  fastify.post(
    '/volunteer-roles/:id/shifts',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: true,
        resolveEventId: async (req) => {
          const client = await pool.connect();
          try {
            const res = await client.query('SELECT event_id FROM volunteer_roles WHERE id = $1', [(req.params as any).id]);
            return res.rows[0]?.event_id || null;
          } finally {
            client.release();
          }
        },
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const parsed = CreateShiftSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid shift parameters',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const shift = await createVolunteerShift(
          { roleId: req.params.id, ...parsed.data },
          req.user!.id
        );
        return reply.code(201).send({ shift });
      } catch (err: any) {
        return reply.code(400).send({
          error: { code: 'SHIFT_CREATION_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 4. Apply for Shift (POST /shifts/:id/applications)
  fastify.post(
    '/shifts/:id/applications',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const application = await applyForShift(req.params.id, req.user!.id);
        return reply.code(201).send({ application });
      } catch (err: any) {
        if (err instanceof VolunteerError) {
          return reply.code(err.status).send({
            error: { code: err.code, message: err.message, details: err.details || {}, requestId: req.id },
          });
        }
        return reply.code(500).send({
          error: { code: 'APPLICATION_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 5. Get Shift Applications (GET /shifts/:id/applications) - Scoped to event managers
  fastify.get(
    '/shifts/:id/applications',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: true,
        resolveEventId: async (req) => {
          const client = await pool.connect();
          try {
            const res = await client.query(
              `SELECT vr.event_id FROM volunteer_shifts vs
               JOIN volunteer_roles vr ON vs.role_id = vr.id
               WHERE vs.id = $1`,
              [(req.params as any).id]
            );
            return res.rows[0]?.event_id || null;
          } finally {
            client.release();
          }
        },
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const client = await pool.connect();
      try {
        const res = await client.query(
          `SELECT a.id, a.shift_id, a.user_id, a.status, a.created_at,
                  u.display_name AS "userName", u.email AS "userEmail"
           FROM volunteer_applications a
           JOIN users u ON u.id = a.user_id
           WHERE a.shift_id = $1
           ORDER BY a.created_at ASC;`,
          [req.params.id]
        );
        return reply.code(200).send({ applications: res.rows });
      } finally {
        client.release();
      }
    }
  );

  const resolveApplicationEventId = async (req: FastifyRequest) => {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT vr.event_id FROM volunteer_applications va
         JOIN volunteer_shifts vs ON va.shift_id = vs.id
         JOIN volunteer_roles vr ON vs.role_id = vr.id
         WHERE va.id = $1`,
        [(req.params as any).id]
      );
      return res.rows[0]?.event_id || null;
    } finally {
      client.release();
    }
  };

  // 6. Approve Application (POST /applications/:id/approve)
  fastify.post(
    '/applications/:id/approve',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: true,
        resolveEventId: resolveApplicationEventId,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const application = await approveVolunteerApplication(req.params.id, req.user!.id);
        return reply.code(200).send({ application });
      } catch (err: any) {
        return reply.code(400).send({
          error: { code: 'INVALID_TRANSITION', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 7. Assign Application (POST /applications/:id/assign)
  fastify.post(
    '/applications/:id/assign',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: true,
        resolveEventId: resolveApplicationEventId,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const assigned = await assignVolunteerApplication(req.params.id, req.user!.id);
        return reply.code(200).send({ application: assigned });
      } catch (err: any) {
        if (err.code === 'CAPACITY_EXCEEDED') {
          return reply.code(409).send({
            error: {
              code: 'CAPACITY_EXCEEDED',
              message: 'Volunteer shift has reached maximum allocated capacity',
              requestId: req.id,
            },
          });
        }
        if (err.code === 'OVERLAPPING_SHIFT_ASSIGNMENT') {
          return reply.code(409).send({
            error: {
              code: 'OVERLAPPING_SHIFT_ASSIGNMENT',
              message: 'Volunteer is already assigned to a concurrent overlapping shift',
              requestId: req.id,
            },
          });
        }
        return reply.code(400).send({
          error: { code: 'ASSIGNMENT_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 8. Reject Application (POST /applications/:id/reject)
  fastify.post(
    '/applications/:id/reject',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: true,
        resolveEventId: resolveApplicationEventId,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>, reply: FastifyReply) => {
      try {
        const application = await rejectVolunteerApplication(
          req.params.id,
          req.user!.id,
          req.body?.reason
        );
        return reply.code(200).send({ application });
      } catch (err: any) {
        return reply.code(400).send({
          error: { code: 'REJECTION_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 9. Cancel Application (POST /applications/:id/cancel)
  fastify.post(
    '/applications/:id/cancel',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const cancelled = await cancelVolunteerApplication(req.params.id, req.user!.id);
        return reply.code(200).send({ application: cancelled });
      } catch (err: any) {
        return reply.code(400).send({
          error: { code: 'CANCELLATION_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 10. Check In Volunteer (POST /applications/:id/check-in)
  fastify.post(
    '/applications/:id/check-in',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string }; Body?: { token?: string } }>, reply: FastifyReply) => {
      try {
        const checkedIn = await checkInVolunteer(req.params.id, req.user!.id, req.body?.token);
        return reply.code(200).send({ application: checkedIn });
      } catch (err: any) {
        const status = err.status || 400;
        return reply.code(status).send({
          error: { code: err.code || 'CHECKIN_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 11. Complete Volunteer Shift (POST /applications/:id/complete)
  fastify.post(
    '/applications/:id/complete',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: true,
        resolveEventId: resolveApplicationEventId,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const completed = await completeVolunteerShift(req.params.id, req.user!.id);
        return reply.code(200).send({ completed });
      } catch (err: any) {
        const status = err.status || 400;
        return reply.code(status).send({
          error: { code: err.code || 'COMPLETION_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 12. User Volunteering Hub (GET /me/volunteering)
  fastify.get(
    '/me/volunteering',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const data = await getUserVolunteering(req.user!.id);
        return reply.code(200).send({ volunteering: data });
      } catch (err: any) {
        return reply.code(500).send({
          error: { code: 'FETCH_VOLUNTEERING_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 13. Public Venue Details (GET /venues/:id)
  fastify.get(
    '/venues/:id',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const venue = await getVenuePublic(req.params.id);
        if (!venue) {
          return reply.code(404).send({
            error: { code: 'VENUE_NOT_FOUND', message: 'Venue not found', requestId: req.id },
          });
        }
        return reply.code(200).send({ venue });
      } catch (err: any) {
        return reply.code(500).send({
          error: { code: 'FETCH_VENUE_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 14. Request Equipment (POST /events/:id/equipment-requests)
  fastify.post(
    '/events/:id/equipment-requests',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const parsed = EquipmentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid equipment request payload',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const request = await requestEquipment(
          { eventId: req.params.id, ...parsed.data },
          req.user!.id
        );
        return reply.code(201).send({ request });
      } catch (err: any) {
        if (err.code === 'EQUIPMENT_UNAVAILABLE') {
          return reply.code(409).send({
            error: {
              code: 'EQUIPMENT_UNAVAILABLE',
              message: err.message,
              requestId: req.id,
            },
          });
        }
        return reply.code(400).send({
          error: { code: 'EQUIPMENT_REQUEST_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 15. Create Support Issue (POST /events/:id/issues)
  fastify.post(
    '/events/:id/issues',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const parsed = SupportIssueSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid support issue payload',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const issue = await createSupportIssue({
          eventId: req.params.id,
          reporterId: req.user!.id,
          ...parsed.data,
        });
        return reply.code(201).send({ issue });
      } catch (err: any) {
        return reply.code(500).send({
          error: { code: 'ISSUE_CREATION_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 16. Get Support Issues for Event (GET /events/:id/issues)
  fastify.get(
    '/events/:id/issues',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const issues = await getSupportIssues(req.params.id);
        return reply.code(200).send({ issues });
      } catch (err: any) {
        return reply.code(500).send({
          error: { code: 'FETCH_ISSUES_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 17. Update Support Issue (PATCH /issues/:id)
  fastify.patch(
    '/issues/:id',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: true,
        resolveEventId: async (req) => {
          const client = await pool.connect();
          try {
            const res = await client.query('SELECT event_id FROM support_issues WHERE id = $1', [(req.params as any).id]);
            return res.rows[0]?.event_id || null;
          } finally {
            client.release();
          }
        },
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const parsed = UpdateIssueSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid issue update payload',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const updated = await updateSupportIssue(req.params.id, req.user!.id, parsed.data);
        return reply.code(200).send({ issue: updated });
      } catch (err: any) {
        return reply.code(400).send({
          error: { code: 'ISSUE_UPDATE_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );

  // 18. Guest Registration (POST /events/:id/guests)
  fastify.post(
    '/events/:id/guests',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const parsed = GuestRegistrationSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid guest registration payload',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const guest = await registerGuest(
          req.params.id,
          parsed.data.name,
          parsed.data.contact,
          req.user!.id
        );
        return reply.code(201).send(guest);
      } catch (err: any) {
        if (err.code === 'GUEST_REGISTRATION_DISABLED') {
          return reply.code(403).send({
            error: {
              code: 'GUEST_REGISTRATION_DISABLED',
              message: err.message,
              requestId: req.id,
            },
          });
        }
        return reply.code(400).send({
          error: { code: 'GUEST_REGISTRATION_FAILED', message: err.message, requestId: req.id },
        });
      }
    }
  );
}
