import { pool } from './index.js';

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Extensions
    await client.query('CREATE EXTENSION IF NOT EXISTS "citext";');
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    await client.query('CREATE EXTENSION IF NOT EXISTS "btree_gist";');

    // Enums
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

      DO $$ BEGIN
        CREATE TYPE event_format AS ENUM ('in_person', 'online', 'hybrid');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE event_status AS ENUM (
          'draft',
          'pending_approval',
          'approved',
          'changes_requested',
          'rejected',
          'published',
          'postponed',
          'cancelled',
          'completed'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE event_visibility AS ENUM ('college', 'public');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE team_mode AS ENUM ('none', 'optional', 'required');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE event_approval_decision AS ENUM ('approved', 'rejected', 'changes_requested');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE venue_booking_status AS ENUM ('hold', 'confirmed', 'released');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE booking_status AS ENUM ('CONFIRMED', 'PENDING_PAYMENT', 'CANCELLED', 'EXPIRED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE waitlist_status AS ENUM ('WAITING', 'OFFERED', 'CLAIMED', 'EXPIRED', 'LEFT');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE team_visibility AS ENUM ('private', 'discoverable');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE team_member_role AS ENUM ('leader', 'co_leader', 'member');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE team_member_status AS ENUM ('INVITED', 'REQUESTED', 'ACTIVE', 'DECLINED', 'REMOVED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE payment_status AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'REFUND_PENDING', 'REFUNDED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE webhook_processing_status AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE refund_status AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSING', 'SUCCEEDED', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE ledger_entry_type AS ENUM ('SALE', 'REFUND');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'PAYMENT_FAILED';
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

    // 3. Sessions
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
        CONSTRAINT uq_organizer_user UNIQUE (organizer_id, user_id)
      );
    `);

    // 7. Event Staff Assignments
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

    // 9. Audit Logs
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

    // ==========================================
    // PHASE 3: VENUES, EVENTS, LIFECYCLE & BOOKINGS
    // ==========================================

    // 10. Venues
    await client.query(`
      CREATE TABLE IF NOT EXISTS venues (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
        name VARCHAR(255) NOT NULL,
        building VARCHAR(255) NOT NULL,
        capacity INT NOT NULL CHECK (capacity > 0),
        accessibility_notes TEXT,
        directions TEXT,
        map_url TEXT,
        lat NUMERIC(9, 6),
        lng NUMERIC(9, 6),
        status VARCHAR(50) DEFAULT 'active' NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 11. Events
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organizer_id UUID NOT NULL REFERENCES organizer_profiles(id) ON DELETE RESTRICT,
        college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL UNIQUE,
        description TEXT NOT NULL,
        category VARCHAR(100) NOT NULL,
        tags TEXT[] DEFAULT '{}' NOT NULL,
        department VARCHAR(100),
        format event_format NOT NULL,
        venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
        registration_opens_at TIMESTAMPTZ,
        registration_closes_at TIMESTAMPTZ,
        capacity INT NOT NULL CHECK (capacity >= 0),
        eligibility JSONB DEFAULT '{}'::jsonb NOT NULL,
        visibility event_visibility DEFAULT 'college' NOT NULL,
        status event_status DEFAULT 'draft' NOT NULL,
        team_mode team_mode DEFAULT 'none' NOT NULL,
        team_min INT,
        team_max INT,
        contact_email VARCHAR(255) NOT NULL,
        version INT DEFAULT 1 NOT NULL,
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        search TSVECTOR GENERATED ALWAYS AS (
          to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(category, '') || ' ' || coalesce(department, ''))
        ) STORED
      );
    `);

    // 12. Event Status History
    await client.query(`
      CREATE TABLE IF NOT EXISTS event_status_history (
        id BIGSERIAL PRIMARY KEY,
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        from_status event_status NOT NULL,
        to_status event_status NOT NULL,
        actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        note TEXT,
        at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 13. Event Approvals
    await client.query(`
      CREATE TABLE IF NOT EXISTS event_approvals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        decision event_approval_decision NOT NULL,
        comments TEXT NOT NULL,
        decided_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 14. Venue Bookings (Strict GiST Exclusion Constraint for Overlap Prevention)
    await client.query(`
      CREATE TABLE IF NOT EXISTS venue_bookings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
        during TSTZRANGE NOT NULL,
        status venue_booking_status DEFAULT 'hold' NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT uq_venue_booking_overlap EXCLUDE USING gist (
          venue_id WITH =,
          during WITH &&
        ) WHERE (status IN ('hold', 'confirmed'))
      );
    `);

    // 15. Event FAQs
    await client.query(`
      CREATE TABLE IF NOT EXISTS event_faqs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        display_order INT DEFAULT 0 NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 16. Event Announcements
    await client.query(`
      CREATE TABLE IF NOT EXISTS event_announcements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 17. Outbox (Transactional message outbox)
    await client.query(`
      CREATE TABLE IF NOT EXISTS outbox (
        id BIGSERIAL PRIMARY KEY,
        event_type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        status VARCHAR(50) DEFAULT 'pending' NOT NULL,
        retries INT DEFAULT 0 NOT NULL,
        dedupe_key VARCHAR(255) UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        processed_at TIMESTAMPTZ
      );
    `);

    // 18. Ticket Types
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticket_types (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        price_paise INT DEFAULT 0 NOT NULL CHECK (price_paise >= 0),
        capacity INT NOT NULL CHECK (capacity >= 0),
        sold INT DEFAULT 0 NOT NULL CHECK (sold <= capacity),
        held INT DEFAULT 0 NOT NULL CHECK (held >= 0 AND sold + held <= capacity),
        sales_start TIMESTAMPTZ,
        sales_end TIMESTAMPTZ,
        eligibility JSONB,
        per_user_limit INT DEFAULT 1 NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 19. Teams
    await client.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        visibility team_visibility DEFAULT 'private' NOT NULL,
        max_size INT DEFAULT 4 NOT NULL,
        status VARCHAR(50) DEFAULT 'active' NOT NULL,
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        skills_offered TEXT[] DEFAULT ARRAY[]::TEXT[],
        skills_needed TEXT[] DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 20. Team Members
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role team_member_role DEFAULT 'member' NOT NULL,
        status team_member_status DEFAULT 'INVITED' NOT NULL,
        joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        PRIMARY KEY (team_id, user_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_team_active_leader ON team_members (team_id) WHERE role = 'leader' AND status = 'ACTIVE';
    `);

    // 21. Team Invitations
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invitee_id UUID REFERENCES users(id) ON DELETE SET NULL,
        token_hash VARCHAR(255),
        expires_at TIMESTAMPTZ NOT NULL,
        status VARCHAR(50) DEFAULT 'PENDING' NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 22. Team Join Requests
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_join_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'PENDING' NOT NULL,
        reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 23. Team Event Registrations
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_event_registrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'registered' NOT NULL,
        submitted_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        member_snapshot JSONB NOT NULL,
        booking_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT uq_team_event_reg UNIQUE (team_id, event_id)
      );
    `);

    // 24. Team Submissions
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_registration_id UUID NOT NULL REFERENCES team_event_registrations(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        abstract TEXT NOT NULL,
        repo_url VARCHAR(500),
        demo_url VARCHAR(500),
        submitted_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        locked_at TIMESTAMPTZ
      );
    `);

    // 25. Bookings
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        team_registration_id UUID REFERENCES team_event_registrations(id) ON DELETE SET NULL,
        status booking_status DEFAULT 'CONFIRMED' NOT NULL,
        total_paise INT DEFAULT 0 NOT NULL CHECK (total_paise >= 0),
        expires_at TIMESTAMPTZ,
        idempotency_key VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT uq_booking_user_idempotency UNIQUE (user_id, idempotency_key)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_user_event_active ON bookings (user_id, event_id) WHERE (status != 'CANCELLED' AND team_registration_id IS NULL);
    `);

    // 26. Booking Items
    await client.query(`
      CREATE TABLE IF NOT EXISTS booking_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        ticket_type_id UUID NOT NULL REFERENCES ticket_types(id) ON DELETE RESTRICT,
        quantity INT DEFAULT 1 NOT NULL CHECK (quantity > 0),
        unit_price_paise INT DEFAULT 0 NOT NULL CHECK (unit_price_paise >= 0)
      );
    `);

    // 27. Tickets
    await client.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        ticket_type_id UUID NOT NULL REFERENCES ticket_types(id) ON DELETE RESTRICT,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        ticket_code VARCHAR(100) NOT NULL UNIQUE,
        qr_payload_hash BYTEA NOT NULL UNIQUE,
        status VARCHAR(50) DEFAULT 'VALID' NOT NULL,
        checked_in_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 28. Registration Form Questions
    await client.query(`
      CREATE TABLE IF NOT EXISTS registration_form_questions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'text' NOT NULL,
        required BOOLEAN DEFAULT false NOT NULL,
        options JSONB,
        sort INT DEFAULT 0 NOT NULL
      );
    `);

    // 29. Registration Answers
    await client.query(`
      CREATE TABLE IF NOT EXISTS registration_answers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        question_id UUID NOT NULL REFERENCES registration_form_questions(id) ON DELETE CASCADE,
        answer JSONB NOT NULL
      );
    `);

    // 30. Waitlist Entries
    await client.query(`
      CREATE TABLE IF NOT EXISTS waitlist_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        ticket_type_id UUID NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        status waitlist_status DEFAULT 'WAITING' NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        offered_at TIMESTAMPTZ,
        offer_expires_at TIMESTAMPTZ,
        claim_token_hash VARCHAR(255)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_active_user ON waitlist_entries (ticket_type_id, user_id) WHERE status IN ('WAITING', 'OFFERED');
    `);

    // 31. Cancellations
    await client.query(`
      CREATE TABLE IF NOT EXISTS cancellations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 32. Payments
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        provider VARCHAR(50) DEFAULT 'simulator' NOT NULL,
        provider_order_id VARCHAR(255) NOT NULL UNIQUE,
        provider_payment_id VARCHAR(255) UNIQUE,
        amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
        currency VARCHAR(10) DEFAULT 'INR' NOT NULL,
        status payment_status DEFAULT 'CREATED' NOT NULL,
        failure_code VARCHAR(100),
        is_simulated BOOLEAN DEFAULT true NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 33. Payment Attempts
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL,
        raw_ref VARCHAR(255),
        at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 34. Webhook Events
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        provider_event_id VARCHAR(255) PRIMARY KEY,
        provider VARCHAR(50) NOT NULL,
        type VARCHAR(100) NOT NULL,
        signature_valid BOOLEAN DEFAULT false NOT NULL,
        received_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        processed_at TIMESTAMPTZ,
        processing_status webhook_processing_status DEFAULT 'RECEIVED' NOT NULL,
        payload_hash BYTEA NOT NULL
      );
    `);

    // 35. Refunds
    await client.query(`
      CREATE TABLE IF NOT EXISTS refunds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
        amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
        reason TEXT NOT NULL,
        status refund_status DEFAULT 'REQUESTED' NOT NULL,
        requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
        idempotency_key VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 36. Organizer Ledger Entries
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizer_ledger_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organizer_id UUID NOT NULL REFERENCES organizer_profiles(id) ON DELETE RESTRICT,
        booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
        entry_type ledger_entry_type NOT NULL,
        amount_paise INTEGER NOT NULL,
        is_simulated BOOLEAN DEFAULT true NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT uq_ledger_payment_entry UNIQUE (payment_id, entry_type)
      );
    `);

    // 37. Receipts
    await client.query(`
      CREATE TABLE IF NOT EXISTS receipts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        number VARCHAR(100) NOT NULL UNIQUE,
        issued_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // Indexes on Payments, Ledger & Bookings
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments(booking_id);
      CREATE INDEX IF NOT EXISTS idx_payments_provider_order ON payments(provider_order_id);
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
      CREATE INDEX IF NOT EXISTS idx_refunds_payment_id ON refunds(payment_id);
      CREATE INDEX IF NOT EXISTS idx_ledger_organizer_id ON organizer_ledger_entries(organizer_id);
      CREATE INDEX IF NOT EXISTS idx_ledger_booking_id ON organizer_ledger_entries(booking_id);
      CREATE INDEX IF NOT EXISTS idx_receipts_booking_id ON receipts(booking_id);
    `);

    // Indexes on Events and Bookings
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_events_status_starts_at ON events(status, starts_at);
      CREATE INDEX IF NOT EXISTS idx_events_organizer_id ON events(organizer_id);
      CREATE INDEX IF NOT EXISTS idx_events_college_visibility ON events(college_id, visibility);
      CREATE INDEX IF NOT EXISTS idx_events_search ON events USING gin(search);
      CREATE INDEX IF NOT EXISTS idx_events_tags ON events USING gin(tags);
      CREATE INDEX IF NOT EXISTS idx_venue_bookings_event ON venue_bookings(event_id);
      CREATE INDEX IF NOT EXISTS idx_venue_bookings_venue ON venue_bookings(venue_id);
      CREATE INDEX IF NOT EXISTS idx_event_faqs_event ON event_faqs(event_id, display_order);
      CREATE INDEX IF NOT EXISTS idx_event_announcements_event ON event_announcements(event_id, created_at DESC);
    `);

    // DB Roles & Grants
    await client.query(`
      DO $$ BEGIN
        CREATE ROLE app_rw;
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE ROLE migrator;
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      GRANT USAGE ON SCHEMA public TO app_rw;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;

      REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw, PUBLIC;
    `);

    await client.query('COMMIT');
    console.log('[Migration] Phase 2 & Phase 3 schemas & constraints applied successfully.');
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
