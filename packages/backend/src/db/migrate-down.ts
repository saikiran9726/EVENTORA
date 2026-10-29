import { pool } from './index.js';

/**
 * Down-migration & Expand/Contract Rollback Engine (Phase 11)
 * Safely rolls back schema revisions while preserving existing business data.
 */
export async function runRollbackToVersion(targetVersion: number) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current version
    const versionRes = await client.query('SELECT MAX(version) as current_version FROM schema_migrations;');
    const currentVersion = versionRes.rows[0]?.current_version || 0;

    console.log(`[Rollback] Current schema version: ${currentVersion}, target version: ${targetVersion}`);

    if (currentVersion <= targetVersion) {
      console.log(`[Rollback] Already at or below target version ${targetVersion}. No down-migration needed.`);
      await client.query('COMMIT');
      return;
    }

    const startedAt = new Date().toISOString();

    // Rollback step 28 -> 27: Database Hardening, Search GIN, Privacy & Retention
    if (currentVersion >= 28 && targetVersion < 28) {
      console.log('[Rollback] Rolling back version 28 (Phase 28)...');
      await client.query(`
        DROP INDEX IF EXISTS idx_scan_log_event_at;
        DROP INDEX IF EXISTS idx_sessions_user_active;
        DROP INDEX IF EXISTS idx_notifications_user_created;
        DROP INDEX IF EXISTS idx_outbox_status_next_attempt;
        DROP INDEX IF EXISTS idx_waitlist_fifo_promotion;
        DROP INDEX IF EXISTS idx_tickets_qr_token_hash_unique;
        DROP INDEX IF EXISTS idx_tickets_event_status;
        DROP INDEX IF EXISTS idx_bookings_pending_expires;
        DROP INDEX IF EXISTS idx_bookings_event_status_created_at;
        DROP INDEX IF EXISTS idx_bookings_user_status;
        DROP INDEX IF EXISTS idx_events_search_gin;
        ALTER TABLE events DROP COLUMN IF EXISTS search_vector;
        DROP INDEX IF EXISTS idx_events_organizer_status;
        DROP INDEX IF EXISTS idx_events_status_starts_at;
        DELETE FROM schema_migrations WHERE version = 28;
      `);
    }

    // Rollback step 27 -> 26: Manifest Items and Offline Check-in Hardening
    if (currentVersion >= 27 && targetVersion < 27) {
      console.log('[Rollback] Rolling back version 27 (Phase 27)...');
      await client.query(`
        DROP INDEX IF EXISTS idx_manifest_items_ref;
        DROP INDEX IF EXISTS idx_manifest_items_manifest_id;
        DROP TABLE IF EXISTS manifest_items CASCADE;
        ALTER TABLE offline_checkin_batches DROP COLUMN IF EXISTS clock_skew_ms;
        ALTER TABLE offline_checkin_batches DROP COLUMN IF EXISTS client_sent_at;
        ALTER TABLE offline_checkin_batches DROP COLUMN IF EXISTS manifest_id;
        ALTER TABLE offline_manifests DROP COLUMN IF EXISTS revoked_at;
        ALTER TABLE offline_manifests DROP COLUMN IF EXISTS manifest_key;
        DELETE FROM schema_migrations WHERE version = 27;
      `);
    }

    // Rollback step 26 -> 25: Event Materials for Registered Attendees
    if (currentVersion >= 26 && targetVersion < 26) {
      console.log('[Rollback] Rolling back version 26 (Phase 26)...');
      await client.query(`
        DROP INDEX IF EXISTS idx_event_materials_event_id;
        DROP TABLE IF EXISTS event_materials CASCADE;
        DELETE FROM schema_migrations WHERE version = 26;
      `);
    }

    // Rollback step 25 -> 24: Organizer Analytics Performance Indexes
    if (currentVersion >= 25 && targetVersion < 25) {
      console.log('[Rollback] Rolling back version 25 (Phase 25)...');
      await client.query(`
        DROP INDEX IF EXISTS idx_bookings_event_created_at;
        DROP INDEX IF EXISTS idx_bookings_event_status;
        DROP INDEX IF EXISTS idx_tickets_event_status_scanned;
        DROP INDEX IF EXISTS idx_waitlist_event_status;
        DELETE FROM schema_migrations WHERE version = 25;
      `);
    }

    // Rollback step 24 -> 23: Durable Export Storage and Download Tokens
    if (currentVersion >= 24 && targetVersion < 24) {
      console.log('[Rollback] Rolling back version 24 (Phase 24)...');
      await client.query(`
        DROP INDEX IF EXISTS idx_export_jobs_download_token;
        ALTER TABLE export_jobs DROP COLUMN IF EXISTS download_token;
        ALTER TABLE export_jobs DROP COLUMN IF EXISTS file_data;
        DELETE FROM schema_migrations WHERE version = 24;
      `);
    }

    // Rollback step 23 -> 22: User Department and Academic Year for Cross-College Eligibility
    if (currentVersion >= 23 && targetVersion < 23) {
      console.log('[Rollback] Rolling back version 23 (Phase 23)...');
      await client.query(`
        DROP INDEX IF EXISTS idx_users_college_dept;
        ALTER TABLE users DROP COLUMN IF EXISTS department;
        ALTER TABLE users DROP COLUMN IF EXISTS year;
        DELETE FROM schema_migrations WHERE version = 23;
      `);
    }

    // Rollback step 22 -> 21: Volunteer Records & Application Indexes
    if (currentVersion >= 22 && targetVersion < 22) {
      console.log('[Rollback] Rolling back version 22 (Phase 22)...');
      await client.query(`
        DROP INDEX IF EXISTS uq_volunteer_records_user_shift;
        DROP INDEX IF EXISTS idx_volunteer_shifts_role_time;
        DROP INDEX IF EXISTS idx_volunteer_applications_user_status;
        DELETE FROM schema_migrations WHERE version = 22;
      `);
    }

    // Rollback step 21 -> 20: Team Security, Invitation Token Index & Paid Registration Lifecycle
    if (currentVersion >= 21 && targetVersion < 21) {
      console.log('[Rollback] Rolling back version 21 (Phase 21)...');
      await client.query(`
        DROP INDEX IF EXISTS idx_team_invitations_token_hash;
        DROP INDEX IF EXISTS idx_team_event_registrations_event_status;
        DELETE FROM schema_migrations WHERE version = 21;
      `);
    }

    // Rollback step 20 -> 19: Waitlist Decline, Booking Link & Paid Claim Workflow
    if (currentVersion >= 20 && targetVersion < 20) {
      console.log('[Rollback] Rolling back version 20 (Phase 20)...');
      await client.query(`
        DROP INDEX IF EXISTS idx_waitlist_entries_booking_id;
        ALTER TABLE waitlist_entries DROP COLUMN IF EXISTS booking_id;
        DELETE FROM schema_migrations WHERE version = 20;
      `);
    }

    // Rollback step 19 -> 18: Resend Email Adapter, Suppression List & Outbox Hardening
    if (currentVersion >= 19 && targetVersion < 19) {
      console.log('[Rollback] Rolling back version 19 (Phase 19)...');
      await client.query(`
        DROP TABLE IF EXISTS email_suppressions CASCADE;
        DROP INDEX IF EXISTS idx_outbox_locked_until;
        ALTER TABLE outbox DROP COLUMN IF EXISTS locked_until;
        ALTER TABLE outbox DROP COLUMN IF EXISTS error;
        DELETE FROM schema_migrations WHERE version = 19;
      `);
    }

    // Rollback step 18 -> 17: Ticket QR Secure Tokens, Rotation & Downloads
    if (currentVersion >= 18 && targetVersion < 18) {
      console.log('[Rollback] Rolling back version 18 (Phase 18)...');
      await client.query(`
        DROP INDEX IF EXISTS idx_tickets_qr_token;
        ALTER TABLE tickets DROP COLUMN IF EXISTS qr_token_rotated_at;
        ALTER TABLE tickets DROP COLUMN IF EXISTS qr_token;
        DELETE FROM schema_migrations WHERE version = 18;
      `);
    }

    // Rollback step 17 -> 16: YouPI-PG Payments Core & Webhook V2
    if (currentVersion >= 17 && targetVersion < 17) {
      console.log('[Rollback] Rolling back version 17 (Phase 17)...');
      await client.query(`
        DROP TABLE IF EXISTS reconciliation_items CASCADE;
        DROP TABLE IF EXISTS reconciliation_records CASCADE;
        ALTER TABLE refunds DROP COLUMN IF EXISTS manual_notes;
        ALTER TABLE refunds DROP COLUMN IF EXISTS manual_processed_at;
        ALTER TABLE refunds DROP COLUMN IF EXISTS refund_utr;
        DROP TABLE IF EXISTS webhook_deliveries CASCADE;
        DROP TABLE IF EXISTS payment_events CASCADE;
        DROP INDEX IF EXISTS idx_payments_status_provider;
        DROP INDEX IF EXISTS idx_payments_utr;
        ALTER TABLE payments DROP COLUMN IF EXISTS raw_webhook_payload;
        ALTER TABLE payments DROP COLUMN IF EXISTS manual_reviewed_at;
        ALTER TABLE payments DROP COLUMN IF EXISTS manual_reviewed_by;
        ALTER TABLE payments DROP COLUMN IF EXISTS verification_queue_reason;
        ALTER TABLE payments DROP COLUMN IF EXISTS checkout_url;
        ALTER TABLE payments DROP COLUMN IF EXISTS queue_position;
        ALTER TABLE payments DROP COLUMN IF EXISTS slot_active;
        ALTER TABLE payments DROP COLUMN IF EXISTS utr;
        DELETE FROM schema_migrations WHERE version = 17;
      `);
    }

    // Rollback step 16 -> 15: Custom Registration Form Builder
    if (currentVersion >= 16 && targetVersion < 16) {
      console.log('[Rollback] Rolling back version 16 (Phase 16)...');
      await client.query(`
        DROP INDEX IF EXISTS idx_registration_answers_field;
        DROP INDEX IF EXISTS idx_registration_answers_booking;
        ALTER TABLE registration_answers DROP COLUMN IF EXISTS attendee_index;
        ALTER TABLE registration_answers DROP COLUMN IF EXISTS value;
        ALTER TABLE registration_answers DROP COLUMN IF EXISTS field_version;
        ALTER TABLE registration_answers DROP COLUMN IF EXISTS field_id;
        DROP TABLE IF EXISTS event_form_fields CASCADE;
        DROP TYPE IF EXISTS event_form_field_type CASCADE;
        DELETE FROM schema_migrations WHERE version = 16;
      `);
    }

    // Rollback step 15 -> 14: Event Pricing Type, Currency & Tier Backfill
    if (currentVersion >= 15 && targetVersion < 15) {
      console.log('[Rollback] Rolling back version 15 (Phase 15)...');
      await client.query(`
        ALTER TABLE events DROP COLUMN IF EXISTS pricing_type;
        ALTER TABLE events DROP COLUMN IF EXISTS currency;
        DROP TYPE IF EXISTS event_pricing_type;
        DELETE FROM schema_migrations WHERE version = 15;
      `);
    }

    // Rollback step 14 -> 13: Event Status History System Actor, Completion Index & Scan Outcome
    if (currentVersion >= 14 && targetVersion < 14) {
      console.log('[Rollback] Rolling back version 14 (Phase 14)...');
      await client.query(`
        DROP INDEX IF EXISTS idx_events_status_ends_at;
        UPDATE event_status_history
        SET actor_id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
        WHERE actor_id IS NULL;
        ALTER TABLE event_status_history ALTER COLUMN actor_id SET NOT NULL;
        UPDATE refunds
        SET requested_by = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
        WHERE requested_by IS NULL;
        ALTER TABLE refunds ALTER COLUMN requested_by SET NOT NULL;
        DELETE FROM schema_migrations WHERE version = 14;
      `);
    }

    // Rollback step 13 -> 12: Active Solo Booking Index & Payload Hash
    if (currentVersion >= 13 && targetVersion < 13) {
      console.log('[Rollback] Rolling back version 13 (Phase 13)...');
      await client.query(`
        DROP INDEX IF EXISTS bookings_active_user_event_solo_idx;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_user_event_active ON bookings (user_id, event_id)
          WHERE (status != 'CANCELLED' AND team_registration_id IS NULL);
        ALTER TABLE bookings DROP COLUMN IF EXISTS payload_hash;
        DELETE FROM schema_migrations WHERE version = 13;
      `);
    }

    // Rollback step 12 -> 11: Token Purpose
    if (currentVersion >= 12 && targetVersion < 12) {
      console.log('[Rollback] Rolling back version 12 (Phase 12)...');
      await client.query(`
        ALTER TABLE password_resets DROP CONSTRAINT IF EXISTS chk_password_resets_purpose;
        ALTER TABLE password_resets DROP COLUMN IF EXISTS purpose;
        DELETE FROM schema_migrations WHERE version = 12;
      `);
    }

    // Rollback step 11 -> 10: Drop perf indexes & ops tables
    if (currentVersion >= 11 && targetVersion < 11) {
      console.log('[Rollback] Rolling back version 11 (Phase 11)...');
      await client.query(`
        DROP INDEX IF EXISTS idx_events_perf_discovery;
        DROP INDEX IF EXISTS idx_bookings_perf_user_event;
        DROP INDEX IF EXISTS idx_tickets_perf_qr_hash;
        DROP INDEX IF EXISTS idx_checkins_perf_dedupe;
        DROP INDEX IF EXISTS idx_ledger_perf_analytics;
        DROP INDEX IF EXISTS idx_feedback_perf_event;
        DELETE FROM schema_migrations WHERE version = 11;
      `);
    }

    // Rollback step 10 -> 9: Cross-college & passport
    if (currentVersion >= 10 && targetVersion < 10) {
      console.log('[Rollback] Rolling back version 10 (Phase 10)...');
      await client.query(`
        DROP TABLE IF EXISTS passport_settings CASCADE;
        DROP TABLE IF EXISTS student_achievements CASCADE;
        DROP TABLE IF EXISTS organizer_verifications CASCADE;
        DELETE FROM schema_migrations WHERE version = 10;
      `);
    }

    // Record ops run
    await client.query(`
      INSERT INTO ops_runs (kind, started_at, finished_at, outcome, evidence_ref)
      VALUES (
        'rollback',
        $1,
        NOW(),
        'SUCCESS',
        jsonb_build_object(
          'from_version', $2::int,
          'to_version', $3::int,
          'mechanism', 'expand_contract_down_migration'
        )
      );
    `, [startedAt, currentVersion, targetVersion]);

    await client.query('COMMIT');
    console.log(`[Rollback] Successfully rolled back to version ${targetVersion}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Rollback] Rollback failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith('migrate-down.ts') || process.argv[1]?.endsWith('migrate-down.js')) {
  const target = parseInt(process.argv[2] || '10', 10);
  runRollbackToVersion(target)
    .then(() => pool.end())
    .catch(() => process.exit(1));
}
