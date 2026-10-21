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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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

// Enums
export const globalRoleEnum = pgEnum('global_role', ['student', 'reviewer', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'pending']);
export const organizerStatusEnum = pgEnum('organizer_status', ['pending', 'verified', 'suspended']);
export const organizerMemberRoleEnum = pgEnum('organizer_member_role', ['owner', 'manager', 'member']);
export const organizerMemberStatusEnum = pgEnum('organizer_member_status', ['active', 'invited', 'removed']);
export const staffCapabilityEnum = pgEnum('staff_capability', ['checkin', 'volunteer_lead']);

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

// 7. Event Staff Assignments (Scoped grants for check-in staff / volunteer lead; event FK added in Phase 3)
export const eventStaffAssignments = pgTable('event_staff_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id').notNull(), // FK added when events table created in Phase 3
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

// 9. Audit Logs (INSERT-only tamper evident log)
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
}));

export const collegesRelations = relations(colleges, ({ many }) => ({
  users: many(users),
  organizers: many(organizerProfiles),
}));

export const organizerProfilesRelations = relations(organizerProfiles, ({ one, many }) => ({
  college: one(colleges, {
    fields: [organizerProfiles.collegeId],
    references: [colleges.id],
  }),
  members: many(organizerMembers),
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

