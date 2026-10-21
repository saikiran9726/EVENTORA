import { pool } from '../packages/backend/src/db/index.js';

async function testPartitioning() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. ops_runs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ops_runs (
        id BIGSERIAL PRIMARY KEY,
        kind VARCHAR(50) NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ,
        outcome VARCHAR(20) NOT NULL,
        evidence_ref JSONB DEFAULT '{}'::jsonb NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ops_runs_kind_outcome ON ops_runs(kind, outcome, started_at DESC);
    `);

    // 2. schema_migrations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // Record versions 1-10
    await client.query(`
      INSERT INTO schema_migrations (version, name) VALUES
        (1, 'Phase 1: Core Foundation & Tokens'),
        (2, 'Phase 2: Auth, Roles & Sessions'),
        (3, 'Phase 3: Event Lifecycle, Venues, Discovery & Calendar'),
        (4, 'Phase 4: Registration, Capacity, Waitlists & Teams'),
        (5, 'Phase 5: Test-Mode Paid Checkout, Receipts & Ledger'),
        (6, 'Phase 6: QR Tickets, Check-in, Attendance & Certificates'),
        (7, 'Phase 7: Feedback, Reviews, Organizer Insights & Exports'),
        (8, 'Phase 8: Volunteers, Venue Navigator, Equipment & Issue Desk'),
        (9, 'Phase 9: Alerts, Notification Pipeline & Offline Check-in'),
        (10, 'Phase 10: Cross-College Discovery & Student Event Passport'),
        (11, 'Phase 11: Production Hardening, ops_runs & Monthly Partitioning')
      ON CONFLICT (version) DO UPDATE SET applied_at = NOW();
    `);

    // 3. Partition audit_logs if not already partitioned
    const checkAudit = await client.query(`
      SELECT relkind FROM pg_class WHERE relname = 'audit_logs' AND relnamespace = 'public'::regnamespace;
    `);

    if (checkAudit.rows.length > 0 && checkAudit.rows[0].relkind !== 'p') {
      console.log('[Migration] Converting audit_logs to monthly partitioned table...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_logs_p (
          id BIGSERIAL,
          actor_id UUID,
          action VARCHAR(100) NOT NULL,
          resource_type VARCHAR(100) NOT NULL,
          resource_id VARCHAR(255),
          college_id UUID,
          meta JSONB DEFAULT '{}'::jsonb NOT NULL,
          ip_hash VARCHAR(64),
          created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
          PRIMARY KEY (id, created_at)
        ) PARTITION BY RANGE (created_at);

        CREATE TABLE IF NOT EXISTS audit_logs_y2026m10 PARTITION OF audit_logs_p
          FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

        CREATE TABLE IF NOT EXISTS audit_logs_y2026m11 PARTITION OF audit_logs_p
          FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

        CREATE TABLE IF NOT EXISTS audit_logs_y2026m12 PARTITION OF audit_logs_p
          FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

        CREATE TABLE IF NOT EXISTS audit_logs_default PARTITION OF audit_logs_p DEFAULT;

        INSERT INTO audit_logs_p (id, actor_id, action, resource_type, resource_id, college_id, meta, ip_hash, created_at)
        SELECT id, actor_id, action, resource_type, resource_id, college_id, meta, ip_hash, created_at FROM audit_logs;

        SELECT setval(pg_get_serial_sequence('audit_logs_p', 'id'), coalesce(max(id), 1)) FROM audit_logs_p;

        ALTER TABLE audit_logs RENAME TO audit_logs_old;
        ALTER TABLE audit_logs_p RENAME TO audit_logs;
        DROP TABLE audit_logs_old CASCADE;

        CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_college ON audit_logs(college_id);

        REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw, PUBLIC;
        GRANT SELECT, INSERT ON audit_logs TO app_rw;
      `);
      console.log('[Migration] audit_logs partitioned successfully.');
    }

    // 4. Partition scan_log if not already partitioned
    const checkScan = await client.query(`
      SELECT relkind FROM pg_class WHERE relname = 'scan_log' AND relnamespace = 'public'::regnamespace;
    `);

    if (checkScan.rows.length > 0 && checkScan.rows[0].relkind !== 'p') {
      console.log('[Migration] Converting scan_log to monthly partitioned table...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS scan_log_p (
          id BIGSERIAL,
          ticket_id UUID,
          event_id UUID NOT NULL,
          staff_id UUID NOT NULL,
          outcome VARCHAR(50) NOT NULL,
          at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
          PRIMARY KEY (id, at)
        ) PARTITION BY RANGE (at);

        CREATE TABLE IF NOT EXISTS scan_log_y2026m10 PARTITION OF scan_log_p
          FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

        CREATE TABLE IF NOT EXISTS scan_log_y2026m11 PARTITION OF scan_log_p
          FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

        CREATE TABLE IF NOT EXISTS scan_log_y2026m12 PARTITION OF scan_log_p
          FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

        CREATE TABLE IF NOT EXISTS scan_log_default PARTITION OF scan_log_p DEFAULT;

        INSERT INTO scan_log_p (id, ticket_id, event_id, staff_id, outcome, at)
        SELECT id, ticket_id, event_id, staff_id, outcome, at FROM scan_log;

        SELECT setval(pg_get_serial_sequence('scan_log_p', 'id'), coalesce(max(id), 1)) FROM scan_log_p;

        ALTER TABLE scan_log RENAME TO scan_log_old;
        ALTER TABLE scan_log_p RENAME TO scan_log;
        DROP TABLE scan_log_old CASCADE;

        CREATE INDEX IF NOT EXISTS idx_scan_log_event_id ON scan_log(event_id);
        CREATE INDEX IF NOT EXISTS idx_scan_log_ticket_id ON scan_log(ticket_id);
        CREATE INDEX IF NOT EXISTS idx_scan_log_staff_id ON scan_log(staff_id);

        REVOKE UPDATE, DELETE, TRUNCATE ON scan_log FROM app_rw, PUBLIC;
        GRANT SELECT, INSERT ON scan_log TO app_rw;
      `);
      console.log('[Migration] scan_log partitioned successfully.');
    }

    await client.query('COMMIT');
    console.log('[Migration] All partitioning and ops_runs applied cleanly.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Partitioning error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

testPartitioning().catch(console.error);
