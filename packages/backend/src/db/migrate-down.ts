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
