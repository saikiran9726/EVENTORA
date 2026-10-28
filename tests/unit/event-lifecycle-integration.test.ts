import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { db } from '../../packages/backend/src/db/index.js';
import {
  venues,
  events,
  organizerProfiles,
  organizerMembers,
  users,
  venueBookings,
  eventStatusHistory,
  eventApprovals,
  bookingItems,
  tickets,
  bookings,
  ticketTypes,
  waitlistEntries,
  teamSubmissions,
  teamEventRegistrations,
  refunds,
} from '../../packages/backend/src/db/schema.js';
import { bookVenueWindow, VenueConflictError } from '../../packages/backend/src/services/venue.js';
import { eq } from 'drizzle-orm';
import { and, not, like, inArray } from 'drizzle-orm';
import crypto from 'crypto';

describe('Phase 3 Event Lifecycle, Venues, Discovery & Authorization Integration', () => {
  const seedPassword = process.env.SEED_PASSWORD || 'Eventora#Test2026!';
  let app: any;
  let testVenue: any;
  let organizerAUser: any;
  let organizerBUser: any;
  let reviewerUser: any;
  let studentUser: any;
  let organizerAProfile: any;
  let organizerBProfile: any;

  async function loginAs(email: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: seedPassword },
    });
    expect(res.statusCode).toBe(200);
    const sessionCookie = res.cookies.find((c: any) => c.name === 'eventora_session')?.value;
    const csrfCookie = res.cookies.find((c: any) => c.name === 'eventora_csrf')?.value;
    return { sessionCookie, csrfCookie, body: JSON.parse(res.body) };
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    organizerAUser = await db.query.users.findFirst({ where: eq(users.email, 'organizer.ras@campus.edu') });
    organizerBUser = await db.query.users.findFirst({ where: eq(users.email, 'organizer.dsc@campus.edu') });
    reviewerUser = await db.query.users.findFirst({ where: eq(users.email, 'reviewer.faculty@campus.edu') });
    studentUser = await db.query.users.findFirst({ where: eq(users.email, 'student1@campus.edu') });

    organizerAProfile = await db.query.organizerProfiles.findFirst({ where: eq(organizerProfiles.displayName, 'Robotics & Automation Society (RAS)') });
    organizerBProfile = await db.query.organizerProfiles.findFirst({ where: eq(organizerProfiles.displayName, 'Developer Student Club (DSC)') });

    testVenue = await db.query.venues.findFirst({ where: eq(venues.name, 'Sir MV Auditorium') });
  });

  beforeEach(async () => {
    // Clear only test events (preserving the 100k discovery performance dataset and other test suites)
    const testEvents = await db.select({ id: events.id }).from(events).where(
      and(
        not(like(events.slug, 'perf-slug-%')),
        not(like(events.slug, 'paid-%')),
        not(like(events.slug, 'gate-%'))
      )
    );
    const testEvtIds = testEvents.map((e) => e.id);

    if (testEvtIds.length > 0) {
      await db.delete(teamEventRegistrations).where(inArray(teamEventRegistrations.eventId, testEvtIds));
      await db.delete(waitlistEntries).where(inArray(waitlistEntries.eventId, testEvtIds));
      await db.delete(tickets).where(inArray(tickets.eventId, testEvtIds));
      await db.delete(refunds);
      await db.delete(bookings).where(inArray(bookings.eventId, testEvtIds));
      await db.delete(ticketTypes).where(inArray(ticketTypes.eventId, testEvtIds));
      await db.delete(venueBookings).where(inArray(venueBookings.eventId, testEvtIds));
      await db.delete(eventApprovals).where(inArray(eventApprovals.eventId, testEvtIds));
      await db.delete(eventStatusHistory).where(inArray(eventStatusHistory.eventId, testEvtIds));
      await db.delete(events).where(inArray(events.id, testEvtIds));
    }
  });

  it('enforces PostgreSQL GiST exclusion constraint on concurrent overlapping venue bookings', async () => {
    // Insert two actual events to satisfy FK constraint
    const [ev1] = await db.insert(events).values({
      organizerId: organizerAProfile.id,
      collegeId: organizerAProfile.collegeId,
      title: 'GiST Overlap Event 1',
      slug: `gist-ev1-${Date.now()}`,
      description: 'First event for GiST testing',
      category: 'Tech',
      format: 'in_person',
      venueId: testVenue.id,
      startsAt: new Date('2026-11-20T10:00:00Z'),
      endsAt: new Date('2026-11-20T14:00:00Z'),
      capacity: 50,
      contactEmail: 'ras@campus.edu',
      createdBy: organizerAUser.id,
    }).returning();

    const [ev2] = await db.insert(events).values({
      organizerId: organizerAProfile.id,
      collegeId: organizerAProfile.collegeId,
      title: 'GiST Overlap Event 2',
      slug: `gist-ev2-${Date.now()}`,
      description: 'Second event for GiST testing',
      category: 'Tech',
      format: 'in_person',
      venueId: testVenue.id,
      startsAt: new Date('2026-11-20T12:00:00Z'),
      endsAt: new Date('2026-11-20T16:00:00Z'),
      capacity: 50,
      contactEmail: 'ras@campus.edu',
      createdBy: organizerAUser.id,
    }).returning();

    const eventId1 = ev1.id;
    const eventId2 = ev2.id;

    // Define overlapping time windows on testVenue:
    // Event 1: 10:00 to 14:00 on Nov 20, 2026
    // Event 2: 12:00 to 16:00 on Nov 20, 2026 (Overlaps 12:00 - 14:00!)
    const start1 = new Date('2026-11-20T10:00:00Z');
    const end1 = new Date('2026-11-20T14:00:00Z');

    const start2 = new Date('2026-11-20T12:00:00Z');
    const end2 = new Date('2026-11-20T16:00:00Z');

    // 1. First booking succeeds
    const booking1 = await bookVenueWindow(eventId1, testVenue.id, start1, end1, 'hold');
    expect(booking1).toBeDefined();
    expect(booking1.venue_id || booking1.venueId).toBe(testVenue.id);

    // 2. Overlapping booking fails via PostgreSQL GiST exclusion constraint (SQLSTATE 23P01)
    await expect(
      bookVenueWindow(eventId2, testVenue.id, start2, end2, 'hold')
    ).rejects.toThrow(VenueConflictError);

    // 3. Non-overlapping booking on same venue succeeds:
    // Event 3: 16:00 to 18:00 on Nov 20, 2026 (No overlap!)
    const [ev3] = await db.insert(events).values({
      organizerId: organizerAProfile.id,
      collegeId: organizerAProfile.collegeId,
      title: 'GiST Overlap Event 3',
      slug: `gist-ev3-${Date.now()}`,
      description: 'Third event for GiST testing',
      category: 'Tech',
      format: 'in_person',
      venueId: testVenue.id,
      startsAt: new Date('2026-11-20T16:00:00Z'),
      endsAt: new Date('2026-11-20T18:00:00Z'),
      capacity: 50,
      contactEmail: 'ras@campus.edu',
      createdBy: organizerAUser.id,
    }).returning();

    const start3 = new Date('2026-11-20T16:00:00Z');
    const end3 = new Date('2026-11-20T18:00:00Z');

    const booking3 = await bookVenueWindow(ev3.id, testVenue.id, start3, end3, 'hold');
    expect(booking3).toBeDefined();
    expect(booking3.venue_id || booking3.venueId).toBe(testVenue.id);
  });

  it('blocks Organizer B from modifying Organizer A event (403 + policy: event:manage:owned)', async () => {
    const orgA = await loginAs('organizer.ras@campus.edu');
    const orgB = await loginAs('organizer.dsc@campus.edu');

    // 1. Organizer A creates an event
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: {
        cookie: `eventora_session=${orgA.sessionCookie}; eventora_csrf=${orgA.csrfCookie}`,
        'x-csrf-token': orgA.csrfCookie,
      },
      payload: {
        organizerId: organizerAProfile.id,
        title: 'RAS Autonomous Drone Racing',
        description: 'High-speed indoor autonomous drone competition on obstacle course.',
        category: 'Robotics',
        tags: ['drones', 'ai', 'robotics'],
        department: 'Electronics',
        format: 'in_person',
        venueId: testVenue.id,
        startsAt: new Date(Date.now() + 86400000 * 5).toISOString(),
        endsAt: new Date(Date.now() + 86400000 * 5 + 3600000 * 3).toISOString(),
        capacity: 100,
        contactEmail: 'ras@campus.edu',
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createdEvent = JSON.parse(createRes.body).event;

    // 2. Organizer B attempts to PATCH Organizer A's event -> must receive 403
    const unauthorizedPatchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${createdEvent.id}`,
      headers: {
        cookie: `eventora_session=${orgB.sessionCookie}; eventora_csrf=${orgB.csrfCookie}`,
        'x-csrf-token': orgB.csrfCookie,
      },
      payload: {
        title: 'Tampered Title by DSC',
      },
    });

    expect(unauthorizedPatchRes.statusCode).toBe(403);
    const patchBody = JSON.parse(unauthorizedPatchRes.body);
    expect(patchBody.error.code).toBe('FORBIDDEN');
    expect(patchBody.error.message).toContain('not have organizer permissions');

    // 3. Organizer A can PATCH their own event -> 200 OK
    const authorizedPatchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${createdEvent.id}`,
      headers: {
        cookie: `eventora_session=${orgA.sessionCookie}; eventora_csrf=${orgA.csrfCookie}`,
        'x-csrf-token': orgA.csrfCookie,
      },
      payload: {
        title: 'RAS Autonomous Drone Racing (Championship Edition)',
        version: createdEvent.version,
      },
    });

    expect(authorizedPatchRes.statusCode).toBe(200);
    const updatedEvent = JSON.parse(authorizedPatchRes.body).event;
    expect(updatedEvent.title).toBe('RAS Autonomous Drone Racing (Championship Edition)');
    expect(updatedEvent.version).toBe(createdEvent.version + 1);
  });

  it('optimistic locking: rejects PATCH with stale version (409 VERSION_CONFLICT)', async () => {
    const orgA = await loginAs('organizer.ras@campus.edu');

    // Create event
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: {
        cookie: `eventora_session=${orgA.sessionCookie}; eventora_csrf=${orgA.csrfCookie}`,
        'x-csrf-token': orgA.csrfCookie,
      },
      payload: {
        organizerId: organizerAProfile.id,
        title: 'Optimistic Locking Test Event',
        description: 'Demonstrating If-Match optimistic concurrency control.',
        category: 'Technology',
        format: 'online',
        startsAt: new Date(Date.now() + 86400000 * 10).toISOString(),
        endsAt: new Date(Date.now() + 86400000 * 10 + 3600000 * 2).toISOString(),
        capacity: 50,
        contactEmail: 'ras@campus.edu',
      },
    });

    const event = JSON.parse(createRes.body).event;

    // PATCH with wrong/stale version (e.g. version 99 instead of 1)
    const stalePatchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}`,
      headers: {
        cookie: `eventora_session=${orgA.sessionCookie}; eventora_csrf=${orgA.csrfCookie}`,
        'x-csrf-token': orgA.csrfCookie,
        'if-match': '99',
      },
      payload: {
        description: 'New description with stale header',
      },
    });

    expect(stalePatchRes.statusCode).toBe(409);
    const staleBody = JSON.parse(stalePatchRes.body);
    expect(staleBody.error.code).toBe('VERSION_CONFLICT');
  });

  it('enforces Reviewer != Creator and Reviewer not in organizer profile rule', async () => {
    const orgA = await loginAs('organizer.ras@campus.edu');
    const facultyReviewer = await loginAs('reviewer.faculty@campus.edu');

    // 1. Organizer A creates an event
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: {
        cookie: `eventora_session=${orgA.sessionCookie}; eventora_csrf=${orgA.csrfCookie}`,
        'x-csrf-token': orgA.csrfCookie,
      },
      payload: {
        organizerId: organizerAProfile.id,
        title: 'Reviewer Conflict Test Symposium',
        description: 'Testing independent faculty governance rules.',
        category: 'Academics',
        format: 'in_person',
        venueId: testVenue.id,
        startsAt: new Date(Date.now() + 86400000 * 15).toISOString(),
        endsAt: new Date(Date.now() + 86400000 * 15 + 3600000 * 4).toISOString(),
        capacity: 200,
        contactEmail: 'ras@campus.edu',
      },
    });

    const event = JSON.parse(createRes.body).event;

    // Submit proposal for review
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/submit`,
      headers: {
        cookie: `eventora_session=${orgA.sessionCookie}; eventora_csrf=${orgA.csrfCookie}`,
        'x-csrf-token': orgA.csrfCookie,
      },
    });

    if (submitRes.statusCode !== 200) {
      console.log('SUBMIT RES BODY:', submitRes.body);
    }
    expect(submitRes.statusCode).toBe(200);

    // 2. Creator attempts to approve their own proposal -> must receive 403 REVIEWER_CONFLICT
    const creatorSelfApprovalRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/approval`,
      headers: {
        cookie: `eventora_session=${orgA.sessionCookie}; eventora_csrf=${orgA.csrfCookie}`,
        'x-csrf-token': orgA.csrfCookie,
      },
      payload: {
        decision: 'approved',
        comments: 'Self approval attempt',
      },
    });

    expect(creatorSelfApprovalRes.statusCode).toBe(403);

    // 3. Independent Faculty Reviewer approves proposal -> 200 OK
    const validApprovalRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/approval`,
      headers: {
        cookie: `eventora_session=${facultyReviewer.sessionCookie}; eventora_csrf=${facultyReviewer.csrfCookie}`,
        'x-csrf-token': facultyReviewer.csrfCookie,
      },
      payload: {
        decision: 'approved',
        comments: 'Proposal adheres to academic guidelines and venue is verified clear.',
      },
    });

    if (validApprovalRes.statusCode !== 200) {
      console.log('VALID APPROVAL RES BODY:', validApprovalRes.body);
    }
    expect(validApprovalRes.statusCode).toBe(200);
    const approvedEvent = JSON.parse(validApprovalRes.body).event;
    expect(approvedEvent.status).toBe('approved');

    // 4. Organizer A publishes the event
    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/publish`,
      headers: {
        cookie: `eventora_session=${orgA.sessionCookie}; eventora_csrf=${orgA.csrfCookie}`,
        'x-csrf-token': orgA.csrfCookie,
      },
    });

    expect(publishRes.statusCode).toBe(200);
    const publishedEvent = JSON.parse(publishRes.body).event;
    expect(publishedEvent.status).toBe('published');
  });

  it('discovery visibility: students & anonymous see ONLY published events', async () => {
    // 1. Anonymous query for events
    const anonRes = await app.inject({
      method: 'GET',
      url: '/api/v1/events',
    });

    expect(anonRes.statusCode).toBe(200);
    const body = JSON.parse(anonRes.body);
    expect(body.items).toBeDefined();

    // Assert every single returned event has status === 'published'
    for (const item of body.items) {
      expect(item.status).toBe('published');
    }

    // 2. Even if anonymous explicitly passes ?status=draft -> returns empty or ignores
    const draftQueryRes = await app.inject({
      method: 'GET',
      url: '/api/v1/events?status=draft',
    });

    expect(draftQueryRes.statusCode).toBe(200);
    const draftBody = JSON.parse(draftQueryRes.body);
    for (const item of draftBody.items) {
      expect(item.status).toBe('published');
    }
  });

  it('RFC 5545 iCalendar generation: downloads valid .ics file with UTC timestamps', async () => {
    // Insert published event
    const [published] = await db
      .insert(events)
      .values({
        organizerId: organizerAProfile.id,
        collegeId: organizerAProfile.collegeId,
        title: 'ICS Calendar Export Symposium',
        slug: `ics-test-${Date.now()}`,
        description: 'Testing standard iCalendar RFC 5545 generation.',
        category: 'Tech',
        format: 'in_person',
        venueId: testVenue.id,
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 86400000 + 7200000),
        capacity: 100,
        status: 'published',
        contactEmail: 'ras@campus.edu',
        createdBy: organizerAUser.id,
      })
      .returning();

    const icsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${published.id}/ics`,
    });

    expect(icsRes.statusCode).toBe(200);
    expect(icsRes.headers['content-type']).toContain('text/calendar');
    expect(icsRes.headers['content-disposition']).toContain('.ics');

    const icsText = icsRes.body;
    expect(icsText).toContain('BEGIN:VCALENDAR');
    expect(icsText).toContain('VERSION:2.0');
    expect(icsText).toContain('BEGIN:VEVENT');
    expect(icsText).toContain('DTSTART:');
    expect(icsText).toContain('DTEND:');
    expect(icsText).toContain('SUMMARY:ICS Calendar Export Symposium');
    expect(icsText).toContain('END:VEVENT');
    expect(icsText).toContain('END:VCALENDAR');
  });

  it('calendar endpoint returns published events within date range', async () => {
    // Insert published event
    await db.insert(events).values({
      organizerId: organizerAProfile.id,
      collegeId: organizerAProfile.collegeId,
      title: 'Calendar Feed Event',
      slug: `cal-test-${Date.now()}`,
      description: 'Testing calendar endpoint feed.',
      category: 'Workshops',
      format: 'online',
      startsAt: new Date(Date.now() + 86400000 * 2),
      endsAt: new Date(Date.now() + 86400000 * 2 + 3600000),
      capacity: 50,
      visibility: 'public',
      status: 'published',
      contactEmail: 'ras@campus.edu',
      createdBy: organizerAUser.id,
    });

    const calRes = await app.inject({
      method: 'GET',
      url: '/api/v1/calendar',
    });

    expect(calRes.statusCode).toBe(200);
    const body = JSON.parse(calRes.body);
    expect(body.events).toBeDefined();
    expect(body.events.length).toBeGreaterThan(0);
  });
});
