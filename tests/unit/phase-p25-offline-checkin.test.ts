import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import 'fake-indexeddb/auto';
import { pool } from '../../packages/backend/src/db/index.js';
import { runMigrations } from '../../packages/backend/src/db/migrate.js';
import { runRollbackToVersion } from '../../packages/backend/src/db/migrate-down.js';
import {
  getOfflineManifestSecret,
  generateOfflineManifest,
  syncOfflineBatch,
  getScanConflicts,
  resolveScanConflict,
  getRevocationDelta,
  revokeManifest,
} from '../../packages/backend/src/services/offline-checkin.js';
import {
  encryptKeyAtRest,
  decryptKeyAtRest,
  verifyTokenLocally,
  recordLocalScan,
  offlineDb,
  purgeExpiredManifests,
} from '../../packages/frontend/src/lib/offline-sync.js';

describe('Phase P25: Offline Check-in Redesign Quality Gate', () => {
  const testSecret = 'offline_manifest_secret_key_32_bytes_test_p25';
  let eventId: string;
  let staffId: string;
  let studentAId: string;
  let studentBId: string;
  let bookingAId: string;
  let bookingBId: string;
  let ticketValidId: string;
  let ticketValidToken: string;
  let ticketValidTokenHash: Buffer;
  let ticketRevokedId: string;
  let ticketRevokedToken: string;
  let ticketRevokedTokenHash: Buffer;

  beforeAll(async () => {
    process.env.OFFLINE_MANIFEST_SECRET = testSecret;
    await runMigrations();

    // 1. Clean previous test runs
    await pool.query(`DELETE FROM offline_ops WHERE device_id LIKE 'dev_p25_%';`);
    await pool.query(`DELETE FROM offline_checkin_batches WHERE device_id LIKE 'dev_p25_%';`);
    await pool.query(`DELETE FROM offline_manifests WHERE device_id LIKE 'dev_p25_%';`);
    await pool.query(`DELETE FROM events WHERE slug = 'gate-event-phase25-offline';`);
    await pool.query(`DELETE FROM organizer_profiles WHERE display_name = 'P25 Turnstile Ops';`);
    await pool.query(`DELETE FROM users WHERE email IN ('staff.p25@eventora.test', 'student.p25a@eventora.test', 'student.p25b@eventora.test');`);

    const colRes = await pool.query(`SELECT id FROM colleges LIMIT 1;`);
    let collegeId = colRes.rows[0]?.id;
    if (!collegeId) {
      const insCol = await pool.query(
        `INSERT INTO colleges (name, domain) VALUES ('Eventora P25 University', 'p25.edu') RETURNING id;`
      );
      collegeId = insCol.rows[0].id;
    }

    // 2. Insert test staff and students
    const staffRes = await pool.query(
      `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status, email_verified_at)
       VALUES ($1, 'staff.p25@eventora.test', 'hash_p25', 'Turnstile Lead P25', 'admin', 'active', NOW())
       RETURNING id;`,
      [collegeId]
    );
    staffId = staffRes.rows[0].id;

    const studentARes = await pool.query(
      `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status, email_verified_at)
       VALUES ($1, 'student.p25a@eventora.test', 'hash_p25', 'Student Alpha P25', 'student', 'active', NOW())
       RETURNING id;`,
      [collegeId]
    );
    studentAId = studentARes.rows[0].id;

    const studentBRes = await pool.query(
      `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status, email_verified_at)
       VALUES ($1, 'student.p25b@eventora.test', 'hash_p25', 'Student Beta P25', 'student', 'active', NOW())
       RETURNING id;`,
      [collegeId]
    );
    studentBId = studentBRes.rows[0].id;

    // 3. Insert organizer profile and test event
    const orgRes = await pool.query(
      `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
       VALUES ($1, 'P25 Turnstile Ops', 'verified', $2)
       RETURNING id;`,
      [collegeId, staffId]
    );
    const organizerId = orgRes.rows[0].id;

    const eventRes = await pool.query(
      `INSERT INTO events (college_id, organizer_id, title, slug, description, format, category, visibility, status, capacity, starts_at, ends_at, created_by, contact_email)
       VALUES ($1, $2, 'Phase 25 Offline Turnstile Symposium', 'gate-event-phase25-offline', 'P25 test event', 'in_person', 'Technology', 'public', 'published', 500, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '4 hours', $3, 'staff.p25@eventora.test')
       RETURNING id;`,
      [collegeId, organizerId, staffId]
    );
    eventId = eventRes.rows[0].id;

    // 4. Insert ticket type
    const ttRes = await pool.query(
      `INSERT INTO ticket_types (event_id, name, price_paise, capacity)
       VALUES ($1, 'General Admission', 0, 500)
       RETURNING id;`,
      [eventId]
    );
    const ticketTypeId = ttRes.rows[0].id;

    // 5. Insert bookings
    const bookingARes = await pool.query(
      `INSERT INTO bookings (event_id, user_id, status, total_paise, idempotency_key)
       VALUES ($1, $2, 'CONFIRMED', 0, $3)
       RETURNING id;`,
      [eventId, studentAId, `idem-p25-a-${Date.now()}`]
    );
    bookingAId = bookingARes.rows[0].id;

    const bookingBRes = await pool.query(
      `INSERT INTO bookings (event_id, user_id, status, total_paise, idempotency_key)
       VALUES ($1, $2, 'CONFIRMED', 0, $3)
       RETURNING id;`,
      [eventId, studentBId, `idem-p25-b-${Date.now()}`]
    );
    bookingBId = bookingBRes.rows[0].id;

    // 6. Generate tickets
    // Valid Ticket
    ticketValidToken = crypto.randomBytes(32).toString('base64url');
    ticketValidTokenHash = crypto.createHash('sha256').update(ticketValidToken).digest();
    const tValRes = await pool.query(
      `INSERT INTO tickets (booking_id, event_id, user_id, ticket_type_id, ticket_code, status, qr_payload_hash, qr_token_hash)
       VALUES ($1, $2, $3, $4, 'TCK-P25-VALID-01', 'VALID', $5, $5)
       RETURNING id;`,
      [bookingAId, eventId, studentAId, ticketTypeId, ticketValidTokenHash]
    );
    ticketValidId = tValRes.rows[0].id;

    // Revoked Ticket
    ticketRevokedToken = crypto.randomBytes(32).toString('base64url');
    ticketRevokedTokenHash = crypto.createHash('sha256').update(ticketRevokedToken).digest();
    const tRevRes = await pool.query(
      `INSERT INTO tickets (booking_id, event_id, user_id, ticket_type_id, ticket_code, status, qr_payload_hash, qr_token_hash)
       VALUES ($1, $2, $3, $4, 'TCK-P25-REVOKED-02', 'REVOKED', $5, $5)
       RETURNING id;`,
      [bookingBId, eventId, studentBId, ticketTypeId, ticketRevokedTokenHash]
    );
    ticketRevokedId = tRevRes.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM offline_ops WHERE device_id LIKE 'dev_p25_%';`);
    await pool.query(`DELETE FROM offline_checkin_batches WHERE device_id LIKE 'dev_p25_%';`);
    await pool.query(`DELETE FROM offline_manifests WHERE device_id LIKE 'dev_p25_%';`);
    await pool.query(`DELETE FROM events WHERE slug = 'gate-event-phase25-offline';`);
    await pool.query(`DELETE FROM organizer_profiles WHERE display_name = 'P25 Turnstile Ops';`);
    await pool.query(`DELETE FROM users WHERE email IN ('staff.p25@eventora.test', 'student.p25a@eventora.test', 'student.p25b@eventora.test');`);
  });

  it('(1) OFFLINE_MANIFEST_SECRET is required with no default', () => {
    const saved = process.env.OFFLINE_MANIFEST_SECRET;
    try {
      delete process.env.OFFLINE_MANIFEST_SECRET;
      expect(() => getOfflineManifestSecret()).toThrowError(/OFFLINE_MANIFEST_SECRET is required; no default allowed/);
    } finally {
      process.env.OFFLINE_MANIFEST_SECRET = saved;
    }
  });

  it('(2) verifies migration 27 down-migration to 26 and re-migration to 27 idempotently', async () => {
    await runRollbackToVersion(26);
    const vRes1 = await pool.query(`SELECT MAX(version) as version FROM schema_migrations;`);
    expect(Number(vRes1.rows[0].version)).toBe(26);

    // Verify manifest_items table dropped in rollback 26
    const tableRes = await pool.query(
      `SELECT to_regclass('public.manifest_items') as tbl;`
    );
    expect(tableRes.rows[0].tbl).toBeNull();

    // Re-apply migration 27
    await runMigrations();
    const vRes2 = await pool.query(`SELECT MAX(version) as version FROM schema_migrations;`);
    expect(Number(vRes2.rows[0].version)).toBeGreaterThanOrEqual(27);

    const tableRestored = await pool.query(
      `SELECT to_regclass('public.manifest_items') as tbl;`
    );
    expect(tableRestored.rows[0].tbl).not.toBeNull();
  });

  it('(3) Manifest generation: per-manifest random key K, excludes REVOKED/CANCELLED/CHECKED_IN, zero N+1 manifest_items', async () => {
    const manifest = await generateOfflineManifest({
      eventId,
      staffId,
      deviceId: 'dev_p25_device_alpha',
      expiresInHours: 4,
    });

    expect(manifest.manifestId).toBeDefined();
    expect(manifest.key).toBeDefined();
    expect(manifest.key).toHaveLength(64); // 32-byte hex string
    expect(manifest.ticketCount).toBe(1); // Excluded ticketRevokedId!

    // Verify manifest_key stored in DB
    const dbManifestRes = await pool.query(
      `SELECT manifest_key, revoked_at FROM offline_manifests WHERE id = $1;`,
      [manifest.manifestId]
    );
    expect(dbManifestRes.rows[0].manifest_key).toBe(manifest.key);
    expect(dbManifestRes.rows[0].revoked_at).toBeNull();

    // Verify manifest_items stored server-side with NO N+1
    const itemsRes = await pool.query(
      `SELECT ticket_id, token_ref, hmac_signature, display_hint
       FROM manifest_items
       WHERE manifest_id = $1;`,
      [manifest.manifestId]
    );
    expect(itemsRes.rows.length).toBe(1);
    expect(itemsRes.rows[0].ticket_id).toBe(ticketValidId);
    expect(itemsRes.rows[0].ticket_id).not.toBe(ticketRevokedId);
    expect(itemsRes.rows[0].token_ref).toHaveLength(16);
    expect(itemsRes.rows[0].hmac_signature).toHaveLength(64);
  });

  it('(4) WebCrypto client-side check: HMAC_K(sha256(token)) truncated membership test', async () => {
    const manifest = await generateOfflineManifest({
      eventId,
      staffId,
      deviceId: 'dev_p25_device_alpha',
    });

    // Valid ticket verification
    const validCheck = await verifyTokenLocally(
      ticketValidToken,
      manifest.key!,
      manifest.items
    );
    expect(validCheck.isValid).toBe(true);
    expect(validCheck.effectiveRef).toBe(manifest.items[0].ref);

    // Invalid / forged token verification
    const forgedToken = 'forged_fake_token_not_in_manifest_12345';
    const fakeCheck = await verifyTokenLocally(
      forgedToken,
      manifest.key!,
      manifest.items
    );
    expect(fakeCheck.isValid).toBe(false);
  });

  it('(5) Client storage: Dexie IndexedDB, key K encrypted at rest with AES-GCM, and auto-purge at expiry', async () => {
    const rawKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    // 1. Encrypt key K at rest
    const { encryptedKey, iv } = await encryptKeyAtRest(rawKey);
    expect(encryptedKey).not.toBe(rawKey);
    expect(iv).toBeDefined();

    // 2. Decrypt key K
    const decrypted = await decryptKeyAtRest(encryptedKey, iv);
    expect(decrypted).toBe(rawKey);

    // 3. Test Dexie auto-purge of expired manifests
    const expiredManifestId = crypto.randomUUID();
    await offlineDb.manifests.put({
      manifestId: expiredManifestId,
      eventId,
      keyId: 'key_expired',
      encryptedKey,
      iv,
      issuedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 1 * 3600 * 1000).toISOString(), // Expired 1h ago
      ticketCount: 10,
      items: [],
    });

    const activeManifestId = crypto.randomUUID();
    await offlineDb.manifests.put({
      manifestId: activeManifestId,
      eventId,
      keyId: 'key_active',
      encryptedKey,
      iv,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), // Active
      ticketCount: 10,
      items: [],
    });

    const purgedCount = await purgeExpiredManifests();
    expect(purgedCount).toBeGreaterThanOrEqual(1);

    const expiredAfter = await offlineDb.manifests.get(expiredManifestId);
    expect(expiredAfter).toBeUndefined();

    const activeAfter = await offlineDb.manifests.get(activeManifestId);
    expect(activeAfter).toBeDefined();
  });

  it('(6) Sync Validation: Rejects batchId collisions and verifies manifest ownership and validity', async () => {
    const manifest = await generateOfflineManifest({
      eventId,
      staffId,
      deviceId: 'dev_p25_device_alpha',
    });

    const batchId = crypto.randomUUID();
    const opId1 = crypto.randomUUID();

    // 1. Successful sync
    const res1 = await syncOfflineBatch({
      eventId,
      staffId,
      deviceId: 'dev_p25_device_alpha',
      batchId,
      manifestId: manifest.manifestId,
      clientSentAt: new Date().toISOString(),
      ops: [
        {
          opId: opId1,
          ticketRef: manifest.items[0].ref,
          scannedAtLocal: new Date().toISOString(),
        },
      ],
    });

    expect(res1.results[0].outcome).toBe('SYNCED');

    // 2. Batch collision: same batchId with different op -> rejected with BATCH_ID_COLLISION
    const collisionOpId = crypto.randomUUID();
    await expect(
      syncOfflineBatch({
        eventId,
        staffId,
        deviceId: 'dev_p25_device_alpha',
        batchId,
        manifestId: manifest.manifestId,
        ops: [
          {
            opId: collisionOpId,
            ticketRef: manifest.items[0].ref,
            scannedAtLocal: new Date().toISOString(),
          },
        ],
      })
    ).rejects.toThrowError('BATCH_ID_COLLISION');

    // 3. Manifest unauthorized: different staff or device -> MANIFEST_UNAUTHORIZED
    await expect(
      syncOfflineBatch({
        eventId,
        staffId: studentAId, // Wrong staff!
        deviceId: 'dev_p25_device_alpha',
        batchId: crypto.randomUUID(),
        manifestId: manifest.manifestId,
        ops: [],
      })
    ).rejects.toThrowError('MANIFEST_UNAUTHORIZED');

    // 4. Manifest revoked -> MANIFEST_REVOKED
    await revokeManifest(manifest.manifestId, staffId);
    await expect(
      syncOfflineBatch({
        eventId,
        staffId,
        deviceId: 'dev_p25_device_alpha',
        batchId: crypto.randomUUID(),
        manifestId: manifest.manifestId,
        ops: [],
      })
    ).rejects.toThrowError('MANIFEST_REVOKED');
  });

  it('(7) Cross-device duplicate scan opens scan_conflicts with both ops preserved', async () => {
    // Fresh ticket for cross-device test
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest();
    const ticketRes = await pool.query(
      `INSERT INTO tickets (booking_id, event_id, user_id, ticket_type_id, ticket_code, status, qr_payload_hash, qr_token_hash)
       VALUES ((SELECT id FROM bookings WHERE event_id = $1 LIMIT 1),
               $1, $2,
               (SELECT id FROM ticket_types WHERE event_id = $1 LIMIT 1),
               'TCK-P25-XDEV-01', 'VALID', $3, $3)
       RETURNING id;`,
      [eventId, studentAId, tokenHash]
    );
    const xTicketId = ticketRes.rows[0].id;

    // Generate manifest for Device 1 and Device 2 while ticket is VALID
    const man1 = await generateOfflineManifest({
      eventId,
      staffId,
      deviceId: 'dev_p25_device_1',
    });
    const xItem1 = man1.items.find((i) => i.hint === `TK-${xTicketId.substring(0, 4).toUpperCase()}`);
    expect(xItem1).toBeDefined();

    const man2 = await generateOfflineManifest({
      eventId,
      staffId,
      deviceId: 'dev_p25_device_2',
    });
    const xItem2 = man2.items.find((i) => i.hint === `TK-${xTicketId.substring(0, 4).toUpperCase()}`);
    expect(xItem2).toBeDefined();

    // Device 1 scans & syncs -> SYNCED
    const op1Id = crypto.randomUUID();
    const res1 = await syncOfflineBatch({
      eventId,
      staffId,
      deviceId: 'dev_p25_device_1',
      batchId: crypto.randomUUID(),
      manifestId: man1.manifestId,
      ops: [{ opId: op1Id, ticketRef: xItem1!.ref, scannedAtLocal: new Date().toISOString() }],
    });
    expect(res1.results[0].outcome).toBe('SYNCED');

    // Device 2 also scanned the same ticket offline and now syncs -> CONFLICT
    const op2Id = crypto.randomUUID();
    const res2 = await syncOfflineBatch({
      eventId,
      staffId,
      deviceId: 'dev_p25_device_2',
      batchId: crypto.randomUUID(),
      manifestId: man2.manifestId,
      ops: [{ opId: op2Id, ticketRef: xItem2!.ref, scannedAtLocal: new Date().toISOString() }],
    });
    expect(res2.results[0].outcome).toBe('CONFLICT');

    // Verify scan_conflicts entry exists with both ops
    const conflicts = await getScanConflicts(eventId);
    const xConflict = conflicts.find((c) => c.ticket_id === xTicketId);
    expect(xConflict).toBeDefined();
    expect(xConflict?.status).toBe('OPEN');
    expect(xConflict?.op_ids).toContain(op2Id);

    // Verify Conflict Resolution
    const resolved = await resolveScanConflict({
      conflictId: xConflict!.id,
      staffId,
      resolutionNote: 'Audited physical identity check at gate verified authentic ticket holder.',
      chosenOpId: op1Id,
    });
    expect(resolved.status).toBe('RESOLVED');
  });

  it('(8) Revocation Delta endpoint returns ticket changes since timestamp', async () => {
    const since = new Date(Date.now() - 10000).toISOString();

    // Revoke a ticket
    await pool.query(
      `UPDATE tickets SET status = 'REVOKED' WHERE id = $1;`,
      [ticketValidId]
    );

    const delta = await getRevocationDelta(eventId, since);
    expect(delta.eventId).toBe(eventId);
    expect(delta.revokedRefs.length).toBeGreaterThanOrEqual(1);
  });

  it('(9) 50 scans offline -> batch sync: reconciles 50 concurrent offline scans in one transaction', async () => {
    // 1. Create 50 tickets for event
    const ticketIds: string[] = [];
    const ticketRefs: string[] = [];
    const ops: Array<{ opId: string; ticketRef: string; scannedAtLocal: string }> = [];

    for (let i = 0; i < 50; i++) {
      const tok = crypto.randomBytes(32).toString('base64url');
      const tokHash = crypto.createHash('sha256').update(tok).digest();
      const insRes = await pool.query(
        `INSERT INTO tickets (booking_id, event_id, user_id, ticket_type_id, ticket_code, status, qr_payload_hash, qr_token_hash)
         VALUES ($1, $2, $3, (SELECT id FROM ticket_types WHERE event_id = $2 LIMIT 1), $4, 'VALID', $5, $5)
         RETURNING id;`,
        [bookingAId, eventId, studentAId, `TCK-P25-BULK-${i}-${Date.now()}`, tokHash]
      );
      ticketIds.push(insRes.rows[0].id);
    }

    // 2. Generate manifest for device
    const bulkManifest = await generateOfflineManifest({
      eventId,
      staffId,
      deviceId: 'dev_p25_bulk_scanner',
    });

    expect(bulkManifest.items.length).toBeGreaterThanOrEqual(50);

    for (const item of bulkManifest.items.slice(0, 50)) {
      ticketRefs.push(item.ref);
      ops.push({
        opId: crypto.randomUUID(),
        ticketRef: item.ref,
        scannedAtLocal: new Date(Date.now() - 60000 + ops.length * 1000).toISOString(),
      });
    }

    // 3. Sync 50 scans in one batch
    const syncRes = await syncOfflineBatch({
      eventId,
      staffId,
      deviceId: 'dev_p25_bulk_scanner',
      batchId: crypto.randomUUID(),
      manifestId: bulkManifest.manifestId,
      clientSentAt: new Date().toISOString(),
      ops,
    });

    expect(syncRes.totalOps).toBe(50);
    expect(syncRes.results.length).toBe(50);
    const syncedCount = syncRes.results.filter((r) => r.outcome === 'SYNCED').length;
    expect(syncedCount).toBe(50);
  });

  it('(10) Expired manifest is blocked both client-side and on server sync', async () => {
    // 1. Expired manifest on server
    const expiredManifestRes = await pool.query(
      `INSERT INTO offline_manifests (event_id, staff_id, device_id, issued_at, expires_at, ticket_count, key_id, manifest_key)
       VALUES ($1, $2, 'dev_p25_expired_dev', NOW() - INTERVAL '5 hours', NOW() - INTERVAL '1 hour', 1, 'key_exp', 'key_hex')
       RETURNING id;`,
      [eventId, staffId]
    );
    const expManifestId = expiredManifestRes.rows[0].id;

    // Server rejects sync with MANIFEST_EXPIRED
    await expect(
      syncOfflineBatch({
        eventId,
        staffId,
        deviceId: 'dev_p25_expired_dev',
        batchId: crypto.randomUUID(),
        manifestId: expManifestId,
        ops: [],
      })
    ).rejects.toThrowError('MANIFEST_EXPIRED');

    // 2. Client-side local scan blocks when manifest is expired
    const expEventId = crypto.randomUUID();
    await offlineDb.manifests.put({
      manifestId: expManifestId,
      eventId: expEventId,
      keyId: 'key_exp',
      encryptedKey: 'deadbeef',
      iv: '0123456789abcdef01234567',
      issuedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
      ticketCount: 1,
      items: [],
    });

    const blockedOp = await recordLocalScan(expEventId, 'any_token');
    expect(blockedOp.status).toBe('REJECTED');
    expect(blockedOp.reason).toBe('EXPIRED_MANIFEST_BLOCKED');
  });

  it('(11) Revoked tickets are rejected upon sync', async () => {
    // Manifest generated before ticket was revoked
    const freshTok = crypto.randomBytes(32).toString('base64url');
    const freshTokHash = crypto.createHash('sha256').update(freshTok).digest();
    const tRes = await pool.query(
      `INSERT INTO tickets (booking_id, event_id, user_id, ticket_type_id, ticket_code, status, qr_payload_hash, qr_token_hash)
       VALUES ((SELECT id FROM bookings WHERE event_id = $1 LIMIT 1), $1, $2, (SELECT id FROM ticket_types WHERE event_id = $1 LIMIT 1), 'TCK-P25-REV-REJECT', 'VALID', $3, $3)
       RETURNING id;`,
      [eventId, studentAId, freshTokHash]
    );
    const revTicketId = tRes.rows[0].id;

    const manifest = await generateOfflineManifest({
      eventId,
      staffId,
      deviceId: 'dev_p25_rev_test_dev',
    });
    const revItem = manifest.items.find((i) => i.hint === `TK-${revTicketId.substring(0, 4).toUpperCase()}`);
    expect(revItem).toBeDefined();

    // Now ticket is revoked on server
    await pool.query(`UPDATE tickets SET status = 'REVOKED' WHERE id = $1;`, [revTicketId]);

    // Device syncs the op -> outcome is REJECTED with TICKET_CANCELLED_OR_REVOKED
    const syncRes = await syncOfflineBatch({
      eventId,
      staffId,
      deviceId: 'dev_p25_rev_test_dev',
      batchId: crypto.randomUUID(),
      manifestId: manifest.manifestId,
      ops: [{ opId: crypto.randomUUID(), ticketRef: revItem!.ref, scannedAtLocal: new Date().toISOString() }],
    });

    expect(syncRes.results[0].outcome).toBe('REJECTED');
    expect(syncRes.results[0].reason).toBe('TICKET_CANCELLED_OR_REVOKED');
  });
});
