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

      DO $$ BEGIN
        CREATE TYPE ticket_status AS ENUM ('VALID', 'CHECKED_IN', 'CANCELLED', 'REVOKED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE checkin_source AS ENUM ('online', 'offline_sync');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE scan_outcome AS ENUM ('ACCEPTED', 'DUPLICATE', 'INVALID', 'WRONG_EVENT', 'REVOKED', 'OUTSIDE_WINDOW', 'NOT_ASSIGNED');
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
      REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;
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

    // Phase 6 Schema updates for tickets table
    await client.query(`
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS booking_item_id UUID REFERENCES booking_items(id) ON DELETE SET NULL;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS qr_token_hash BYTEA UNIQUE;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS revoke_reason TEXT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS checked_in_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;

      UPDATE tickets SET owner_user_id = user_id WHERE owner_user_id IS NULL;
      UPDATE tickets SET qr_token_hash = qr_payload_hash WHERE qr_token_hash IS NULL;
      UPDATE tickets SET issued_at = created_at WHERE issued_at IS NULL;
    `);

    // 38. Attendance Sessions
    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL,
        checkin_opens_at TIMESTAMPTZ NOT NULL,
        checkin_closes_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 39. Checkins
    await client.query(`
      CREATE TABLE IF NOT EXISTS checkins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        session_id UUID REFERENCES attendance_sessions(id) ON DELETE SET NULL,
        staff_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        source VARCHAR(50) DEFAULT 'online' NOT NULL,
        device_id VARCHAR(100),
        scanned_at TIMESTAMPTZ NOT NULL,
        recorded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_checkins_ticket_session ON checkins (ticket_id, session_id) WHERE session_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_checkins_ticket_nosession ON checkins (ticket_id) WHERE session_id IS NULL;
    `);

    // 40. Certificate Policies
    await client.query(`
      CREATE TABLE IF NOT EXISTS certificate_policies (
        event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
        min_sessions INT DEFAULT 1 NOT NULL,
        requires_checkin BOOLEAN DEFAULT true NOT NULL,
        template JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 41. Certificates
    await client.query(`
      CREATE TABLE IF NOT EXISTS certificates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        verification_code VARCHAR(50) NOT NULL UNIQUE,
        issued_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoke_reason TEXT,
        hash BYTEA NOT NULL,
        CONSTRAINT uq_certificates_user_event UNIQUE (user_id, event_id)
      );
    `);

    // 42. Scan Log
    await client.query(`
      CREATE TABLE IF NOT EXISTS scan_log (
        id BIGSERIAL PRIMARY KEY,
        ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        staff_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        outcome VARCHAR(50) NOT NULL,
        at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // Indexes on Phase 6 Checkin & Certs
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_sessions_event_id ON attendance_sessions(event_id);
      CREATE INDEX IF NOT EXISTS idx_checkins_event_id ON checkins(event_id);
      CREATE INDEX IF NOT EXISTS idx_checkins_staff_id ON checkins(staff_id);
      CREATE INDEX IF NOT EXISTS idx_checkins_scanned_at ON checkins(scanned_at);
      CREATE INDEX IF NOT EXISTS idx_certificates_user_id ON certificates(user_id);
      CREATE INDEX IF NOT EXISTS idx_certificates_event_id ON certificates(event_id);
      CREATE INDEX IF NOT EXISTS idx_certificates_code ON certificates(verification_code);
      CREATE INDEX IF NOT EXISTS idx_scan_log_event_id ON scan_log(event_id);
      CREATE INDEX IF NOT EXISTS idx_scan_log_ticket_id ON scan_log(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_qr_token_hash ON tickets(qr_token_hash);
      CREATE INDEX IF NOT EXISTS idx_tickets_owner_user ON tickets(owner_user_id);
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

    // Phase 7: Feedback, Reviews, Organizer Insights, Exports
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE feedback_moderation_status AS ENUM ('visible', 'flagged', 'hidden');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE feedback_invitation_status AS ENUM ('PENDING', 'REMINDED', 'COMPLETED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE feedback_report_status AS ENUM ('PENDING', 'REVIEWED', 'DISMISSED', 'ACTIONED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE export_job_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE export_job_kind AS ENUM ('attendees', 'feedback', 'sales_ledger', 'analytics');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      -- 43. Event Feedback
      CREATE TABLE IF NOT EXISTS event_feedback (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
        rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
        answers JSONB DEFAULT '{}'::jsonb,
        comment TEXT,
        moderation_status feedback_moderation_status DEFAULT 'visible' NOT NULL,
        submitted_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        edited_at TIMESTAMPTZ,
        CONSTRAINT uq_feedback_event_user UNIQUE (event_id, user_id)
      );

      -- 44. Feedback Invitations
      CREATE TABLE IF NOT EXISTS feedback_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        status feedback_invitation_status DEFAULT 'PENDING' NOT NULL,
        invited_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        last_reminded_at TIMESTAMPTZ,
        reminders_sent SMALLINT DEFAULT 0 NOT NULL,
        CONSTRAINT uq_feedback_invitation_event_user UNIQUE (event_id, user_id)
      );

      -- 45. Feedback Reports
      CREATE TABLE IF NOT EXISTS feedback_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        feedback_id UUID REFERENCES event_feedback(id) ON DELETE CASCADE NOT NULL,
        reporter_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        reason TEXT NOT NULL,
        status feedback_report_status DEFAULT 'PENDING' NOT NULL,
        resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        resolved_at TIMESTAMPTZ
      );

      -- 46. Feedback Questions
      CREATE TABLE IF NOT EXISTS feedback_questions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
        label TEXT NOT NULL,
        type VARCHAR(50) NOT NULL,
        required BOOLEAN DEFAULT false NOT NULL,
        options JSONB,
        sort INT DEFAULT 0 NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      -- 47. Export Jobs
      CREATE TABLE IF NOT EXISTS export_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requester_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
        kind export_job_kind NOT NULL,
        format VARCHAR(10) DEFAULT 'csv' NOT NULL,
        status export_job_status DEFAULT 'PENDING' NOT NULL,
        file_key TEXT,
        download_url TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        completed_at TIMESTAMPTZ,
        row_count INT DEFAULT 0
      );

      -- 48. Event Metrics (Aggregate & Materialized Analytics Table)
      CREATE TABLE IF NOT EXISTS event_metrics (
        event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
        registrations INT DEFAULT 0 NOT NULL,
        confirmed INT DEFAULT 0 NOT NULL,
        cancellations INT DEFAULT 0 NOT NULL,
        waitlist_joined INT DEFAULT 0 NOT NULL,
        waitlist_converted INT DEFAULT 0 NOT NULL,
        checkins INT DEFAULT 0 NOT NULL,
        no_shows INT DEFAULT 0 NOT NULL,
        feedback_count INT DEFAULT 0 NOT NULL,
        rating_avg NUMERIC(3, 2) DEFAULT 0.00 NOT NULL,
        sales_paise_simulated INT DEFAULT 0 NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_event_feedback_event ON event_feedback(event_id, submitted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_feedback_invitations_user ON feedback_invitations(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_export_jobs_requester ON export_jobs(requester_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_export_jobs_event ON export_jobs(event_id);
    `);

    // Phase 8: Volunteers, Venue Navigator, Equipment & Issue Desk
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE volunteer_application_status AS ENUM (
          'APPLIED',
          'APPROVED',
          'ASSIGNED',
          'CHECKED_IN',
          'COMPLETED',
          'CANCELLED',
          'REJECTED'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE equipment_request_status AS ENUM (
          'PENDING',
          'APPROVED',
          'REJECTED',
          'RETURNED'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE support_issue_status AS ENUM (
          'OPEN',
          'IN_PROGRESS',
          'RESOLVED',
          'CLOSED'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      -- Venue & Event Enrichments
      ALTER TABLE venues ADD COLUMN IF NOT EXISTS entry_instructions TEXT;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS allow_guests BOOLEAN DEFAULT false NOT NULL;

      -- Volunteer Roles
      CREATE TABLE IF NOT EXISTS volunteer_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        requirements TEXT,
        capacity INT NOT NULL CHECK (capacity > 0),
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      -- Volunteer Shifts
      CREATE TABLE IF NOT EXISTS volunteer_shifts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        role_id UUID NOT NULL REFERENCES volunteer_roles(id) ON DELETE CASCADE,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
        capacity INT NOT NULL CHECK (capacity > 0),
        assigned INT DEFAULT 0 NOT NULL CHECK (assigned >= 0 AND assigned <= capacity),
        venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      -- Volunteer Applications
      CREATE TABLE IF NOT EXISTS volunteer_applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shift_id UUID NOT NULL REFERENCES volunteer_shifts(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status volunteer_application_status DEFAULT 'APPLIED' NOT NULL,
        reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        checkin_token_hash BYTEA UNIQUE,
        checked_in_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT uq_volunteer_shift_user UNIQUE (shift_id, user_id)
      );

      -- Volunteer Records (Feeds Passport)
      CREATE TABLE IF NOT EXISTS volunteer_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        shift_id UUID NOT NULL REFERENCES volunteer_shifts(id) ON DELETE CASCADE,
        hours NUMERIC(5, 2) NOT NULL,
        verified_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        verified_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      -- Equipment Items
      CREATE TABLE IF NOT EXISTS equipment_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
        name VARCHAR(255) NOT NULL,
        qty_total INT NOT NULL CHECK (qty_total >= 0),
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      -- Equipment Requests
      CREATE TABLE IF NOT EXISTS equipment_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        item_id UUID NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
        qty INT NOT NULL CHECK (qty > 0),
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
        status equipment_request_status DEFAULT 'PENDING' NOT NULL,
        reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      -- Support Issues
      CREATE TABLE IF NOT EXISTS support_issues (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
        category VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        status support_issue_status DEFAULT 'OPEN' NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      -- Support Issue Events (Audit Timeline)
      CREATE TABLE IF NOT EXISTS support_issue_events (
        id BIGSERIAL PRIMARY KEY,
        issue_id UUID NOT NULL REFERENCES support_issues(id) ON DELETE CASCADE,
        actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        from_status support_issue_status,
        to_status support_issue_status,
        note TEXT NOT NULL,
        at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      -- Guest Registrations
      CREATE TABLE IF NOT EXISTS guest_registrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        contact_hash VARCHAR(64) NOT NULL,
        access_code_hash BYTEA NOT NULL,
        status VARCHAR(50) DEFAULT 'VALID' NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_volunteer_shifts_role ON volunteer_shifts(role_id);
      CREATE INDEX IF NOT EXISTS idx_volunteer_apps_user ON volunteer_applications(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_volunteer_records_user ON volunteer_records(user_id);
      CREATE INDEX IF NOT EXISTS idx_equipment_requests_item ON equipment_requests(item_id, starts_at, ends_at);
      CREATE INDEX IF NOT EXISTS idx_support_issues_event ON support_issues(event_id, status);
      CREATE INDEX IF NOT EXISTS idx_support_issue_events_issue ON support_issue_events(issue_id);
    `);

    // ==========================================
    // PHASE 9: ALERTS, NOTIFICATIONS, OFFLINE CHECK-IN
    // ==========================================
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE notification_severity AS ENUM ('info', 'important', 'urgent');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE notification_channel AS ENUM ('inapp', 'email');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE delivery_status AS ENUM ('QUEUED', 'ACCEPTED', 'DELIVERED', 'FAILED', 'UNKNOWN');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE event_alert_kind AS ENUM ('venue', 'time', 'speaker', 'cancellation', 'safety');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE offline_op_outcome AS ENUM ('SYNCED', 'DUPLICATE', 'REJECTED', 'CONFLICT');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE scan_conflict_status AS ENUM ('OPEN', 'RESOLVED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE outbox_status AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'DEAD');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      -- Enrich outbox with Phase 9 columns
      ALTER TABLE outbox ADD COLUMN IF NOT EXISTS topic VARCHAR(100);
      ALTER TABLE outbox ADD COLUMN IF NOT EXISTS aggregate_id VARCHAR(255);
      ALTER TABLE outbox ADD COLUMN IF NOT EXISTS attempts SMALLINT DEFAULT 0;
      ALTER TABLE outbox ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

      -- Notifications
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(100) NOT NULL,
        event_id UUID REFERENCES events(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        severity notification_severity DEFAULT 'info' NOT NULL,
        payload JSONB,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      -- Notification Deliveries
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        channel notification_channel NOT NULL,
        status delivery_status DEFAULT 'QUEUED' NOT NULL,
        provider VARCHAR(50),
        provider_msg_id VARCHAR(255),
        attempts SMALLINT DEFAULT 0 NOT NULL,
        accepted_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        error_code VARCHAR(100),
        CONSTRAINT uq_notification_channel UNIQUE (notification_id, channel)
      );

      -- Event Alerts
      CREATE TABLE IF NOT EXISTS event_alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        kind event_alert_kind NOT NULL,
        message TEXT NOT NULL,
        severity notification_severity DEFAULT 'info' NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      -- Notification Metrics (Latency samples)
      CREATE TABLE IF NOT EXISTS notification_metrics (
        id BIGSERIAL PRIMARY KEY,
        notification_id UUID,
        t_trigger TIMESTAMPTZ NOT NULL,
        t_enqueued TIMESTAMPTZ NOT NULL,
        t_dequeued TIMESTAMPTZ NOT NULL,
        t_provider_accepted TIMESTAMPTZ
      );

      -- Offline Manifests
      CREATE TABLE IF NOT EXISTS offline_manifests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
        device_id VARCHAR(100) NOT NULL,
        issued_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        ticket_count INTEGER DEFAULT 0 NOT NULL,
        key_id VARCHAR(64) NOT NULL
      );

      -- Offline Checkin Batches
      CREATE TABLE IF NOT EXISTS offline_checkin_batches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        device_id VARCHAR(100) NOT NULL,
        staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'RECEIVED' NOT NULL,
        received_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        op_count INTEGER DEFAULT 0 NOT NULL
      );

      -- Offline Ops
      CREATE TABLE IF NOT EXISTS offline_ops (
        op_id UUID PRIMARY KEY,
        batch_id UUID NOT NULL REFERENCES offline_checkin_batches(id) ON DELETE CASCADE,
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        ticket_ref VARCHAR(64) NOT NULL,
        device_id VARCHAR(100) NOT NULL,
        scanned_at_local TIMESTAMPTZ NOT NULL,
        outcome offline_op_outcome NOT NULL,
        reason TEXT,
        reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        resolution TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      -- Scan Conflicts
      CREATE TABLE IF NOT EXISTS scan_conflicts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        op_ids UUID[] NOT NULL,
        status scan_conflict_status DEFAULT 'OPEN' NOT NULL,
        resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
        resolution_note TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON notification_deliveries(status);
      CREATE INDEX IF NOT EXISTS idx_event_alerts_event ON event_alerts(event_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_offline_manifests_event ON offline_manifests(event_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_offline_ops_ticket ON offline_ops(ticket_ref, event_id);
      CREATE INDEX IF NOT EXISTS idx_scan_conflicts_event ON scan_conflicts(event_id, status);
      CREATE INDEX IF NOT EXISTS idx_outbox_queue ON outbox(status, next_attempt_at) WHERE status IN ('pending', 'PENDING');

      -- Phase 10: Cross-College & Student Event Passport (FR-XCOL, FR-PASS)
      DO $$ BEGIN
        CREATE TYPE college_participation_status AS ENUM ('none', 'pending', 'participating');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE organizer_verification_status AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE achievement_type AS ENUM ('ATTENDANCE', 'VOLUNTEER', 'CERTIFICATE', 'TEAM_PARTICIPATION');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE achievement_verification_status AS ENUM ('VERIFIED', 'PENDING', 'REVOKED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE achievement_visibility AS ENUM ('private', 'public');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      -- Alter colleges
      ALTER TABLE colleges ADD COLUMN IF NOT EXISTS participation_status college_participation_status DEFAULT 'none' NOT NULL;
      ALTER TABLE colleges ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
      ALTER TABLE colleges ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id) ON DELETE SET NULL;

      -- Organizer Verifications
      CREATE TABLE IF NOT EXISTS organizer_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organizer_id UUID NOT NULL REFERENCES organizer_profiles(id) ON DELETE CASCADE,
        status organizer_verification_status DEFAULT 'PENDING' NOT NULL,
        evidence_ref TEXT NOT NULL,
        reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      -- Student Achievements
      CREATE TABLE IF NOT EXISTS student_achievements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type achievement_type NOT NULL,
        source_event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        source_ref_id UUID NOT NULL,
        verification_status achievement_verification_status DEFAULT 'VERIFIED' NOT NULL,
        visibility achievement_visibility DEFAULT 'public' NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT uq_student_achievements_type_sourceref UNIQUE (type, source_ref_id)
      );

      -- Passport Settings
      CREATE TABLE IF NOT EXISTS passport_settings (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        is_public BOOLEAN DEFAULT FALSE NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        show_attendance BOOLEAN DEFAULT TRUE NOT NULL,
        show_volunteer BOOLEAN DEFAULT TRUE NOT NULL,
        show_certificates BOOLEAN DEFAULT TRUE NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_colleges_participation ON colleges(participation_status);
      CREATE INDEX IF NOT EXISTS idx_organizer_verifications_org ON organizer_verifications(organizer_id, status);
      CREATE INDEX IF NOT EXISTS idx_student_achievements_user_vis ON student_achievements(user_id, visibility, verification_status);
      CREATE INDEX IF NOT EXISTS idx_passport_settings_slug ON passport_settings(slug) WHERE is_public = TRUE;
    `);

    // ==========================================
    // PHASE 11: PRODUCTION HARDENING, OPS RUNS, AUDIT PARTITIONING & READINESS
    // ==========================================
    await client.query(`
      DO $$ BEGIN
        CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
      EXCEPTION
        WHEN duplicate_object THEN null;
        WHEN insufficient_privilege THEN
          RAISE NOTICE 'Skipping pg_stat_statements: insufficient privilege in managed database environment';
        WHEN feature_not_supported THEN
          RAISE NOTICE 'Skipping pg_stat_statements: not available in shared_preload_libraries';
      END $$;
    `);

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

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

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
        (11, 'Phase 11: Production Hardening, ops_runs & Monthly Partitioning'),
        (12, 'Phase 12: Auth Token Purpose Separation & Session Hardening'),
        (13, 'Phase 13: Active Solo Booking Partial Unique Index & Hold Reconciliation'),
        (14, 'Phase 14: Event Status History System Actor, Completion Index & Scan Outcome'),
        (15, 'Phase 15: Event Pricing Type, Currency & Tier Backfill'),
        (16, 'Phase 16: Custom Registration Form Builder & Versioned Fields')
      ON CONFLICT (version) DO UPDATE SET applied_at = NOW();

      -- Comprehensive production performance indexes
      CREATE INDEX IF NOT EXISTS idx_events_perf_discovery ON events(visibility, status, starts_at, category);
      CREATE INDEX IF NOT EXISTS idx_bookings_perf_user_event ON bookings(user_id, event_id, status);
      CREATE INDEX IF NOT EXISTS idx_tickets_perf_qr_hash ON tickets(qr_token_hash);
      CREATE INDEX IF NOT EXISTS idx_checkins_perf_dedupe ON checkins(ticket_id, session_id);
      CREATE INDEX IF NOT EXISTS idx_ledger_perf_analytics ON organizer_ledger_entries(organizer_id, entry_type, created_at);
      CREATE INDEX IF NOT EXISTS idx_feedback_perf_event ON event_feedback(event_id, moderation_status);

      -- Phase 12: Auth Token Purpose Separation & Session Hardening
      ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS purpose VARCHAR(50) DEFAULT 'reset_password' NOT NULL;
      DO $$ BEGIN
        ALTER TABLE password_resets ADD CONSTRAINT chk_password_resets_purpose CHECK (purpose IN ('verify_email', 'reset_password'));
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;

      -- Phase 13: Active Solo Booking Partial Unique Index & Hold Reconciliation
      DROP INDEX IF EXISTS uq_booking_user_event_active;
      CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_user_event_solo_idx ON bookings (user_id, event_id)
        WHERE status IN ('PENDING_PAYMENT', 'CONFIRMED') AND team_registration_id IS NULL;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payload_hash VARCHAR(64);

      -- Phase 14: Event Status History System Actor, Completion Index & Scan Outcome
      ALTER TABLE event_status_history ALTER COLUMN actor_id DROP NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_events_status_ends_at ON events(status, ends_at);
      ALTER TABLE refunds ALTER COLUMN requested_by DROP NOT NULL;
      ALTER TYPE scan_outcome ADD VALUE IF NOT EXISTS 'EVENT_NOT_PUBLISHED';

      -- Phase 15: Event Pricing Type, Currency & Tier Backfill
      DO $$ BEGIN
        CREATE TYPE event_pricing_type AS ENUM ('free', 'paid');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;

      ALTER TABLE events ADD COLUMN IF NOT EXISTS pricing_type event_pricing_type DEFAULT 'free' NOT NULL;
      ALTER TABLE events ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'INR' NOT NULL;

      -- Backfill pricing_type from existing ticket_types
      UPDATE events e
      SET pricing_type = 'paid'
      WHERE EXISTS (
        SELECT 1 FROM ticket_types tt
        WHERE tt.event_id = e.id AND tt.price_paise > 0
      );

      -- Phase 16: Custom Registration Form Builder & Versioned Fields
      DO $$ BEGIN
        CREATE TYPE event_form_field_type AS ENUM (
          'short_text',
          'long_text',
          'dropdown',
          'radio',
          'checkbox',
          'multi_checkbox',
          'phone',
          'email',
          'number',
          'date',
          'dietary'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;

      CREATE TABLE IF NOT EXISTS event_form_fields (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        position INT NOT NULL DEFAULT 0,
        type event_form_field_type NOT NULL DEFAULT 'short_text',
        label TEXT NOT NULL,
        help_text TEXT,
        required BOOLEAN NOT NULL DEFAULT false,
        options JSONB NOT NULL DEFAULT '[]'::jsonb,
        validation JSONB NOT NULL DEFAULT '{}'::jsonb,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_event_form_fields_event_pos ON event_form_fields(event_id, position);

      ALTER TABLE registration_answers ADD COLUMN IF NOT EXISTS field_id UUID REFERENCES event_form_fields(id) ON DELETE CASCADE;
      ALTER TABLE registration_answers ADD COLUMN IF NOT EXISTS field_version INT DEFAULT 1;
      ALTER TABLE registration_answers ADD COLUMN IF NOT EXISTS value JSONB;
      ALTER TABLE registration_answers ADD COLUMN IF NOT EXISTS attendee_index INT NOT NULL DEFAULT 0;

      ALTER TABLE registration_answers ALTER COLUMN question_id DROP NOT NULL;
      ALTER TABLE registration_answers ALTER COLUMN answer DROP NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_registration_answers_booking ON registration_answers(booking_id);
      CREATE INDEX IF NOT EXISTS idx_registration_answers_field ON registration_answers(field_id);
    `);

    // Non-negotiable audit log immutability: ensure append-only restriction is applied to PUBLIC
    await client.query(`
      REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;
    `);

    // Optional least-privilege roles (applicable for self-hosted / Docker Postgres; handled cleanly if restricted on managed cloud)
    await client.query(`
      DO $$ BEGIN
        -- 1. Create app_rw role if possible
        BEGIN
          CREATE ROLE app_rw;
        EXCEPTION
          WHEN duplicate_object THEN null;
          WHEN insufficient_privilege THEN
            RAISE NOTICE 'Skipping CREATE ROLE app_rw: insufficient privilege in managed database environment';
        END;

        -- 2. Create migrator role if possible
        BEGIN
          CREATE ROLE migrator;
        EXCEPTION
          WHEN duplicate_object THEN null;
          WHEN insufficient_privilege THEN
            RAISE NOTICE 'Skipping CREATE ROLE migrator: insufficient privilege in managed database environment';
        END;

        -- 3. If app_rw role exists, grant bounded privileges and revoke mutation on audit_logs
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
          GRANT USAGE ON SCHEMA public TO app_rw;
          GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
          GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
          REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw;
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
    console.log('[Migration] Phase 1-11 schemas, partition bounds, and constraints applied successfully.');
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
