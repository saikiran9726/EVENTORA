import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import {
  validateAnswerValue,
  isSafeRegex,
  stripHtml,
  getEventForm,
  saveEventForm,
  getEventFormSubmissions,
  FormBuilderError,
} from '../../packages/backend/src/services/form-builder.js';
import { REDACT_PATHS } from '../../packages/backend/src/logger.js';
import { FormFieldItem, DEFAULT_DIETARY_OPTIONS } from '../../packages/shared/src/form.js';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';

describe('Phase P11: Custom Registration Form Builder & Answer Validation', () => {
  describe('HTML Stripping & Sanitization', () => {
    const textField: FormFieldItem = {
      id: 'fld-1',
      eventId: 'evt-1',
      position: 0,
      type: 'short_text',
      label: 'Emergency Contact Note',
      required: true,
      options: [],
      validation: {},
    };

    it('strips malicious HTML tags and scripts from text answers', () => {
      const input = '<script>alert("xss")</script>Hello <b>World</b><img src=x onerror=alert(1)>';
      const result = validateAnswerValue(textField, input);
      expect(result.valid).toBe(true);
      expect(result.value).toBe('Hello World');
      expect(result.value).not.toContain('<script>');
      expect(result.value).not.toContain('<b>');
      expect(result.value).not.toContain('<img');
    });

    it('preserves clean plain text', () => {
      const input = 'Call my roommate at room 402';
      const result = validateAnswerValue(textField, input);
      expect(result.valid).toBe(true);
      expect(result.value).toBe(input);
    });

    it('rejects answers exceeding 1000 characters', () => {
      const longInput = 'A'.repeat(1001);
      expect(() => validateAnswerValue(textField, longInput)).toThrow(
        /exceeds maximum length of 1000 characters/
      );
    });
  });

  describe('Field Type Validation', () => {
    it('validates required fields', () => {
      const reqField: FormFieldItem = {
        position: 0,
        type: 'short_text',
        label: 'T-Shirt Size',
        required: true,
        options: [],
        validation: {},
      };

      expect(() => validateAnswerValue(reqField, '')).toThrow(/Answer is required/);
      expect(() => validateAnswerValue(reqField, null)).toThrow(/Answer is required/);
      expect(() => validateAnswerValue(reqField, undefined)).toThrow(/Answer is required/);
    });

    it('allows optional fields to be empty or null', () => {
      const optField: FormFieldItem = {
        position: 0,
        type: 'short_text',
        label: 'Dietary Notes',
        required: false,
        options: [],
        validation: {},
      };

      expect(validateAnswerValue(optField, '')).toEqual({ valid: true, value: null });
      expect(validateAnswerValue(optField, null)).toEqual({ valid: true, value: null });
      expect(validateAnswerValue(optField, undefined)).toEqual({ valid: true, value: null });
    });

    it('validates email field format', () => {
      const emailField: FormFieldItem = {
        position: 0,
        type: 'email',
        label: 'Alternate Email',
        required: true,
        options: [],
        validation: {},
      };

      expect(validateAnswerValue(emailField, 'student@campus.edu')).toEqual({
        valid: true,
        value: 'student@campus.edu',
      });
      expect(() => validateAnswerValue(emailField, 'not-an-email')).toThrow(
        /valid email address/
      );
    });

    it('validates phone field format', () => {
      const phoneField: FormFieldItem = {
        position: 0,
        type: 'phone',
        label: 'Phone Number',
        required: true,
        options: [],
        validation: {},
      };

      expect(validateAnswerValue(phoneField, '+91 9876543210')).toEqual({
        valid: true,
        value: '+91 9876543210',
      });
      expect(validateAnswerValue(phoneField, '9876543210')).toEqual({
        valid: true,
        value: '9876543210',
      });
      expect(() => validateAnswerValue(phoneField, 'abc12345')).toThrow(
        /valid phone number/
      );
    });

    it('validates number field with min/max constraints', () => {
      const numField: FormFieldItem = {
        position: 0,
        type: 'number',
        label: 'Years of Experience',
        required: true,
        options: [],
        validation: { min: 1, max: 10 },
      };

      expect(validateAnswerValue(numField, 3)).toEqual({ valid: true, value: 3 });
      expect(validateAnswerValue(numField, '5')).toEqual({ valid: true, value: 5 });
      expect(() => validateAnswerValue(numField, 0)).toThrow(/cannot be less than 1/);
      expect(() => validateAnswerValue(numField, 15)).toThrow(/cannot exceed 10/);
      expect(() => validateAnswerValue(numField, 'invalid')).toThrow(/must be a valid number/);
    });

    it('validates single checkbox boolean', () => {
      const checkField: FormFieldItem = {
        position: 0,
        type: 'checkbox',
        label: 'Consent',
        required: true,
        options: [],
        validation: {},
      };

      expect(validateAnswerValue(checkField, true)).toEqual({ valid: true, value: true });
      expect(() => validateAnswerValue(checkField, false)).toThrow(/must be accepted/);
    });

    it('validates dropdown and radio option membership', () => {
      const dropdownField: FormFieldItem = {
        position: 0,
        type: 'dropdown',
        label: 'T-Shirt Size',
        required: true,
        options: ['S', 'M', 'L', 'XL'],
        validation: {},
      };

      expect(validateAnswerValue(dropdownField, 'M')).toEqual({ valid: true, value: 'M' });
      expect(() => validateAnswerValue(dropdownField, 'XXXL')).toThrow(
        /not a valid option/i
      );
    });

    it('validates multi_checkbox array of options', () => {
      const multiField: FormFieldItem = {
        position: 0,
        type: 'multi_checkbox',
        label: 'Tracks of Interest',
        required: true,
        options: ['AI', 'Robotics', 'IoT', 'Web3'],
        validation: {},
      };

      expect(validateAnswerValue(multiField, ['AI', 'Robotics'])).toEqual({
        valid: true,
        value: ['AI', 'Robotics'],
      });
      expect(() => validateAnswerValue(multiField, ['AI', 'Hacking'])).toThrow(
        /not valid/i
      );
    });

    it('validates dietary preference against allowed options', () => {
      const dietaryField: FormFieldItem = {
        position: 0,
        type: 'dietary',
        label: 'Meal Preference',
        required: true,
        options: [...DEFAULT_DIETARY_OPTIONS],
        validation: {},
      };

      expect(validateAnswerValue(dietaryField, 'Vegetarian')).toEqual({
        valid: true,
        value: 'Vegetarian',
      });
      expect(validateAnswerValue(dietaryField, 'Halal')).toEqual({
        valid: true,
        value: 'Halal',
      });
      expect(() => validateAnswerValue(dietaryField, 'Steak')).toThrow(
        /not valid/i
      );
    });

    it('validates custom regex patterns safely', () => {
      const rollField: FormFieldItem = {
        position: 0,
        type: 'short_text',
        label: 'Roll Code',
        required: true,
        options: [],
        validation: {
          pattern: '^[A-Z]{2}[0-9]{4}$',
          errorMessage: 'Format must be 2 letters followed by 4 digits',
        },
      };

      expect(validateAnswerValue(rollField, 'CS1024')).toEqual({
        valid: true,
        value: 'CS1024',
      });
      expect(() => validateAnswerValue(rollField, 'cs1024')).toThrow(
        /does not match required format/
      );
    });
  });

  describe('Regex Safety (ReDoS Protection)', () => {
    it('accepts safe regex patterns', () => {
      expect(isSafeRegex('^[A-Za-z0-9_-]+$')).toBe(true);
      expect(isSafeRegex('^\\d{10}$')).toBe(true);
      expect(isSafeRegex('^[a-z]+@[a-z]+\\.[a-z]+$')).toBe(true);
    });

    it('rejects catastrophic backtracking / nested quantifier patterns', () => {
      expect(isSafeRegex('(a+)+')).toBe(false);
      expect(isSafeRegex('(a*)*')).toBe(false);
      expect(isSafeRegex('([a-z]+)+')).toBe(false);
    });
  });

  describe('PII & Answer Log Redaction', () => {
    it('ensures answers and registrationAnswers are in REDACT_PATHS', () => {
      expect(REDACT_PATHS).toContain('answers');
      expect(REDACT_PATHS).toContain('*.answers');
      expect(REDACT_PATHS).toContain('body.answers');
      expect(REDACT_PATHS).toContain('registrationAnswers');
      expect(REDACT_PATHS).toContain('*.registrationAnswers');
    });
  });

  describe('End-to-End API & Integration Suite', () => {
    let app: any;
    let collegeId: string;
    let organizerId: string;
    let orgUserId: string;
    let studentUserId: string;
    let eventId: string;
    let ticketTypeId: string;
    let orgAuthHeaders: Record<string, string>;
    let studentAuthHeaders: Record<string, string>;

    async function createSessionForUser(userId: string): Promise<Record<string, string>> {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const csrfToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(sessionToken).digest();

      await pool.query(
        `INSERT INTO sessions (id_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 day');`,
        [tokenHash, userId]
      );

      return {
        cookie: `eventora_session=${sessionToken}; eventora_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
      };
    }

    beforeAll(async () => {
      app = buildApp();
      await app.ready();

      const client = await pool.connect();
      try {
        const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
        collegeId = cRes.rows[0].id;

        // 1. Create Organizer User & Profile
        const uRes = await client.query(
          `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
           VALUES ($1, $2, 'hash', 'Organizer Lead P11', 'student', 'active')
           RETURNING id;`,
          [collegeId, `org.lead.p11.${Date.now()}@campus.edu`]
        );
        orgUserId = uRes.rows[0].id;

        const pRes = await client.query(
          `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
           VALUES ($1, 'P11 Robotics Council', 'verified', $2)
           RETURNING id;`,
          [collegeId, orgUserId]
        );
        organizerId = pRes.rows[0].id;

        await client.query(
          `INSERT INTO organizer_members (organizer_id, user_id, role, status)
           VALUES ($1, $2, 'owner', 'active');`,
          [organizerId, orgUserId]
        );

        // 2. Create Student User
        const sRes = await client.query(
          `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
           VALUES ($1, $2, 'hash', 'Student Attendee P11', 'student', 'active')
           RETURNING id;`,
          [collegeId, `student.attendee.p11.${Date.now()}@campus.edu`]
        );
        studentUserId = sRes.rows[0].id;

        // 3. Create Venue & Event
        const vRes = await client.query(
          `INSERT INTO venues (college_id, name, building, capacity)
           VALUES ($1, 'P11 Auditorium', 'Tech Block', 300)
           RETURNING id;`,
          [collegeId]
        );
        const venueId = vRes.rows[0].id;

        const startsAt = new Date(Date.now() + 7 * 86400000);
        const endsAt = new Date(startsAt.getTime() + 4 * 3600000);

        const eRes = await client.query(
          `INSERT INTO events (
             organizer_id, college_id, title, slug, description, category, department, format,
             venue_id, starts_at, ends_at, capacity, status, visibility, contact_email, created_by
           ) VALUES (
             $1, $2, 'P11 Autonomous Vehicles Summit', $3, 'P11 Test Description', 'Robotics', 'Robotics', 'in_person',
             $4, $5, $6, 100, 'published', 'public', 'org.p11@campus.edu', $7
           ) RETURNING id;`,
          [
            organizerId,
            collegeId,
            `p11-summit-${Date.now()}`,
            venueId,
            startsAt,
            endsAt,
            orgUserId,
          ]
        );
        eventId = eRes.rows[0].id;

        const ttRes = await client.query(
          `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
           VALUES ($1, 'Student Pass', 0, 100, 0, 0)
           RETURNING id;`,
          [eventId]
        );
        ticketTypeId = ttRes.rows[0].id;

        orgAuthHeaders = await createSessionForUser(orgUserId);
        studentAuthHeaders = await createSessionForUser(studentUserId);
      } finally {
        client.release();
      }
    });

    afterAll(async () => {
      await app.close();
    });

    let dietaryFieldId: string;
    let tshirtFieldId: string;

    it('1. GET /api/v1/events/:id/form returns initial empty fields configuration', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}/form`,
        headers: orgAuthHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.form).toBeDefined();
      expect(body.form.eventId).toBe(eventId);
      expect(body.form.version).toBe(1);
      expect(body.form.isFrozen).toBe(false);
      expect(body.form.fields).toHaveLength(0);
    });

    it('2. PUT /api/v1/events/:id/form enforces optimistic version locking (409 on version mismatch)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/events/${eventId}/form`,
        headers: orgAuthHeaders,
        payload: {
          expectedVersion: 999, // Mismatched version
          fields: [
            {
              type: 'dietary',
              label: 'Dietary Preference',
              required: true,
              options: [...DEFAULT_DIETARY_OPTIONS],
            },
          ],
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VERSION_CONFLICT');
    });

    it('3. PUT /api/v1/events/:id/form successfully saves custom fields and increments version', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/events/${eventId}/form`,
        headers: orgAuthHeaders,
        payload: {
          expectedVersion: 1,
          fields: [
            {
              position: 0,
              type: 'dietary',
              label: 'Dietary Preference',
              required: true,
              options: [...DEFAULT_DIETARY_OPTIONS],
            },
            {
              position: 1,
              type: 'dropdown',
              label: 'T-Shirt Size',
              required: true,
              options: ['S', 'M', 'L', 'XL'],
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.form.version).toBe(2);
      expect(body.form.fields).toHaveLength(2);

      dietaryFieldId = body.form.fields[0].id;
      tshirtFieldId = body.form.fields[1].id;
      expect(dietaryFieldId).toBeDefined();
      expect(tshirtFieldId).toBeDefined();
    });

    it('4. Booking rejects when required custom question is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/bookings`,
        headers: {
          ...studentAuthHeaders,
          'Idempotency-Key': `book-req-missing-${Date.now()}`,
        },
        payload: {
          items: [{ ticketTypeId, quantity: 1 }],
          answers: [
            // Missing T-Shirt Size
            { fieldId: dietaryFieldId, value: 'Vegetarian', attendeeIndex: 0 },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('MISSING_REQUIRED_FIELD');
    });

    it('5. Booking rejects when answer option violates allowed options', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/bookings`,
        headers: {
          ...studentAuthHeaders,
          'Idempotency-Key': `book-invalid-opt-${Date.now()}`,
        },
        payload: {
          items: [{ ticketTypeId, quantity: 1 }],
          answers: [
            { fieldId: dietaryFieldId, value: 'Vegetarian', attendeeIndex: 0 },
            { fieldId: tshirtFieldId, value: 'XXXXL', attendeeIndex: 0 }, // Invalid option
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('INVALID_OPTION_MEMBERSHIP');
    });

    it('6. Booking rejects unknown fieldId not belonging to event', async () => {
      const fakeFieldId = '00000000-0000-0000-0000-000000000000';
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/bookings`,
        headers: {
          ...studentAuthHeaders,
          'Idempotency-Key': `book-unknown-fld-${Date.now()}`,
        },
        payload: {
          items: [{ ticketTypeId, quantity: 1 }],
          answers: [
            { fieldId: fakeFieldId, value: 'Vegetarian', attendeeIndex: 0 },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('UNKNOWN_FORM_FIELD');
    });

    it('7. Valid booking successfully records answers into registration_answers with field version', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/bookings`,
        headers: {
          ...studentAuthHeaders,
          'Idempotency-Key': `book-valid-p11-${Date.now()}`,
        },
        payload: {
          items: [{ ticketTypeId, quantity: 1 }],
          answers: [
            { fieldId: dietaryFieldId, value: 'Vegetarian', attendeeIndex: 0 },
            { fieldId: tshirtFieldId, value: 'L', attendeeIndex: 0 },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.booking.status).toBe('CONFIRMED');

      // Verify DB persistence in registration_answers
      const dbAnswers = await pool.query(
        `SELECT * FROM registration_answers WHERE booking_id = $1 ORDER BY attendee_index ASC;`,
        [body.booking.id]
      );
      expect(dbAnswers.rows.length).toBe(2);
      expect(dbAnswers.rows[0].field_id).toBe(dietaryFieldId);
      expect(dbAnswers.rows[0].value).toBe('Vegetarian');
      expect(dbAnswers.rows[0].field_version).toBe(2);
      expect(dbAnswers.rows[1].field_id).toBe(tshirtFieldId);
      expect(dbAnswers.rows[1].value).toBe('L');
    });

    it('8. Form freezing guard prevents deleting existing fields once registrations exist (400 FORM_FROZEN)', async () => {
      // Attempt to save form without dietaryFieldId
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/events/${eventId}/form`,
        headers: orgAuthHeaders,
        payload: {
          expectedVersion: 2,
          fields: [
            {
              id: tshirtFieldId,
              position: 0,
              type: 'dropdown',
              label: 'T-Shirt Size',
              required: true,
              options: ['S', 'M', 'L', 'XL'],
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('FORM_FROZEN');
    });

    it('9. GET /api/v1/events/:id/form/submissions returns answers to organizer only', async () => {
      // Organizer request succeeds
      const resOrg = await app.inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}/form/submissions`,
        headers: orgAuthHeaders,
      });

      expect(resOrg.statusCode).toBe(200);
      const bodyOrg = JSON.parse(resOrg.body);
      expect(bodyOrg.eventId).toBe(eventId);
      expect(bodyOrg.totalSubmissions).toBeGreaterThanOrEqual(1);
      expect(bodyOrg.submissions).toBeInstanceOf(Array);
      expect(bodyOrg.submissions.length).toBeGreaterThanOrEqual(1);
      expect(bodyOrg.submissions[0].attendeeName).toBe('Student Attendee P11');

      // Unauthenticated request is rejected
      const resAnon = await app.inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}/form/submissions`,
      });
      expect(resAnon.statusCode).toBe(401);
    });
  });
});
