import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  generateOfflineManifest,
  syncOfflineBatch,
  getScanConflicts,
  resolveScanConflict,
} from '../../../services/offline-checkin.js';

const SyncBatchSchema = z.object({
  batchId: z.string().uuid(),
  deviceId: z.string().min(1).max(100),
  ops: z.array(
    z.object({
      opId: z.string().uuid(),
      ticketRef: z.string().min(1).max(64),
      scannedAtLocal: z.string().datetime(),
    })
  ).max(100),
});

const ResolveConflictSchema = z.object({
  resolutionNote: z.string().min(1).max(1000),
  chosenOpId: z.string().uuid().optional(),
});

export async function offlineCheckinRoutes(fastify: FastifyInstance) {
  // 1. GET /events/:id/check-in/manifest (Assigned staff only, short-lived, zero-PII)
  fastify.get(
    '/events/:id/check-in/manifest',
    {
      config: {
        auth: true,
        policy: 'attendance:checkin:assigned',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id: eventId } = req.params as { id: string };
      const query = req.query as { deviceId?: string; expiresInHours?: string };
      const deviceId = query.deviceId || `dev_${req.id.substring(0, 8)}`;
      const expiresInHours = query.expiresInHours ? parseInt(query.expiresInHours, 10) : 4;

      try {
        const manifest = await generateOfflineManifest({
          eventId,
          staffId: req.user!.id,
          deviceId,
          expiresInHours,
        });

        return reply.send(manifest);
      } catch (err: any) {
        if (err.message === 'EVENT_NOT_FOUND') {
          return reply.code(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Event not found',
              requestId: req.id,
            },
          });
        }
        return reply.code(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: err.message || 'Failed to generate offline manifest',
            requestId: req.id,
          },
        });
      }
    }
  );

  // 2. POST /events/:id/check-in/sync-batch (Reconciles batch, idempotent per op_id)
  fastify.post(
    '/events/:id/check-in/sync-batch',
    {
      config: {
        auth: true,
        policy: 'attendance:checkin:assigned',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id: eventId } = req.params as { id: string };
      const parsed = SyncBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid sync batch payload (max 100 ops)',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const result = await syncOfflineBatch({
          eventId,
          staffId: req.user!.id,
          deviceId: parsed.data.deviceId,
          batchId: parsed.data.batchId,
          ops: parsed.data.ops,
        });

        return reply.send(result);
      } catch (err: any) {
        if (err.message === 'BATCH_SIZE_EXCEEDED') {
          return reply.code(400).send({
            error: {
              code: 'BAD_REQUEST',
              message: 'Batch size exceeds 100 operations maximum',
              requestId: req.id,
            },
          });
        }
        return reply.code(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: err.message || 'Batch sync failed',
            requestId: req.id,
          },
        });
      }
    }
  );

  // 3. GET /events/:id/check-in/conflicts (Review duplicate / conflicting scans)
  fastify.get(
    '/events/:id/check-in/conflicts',
    {
      config: {
        auth: true,
        policy: 'attendance:checkin:assigned',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id: eventId } = req.params as { id: string };
      const conflicts = await getScanConflicts(eventId);
      return reply.send({ conflicts });
    }
  );

  // 4. POST /conflicts/:id/resolve (Resolve scan conflict with audited note)
  fastify.post(
    '/conflicts/:id/resolve',
    {
      config: {
        auth: true,
        policy: 'attendance:resolve_conflict',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id: conflictId } = req.params as { id: string };
      const parsed = ResolveConflictSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Resolution note is required',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const resolved = await resolveScanConflict({
          conflictId,
          staffId: req.user!.id,
          resolutionNote: parsed.data.resolutionNote,
          chosenOpId: parsed.data.chosenOpId,
        });

        return reply.send({ conflict: resolved });
      } catch (err: any) {
        if (err.message === 'CONFLICT_NOT_FOUND') {
          return reply.code(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Scan conflict not found',
              requestId: req.id,
            },
          });
        }
        return reply.code(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: err.message || 'Failed to resolve conflict',
            requestId: req.id,
          },
        });
      }
    }
  );
}
