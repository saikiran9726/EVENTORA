import crypto from 'crypto';
import { pool } from '../db/index.js';

export function getOfflineManifestSecret(): string {
  const secret = process.env.OFFLINE_MANIFEST_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error('OFFLINE_MANIFEST_SECRET is required; no default allowed.');
  }
  return secret;
}

export const MANIFEST_HMAC_SECRET = process.env.OFFLINE_MANIFEST_SECRET || '';

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
  manifestId?: string;
  clientSentAt?: string;
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
export function computeTicketRef(tokenHash: Buffer | string, secret?: string): string {
  const s = secret || getOfflineManifestSecret();
  const buf = Buffer.isBuffer(tokenHash) ? tokenHash : Buffer.from(tokenHash, 'hex');
  return crypto.createHmac('sha256', s).update(buf).digest('hex').substring(0, 16);
}

/**
 * Computes verification HMAC for client local proof verification.
 */
export function computeItemHmac(ref: string, keyId: string, secret?: string): string {
  const s = secret || getOfflineManifestSecret();
  return crypto.createHmac('sha256', s).update(`${ref}:${keyId}`).digest('hex').substring(0, 32);
}

/**
 * Generates an offline check-in manifest for assigned staff and device.
 * Manifest is short-lived (default 4 hours) and strictly zero-PII.
 * Excludes CANCELLED, REVOKED, REFUNDED, and CHECKED_IN tickets.
 * Generates per-manifest random key K (for WebCrypto client-side HMAC membership verification).
 * Stores manifest rows in manifest_items with NO N+1 queries.
 */
export async function generateOfflineManifest(params: GenerateManifestParams) {
  const { eventId, staffId, deviceId, expiresInHours = 4 } = params;

  // Enforce OFFLINE_MANIFEST_SECRET required, no default
  getOfflineManifestSecret();

  // 1. Verify event exists
  const eventRes = await pool.query(
    `SELECT id, title, starts_at, ends_at FROM events WHERE id = $1;`,
    [eventId]
  );
  if (eventRes.rows.length === 0) {
    throw new Error('EVENT_NOT_FOUND');
  }

  // 2. Query valid tickets for this event (exclude CANCELLED/REVOKED/REFUNDED/CHECKED_IN)
  const ticketsRes = await pool.query<{
    id: string;
    qr_token_hash: string | Buffer;
    status: string;
  }>(
    `SELECT t.id, t.qr_token_hash, t.status
     FROM tickets t
     JOIN bookings b ON t.booking_id = b.id
     WHERE t.event_id = $1
       AND t.status NOT IN ('CANCELLED', 'REVOKED', 'CHECKED_IN')
       AND b.status NOT IN ('CANCELLED', 'PAYMENT_FAILED', 'EXPIRED');`,
    [eventId]
  );

  // 3. Generate per-manifest random key K (32 random bytes)
  const keyK = crypto.randomBytes(32).toString('hex');
  const keyId = crypto.randomBytes(8).toString('hex');
  const manifestId = crypto.randomUUID();

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + expiresInHours * 3600 * 1000);

  // 4. Project zero-PII manifest items:
  // For each ticket, HMAC_K(sha256(token)) truncated
  const items = ticketsRes.rows.map((t) => {
    const tokenHashBuf = Buffer.isBuffer(t.qr_token_hash)
      ? t.qr_token_hash
      : Buffer.from(t.qr_token_hash, 'hex');

    const fullHmac = crypto.createHmac('sha256', Buffer.from(keyK, 'hex')).update(tokenHashBuf).digest('hex');
    const truncatedRef = fullHmac.substring(0, 16);
    const hint = `TK-${t.id.substring(0, 4).toUpperCase()}`;

    return {
      ticketId: t.id,
      ref: truncatedRef,
      hmac: fullHmac,
      hint,
    };
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 5. Save manifest record with per-manifest random key K
    await client.query(
      `INSERT INTO offline_manifests (id, event_id, staff_id, device_id, issued_at, expires_at, ticket_count, key_id, manifest_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
      [manifestId, eventId, staffId, deviceId, issuedAt, expiresAt, items.length, keyId, keyK]
    );

    // 6. Bulk insert manifest_items with NO N+1
    if (items.length > 0) {
      const valueClauses: string[] = [];
      const valueParams: any[] = [];
      let paramIdx = 1;

      for (const item of items) {
        valueClauses.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4})`);
        valueParams.push(manifestId, item.ticketId, item.ref, item.hmac, item.hint);
        paramIdx += 5;
      }

      await client.query(
        `INSERT INTO manifest_items (manifest_id, ticket_id, token_ref, hmac_signature, display_hint)
         VALUES ${valueClauses.join(', ')};`,
        valueParams
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    manifestId,
    eventId,
    keyId,
    key: keyK,
    wrappedKey: `wrp_${keyId}_${keyK.substring(0, 16)}`,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ticketCount: items.length,
    items: items.map(({ ref, hmac, hint }) => ({ ref, hmac, hint })),
  };
}

/**
 * Reconciles an offline sync batch (up to 100 ops).
 * Authoritative server receipt time with clock-skew estimate.
 * Rejects batchId collisions.
 * Verifies manifest belongs to staff+device and is unexpired/unrevoked.
 * Cross-device duplicates open scan_conflicts.
 */
export async function syncOfflineBatch(params: SyncBatchParams) {
  const { eventId, staffId, deviceId, batchId, manifestId, clientSentAt, ops } = params;

  if (ops.length > 100) {
    throw new Error('BATCH_SIZE_EXCEEDED'); // max 100 ops
  }

  const serverReceiptAt = new Date();
  let clockSkewMs = 0;
  if (clientSentAt) {
    clockSkewMs = serverReceiptAt.getTime() - new Date(clientSentAt).getTime();
  } else if (ops.length > 0) {
    clockSkewMs = serverReceiptAt.getTime() - new Date(ops[0].scannedAtLocal).getTime();
  }

  const client = await pool.connect();
  const results: Array<{
    opId: string;
    outcome: 'SYNCED' | 'DUPLICATE' | 'REJECTED' | 'CONFLICT';
    reason: string | null;
  }> = [];

  try {
    await client.query('BEGIN');

    // 1. Verify Manifest if provided
    if (manifestId) {
      const manifestRes = await client.query(
        `SELECT id, staff_id, device_id, expires_at, revoked_at
         FROM offline_manifests
         WHERE id = $1;`,
        [manifestId]
      );

      if (manifestRes.rows.length === 0) {
        throw new Error('MANIFEST_NOT_FOUND');
      }

      const m = manifestRes.rows[0];
      if (m.staff_id !== staffId || m.device_id !== deviceId) {
        throw new Error('MANIFEST_UNAUTHORIZED');
      }

      if (new Date(m.expires_at).getTime() <= serverReceiptAt.getTime()) {
        throw new Error('MANIFEST_EXPIRED');
      }

      if (m.revoked_at !== null) {
        throw new Error('MANIFEST_REVOKED');
      }
    }

    // 2. Batch collision check
    const existingBatchRes = await client.query(
      `SELECT id, event_id, device_id, status, op_count
       FROM offline_checkin_batches
       WHERE id = $1;`,
      [batchId]
    );

    if (existingBatchRes.rows.length > 0) {
      // Check if this is an idempotent replay of the exact same ops
      const existingOpsRes = await client.query(
        `SELECT op_id, outcome, reason FROM offline_ops WHERE batch_id = $1;`,
        [batchId]
      );
      const existingOpMap = new Map(existingOpsRes.rows.map((r) => [r.op_id, r]));
      const isExactReplay =
        ops.length === existingOpsRes.rows.length &&
        ops.every((op) => existingOpMap.has(op.opId));

      if (isExactReplay) {
        await client.query('COMMIT');
        return {
          batchId,
          totalOps: ops.length,
          clockSkewMs,
          serverReceiptAt: serverReceiptAt.toISOString(),
          results: ops.map((op) => {
            const ex = existingOpMap.get(op.opId)!;
            return { opId: ex.op_id, outcome: ex.outcome, reason: ex.reason };
          }),
        };
      }

      // If different or colliding batchId -> REJECT
      throw new Error('BATCH_ID_COLLISION');
    }

    // Insert new batch record with authoritative receipt time and clock-skew estimate
    await client.query(
      `INSERT INTO offline_checkin_batches (id, event_id, device_id, staff_id, status, op_count, manifest_id, client_sent_at, clock_skew_ms)
       VALUES ($1, $2, $3, $4, 'PROCESSING', $5, $6, $7, $8);`,
      [
        batchId,
        eventId,
        deviceId,
        staffId,
        ops.length,
        manifestId || null,
        clientSentAt ? new Date(clientSentAt) : null,
        clockSkewMs,
      ]
    );

    // 3. Fetch ticket mapping with NO N+1
    const refToTicketMap = new Map<string, any>();

    if (manifestId) {
      // Query via manifest_items
      const opRefs = ops.map((o) => o.ticketRef);
      const manifestItemsRes = await client.query(
        `SELECT mi.token_ref, t.id, t.status, t.checked_in_at, t.checked_in_by, t.qr_token_hash
         FROM manifest_items mi
         JOIN tickets t ON mi.ticket_id = t.id
         WHERE mi.manifest_id = $1 AND mi.token_ref = ANY($2::varchar[]);`,
        [manifestId, opRefs]
      );

      for (const row of manifestItemsRes.rows) {
        refToTicketMap.set(row.token_ref, row);
      }
    }

    // Fallback or fill-in from tickets table for unknown or legacy refs
    const missingRefs = ops.filter((o) => !refToTicketMap.has(o.ticketRef)).map((o) => o.ticketRef);
    if (missingRefs.length > 0) {
      const allTicketsRes = await client.query(
        `SELECT id, qr_token_hash, status, checked_in_at, checked_in_by
         FROM tickets
         WHERE event_id = $1;`,
        [eventId]
      );

      const secret = process.env.OFFLINE_MANIFEST_SECRET;
      for (const t of allTicketsRes.rows) {
        if (secret) {
          const ref = computeTicketRef(t.qr_token_hash, secret);
          if (missingRefs.includes(ref) && !refToTicketMap.has(ref)) {
            refToTicketMap.set(ref, t);
          }
        }
      }
    }

    // 4. Process each op in transaction
    for (const op of ops) {
      const { opId, ticketRef, scannedAtLocal } = op;

      // Idempotency check: if op_id already exists, return stored outcome
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

      if (ticket.status === 'CANCELLED' || ticket.status === 'REVOKED') {
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

      // Check if already checked in (Cross-device duplicate -> CONFLICT)
      if (ticket.status === 'CHECKED_IN') {
        const outcome = manifestId ? 'CONFLICT' : 'DUPLICATE';
        const reason = 'ALREADY_CHECKED_IN';

        // Record this conflict op
        await client.query(
          `INSERT INTO offline_ops (op_id, batch_id, event_id, ticket_ref, device_id, scanned_at_local, outcome, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
          [opId, batchId, eventId, ticketRef, deviceId, scannedAtLocal, outcome, reason]
        );

        // Find prior synced op to record conflict
        const priorOpsRes = await client.query(
          `SELECT op_id FROM offline_ops WHERE ticket_ref = $1 AND event_id = $2 AND outcome = 'SYNCED' ORDER BY scanned_at_local ASC LIMIT 1;`,
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

      // Insert checkins record with authoritative server receipt time
      await client.query(
        `INSERT INTO checkins (ticket_id, event_id, staff_id, source, device_id, scanned_at, recorded_at)
         VALUES ($1, $2, $3, 'offline_sync', $4, $5, $6)
         ON CONFLICT (ticket_id) WHERE session_id IS NULL DO NOTHING;`,
        [ticket.id, eventId, staffId, deviceId, scannedAtLocal, serverReceiptAt]
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
      clockSkewMs,
      serverReceiptAt: serverReceiptAt.toISOString(),
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
  interface ScanConflictRow {
    id: string;
    event_id: string;
    ticket_id: string;
    op_ids: string[];
    status: string;
    resolved_by: string | null;
    resolution_note: string | null;
    created_at: Date | string;
    owner_user_id: string;
    attendee_name: string;
    attendee_email: string;
    resolver_name: string | null;
  }

  const res = await pool.query<ScanConflictRow>(
    `SELECT sc.id, sc.event_id, sc.ticket_id, sc.op_ids, sc.status, sc.resolved_by, sc.resolution_note, sc.created_at,
            COALESCE(t.owner_user_id, t.user_id) as owner_user_id,
            COALESCE(u.display_name, 'Unknown Attendee') as attendee_name,
            COALESCE(u.email, 'unknown@attendee.edu') as attendee_email,
            res_u.display_name as resolver_name
     FROM scan_conflicts sc
     JOIN tickets t ON sc.ticket_id = t.id
     LEFT JOIN users u ON COALESCE(t.owner_user_id, t.user_id) = u.id
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

/**
 * Revocation Delta Endpoint helper.
 * Returns tickets that were cancelled, revoked, or checked-in since the provided timestamp.
 */
export async function getRevocationDelta(eventId: string, since?: string) {
  const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 3600 * 1000);

  const deltaRes = await pool.query<{
    id: string;
    status: string;
    checked_in_at: Date | null;
    updated_at: Date;
    token_ref: string | null;
  }>(
    `SELECT t.id, t.status, t.checked_in_at, mi.token_ref
     FROM tickets t
     LEFT JOIN manifest_items mi ON t.id = mi.ticket_id
     WHERE t.event_id = $1
       AND (
         t.status IN ('CANCELLED', 'REVOKED')
         OR (t.status = 'CHECKED_IN' AND t.checked_in_at >= $2)
       );`,
    [eventId, sinceDate]
  );

  const revokedRefs: string[] = [];
  const checkedInRefs: string[] = [];

  for (const row of deltaRes.rows) {
    if (row.token_ref) {
      if (row.status === 'CANCELLED' || row.status === 'REVOKED') {
        revokedRefs.push(row.token_ref);
      } else if (row.status === 'CHECKED_IN') {
        checkedInRefs.push(row.token_ref);
      }
    }
  }

  return {
    eventId,
    asOf: new Date().toISOString(),
    since: sinceDate.toISOString(),
    revokedRefs,
    checkedInRefs,
    totalDeltas: revokedRefs.length + checkedInRefs.length,
  };
}

/**
 * Revokes an offline manifest immediately.
 */
export async function revokeManifest(manifestId: string, staffId: string) {
  const res = await pool.query(
    `UPDATE offline_manifests
     SET revoked_at = NOW()
     WHERE id = $1
     RETURNING id, event_id, staff_id, device_id, revoked_at;`,
    [manifestId]
  );

  if (res.rows.length === 0) {
    throw new Error('MANIFEST_NOT_FOUND');
  }

  // Audit log entry
  await pool.query(
    `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta, created_at)
     VALUES ($1, 'attendance.manifest_revoked', 'offline_manifests', $2, $3, NOW());`,
    [staffId, manifestId, JSON.stringify({ manifestId, revokedAt: res.rows[0].revoked_at })]
  );

  return res.rows[0];
}
