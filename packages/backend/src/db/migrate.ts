import { pool } from './index.js';

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Enable CITEXT extension
    await client.query('CREATE EXTENSION IF NOT EXISTS "citext";');
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    // Create enums if not existing
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE global_role AS ENUM ('student', 'reviewer', 'admin');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE user_status AS ENUM ('active', 'suspended', 'pending');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE organizer_status AS ENUM ('pending', 'verified', 'suspended');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE organizer_member_role AS ENUM ('owner', 'manager', 'member');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE organizer_member_status AS ENUM ('active', 'invited', 'removed');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE staff_capability AS ENUM ('checkin', 'volunteer_lead');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // 1. Colleges
    await client.query(`
      CREATE TABLE IF NOT EXISTS colleges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        domain VARCHAR(255) NOT NULL UNIQUE,
        status VARCHAR(50) DEFAULT 'active' NOT NULL,
        public_discovery BOOLEAN DEFAULT false NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 2. Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
        email CITEXT NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        global_role global_role DEFAULT 'student' NOT NULL,
        status user_status DEFAULT 'pending' NOT NULL,
        email_verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 3. Sessions (id_hash bytea pk)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id_hash BYTEA PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        last_seen_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        ip_hash VARCHAR(64),
        ua_hash VARCHAR(64),
        revoked_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    `);

    // 4. Password Resets
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        token_hash VARCHAR(64) PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 5. Organizer Profiles
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizer_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
        display_name VARCHAR(255) NOT NULL,
        status organizer_status DEFAULT 'pending' NOT NULL,
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 6. Organizer Members
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizer_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organizer_id UUID NOT NULL REFERENCES organizer_profiles(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role organizer_member_role DEFAULT 'member' NOT NULL,
        status organizer_member_status DEFAULT 'active' NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT uq_organizer_user UNIQUE(organizer_id, user_id)
      );
    `);

    // 7. Event Staff Assignments (Capability grants for check-in staff / volunteer lead)
    await client.query(`
      CREATE TABLE IF NOT EXISTS event_staff_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        capability staff_capability NOT NULL,
        granted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 8. User Preferences
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        email_enabled BOOLEAN DEFAULT true NOT NULL,
        inapp_enabled BOOLEAN DEFAULT true NOT NULL,
        theme VARCHAR(20) DEFAULT 'light' NOT NULL,
        locale VARCHAR(10) DEFAULT 'en-IN' NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 9. Audit Logs (INSERT-only)
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_id UUID,
        action VARCHAR(100) NOT NULL,
        resource_type VARCHAR(100) NOT NULL,
        resource_id VARCHAR(255),
        college_id UUID,
        meta JSONB DEFAULT '{}'::jsonb NOT NULL,
        ip_hash VARCHAR(64),
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // DB Roles: app_rw (no DDL, no audit_logs UPDATE/DELETE), migrator
    await client.query(`
      DO $$ BEGIN
        CREATE ROLE app_rw;
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE ROLE migrator;
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      -- Grant permissions for app_rw
      GRANT USAGE ON SCHEMA public TO app_rw;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;

      -- Revoke UPDATE/DELETE on audit_logs from app_rw and public (INSERT-only guarantee)
      REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw, PUBLIC;
    `);

    await client.query('COMMIT');
    console.log('[Migration] Phase 2 schema & DB roles applied successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Failed to apply migrations:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
