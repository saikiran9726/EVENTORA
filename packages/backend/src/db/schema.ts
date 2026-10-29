import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  pgEnum,
  bigserial,
  jsonb,
  customType,
  unique,
  integer,
  numeric,
  smallint,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// Custom bytea type for binary hashes (e.g. SHA-256 session token hash)
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
  toDriver(val: Buffer): Buffer {
    return val;
  },
  fromDriver(val: Buffer): Buffer {
    return val;
  },
});

// Custom citext type for case-insensitive email comparison
const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

// Custom tstzrange type for GiST range index
const tstzrange = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tstzrange';
  },
});

// Enums
export const globalRoleEnum = pgEnum('global_role', ['student', 'reviewer', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'pending']);
export const organizerStatusEnum = pgEnum('organizer_status', ['pending', 'verified', 'suspended']);
export const organizerMemberRoleEnum = pgEnum('organizer_member_role', ['owner', 'manager', 'member']);
export const organizerMemberStatusEnum = pgEnum('organizer_member_status', ['active', 'invited', 'removed']);
export const staffCapabilityEnum = pgEnum('staff_capability', ['checkin', 'volunteer_lead']);

export const eventFormatEnum = pgEnum('event_format', ['in_person', 'online', 'hybrid']);
export const eventStatusEnum = pgEnum('event_status', [
  'draft',
  'pending_approval',
  'approved',
  'changes_requested',
  'rejected',
  'published',
  'postponed',
  'cancelled',
  'completed',
]);
export const eventVisibilityEnum = pgEnum('event_visibility', ['college', 'public']);
export const eventPricingTypeEnum = pgEnum('event_pricing_type', ['free', 'paid']);
export const eventFormFieldTypeEnum = pgEnum('event_form_field_type', [
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
  'dietary',
]);
export const teamModeEnum = pgEnum('team_mode', ['none', 'optional', 'required']);
export const eventApprovalDecisionEnum = pgEnum('event_approval_decision', [
  'approved',
  'rejected',
  'changes_requested',
]);
export const venueBookingStatusEnum = pgEnum('venue_booking_status', ['hold', 'confirmed', 'released']);

export const bookingStatusEnum = pgEnum('booking_status', [
  'CONFIRMED',
  'PENDING_PAYMENT',
  'PAYMENT_FAILED',
  'CANCELLED',
  'EXPIRED',
]);
export const waitlistStatusEnum = pgEnum('waitlist_status', [
  'WAITING',
  'OFFERED',
  'CLAIMED',
  'EXPIRED',
  'LEFT',
  'DECLINED',
]);
export const teamVisibilityEnum = pgEnum('team_visibility', ['private', 'discoverable']);
export const teamMemberRoleEnum = pgEnum('team_member_role', ['leader', 'co_leader', 'member']);
export const teamMemberStatusEnum = pgEnum('team_member_status', [
  'INVITED',
  'REQUESTED',
  'ACTIVE',
  'DECLINED',
  'REMOVED',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'CREATED',
  'PENDING',
  'QUEUED',
  'VERIFICATION_QUEUE',
  'SUCCESS',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
]);

export const webhookProcessingStatusEnum = pgEnum('webhook_processing_status', [
  'RECEIVED',
  'PROCESSED',
  'IGNORED',
  'FAILED',
]);

export const refundStatusEnum = pgEnum('refund_status', [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'REFUND_PENDING_MANUAL',
]);

export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', ['SALE', 'REFUND']);

export const ticketStatusEnum = pgEnum('ticket_status', [
  'VALID',
  'CHECKED_IN',
  'CANCELLED',
  'REVOKED',
]);

export const checkinSourceEnum = pgEnum('checkin_source', [
  'online',
  'offline_sync',
]);

export const scanOutcomeEnum = pgEnum('scan_outcome', [
  'ACCEPTED',
  'DUPLICATE',
  'INVALID',
  'WRONG_EVENT',
  'REVOKED',
  'OUTSIDE_WINDOW',
  'NOT_ASSIGNED',
  'EVENT_NOT_PUBLISHED',
]);

export const feedbackModerationStatusEnum = pgEnum('feedback_moderation_status', [
  'visible',
  'flagged',
  'hidden',
]);

export const feedbackInvitationStatusEnum = pgEnum('feedback_invitation_status', [
  'PENDING',
  'REMINDED',
  'COMPLETED',
]);

export const feedbackReportStatusEnum = pgEnum('feedback_report_status', [
  'PENDING',
  'REVIEWED',
  'DISMISSED',
  'ACTIONED',
]);

export const exportJobStatusEnum = pgEnum('export_job_status', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);

export const exportJobKindEnum = pgEnum('export_job_kind', [
  'attendees',
  'feedback',
  'sales_ledger',
  'analytics',
]);

export const volunteerApplicationStatusEnum = pgEnum('volunteer_application_status', [
  'APPLIED',
  'APPROVED',
  'ASSIGNED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
]);

export const equipmentRequestStatusEnum = pgEnum('equipment_request_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'RETURNED',
]);

export const supportIssueStatusEnum = pgEnum('support_issue_status', [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
]);

export const notificationSeverityEnum = pgEnum('notification_severity', [
  'info',
  'important',
  'urgent',
]);

export const notificationChannelEnum = pgEnum('notification_channel', [
  'inapp',
  'email',
]);

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'QUEUED',
  'ACCEPTED',
  'DELIVERED',
  'FAILED',
  'UNKNOWN',
]);

export const eventAlertKindEnum = pgEnum('event_alert_kind', [
  'venue',
  'time',
  'speaker',
  'cancellation',
  'safety',
]);

export const offlineOpOutcomeEnum = pgEnum('offline_op_outcome', [
  'SYNCED',
  'DUPLICATE',
  'REJECTED',
  'CONFLICT',
]);

export const scanConflictStatusEnum = pgEnum('scan_conflict_status', [
  'OPEN',
  'RESOLVED',
]);

export const outboxStatusEnum = pgEnum('outbox_status', [
  'PENDING',
  'PROCESSING',
  'DONE',
  'DEAD',
]);

// Phase 10 Enums (FR-XCOL, FR-PASS)
export const collegeParticipationStatusEnum = pgEnum('college_participation_status', [
  'none',
  'pending',
  'participating',
]);

export const organizerVerificationStatusEnum = pgEnum('organizer_verification_status', [
  'PENDING',
  'VERIFIED',
  'REJECTED',
]);

export const achievementTypeEnum = pgEnum('achievement_type', [
  'ATTENDANCE',
  'VOLUNTEER',
  'CERTIFICATE',
  'TEAM_PARTICIPATION',
]);

export const achievementVerificationStatusEnum = pgEnum('achievement_verification_status', [
  'VERIFIED',
  'PENDING',
  'REVOKED',
]);

export const achievementVisibilityEnum = pgEnum('achievement_visibility', [
  'private',
  'public',
]);

// 1. Colleges
export const colleges = pgTable('colleges', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  domain: varchar('domain', { length: 255 }).notNull().unique(),
  status: varchar('status', { length: 50 }).default('active').notNull(),
  publicDiscovery: boolean('public_discovery').default(false).notNull(),
  participationStatus: collegeParticipationStatusEnum('participation_status').default('none').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifiedBy: uuid('verified_by').references((): any => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 2. Users
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  collegeId: uuid('college_id')
    .references(() => colleges.id, { onDelete: 'restrict' })
    .notNull(),
  email: citext('email').notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  globalRole: globalRoleEnum('global_role').default('student').notNull(),
  status: userStatusEnum('status').default('pending').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  department: varchar('department', { length: 100 }),
  year: integer('year'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 3. Sessions (Opaque 256-bit random ID SHA-256 hashed into bytea pk)
export const sessions = pgTable('sessions', {
  idHash: bytea('id_hash').primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipHash: varchar('ip_hash', { length: 64 }),
  uaHash: varchar('ua_hash', { length: 64 }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

// 4. Password Resets
export const passwordResets = pgTable('password_resets', {
  tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  purpose: varchar('purpose', { length: 50 }).default('reset_password').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 5. Organizer Profiles
export const organizerProfiles = pgTable('organizer_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  collegeId: uuid('college_id')
    .references(() => colleges.id, { onDelete: 'restrict' })
    .notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  status: organizerStatusEnum('status').default('pending').notNull(),
  createdBy: uuid('created_by')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 6. Organizer Members
export const organizerMembers = pgTable(
  'organizer_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizerId: uuid('organizer_id')
      .references(() => organizerProfiles.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: organizerMemberRoleEnum('role').default('member').notNull(),
    status: organizerMemberStatusEnum('status').default('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueOrganizerUser: unique('uq_organizer_user').on(table.organizerId, table.userId),
  })
);

// 7. Event Staff Assignments
export const eventStaffAssignments = pgTable('event_staff_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id').notNull(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  capability: staffCapabilityEnum('capability').notNull(),
  grantedBy: uuid('granted_by')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 8. User Preferences
export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  emailEnabled: boolean('email_enabled').default(true).notNull(),
  inappEnabled: boolean('inapp_enabled').default(true).notNull(),
  theme: varchar('theme', { length: 20 }).default('light').notNull(),
  locale: varchar('locale', { length: 10 }).default('en-IN').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 9. Audit Logs (INSERT-only)
export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorId: uuid('actor_id'),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 100 }).notNull(),
  resourceId: varchar('resource_id', { length: 255 }),
  collegeId: uuid('college_id'),
  meta: jsonb('meta').default({}).notNull(),
  ipHash: varchar('ip_hash', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// PHASE 3 TABLES
// ==========================================

// 10. Venues
export const venues = pgTable('venues', {
  id: uuid('id').defaultRandom().primaryKey(),
  collegeId: uuid('college_id')
    .references(() => colleges.id, { onDelete: 'restrict' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  building: varchar('building', { length: 255 }).notNull(),
  capacity: integer('capacity').notNull(),
  accessibilityNotes: text('accessibility_notes'),
  directions: text('directions'),
  mapUrl: text('map_url'),
  lat: numeric('lat', { precision: 9, scale: 6 }),
  lng: numeric('lng', { precision: 9, scale: 6 }),
  entryInstructions: text('entry_instructions'),
  status: varchar('status', { length: 50 }).default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 11. Events
export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizerId: uuid('organizer_id')
    .references(() => organizerProfiles.id, { onDelete: 'restrict' })
    .notNull(),
  collegeId: uuid('college_id')
    .references(() => colleges.id, { onDelete: 'restrict' })
    .notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  description: text('description').notNull(),
  category: varchar('category', { length: 100 }).notNull(),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  department: varchar('department', { length: 100 }),
  format: eventFormatEnum('format').notNull(),
  venueId: uuid('venue_id').references(() => venues.id, { onDelete: 'set null' }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  registrationOpensAt: timestamp('registration_opens_at', { withTimezone: true }),
  registrationClosesAt: timestamp('registration_closes_at', { withTimezone: true }),
  capacity: integer('capacity').notNull(),
  pricingType: eventPricingTypeEnum('pricing_type').default('free').notNull(),
  currency: varchar('currency', { length: 10 }).default('INR').notNull(),
  eligibility: jsonb('eligibility').default({}).notNull(),
  visibility: eventVisibilityEnum('visibility').default('college').notNull(),
  status: eventStatusEnum('status').default('draft').notNull(),
  teamMode: teamModeEnum('team_mode').default('none').notNull(),
  teamMin: integer('team_min'),
  teamMax: integer('team_max'),
  contactEmail: varchar('contact_email', { length: 255 }).notNull(),
  allowGuests: boolean('allow_guests').default(false).notNull(),
  version: integer('version').default(1).notNull(),
  createdBy: uuid('created_by')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 12. Event Status History
export const eventStatusHistory = pgTable('event_status_history', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  fromStatus: eventStatusEnum('from_status').notNull(),
  toStatus: eventStatusEnum('to_status').notNull(),
  actorId: uuid('actor_id')
    .references(() => users.id, { onDelete: 'restrict' }),
  note: text('note'),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
});

// 13. Event Approvals
export const eventApprovals = pgTable('event_approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  reviewerId: uuid('reviewer_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  decision: eventApprovalDecisionEnum('decision').notNull(),
  comments: text('comments').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).defaultNow().notNull(),
});

// 14. Venue Bookings
export const venueBookings = pgTable('venue_bookings', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  venueId: uuid('venue_id')
    .references(() => venues.id, { onDelete: 'restrict' })
    .notNull(),
  during: tstzrange('during').notNull(),
  status: venueBookingStatusEnum('status').default('hold').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 15. Event FAQs
export const eventFaqs = pgTable('event_faqs', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  displayOrder: integer('display_order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 16. Event Announcements
export const eventAnnouncements = pgTable('event_announcements', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  body: text('body').notNull(),
  createdBy: uuid('created_by')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 17. Outbox (Transactional message outbox)
export const outbox = pgTable('outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  topic: varchar('topic', { length: 100 }),
  aggregateId: varchar('aggregate_id', { length: 255 }),
  payload: jsonb('payload').notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  retries: integer('retries').default(0).notNull(),
  attempts: smallint('attempts').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  error: text('error'),
  dedupeKey: varchar('dedupe_key', { length: 255 }).unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

// 18. Ticket Types
export const ticketTypes = pgTable('ticket_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  pricePaise: integer('price_paise').default(0).notNull(),
  capacity: integer('capacity').notNull(),
  sold: integer('sold').default(0).notNull(),
  held: integer('held').default(0).notNull(),
  salesStart: timestamp('sales_start', { withTimezone: true }),
  salesEnd: timestamp('sales_end', { withTimezone: true }),
  eligibility: jsonb('eligibility'),
  perUserLimit: integer('per_user_limit').default(1).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 19. Teams
export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  visibility: teamVisibilityEnum('visibility').default('private').notNull(),
  maxSize: integer('max_size').default(4).notNull(),
  status: varchar('status', { length: 50 }).default('active').notNull(),
  createdBy: uuid('created_by')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  skillsOffered: text('skills_offered').array(),
  skillsNeeded: text('skills_needed').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 20. Team Members
export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: teamMemberRoleEnum('role').default('member').notNull(),
    status: teamMemberStatusEnum('status').default('INVITED').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.teamId, table.userId] }),
  })
);

// 21. Team Invitations
export const teamInvitations = pgTable('team_invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id')
    .references(() => teams.id, { onDelete: 'cascade' })
    .notNull(),
  inviterId: uuid('inviter_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  inviteeId: uuid('invitee_id').references(() => users.id, { onDelete: 'set null' }),
  tokenHash: varchar('token_hash', { length: 255 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 50 }).default('PENDING').notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 22. Team Join Requests
export const teamJoinRequests = pgTable('team_join_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id')
    .references(() => teams.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  status: varchar('status', { length: 50 }).default('PENDING').notNull(),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 23. Team Event Registrations
export const teamEventRegistrations = pgTable(
  'team_event_registrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    eventId: uuid('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    status: varchar('status', { length: 50 }).default('registered').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    memberSnapshot: jsonb('member_snapshot').notNull(),
    bookingId: uuid('booking_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uqTeamEvent: unique('uq_team_event_reg').on(table.teamId, table.eventId),
  })
);

// 24. Team Submissions
export const teamSubmissions = pgTable('team_submissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamRegistrationId: uuid('team_registration_id')
    .references(() => teamEventRegistrations.id, { onDelete: 'cascade' })
    .notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  abstract: text('abstract').notNull(),
  repoUrl: varchar('repo_url', { length: 500 }),
  demoUrl: varchar('demo_url', { length: 500 }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
});

// 25. Bookings
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    eventId: uuid('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    teamRegistrationId: uuid('team_registration_id').references(
      () => teamEventRegistrations.id,
      { onDelete: 'set null' }
    ),
    status: bookingStatusEnum('status').default('CONFIRMED').notNull(),
    totalPaise: integer('total_paise').default(0).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uqUserIdempotency: unique('uq_booking_user_idempotency').on(table.userId, table.idempotencyKey),
    bookingsActiveUserEventSoloIdx: uniqueIndex('bookings_active_user_event_solo_idx')
      .on(table.userId, table.eventId)
      .where(sql`status IN ('PENDING_PAYMENT', 'CONFIRMED') AND team_registration_id IS NULL`),
    eventCreatedAtIdx: index('idx_bookings_event_created_at').on(table.eventId, table.createdAt),
    eventStatusIdx: index('idx_bookings_event_status').on(table.eventId, table.status),
  })
);

// 26. Booking Items
export const bookingItems = pgTable('booking_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  bookingId: uuid('booking_id')
    .references(() => bookings.id, { onDelete: 'cascade' })
    .notNull(),
  ticketTypeId: uuid('ticket_type_id')
    .references(() => ticketTypes.id, { onDelete: 'restrict' })
    .notNull(),
  quantity: integer('quantity').default(1).notNull(),
  unitPricePaise: integer('unit_price_paise').default(0).notNull(),
});

// 27. Tickets
export const tickets = pgTable('tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  bookingId: uuid('booking_id')
    .references(() => bookings.id, { onDelete: 'cascade' })
    .notNull(),
  bookingItemId: uuid('booking_item_id')
    .references(() => bookingItems.id, { onDelete: 'set null' }),
  ticketTypeId: uuid('ticket_type_id')
    .references(() => ticketTypes.id, { onDelete: 'restrict' })
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  ownerUserId: uuid('owner_user_id')
    .references(() => users.id, { onDelete: 'restrict' }),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  ticketCode: varchar('ticket_code', { length: 100 }).notNull().unique(),
  qrPayloadHash: bytea('qr_payload_hash').notNull().unique(),
  qrTokenHash: bytea('qr_token_hash').unique(),
  qrToken: text('qr_token'),
  qrTokenRotatedAt: timestamp('qr_token_rotated_at', { withTimezone: true }),
  status: ticketStatusEnum('status').default('VALID').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: text('revoke_reason'),
  checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
  checkedInBy: uuid('checked_in_by')
    .references(() => users.id, { onDelete: 'set null' }),
  version: integer('version').default(1).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  eventStatusScannedIdx: index('idx_tickets_event_status_scanned').on(table.eventId, table.status, table.checkedInAt),
}));

// 28. Registration Form Questions (Legacy)
export const registrationFormQuestions = pgTable('registration_form_questions', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  label: text('label').notNull(),
  type: varchar('type', { length: 50 }).default('text').notNull(),
  required: boolean('required').default(false).notNull(),
  options: jsonb('options'),
  sort: integer('sort').default(0).notNull(),
});

// 28b. Event Form Fields (Phase 16 Custom Registration Form Builder)
export const eventFormFields = pgTable(
  'event_form_fields',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    position: integer('position').default(0).notNull(),
    type: eventFormFieldTypeEnum('type').default('short_text').notNull(),
    label: text('label').notNull(),
    helpText: text('help_text'),
    required: boolean('required').default(false).notNull(),
    options: jsonb('options').$type<string[]>().default([]).notNull(),
    validation: jsonb('validation').$type<Record<string, any>>().default({}).notNull(),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    eventPosIdx: index('idx_event_form_fields_event_pos').on(table.eventId, table.position),
  })
);

// 29. Registration Answers
export const registrationAnswers = pgTable(
  'registration_answers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bookingId: uuid('booking_id')
      .references(() => bookings.id, { onDelete: 'cascade' })
      .notNull(),
    questionId: uuid('question_id')
      .references(() => registrationFormQuestions.id, { onDelete: 'cascade' }),
    answer: jsonb('answer'),
    fieldId: uuid('field_id')
      .references(() => eventFormFields.id, { onDelete: 'cascade' }),
    fieldVersion: integer('field_version').default(1),
    value: jsonb('value'),
    attendeeIndex: integer('attendee_index').default(0).notNull(),
  },
  (table) => ({
    bookingIdx: index('idx_registration_answers_booking').on(table.bookingId),
    fieldIdx: index('idx_registration_answers_field').on(table.fieldId),
  })
);

// 30. Waitlist Entries
export const waitlistEntries = pgTable('waitlist_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  ticketTypeId: uuid('ticket_type_id')
    .references(() => ticketTypes.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  status: waitlistStatusEnum('status').default('WAITING').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  offeredAt: timestamp('offered_at', { withTimezone: true }),
  offerExpiresAt: timestamp('offer_expires_at', { withTimezone: true }),
  claimTokenHash: varchar('claim_token_hash', { length: 255 }),
  bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
}, (table) => ({
  eventStatusIdx: index('idx_waitlist_event_status').on(table.eventId, table.status),
}));

// 31. Cancellations
export const cancellations = pgTable('cancellations', {
  id: uuid('id').defaultRandom().primaryKey(),
  bookingId: uuid('booking_id')
    .references(() => bookings.id, { onDelete: 'cascade' })
    .notNull(),
  reason: text('reason').notNull(),
  actorId: uuid('actor_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
});

// 32. Payments (Phase 5 - Paid Ticketing & Phase 17 YouPI-PG)
export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  bookingId: uuid('booking_id')
    .references(() => bookings.id, { onDelete: 'cascade' })
    .notNull(),
  provider: varchar('provider', { length: 50 }).default('youpi').notNull(),
  providerOrderId: varchar('provider_order_id', { length: 255 }).notNull().unique(),
  providerPaymentId: varchar('provider_payment_id', { length: 255 }).unique(),
  amountPaise: integer('amount_paise').notNull(),
  currency: varchar('currency', { length: 10 }).default('INR').notNull(),
  status: paymentStatusEnum('status').default('PENDING').notNull(),
  failureCode: varchar('failure_code', { length: 100 }),
  isSimulated: boolean('is_simulated').default(false).notNull(),
  utr: varchar('utr', { length: 50 }).unique(),
  slotActive: boolean('slot_active').default(false).notNull(),
  queuePosition: integer('queue_position'),
  checkoutUrl: text('checkout_url'),
  verificationQueueReason: text('verification_queue_reason'),
  manualReviewedBy: uuid('manual_reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  manualReviewedAt: timestamp('manual_reviewed_at', { withTimezone: true }),
  rawWebhookPayload: jsonb('raw_webhook_payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 33. Payment Attempts
export const paymentAttempts = pgTable('payment_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentId: uuid('payment_id')
    .references(() => payments.id, { onDelete: 'cascade' })
    .notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  rawRef: varchar('raw_ref', { length: 255 }),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
});

// 34. Webhook Events (Legacy & Generic)
export const webhookEvents = pgTable('webhook_events', {
  providerEventId: varchar('provider_event_id', { length: 255 }).primaryKey(),
  provider: varchar('provider', { length: 50 }).notNull(),
  type: varchar('type', { length: 100 }).notNull(),
  signatureValid: boolean('signature_valid').default(false).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processingStatus: webhookProcessingStatusEnum('processing_status').default('RECEIVED').notNull(),
  payloadHash: bytea('payload_hash').notNull(),
});

// Phase 17: Payment Events Audit Trail
export const paymentEvents = pgTable('payment_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentId: uuid('payment_id')
    .references(() => payments.id, { onDelete: 'cascade' })
    .notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  fromStatus: varchar('from_status', { length: 50 }),
  toStatus: varchar('to_status', { length: 50 }).notNull(),
  payload: jsonb('payload').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Phase 17: Webhook Deliveries (Deduplication on X-Gateway-Delivery-Id)
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  deliveryId: varchar('delivery_id', { length: 255 }).notNull().unique(),
  provider: varchar('provider', { length: 50 }).default('youpi').notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  status: varchar('status', { length: 50 }).default('RECEIVED').notNull(),
  attempts: integer('attempts').default(1).notNull(),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 35. Refunds
export const refunds = pgTable('refunds', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentId: uuid('payment_id')
    .references(() => payments.id, { onDelete: 'restrict' })
    .notNull(),
  amountPaise: integer('amount_paise').notNull(),
  reason: text('reason').notNull(),
  status: refundStatusEnum('status').default('REQUESTED').notNull(),
  requestedBy: uuid('requested_by')
    .references(() => users.id, { onDelete: 'restrict' }),
  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
  refundUtr: varchar('refund_utr', { length: 50 }),
  manualProcessedAt: timestamp('manual_processed_at', { withTimezone: true }),
  manualNotes: text('manual_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Phase 17: Reconciliation Records & Items
export const reconciliationRecords = pgTable('reconciliation_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  batchId: varchar('batch_id', { length: 100 }).notNull().unique(),
  importedBy: uuid('imported_by').references(() => users.id, { onDelete: 'set null' }),
  filename: varchar('filename', { length: 255 }).notNull(),
  totalRows: integer('total_rows').default(0).notNull(),
  matchedCount: integer('matched_count').default(0).notNull(),
  unmatchedCount: integer('unmatched_count').default(0).notNull(),
  status: varchar('status', { length: 50 }).default('COMPLETED').notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true }).defaultNow().notNull(),
});

export const reconciliationItems = pgTable('reconciliation_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  recordId: uuid('record_id')
    .references(() => reconciliationRecords.id, { onDelete: 'cascade' })
    .notNull(),
  utr: varchar('utr', { length: 50 }).notNull(),
  amountPaise: integer('amount_paise').notNull(),
  txnDate: timestamp('txn_date', { withTimezone: true }).notNull(),
  matchedPaymentId: uuid('matched_payment_id').references(() => payments.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 50 }).notNull(),
  details: jsonb('details').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 36. Organizer Ledger Entries
export const organizerLedgerEntries = pgTable(
  'organizer_ledger_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizerId: uuid('organizer_id')
      .references(() => organizerProfiles.id, { onDelete: 'restrict' })
      .notNull(),
    bookingId: uuid('booking_id')
      .references(() => bookings.id, { onDelete: 'cascade' })
      .notNull(),
    paymentId: uuid('payment_id')
      .references(() => payments.id, { onDelete: 'restrict' })
      .notNull(),
    entryType: ledgerEntryTypeEnum('entry_type').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    isSimulated: boolean('is_simulated').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uqPaymentEntry: unique('uq_ledger_payment_entry').on(table.paymentId, table.entryType),
  })
);

// 37. Receipts
export const receipts = pgTable('receipts', {
  id: uuid('id').defaultRandom().primaryKey(),
  bookingId: uuid('booking_id')
    .references(() => bookings.id, { onDelete: 'cascade' })
    .notNull(),
  number: varchar('number', { length: 100 }).notNull().unique(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
});

// 38. Attendance Sessions
export const attendanceSessions = pgTable('attendance_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  checkinOpensAt: timestamp('checkin_opens_at', { withTimezone: true }).notNull(),
  checkinClosesAt: timestamp('checkin_closes_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 39. Checkins
export const checkins = pgTable(
  'checkins',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id')
      .references(() => tickets.id, { onDelete: 'cascade' })
      .notNull(),
    eventId: uuid('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    sessionId: uuid('session_id')
      .references(() => attendanceSessions.id, { onDelete: 'set null' }),
    staffId: uuid('staff_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    source: checkinSourceEnum('source').default('online').notNull(),
    deviceId: varchar('device_id', { length: 100 }),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  }
);

// 40. Certificate Policies
export const certificatePolicies = pgTable('certificate_policies', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => events.id, { onDelete: 'cascade' }),
  minSessions: integer('min_sessions').default(1).notNull(),
  requiresCheckin: boolean('requires_checkin').default(true).notNull(),
  template: jsonb('template'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 41. Certificates
export const certificates = pgTable(
  'certificates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    eventId: uuid('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    verificationCode: varchar('verification_code', { length: 50 }).notNull().unique(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
    hash: bytea('hash').notNull(),
  },
  (table) => ({
    uqUserEvent: unique('uq_certificates_user_event').on(table.userId, table.eventId),
  })
);

// 42. Scan Log
export const scanLog = pgTable('scan_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ticketId: uuid('ticket_id')
    .references(() => tickets.id, { onDelete: 'set null' }),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  staffId: uuid('staff_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  outcome: scanOutcomeEnum('outcome').notNull(),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
});

// 43. Event Feedback
export const eventFeedback = pgTable(
  'event_feedback',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    ticketId: uuid('ticket_id')
      .references(() => tickets.id, { onDelete: 'set null' }),
    rating: smallint('rating').notNull(),
    answers: jsonb('answers').default({}),
    comment: text('comment'),
    moderationStatus: feedbackModerationStatusEnum('moderation_status').default('visible').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (table) => ({
    uqFeedbackEventUser: unique('uq_feedback_event_user').on(table.eventId, table.userId),
  })
);

// 44. Feedback Invitations
export const feedbackInvitations = pgTable(
  'feedback_invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    status: feedbackInvitationStatusEnum('status').default('PENDING').notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }).defaultNow().notNull(),
    lastRemindedAt: timestamp('last_reminded_at', { withTimezone: true }),
    remindersSent: smallint('reminders_sent').default(0).notNull(),
  },
  (table) => ({
    uqFeedbackInvitationEventUser: unique('uq_feedback_invitation_event_user').on(table.eventId, table.userId),
  })
);

// 45. Feedback Reports
export const feedbackReports = pgTable('feedback_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  feedbackId: uuid('feedback_id')
    .references(() => eventFeedback.id, { onDelete: 'cascade' })
    .notNull(),
  reporterId: uuid('reporter_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  reason: text('reason').notNull(),
  status: feedbackReportStatusEnum('status').default('PENDING').notNull(),
  resolvedBy: uuid('resolved_by')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

// 46. Feedback Questions
export const feedbackQuestions = pgTable('feedback_questions', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  label: text('label').notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  required: boolean('required').default(false).notNull(),
  options: jsonb('options'),
  sort: integer('sort').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 47. Export Jobs
export const exportJobs = pgTable('export_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  requesterId: uuid('requester_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  kind: exportJobKindEnum('kind').notNull(),
  format: varchar('format', { length: 10 }).default('csv').notNull(),
  status: exportJobStatusEnum('status').default('PENDING').notNull(),
  fileKey: text('file_key'),
  downloadUrl: text('download_url'),
  downloadToken: text('download_token'),
  fileData: bytea('file_data'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  rowCount: integer('row_count').default(0),
});

// 48. Event Metrics (Aggregate & Analytics Table)
export const eventMetrics = pgTable('event_metrics', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => events.id, { onDelete: 'cascade' }),
  registrations: integer('registrations').default(0).notNull(),
  confirmed: integer('confirmed').default(0).notNull(),
  cancellations: integer('cancellations').default(0).notNull(),
  waitlistJoined: integer('waitlist_joined').default(0).notNull(),
  waitlistConverted: integer('waitlist_converted').default(0).notNull(),
  checkins: integer('checkins').default(0).notNull(),
  noShows: integer('no_shows').default(0).notNull(),
  feedbackCount: integer('feedback_count').default(0).notNull(),
  ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }).default('0.00').notNull(),
  salesPaiseSimulated: integer('sales_paise_simulated').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// PHASE 8 TABLES: VOLUNTEERS, EQUIPMENT, ISSUES, GUESTS
// ==========================================

// 49. Volunteer Roles
export const volunteerRoles = pgTable('volunteer_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  requirements: text('requirements'),
  capacity: integer('capacity').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 50. Volunteer Shifts
export const volunteerShifts = pgTable('volunteer_shifts', {
  id: uuid('id').defaultRandom().primaryKey(),
  roleId: uuid('role_id')
    .references(() => volunteerRoles.id, { onDelete: 'cascade' })
    .notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  capacity: integer('capacity').notNull(),
  assigned: integer('assigned').default(0).notNull(),
  venueId: uuid('venue_id').references(() => venues.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 51. Volunteer Applications
export const volunteerApplications = pgTable(
  'volunteer_applications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shiftId: uuid('shift_id')
      .references(() => volunteerShifts.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    status: volunteerApplicationStatusEnum('status').default('APPLIED').notNull(),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    checkinTokenHash: bytea('checkin_token_hash').unique(),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uqShiftUser: unique('uq_volunteer_shift_user').on(table.shiftId, table.userId),
  })
);

// 52. Volunteer Records (Feeds Passport)
export const volunteerRecords = pgTable('volunteer_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  shiftId: uuid('shift_id')
    .references(() => volunteerShifts.id, { onDelete: 'cascade' })
    .notNull(),
  hours: numeric('hours', { precision: 5, scale: 2 }).notNull(),
  verifiedBy: uuid('verified_by')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 53. Equipment Items
export const equipmentItems = pgTable('equipment_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  collegeId: uuid('college_id')
    .references(() => colleges.id, { onDelete: 'restrict' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  qtyTotal: integer('qty_total').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 54. Equipment Requests
export const equipmentRequests = pgTable('equipment_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  itemId: uuid('item_id')
    .references(() => equipmentItems.id, { onDelete: 'cascade' })
    .notNull(),
  qty: integer('qty').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  status: equipmentRequestStatusEnum('status').default('PENDING').notNull(),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 55. Support Issues (Issue Desk)
export const supportIssues = pgTable('support_issues', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  reporterId: uuid('reporter_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  category: varchar('category', { length: 100 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull(),
  status: supportIssueStatusEnum('status').default('OPEN').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 56. Support Issue Events (Audit Timeline)
export const supportIssueEvents = pgTable('support_issue_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  issueId: uuid('issue_id')
    .references(() => supportIssues.id, { onDelete: 'cascade' })
    .notNull(),
  actorId: uuid('actor_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  fromStatus: supportIssueStatusEnum('from_status'),
  toStatus: supportIssueStatusEnum('to_status'),
  note: text('note').notNull(),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
});

// 57. Guest Registrations
export const guestRegistrations = pgTable('guest_registrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  contactHash: varchar('contact_hash', { length: 64 }).notNull(),
  accessCodeHash: bytea('access_code_hash').notNull(),
  status: varchar('status', { length: 50 }).default('VALID').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  college: one(colleges, {
    fields: [users.collegeId],
    references: [colleges.id],
  }),
  preferences: one(userPreferences, {
    fields: [users.id],
    references: [userPreferences.userId],
  }),
  sessions: many(sessions),
  organizerMemberships: many(organizerMembers),
  staffAssignments: many(eventStaffAssignments),
  eventsCreated: many(events),
  approvalsDecided: many(eventApprovals),
}));

export const collegesRelations = relations(colleges, ({ many }) => ({
  users: many(users),
  organizers: many(organizerProfiles),
  venues: many(venues),
  events: many(events),
}));

export const organizerProfilesRelations = relations(organizerProfiles, ({ one, many }) => ({
  college: one(colleges, {
    fields: [organizerProfiles.collegeId],
    references: [colleges.id],
  }),
  members: many(organizerMembers),
  events: many(events),
}));

export const venuesRelations = relations(venues, ({ one, many }) => ({
  college: one(colleges, {
    fields: [venues.collegeId],
    references: [colleges.id],
  }),
  events: many(events),
  bookings: many(venueBookings),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  organizer: one(organizerProfiles, {
    fields: [events.organizerId],
    references: [organizerProfiles.id],
  }),
  college: one(colleges, {
    fields: [events.collegeId],
    references: [colleges.id],
  }),
  venue: one(venues, {
    fields: [events.venueId],
    references: [venues.id],
  }),
  creator: one(users, {
    fields: [events.createdBy],
    references: [users.id],
  }),
  statusHistory: many(eventStatusHistory),
  approvals: many(eventApprovals),
  venueBookings: many(venueBookings),
  faqs: many(eventFaqs),
  announcements: many(eventAnnouncements),
  ticketTypes: many(ticketTypes),
  formFields: many(eventFormFields),
}));

export const eventFaqsRelations = relations(eventFaqs, ({ one }) => ({
  event: one(events, {
    fields: [eventFaqs.eventId],
    references: [events.id],
  }),
}));

export const eventAnnouncementsRelations = relations(eventAnnouncements, ({ one }) => ({
  event: one(events, {
    fields: [eventAnnouncements.eventId],
    references: [events.id],
  }),
}));

export const eventStatusHistoryRelations = relations(eventStatusHistory, ({ one }) => ({
  event: one(events, {
    fields: [eventStatusHistory.eventId],
    references: [events.id],
  }),
}));

export const eventApprovalsRelations = relations(eventApprovals, ({ one }) => ({
  event: one(events, {
    fields: [eventApprovals.eventId],
    references: [events.id],
  }),
}));

export const venueBookingsRelations = relations(venueBookings, ({ one }) => ({
  event: one(events, {
    fields: [venueBookings.eventId],
    references: [events.id],
  }),
}));

export const ticketTypesRelations = relations(ticketTypes, ({ one }) => ({
  event: one(events, {
    fields: [ticketTypes.eventId],
    references: [events.id],
  }),
}));

export const eventFormFieldsRelations = relations(eventFormFields, ({ one, many }) => ({
  event: one(events, {
    fields: [eventFormFields.eventId],
    references: [events.id],
  }),
  answers: many(registrationAnswers),
}));

export const registrationAnswersRelations = relations(registrationAnswers, ({ one }) => ({
  booking: one(bookings, {
    fields: [registrationAnswers.bookingId],
    references: [bookings.id],
  }),
  field: one(eventFormFields, {
    fields: [registrationAnswers.fieldId],
    references: [eventFormFields.id],
  }),
}));

// Inferred Types
export type College = typeof colleges.$inferSelect;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type PasswordReset = typeof passwordResets.$inferSelect;
export type OrganizerProfile = typeof organizerProfiles.$inferSelect;
export type OrganizerMember = typeof organizerMembers.$inferSelect;
export type EventStaffAssignment = typeof eventStaffAssignments.$inferSelect;
export type UserPreference = typeof userPreferences.$inferSelect;
export type EventFormField = typeof eventFormFields.$inferSelect;
export type NewEventFormField = typeof eventFormFields.$inferInsert;
export type EventFormFieldType = typeof eventFormFieldTypeEnum.enumValues[number];
export type AuditLog = typeof auditLogs.$inferSelect;

export type Venue = typeof venues.$inferSelect;
export type NewVenue = typeof venues.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type EventStatus = typeof eventStatusEnum.enumValues[number];
export type EventFormat = typeof eventFormatEnum.enumValues[number];
export type EventVisibility = typeof eventVisibilityEnum.enumValues[number];
export type TeamMode = typeof teamModeEnum.enumValues[number];
export type EventStatusHistory = typeof eventStatusHistory.$inferSelect;
export type EventApproval = typeof eventApprovals.$inferSelect;
export type VenueBooking = typeof venueBookings.$inferSelect;
export type EventFaq = typeof eventFaqs.$inferSelect;
export type EventAnnouncement = typeof eventAnnouncements.$inferSelect;
export type OutboxRecord = typeof outbox.$inferSelect;

export type TicketType = typeof ticketTypes.$inferSelect;
export type NewTicketType = typeof ticketTypes.$inferInsert;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type BookingStatus = typeof bookingStatusEnum.enumValues[number];
export type BookingItem = typeof bookingItems.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type RegistrationFormQuestion = typeof registrationFormQuestions.$inferSelect;
export type RegistrationAnswer = typeof registrationAnswers.$inferSelect;
export type WaitlistEntry = typeof waitlistEntries.$inferSelect;
export type WaitlistStatus = typeof waitlistStatusEnum.enumValues[number];
export type Cancellation = typeof cancellations.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type TeamMemberRole = typeof teamMemberRoleEnum.enumValues[number];
export type TeamMemberStatus = typeof teamMemberStatusEnum.enumValues[number];
export type TeamInvitation = typeof teamInvitations.$inferSelect;
export type TeamJoinRequest = typeof teamJoinRequests.$inferSelect;
export type TeamEventRegistration = typeof teamEventRegistrations.$inferSelect;
export type TeamSubmission = typeof teamSubmissions.$inferSelect;

export type TicketStatus = typeof ticketStatusEnum.enumValues[number];
export type CheckinSource = typeof checkinSourceEnum.enumValues[number];
export type ScanOutcome = typeof scanOutcomeEnum.enumValues[number];
export type AttendanceSession = typeof attendanceSessions.$inferSelect;
export type Checkin = typeof checkins.$inferSelect;
export type CertificatePolicy = typeof certificatePolicies.$inferSelect;
export type Certificate = typeof certificates.$inferSelect;
export type ScanLogEntry = typeof scanLog.$inferSelect;

export type EventFeedback = typeof eventFeedback.$inferSelect;
export type NewEventFeedback = typeof eventFeedback.$inferInsert;
export type FeedbackModerationStatus = typeof feedbackModerationStatusEnum.enumValues[number];
export type FeedbackInvitation = typeof feedbackInvitations.$inferSelect;
export type FeedbackInvitationStatus = typeof feedbackInvitationStatusEnum.enumValues[number];
export type FeedbackReport = typeof feedbackReports.$inferSelect;
export type FeedbackQuestion = typeof feedbackQuestions.$inferSelect;
export type ExportJob = typeof exportJobs.$inferSelect;
export type ExportJobStatus = typeof exportJobStatusEnum.enumValues[number];
export type ExportJobKind = typeof exportJobKindEnum.enumValues[number];
export type EventMetrics = typeof eventMetrics.$inferSelect;

export type VolunteerRole = typeof volunteerRoles.$inferSelect;
export type NewVolunteerRole = typeof volunteerRoles.$inferInsert;
export type VolunteerShift = typeof volunteerShifts.$inferSelect;
export type NewVolunteerShift = typeof volunteerShifts.$inferInsert;
export type VolunteerApplication = typeof volunteerApplications.$inferSelect;
export type VolunteerApplicationStatus = typeof volunteerApplicationStatusEnum.enumValues[number];
export type VolunteerRecord = typeof volunteerRecords.$inferSelect;
export type EquipmentItem = typeof equipmentItems.$inferSelect;
export type EquipmentRequest = typeof equipmentRequests.$inferSelect;
export type EquipmentRequestStatus = typeof equipmentRequestStatusEnum.enumValues[number];
export type SupportIssue = typeof supportIssues.$inferSelect;
export type SupportIssueStatus = typeof supportIssueStatusEnum.enumValues[number];
export type SupportIssueEvent = typeof supportIssueEvents.$inferSelect;
export type GuestRegistration = typeof guestRegistrations.$inferSelect;

// ==========================================
// PHASE 9: ALERTS, NOTIFICATION PIPELINE, OFFLINE CHECK-IN
// ==========================================

// 46. Notifications
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  type: varchar('type', { length: 100 }).notNull(),
  eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  severity: notificationSeverityEnum('severity').default('info').notNull(),
  payload: jsonb('payload'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 47. Notification Deliveries
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    notificationId: uuid('notification_id')
      .references(() => notifications.id, { onDelete: 'cascade' })
      .notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    status: deliveryStatusEnum('status').default('QUEUED').notNull(),
    provider: varchar('provider', { length: 50 }),
    providerMsgId: varchar('provider_msg_id', { length: 255 }),
    attempts: smallint('attempts').default(0).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    errorCode: varchar('error_code', { length: 100 }),
  },
  (table) => ({
    notifChannelUnique: unique().on(table.notificationId, table.channel),
  })
);

// 48. Event Alerts
export const eventAlerts = pgTable('event_alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  kind: eventAlertKindEnum('kind').notNull(),
  message: text('message').notNull(),
  severity: notificationSeverityEnum('severity').default('info').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 49. Notification Metrics (Latency boundary samples)
export const notificationMetrics = pgTable('notification_metrics', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  notificationId: uuid('notification_id'),
  tTrigger: timestamp('t_trigger', { withTimezone: true }).notNull(),
  tEnqueued: timestamp('t_enqueued', { withTimezone: true }).notNull(),
  tDequeued: timestamp('t_dequeued', { withTimezone: true }).notNull(),
  tProviderAccepted: timestamp('t_provider_accepted', { withTimezone: true }),
});

// 50. Offline Manifests
export const offlineManifests = pgTable('offline_manifests', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  staffId: uuid('staff_id').references(() => users.id, { onDelete: 'set null' }),
  deviceId: varchar('device_id', { length: 100 }).notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ticketCount: integer('ticket_count').default(0).notNull(),
  keyId: varchar('key_id', { length: 64 }).notNull(),
});

// 51. Offline Checkin Batches
export const offlineCheckinBatches = pgTable('offline_checkin_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  deviceId: varchar('device_id', { length: 100 }).notNull(),
  staffId: uuid('staff_id').references(() => users.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 50 }).default('RECEIVED').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  opCount: integer('op_count').default(0).notNull(),
});

// 52. Offline Ops
export const offlineOps = pgTable('offline_ops', {
  opId: uuid('op_id').primaryKey(),
  batchId: uuid('batch_id')
    .references(() => offlineCheckinBatches.id, { onDelete: 'cascade' })
    .notNull(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  ticketRef: varchar('ticket_ref', { length: 64 }).notNull(),
  deviceId: varchar('device_id', { length: 100 }).notNull(),
  scannedAtLocal: timestamp('scanned_at_local', { withTimezone: true }).notNull(),
  outcome: offlineOpOutcomeEnum('outcome').notNull(),
  reason: text('reason'),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  resolution: text('resolution'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 53. Scan Conflicts
export const scanConflicts = pgTable('scan_conflicts', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  ticketId: uuid('ticket_id')
    .references(() => tickets.id, { onDelete: 'cascade' })
    .notNull(),
  opIds: customType<{ data: string[]; driverData: string[] }>({
    dataType() {
      return 'uuid[]';
    },
  })('op_ids').notNull(),
  status: scanConflictStatusEnum('status').default('OPEN').notNull(),
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 54. Organizer Verifications (FR-XCOL)
export const organizerVerifications = pgTable('organizer_verifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizerId: uuid('organizer_id')
    .references(() => organizerProfiles.id, { onDelete: 'cascade' })
    .notNull(),
  status: organizerVerificationStatusEnum('status').default('PENDING').notNull(),
  evidenceRef: text('evidence_ref').notNull(),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 55. Student Achievements (FR-PASS)
export const studentAchievements = pgTable(
  'student_achievements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    type: achievementTypeEnum('type').notNull(),
    sourceEventId: uuid('source_event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    sourceRefId: uuid('source_ref_id').notNull(),
    verificationStatus: achievementVerificationStatusEnum('verification_status').default('VERIFIED').notNull(),
    visibility: achievementVisibilityEnum('visibility').default('public').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uqStudentAchievementsTypeSourceref: uniqueIndex('uq_student_achievements_type_sourceref').on(table.type, table.sourceRefId),
    idxStudentAchievementsUserVisibility: index('idx_student_achievements_user_visibility').on(table.userId, table.visibility, table.verificationStatus),
  })
);

// 56. Passport Settings (FR-PASS)
export const passportSettings = pgTable('passport_settings', {
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .primaryKey(),
  isPublic: boolean('is_public').default(false).notNull(),
  slug: varchar('slug', { length: 255 }).unique().notNull(),
  showAttendance: boolean('show_attendance').default(true).notNull(),
  showVolunteer: boolean('show_volunteer').default(true).notNull(),
  showCertificates: boolean('show_certificates').default(true).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationSeverity = typeof notificationSeverityEnum.enumValues[number];
export type NotificationChannel = typeof notificationChannelEnum.enumValues[number];
export type DeliveryStatus = typeof deliveryStatusEnum.enumValues[number];
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type EventAlert = typeof eventAlerts.$inferSelect;
export type EventAlertKind = typeof eventAlertKindEnum.enumValues[number];
export type NotificationMetric = typeof notificationMetrics.$inferSelect;
export type OfflineManifest = typeof offlineManifests.$inferSelect;
export type OfflineCheckinBatch = typeof offlineCheckinBatches.$inferSelect;
export type OfflineOp = typeof offlineOps.$inferSelect;
export type OfflineOpOutcome = typeof offlineOpOutcomeEnum.enumValues[number];
export type ScanConflict = typeof scanConflicts.$inferSelect;
export type ScanConflictStatus = typeof scanConflictStatusEnum.enumValues[number];
export type OutboxStatus = typeof outboxStatusEnum.enumValues[number];

export type CollegeParticipationStatus = typeof collegeParticipationStatusEnum.enumValues[number];
export type OrganizerVerification = typeof organizerVerifications.$inferSelect;
export type OrganizerVerificationStatus = typeof organizerVerificationStatusEnum.enumValues[number];
export type StudentAchievement = typeof studentAchievements.$inferSelect;
export type AchievementType = typeof achievementTypeEnum.enumValues[number];
export type AchievementVerificationStatus = typeof achievementVerificationStatusEnum.enumValues[number];
export type AchievementVisibility = typeof achievementVisibilityEnum.enumValues[number];
export type PassportSetting = typeof passportSettings.$inferSelect;

// 57. Ops Runs (Phase 11 Rehearsal Evidence)
export const opsRuns = pgTable(
  'ops_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: varchar('kind', { length: 50 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    outcome: varchar('outcome', { length: 20 }).notNull(),
    evidenceRef: jsonb('evidence_ref').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    idxOpsRunsKindOutcome: index('idx_ops_runs_kind_outcome').on(table.kind, table.outcome, table.startedAt),
  })
);

// 58. Schema Migrations (Readiness Tracker)
export const schemaMigrations = pgTable('schema_migrations', {
  version: integer('version').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow().notNull(),
});

export type OpsRun = typeof opsRuns.$inferSelect;
export type NewOpsRun = typeof opsRuns.$inferInsert;
export type SchemaMigration = typeof schemaMigrations.$inferSelect;

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type PaymentStatus = typeof paymentStatusEnum.enumValues[number];
export type PaymentEvent = typeof paymentEvents.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type RefundStatus = typeof refundStatusEnum.enumValues[number];
export type ReconciliationRecord = typeof reconciliationRecords.$inferSelect;
export type ReconciliationItem = typeof reconciliationItems.$inferSelect;

// 59. Email Suppressions (Hard bounces & spam complaints)
export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    reason: varchar('reason', { length: 50 }).notNull(),
    source: varchar('source', { length: 50 }).default('resend').notNull(),
    details: jsonb('details').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    idxEmailSuppressionsEmail: index('idx_email_suppressions_email').on(table.email),
  })
);

export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type NewEmailSuppression = typeof emailSuppressions.$inferInsert;

// 60. Event Materials (Registered-only attendee downloads)
export const eventMaterials = pgTable(
  'event_materials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    fileUrl: text('file_url').notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    uploadedBy: uuid('uploaded_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    idxEventMaterialsEventId: index('idx_event_materials_event_id').on(table.eventId),
  })
);

export type EventMaterial = typeof eventMaterials.$inferSelect;
export type NewEventMaterial = typeof eventMaterials.$inferInsert;



