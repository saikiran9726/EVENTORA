import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from '../../../db/index.js';
import {
  generateOfflineManifest,
  syncOfflineBatch,
  getScanConflicts,
  resolveScanConflict,
  getRevocationDelta,
  revokeManifest,
} from '../../../services/offline-checkin.js';

const SyncBatchSchema = z.object({
  batchId: z.string().uuid(),
  deviceId: z.string().min(1).max(100),
  manifestId: z.string().uuid().optional(),
  clientSentAt: z.string().datetime().optional(),
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
        if (err.message?.includes('OFFLINE_MANIFEST_SECRET')) {
          return reply.code(500).send({
            error: {
              code: 'CONFIG_ERROR',
              message: 'OFFLINE_MANIFEST_SECRET is required on server',
              requestId: req.id,
            },
          });
        }
        return reply.code(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to generate offline manifest',
            requestId: req.id,
          },
        });
      }
    }
  );

  // 2. POST /events/:id/check-in/sync-batch (Reconciles batch, authoritative receipt, clock skew, collision checks)
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
          manifestId: parsed.data.manifestId,
          clientSentAt: parsed.data.clientSentAt,
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
        if (err.message === 'BATCH_ID_COLLISION') {
          return reply.code(409).send({
            error: {
              code: 'BATCH_ID_COLLISION',
              message: 'A batch with this ID has already been processed or collided with another device submission',
              requestId: req.id,
            },
          });
        }
        if (err.message === 'MANIFEST_EXPIRED') {
          return reply.code(400).send({
            error: {
              code: 'MANIFEST_EXPIRED',
              message: 'Offline manifest has expired; batch sync blocked',
              requestId: req.id,
            },
          });
        }
        if (err.message === 'MANIFEST_REVOKED') {
          return reply.code(400).send({
            error: {
              code: 'MANIFEST_REVOKED',
              message: 'Offline manifest has been revoked; batch sync blocked',
              requestId: req.id,
            },
          });
        }
        if (err.message === 'MANIFEST_UNAUTHORIZED' || err.message === 'MANIFEST_NOT_FOUND') {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'Manifest does not match authenticated staff user or device',
              requestId: req.id,
            },
          });
        }
        return reply.code(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Batch sync failed',
            requestId: req.id,
          },
        });
      }
    }
  );

  // 3. GET /events/:id/check-in/delta (Revocation delta endpoint)
  fastify.get(
    '/events/:id/check-in/delta',
    {
      config: {
        auth: true,
        policy: 'attendance:checkin:assigned',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id: eventId } = req.params as { id: string };
      const query = req.query as { since?: string };

      try {
        const delta = await getRevocationDelta(eventId, query.since);
        return reply.send(delta);
      } catch {
        return reply.code(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch revocation delta',
            requestId: req.id,
          },
        });
      }
    }
  );

  // 4. POST /events/:id/check-in/manifest/:manifestId/revoke (Revoke manifest)
  fastify.post(
    '/events/:id/check-in/manifest/:manifestId/revoke',
    {
      config: {
        auth: true,
        policy: 'attendance:checkin:assigned',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { manifestId } = req.params as { manifestId: string };

      try {
        const revoked = await revokeManifest(manifestId, req.user!.id);
        return reply.send({ success: true, manifest: revoked });
      } catch (err: any) {
        if (err.message === 'MANIFEST_NOT_FOUND') {
          return reply.code(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Manifest not found',
              requestId: req.id,
            },
          });
        }
        return reply.code(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to revoke manifest',
            requestId: req.id,
          },
        });
      }
    }
  );

  // 5. GET /events/:id/check-in/conflicts (Review duplicate / conflicting scans)
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

  // 6. POST /conflicts/:id/resolve (Resolve scan conflict with audited note)
  fastify.post(
    '/conflicts/:id/resolve',
    {
      config: {
        auth: true,
        policy: 'attendance:resolve_conflict',
        objectCheck: true,
        resolveEventId: async (req) => {
          const { id } = req.params as { id: string };
          const client = await pool.connect();
          try {
            const res = await client.query('SELECT event_id FROM scan_conflicts WHERE id = $1', [id]);
            return res.rows[0]?.event_id || null;
          } finally {
            client.release();
          }
        },
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
            message: 'Failed to resolve conflict',
            requestId: req.id,
          },
        });
      }
    }
  );
}
