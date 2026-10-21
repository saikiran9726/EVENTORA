import crypto from 'crypto';
import { pool } from '../db/index.js';

export const MANIFEST_HMAC_SECRET = process.env.OFFLINE_MANIFEST_SECRET || 'eventora_offline_manifest_secret_key_32_bytes';

export interface GenerateManifestParams {
  eventId: string;
  staffId: string;
  deviceId: string;
  expiresInHours?: number;
}

export interface SyncBatchParams {
  eventId: string;
  staffId: string;
  deviceId: string;
  batchId: string;
  ops: Array<{
    opId: string;
    ticketRef: string;
    scannedAtLocal: string;
  }>;
}

export interface ResolveConflictParams {
  conflictId: string;
  staffId: string;
  resolutionNote: string;
  chosenOpId?: string;
}

/**
 * Computes deterministic 16-hex-char ticket_ref from ticket qrTokenHash.
 * ZERO PII exposure: names, emails, phones are never present in the manifest!
 */
export function computeTicketRef(tokenHash: Buffer | string, secret = MANIFEST_HMAC_SECRET): string {
  const buf = Buffer.isBuffer(tokenHash) ? tokenHash : Buffer.from(tokenHash, 'hex');
  return crypto.createHmac('sha256', secret).update(buf).digest('hex').substring(0, 16);
}

/**
 * Computes verification HMAC for client local proof verification.
 */
export function computeItemHmac(ref: string, keyId: string, secret = MANIFEST_HMAC_SECRET): string {
  return crypto.createHmac('sha256', secret).update(`${ref}:${keyId}`).digest('hex').substring(0, 32);
}

/**
 * Generates an offline check-in manifest for assigned staff and device.
 * Manifest is short-lived (default 4 hours) and strictly zero-PII.
 */
export async function generateOfflineManifest(params: GenerateManifestParams) {
  const { eventId, staffId, deviceId, expiresInHours = 4 } = params;

  // 1. Verify event exists
  const eventRes = await pool.query(
    `SELECT id, title, starts_at, ends_at FROM events WHERE id = $1;`,
    [eventId]
  );
  if (eventRes.rows.length === 0) {
    throw new Error('EVENT_NOT_FOUND');
  }

  // 2. Query valid tickets for this event (non-cancelled)
  const ticketsRes = await pool.query(
    `SELECT id, qr_token_hash, status
     FROM tickets
     WHERE event_id = $1 AND status != 'CANCELLED';`,
    [eventId]
  );

  const keyId = crypto.randomBytes(8).toString('hex');
  const wrappedKey = crypto
    .createHmac('sha256', MANIFEST_HMAC_SECRET)
    .update(`manifest_wrapped_${keyId}_${staffId}_${deviceId}`)
    .digest('hex');

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + expiresInHours * 3600 * 1000);

  // 3. Project zero-PII manifest items: ref, hmac, hint
  const items = ticketsRes.rows.map((t) => {
    const ref = computeTicketRef(t.qr_token_hash);
    const hmac = computeItemHmac(ref, keyId);
    const hint = `TK-${t.id.substring(0, 4).toUpperCase()}`;
    return {
      ref,
      hmac,
      hint,
    };
  });

  // 4. Save manifest record
  const manifestRes = await pool.query(
    `INSERT INTO offline_manifests (event_id, staff_id, device_id, issued_at, expires_at, ticket_count, key_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, event_id, staff_id, device_id, issued_at, expires_at, ticket_count, key_id;`,
    [eventId, staffId, deviceId, issuedAt, expiresAt, items.length, keyId]
  );

  return {
    manifestId: manifestRes.rows[0].id,
    eventId,
    keyId,
    wrappedKey,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ticketCount: items.length,
    items,
  };
}

/**
 * Reconciles an offline sync batch (up to 100 ops).
 * Idempotent per op_id: replays return identical per-op outcome without duplicate records.
 * Duplicate scans open scan_conflicts with both ops preserved.
 */
export async function syncOfflineBatch(params: SyncBatchParams) {
  const { eventId, staffId, deviceId, batchId, ops } = params;

  if (ops.length > 100) {
    throw new Error('BATCH_SIZE_EXCEEDED'); // max 100 ops per blueprint
  }

  const client = await pool.connect();
  const results: Array<{
    opId: string;
    outcome: 'SYNCED' | 'DUPLICATE' | 'REJECTED' | 'CONFLICT';
    reason: string | null;
  }> = [];

  try {
    await client.query('BEGIN');

    // 1. Ensure batch record exists
    await client.query(
      `INSERT INTO offline_checkin_batches (id, event_id, device_id, staff_id, status, op_count)
       VALUES ($1, $2, $3, $4, 'PROCESSING', $5)
       ON CONFLICT (id) DO UPDATE SET op_count = offline_checkin_batches.op_count + $5;`,
      [batchId, eventId, deviceId, staffId, ops.length]
    );

    // 2. Fetch all tickets for this event with their token hashes to map ticketRefs
    const ticketsRes = await client.query(
      `SELECT id, qr_token_hash, status, checked_in_at, checked_in_by
       FROM tickets
       WHERE event_id = $1;`,
      [eventId]
    );

    const refToTicketMap = new Map<string, any>();
    for (const ticket of ticketsRes.rows) {
      const ref = computeTicketRef(ticket.qr_token_hash);
      refToTicketMap.set(ref, ticket);
    }

    // 3. Process each op in transaction
    for (const op of ops) {
      const { opId, ticketRef, scannedAtLocal } = op;

      // Idempotency check: if op_id already exists, return stored outcome!
      const existingOpRes = await client.query(
        `SELECT op_id, outcome, reason FROM offline_ops WHERE op_id = $1;`,
        [opId]
      );

      if (existingOpRes.rows.length > 0) {
        results.push({
          opId: existingOpRes.rows[0].op_id,
          outcome: existingOpRes.rows[0].outcome,
          reason: existingOpRes.rows[0].reason,
        });
        continue;
      }

      const ticket = refToTicketMap.get(ticketRef);

      if (!ticket) {
        // Unknown ref -> REJECTED
        const outcome = 'REJECTED';
        const reason = 'INVALID_TICKET_REF';
        await client.query(
          `INSERT INTO offline_ops (op_id, batch_id, event_id, ticket_ref, device_id, scanned_at_local, outcome, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
          [opId, batchId, eventId, ticketRef, deviceId, scannedAtLocal, outcome, reason]
        );
        results.push({ opId, outcome, reason });
        continue;
      }

      if (ticket.status === 'CANCELLED') {
        // Revoked or cancelled ticket -> REJECTED
        const outcome = 'REJECTED';
        const reason = 'TICKET_CANCELLED_OR_REVOKED';
        await client.query(
          `INSERT INTO offline_ops (op_id, batch_id, event_id, ticket_ref, device_id, scanned_at_local, outcome, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
          [opId, batchId, eventId, ticketRef, deviceId, scannedAtLocal, outcome, reason]
        );
        results.push({ opId, outcome, reason });
        continue;
      }

      // Check if already checked in
      if (ticket.status === 'CHECKED_IN') {
        const outcome = 'DUPLICATE';
        const reason = 'ALREADY_CHECKED_IN';

        // Record this duplicate op
        await client.query(
          `INSERT INTO offline_ops (op_id, batch_id, event_id, ticket_ref, device_id, scanned_at_local, outcome, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
          [opId, batchId, eventId, ticketRef, deviceId, scannedAtLocal, outcome, reason]
        );

        // Find existing op or checkin to record conflict
        const priorOpsRes = await client.query(
          `SELECT op_id FROM offline_ops WHERE ticket_ref = $1 AND event_id = $2 AND outcome = 'SYNCED';`,
          [ticketRef, eventId]
        );
        const priorOpId = priorOpsRes.rows[0]?.op_id || opId;

        // Open or update scan_conflict
        await client.query(
          `INSERT INTO scan_conflicts (event_id, ticket_id, op_ids, status)
           VALUES ($1, $2, ARRAY[$3, $4]::uuid[], 'OPEN');`,
          [eventId, ticket.id, priorOpId, opId]
        );

        results.push({ opId, outcome, reason });
        continue;
      }

      // Valid ticket -> SYNCED
      const outcome = 'SYNCED';
      const reason = null;

      // Update ticket to CHECKED_IN
      await client.query(
        `UPDATE tickets
         SET status = 'CHECKED_IN', checked_in_at = $1, checked_in_by = $2
         WHERE id = $3;`,
        [scannedAtLocal, staffId, ticket.id]
      );
      ticket.status = 'CHECKED_IN'; // update in-memory map for duplicate checks in same batch

      // Insert checkins record with source offline_sync
      await client.query(
        `INSERT INTO checkins (ticket_id, event_id, staff_id, source, device_id, scanned_at, recorded_at)
         VALUES ($1, $2, $3, 'offline_sync', $4, $5, NOW())
         ON CONFLICT (ticket_id) WHERE session_id IS NULL DO NOTHING;`,
        [ticket.id, eventId, staffId, deviceId, scannedAtLocal]
      );

      // Record offline_ops
      await client.query(
        `INSERT INTO offline_ops (op_id, batch_id, event_id, ticket_ref, device_id, scanned_at_local, outcome, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
        [opId, batchId, eventId, ticketRef, deviceId, scannedAtLocal, outcome, reason]
      );

      results.push({ opId, outcome, reason });
    }

    // Mark batch status PROCESSED
    await client.query(
      `UPDATE offline_checkin_batches SET status = 'PROCESSED' WHERE id = $1;`,
      [batchId]
    );

    await client.query('COMMIT');
    return {
      batchId,
      totalOps: ops.length,
      results,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns scan conflicts for an event, with associated ops details.
 */
export async function getScanConflicts(eventId: string) {
  const res = await pool.query(
    `SELECT sc.id, sc.event_id, sc.ticket_id, sc.op_ids, sc.status, sc.resolved_by, sc.resolution_note, sc.created_at,
            t.owner_user_id, u.display_name as attendee_name, u.email as attendee_email,
            res_u.display_name as resolver_name
     FROM scan_conflicts sc
     JOIN tickets t ON sc.ticket_id = t.id
     JOIN users u ON t.owner_user_id = u.id
     LEFT JOIN users res_u ON sc.resolved_by = res_u.id
     WHERE sc.event_id = $1
     ORDER BY (sc.status = 'OPEN') DESC, sc.created_at DESC;`,
    [eventId]
  );

  // Fetch conflicting ops metadata
  const conflictsWithOps = await Promise.all(
    res.rows.map(async (conflict) => {
      const opsRes = await pool.query(
        `SELECT op_id, batch_id, device_id, scanned_at_local, outcome, reason, created_at
         FROM offline_ops
         WHERE op_id = ANY($1::uuid[]);`,
        [conflict.op_ids]
      );
      return {
        ...conflict,
        conflictingOps: opsRes.rows,
      };
    })
  );

  return conflictsWithOps;
}

/**
 * Resolves a scan conflict with an explicit audited note.
 */
export async function resolveScanConflict(params: ResolveConflictParams) {
  const { conflictId, staffId, resolutionNote } = params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const conflictRes = await client.query(
      `SELECT id, event_id, ticket_id, op_ids, status FROM scan_conflicts WHERE id = $1 FOR UPDATE;`,
      [conflictId]
    );
    if (conflictRes.rows.length === 0) {
      throw new Error('CONFLICT_NOT_FOUND');
    }
    const conflict = conflictRes.rows[0];

    // Update scan conflict
    const updatedRes = await client.query(
      `UPDATE scan_conflicts
       SET status = 'RESOLVED', resolved_by = $1, resolution_note = $2
       WHERE id = $3
       RETURNING id, event_id, ticket_id, status, resolved_by, resolution_note;`,
      [staffId, resolutionNote, conflictId]
    );

    // Audit log entry
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta, created_at)
       VALUES ($1, 'attendance.conflict_resolved', 'scan_conflicts', $2, $3, NOW());`,
      [
        staffId,
        conflictId,
        JSON.stringify({
          eventId: conflict.event_id,
          ticketId: conflict.ticket_id,
          opIds: conflict.op_ids,
          note: resolutionNote,
        }),
      ]
    );

    await client.query('COMMIT');
    return updatedRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
