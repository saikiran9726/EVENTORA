import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getColleges,
  verifyCollege,
  verifyOrganizer,
  getOrganizerVerification,
  getPublicCrossCollegeEvents,
  getOrCreatePassportSettings,
  updatePassportSettings,
  getStudentAchievements,
  getPublicPassport,
} from '../../../services/passport-crosscollege.js';

const VerifyCollegeSchema = z.object({
  participationStatus: z.enum(['none', 'pending', 'participating']),
});

const VerifyOrganizerSchema = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']),
  evidenceRef: z.string().optional(),
});

const UpdatePassportSettingsSchema = z.object({
  isPublic: z.boolean().optional(),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/i, 'Slug must contain only alphanumeric and dash characters').optional(),
  showAttendance: z.boolean().optional(),
  showVolunteer: z.boolean().optional(),
  showCertificates: z.boolean().optional(),
});

const PublicEventsFilterSchema = z.object({
  collegeId: z.string().uuid().optional(),
  q: z.string().optional(),
  category: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function handleGetPublicPassportRoute(req: FastifyRequest, reply: FastifyReply) {
  const { slug } = req.params as { slug: string };

  // Ensure no CDN caching so visibility changes take immediate effect
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  reply.header('Pragma', 'no-cache');

  try {
    const passport = await getPublicPassport(slug, req.ip || '127.0.0.1');
    if (!passport) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Public passport not found.',
          requestId: req.id,
        },
      });
    }

    return reply.send(passport);
  } catch (err: any) {
    if (err.message && err.message.includes('rate limit exceeded')) {
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: err.message,
          details: { limit: 30, window: '60s' },
          requestId: req.id,
        },
      });
    }
    throw err;
  }
}

export async function crossCollegePassportRoutes(fastify: FastifyInstance) {
  // 1. GET /colleges (Public list of participating institutions)
  fastify.get(
    '/colleges',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const colleges = await getColleges();
      return reply.send({ colleges });
    }
  );

  // 2. GET /public/events (Anonymous cross-college public discovery)
  fastify.get(
    '/public/events',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = PublicEventsFilterSchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters for public events filter',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      const events = await getPublicCrossCollegeEvents(parsed.data);
      return reply.send({ events });
    }
  );

  // 3. GET /organizers/:id/verification (Public organizer verification state)
  fastify.get(
    '/organizers/:id/verification',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id: organizerId } = req.params as { id: string };
      const verification = await getOrganizerVerification(organizerId);
      return reply.send(verification);
    }
  );

  // 4. POST /admin/colleges/:id/verify (Admin college verification)
  fastify.post(
    '/admin/colleges/:id/verify',
    {
      config: {
        auth: true,
        policy: 'user:manage',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id: collegeId } = req.params as { id: string };
      const parsed = VerifyCollegeSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid college verification payload',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const college = await verifyCollege({
          collegeId,
          participationStatus: parsed.data.participationStatus,
          adminId: req.user!.id,
        });
        return reply.send({ college });
      } catch (err: any) {
        if (err.message === 'COLLEGE_NOT_FOUND') {
          return reply.code(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'College not found',
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 5. POST /admin/organizers/:id/verify (Admin organizer verification)
  fastify.post(
    '/admin/organizers/:id/verify',
    {
      config: {
        auth: true,
        policy: 'user:manage',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id: organizerId } = req.params as { id: string };
      const parsed = VerifyOrganizerSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid organizer verification payload',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      const verification = await verifyOrganizer({
        organizerId,
        status: parsed.data.status,
        evidenceRef: parsed.data.evidenceRef || 'Verified official campus club charter',
        adminId: req.user!.id,
      });

      return reply.send({ verification });
    }
  );

  // 5b. POST /organizers/:id/verification (Compatibility alias for admin organizer verification)
  fastify.post(
    '/organizers/:id/verification',
    {
      config: {
        auth: true,
        policy: 'user:manage',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id: organizerId } = req.params as { id: string };
      const parsed = VerifyOrganizerSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid organizer verification payload',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      const verification = await verifyOrganizer({
        organizerId,
        status: parsed.data.status,
        evidenceRef: parsed.data.evidenceRef || 'Verified official campus club charter',
        adminId: req.user!.id,
      });

      return reply.send({ verification });
    }
  );

  // 6. GET /me/passport (Authenticated student passport settings & summary)
  const handleGetMyPassport = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user!.id;
    const settings = await getOrCreatePassportSettings(userId);
    const achievements = await getStudentAchievements(userId);

    const stats = {
      totalAchievements: achievements.length,
      verifiedCount: achievements.filter((a) => a.verificationStatus === 'VERIFIED').length,
      attendanceCount: achievements.filter((a) => a.type === 'ATTENDANCE').length,
      volunteerCount: achievements.filter((a) => a.type === 'VOLUNTEER').length,
      certificateCount: achievements.filter((a) => a.type === 'CERTIFICATE').length,
    };

    return reply.send({ settings, stats, achievements });
  };

  fastify.get('/me/passport', { config: { auth: true, policy: 'authenticated', objectCheck: false } }, handleGetMyPassport);
  fastify.get('/users/me/passport', { config: { auth: true, policy: 'authenticated', objectCheck: false } }, handleGetMyPassport);

  // 7. GET /me/achievements (Authenticated student achievements list)
  const handleGetMyAchievements = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user!.id;
    const achievements = await getStudentAchievements(userId);
    return reply.send({ achievements });
  };

  fastify.get('/me/achievements', { config: { auth: true, policy: 'authenticated', objectCheck: false } }, handleGetMyAchievements);
  fastify.get('/users/me/achievements', { config: { auth: true, policy: 'authenticated', objectCheck: false } }, handleGetMyAchievements);

  // 8. PATCH /me/passport/visibility (Toggle public visibility & categories)
  const handleUpdatePassportVisibility = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user!.id;
    const parsed = UpdatePassportSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid passport settings payload',
          details: parsed.error.format(),
          requestId: req.id,
        },
      });
    }

    try {
      const updated = await updatePassportSettings(userId, parsed.data);
      return reply.send({ settings: updated });
    } catch (err: any) {
      if (err.code === '23505') {
        return reply.code(409).send({
          error: {
            code: 'SLUG_TAKEN',
            message: 'This passport public URL handle is already taken. Please pick another.',
            requestId: req.id,
          },
        });
      }
      throw err;
    }
  };

  fastify.patch('/me/passport/visibility', { config: { auth: true, policy: 'authenticated', objectCheck: false } }, handleUpdatePassportVisibility);
  fastify.patch('/users/me/passport/visibility', { config: { auth: true, policy: 'authenticated', objectCheck: false } }, handleUpdatePassportVisibility);

  // 9. Public GET /p/:slug (Public Passport Timeline & Verified Achievements)
  // CRITICAL RULE: Cache-Control: no-store; 404 when not public (indistinguishable from nonexistent)
  fastify.get(
    '/p/:slug',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    handleGetPublicPassportRoute
  );

  // 10. REJECTION OF SELF-ENTERED ACHIEVEMENTS (Security Gate Rule)
  const rejectSelfEnteredAchievements = async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.code(405).send({
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message:
          'Student achievements cannot be self-entered. Achievements are recorded exclusively via verified event check-in, certificate issuance, or volunteer verification.',
        requestId: req.id,
      },
    });
  };

  fastify.post('/me/achievements', { config: { auth: true, policy: 'authenticated', objectCheck: false } }, rejectSelfEnteredAchievements);
  fastify.post('/users/me/achievements', { config: { auth: true, policy: 'authenticated', objectCheck: false } }, rejectSelfEnteredAchievements);
}
