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
export const teamModeEnum = pgEnum('team_mode', ['none', 'optional', 'required']);
export const eventApprovalDecisionEnum = pgEnum('event_approval_decision', [
  'approved',
  'rejected',
  'changes_requested',
]);
export const venueBookingStatusEnum = pgEnum('venue_booking_status', ['hold', 'confirmed', 'released']);

// 1. Colleges
export const colleges = pgTable('colleges', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  domain: varchar('domain', { length: 255 }).notNull().unique(),
  status: varchar('status', { length: 50 }).default('active').notNull(),
  publicDiscovery: boolean('public_discovery').default(false).notNull(),
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
  eligibility: jsonb('eligibility').default({}).notNull(),
  visibility: eventVisibilityEnum('visibility').default('college').notNull(),
  status: eventStatusEnum('status').default('draft').notNull(),
  teamMode: teamModeEnum('team_mode').default('none').notNull(),
  teamMin: integer('team_min'),
  teamMax: integer('team_max'),
  contactEmail: varchar('contact_email', { length: 255 }).notNull(),
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
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
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
  payload: jsonb('payload').notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  retries: integer('retries').default(0).notNull(),
  dedupeKey: varchar('dedupe_key', { length: 255 }).unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
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
