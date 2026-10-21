import { z } from 'zod';

export const GlobalRoleEnum = z.enum([
  'student',
  'organizer',
  'reviewer',
  'admin',
  'volunteer',
  'checkin_staff',
]);

export type GlobalRole = z.infer<typeof GlobalRoleEnum>;

export const PolicyStringEnum = z.enum([
  'event:create',
  'event:review',
  'event:manage:owned',
  'attendance:checkin:assigned',
  'analytics:view:owned',
  'user:manage',
  'export:owned',
]);

export type PolicyString = z.infer<typeof PolicyStringEnum>;

export interface ScopedGrant {
  organizerId?: string;
  eventId?: string;
  permissions: PolicyString[];
}

export interface UserContext {
  id: string;
  email: string;
  fullName: string;
  globalRole: GlobalRole;
  scopedGrants: ScopedGrant[];
}
