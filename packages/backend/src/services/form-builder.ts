import { pool, db } from '../db/index.js';
import {
  eventFormFields,
  registrationAnswers,
  bookings,
  type EventFormField,
  type EventFormFieldType,
} from '../db/schema.js';
import { eq, and, sql, asc } from 'drizzle-orm';

export class FormBuilderError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details: Record<string, any> = {}
  ) {
    super(message);
    this.name = 'FormBuilderError';
  }
}

export const VALID_FIELD_TYPES: EventFormFieldType[] = [
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
];

export const DEFAULT_DIETARY_OPTIONS = [
  'Vegetarian',
  'Vegan',
  'Jain',
  'Halal',
  'No Preference',
];

export interface FormFieldInput {
  id?: string;
  position: number;
  type: EventFormFieldType;
  label: string;
  helpText?: string | null;
  required?: boolean;
  options?: string[];
  validation?: Record<string, any>;
}

export interface FormSubmissionAnswerInput {
  fieldId: string;
  value: any;
  attendeeIndex?: number;
}

/**
 * Strips HTML tags from strings to mitigate stored XSS.
 */
export function stripHtml(input: string): string {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]*>?/gm, '')
    .trim();
}

/**
 * Checks if a regex pattern is safe to execute without ReDoS vulnerability.
 */
export function isSafeRegex(pattern: string): boolean {
  if (!pattern || typeof pattern !== 'string') return false;
  if (pattern.length > 250) return false;
  // Disallow nested quantifiers like (a+)+, (a*)* or (.*a){2,}
  if (/\([^)]*(\+|\*|\{[0-9]+,[0-9]*\})[^)]*\)\s*(\+|\*|\{[0-9]+,[0-9]*\})/.test(pattern)) {
    return false;
  }
  if (/(\+|\*|\{[0-9]+,[0-9]*\})\s*(\+|\*|\{[0-9]+,[0-9]*\})/.test(pattern)) {
    return false;
  }
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates and sanitizes a single answer against its field definition.
 */
export function validateAnswerValue(
  field: EventFormField,
  rawValue: any
): { valid: boolean; value: any } {
  const isProvided =
    rawValue !== undefined &&
    rawValue !== null &&
    (typeof rawValue === 'string' ? rawValue.trim() !== '' : true) &&
    (!Array.isArray(rawValue) || rawValue.length > 0);

  // 1. Required check
  if (field.required && !isProvided) {
    throw new FormBuilderError(
      'MISSING_REQUIRED_FIELD',
      `Answer is required for field: "${field.label}"`,
      400,
      { fieldId: field.id, label: field.label }
    );
  }

  if (!isProvided) {
    return { valid: true, value: null };
  }

  // 2. Type-specific checks and HTML stripping
  switch (field.type) {
    case 'short_text': {
      if (typeof rawValue !== 'string') {
        throw new FormBuilderError(
          'INVALID_FIELD_TYPE',
          `Field "${field.label}" must be a text string`,
          400,
          { fieldId: field.id }
        );
      }
      const sanitized = stripHtml(rawValue);
      if (sanitized.length > 1000) {
        throw new FormBuilderError(
          'ANSWER_TOO_LONG',
          `Field "${field.label}" exceeds maximum length of 1000 characters`,
          400,
          { fieldId: field.id, maxLength: 1000 }
        );
      }
      if (field.validation && typeof field.validation.pattern === 'string') {
        const pattern = field.validation.pattern;
        if (isSafeRegex(pattern)) {
          const reg = new RegExp(pattern);
          if (!reg.test(sanitized)) {
            throw new FormBuilderError(
              'VALIDATION_ERROR',
              `Field "${field.label}" does not match required format`,
              400,
              { fieldId: field.id, pattern }
            );
          }
        }
      }
      return { valid: true, value: sanitized };
    }

    case 'long_text': {
      if (typeof rawValue !== 'string') {
        throw new FormBuilderError(
          'INVALID_FIELD_TYPE',
          `Field "${field.label}" must be text`,
          400,
          { fieldId: field.id }
        );
      }
      const sanitized = stripHtml(rawValue);
      if (sanitized.length > 1000) {
        throw new FormBuilderError(
          'ANSWER_TOO_LONG',
          `Field "${field.label}" exceeds maximum length of 1000 characters`,
          400,
          { fieldId: field.id, maxLength: 1000 }
        );
      }
      return { valid: true, value: sanitized };
    }

    case 'email': {
      if (typeof rawValue !== 'string') {
        throw new FormBuilderError(
          'INVALID_FIELD_TYPE',
          `Field "${field.label}" must be an email address`,
          400,
          { fieldId: field.id }
        );
      }
      const sanitized = stripHtml(rawValue).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitized)) {
        throw new FormBuilderError(
          'INVALID_EMAIL_FORMAT',
          `Field "${field.label}" must be a valid email address`,
          400,
          { fieldId: field.id }
        );
      }
      if (sanitized.length > 255) {
        throw new FormBuilderError(
          'ANSWER_TOO_LONG',
          `Field "${field.label}" exceeds maximum length of 255 characters`,
          400,
          { fieldId: field.id }
        );
      }
      return { valid: true, value: sanitized };
    }

    case 'phone': {
      if (typeof rawValue !== 'string') {
        throw new FormBuilderError(
          'INVALID_FIELD_TYPE',
          `Field "${field.label}" must be a phone number`,
          400,
          { fieldId: field.id }
        );
      }
      const sanitized = stripHtml(rawValue);
      if (!/^\+?[0-9\s-]{7,15}$/.test(sanitized)) {
        throw new FormBuilderError(
          'INVALID_PHONE_FORMAT',
          `Field "${field.label}" must be a valid phone number (7-15 digits)`,
          400,
          { fieldId: field.id }
        );
      }
      return { valid: true, value: sanitized };
    }

    case 'number': {
      const num = typeof rawValue === 'number' ? rawValue : parseFloat(rawValue);
      if (isNaN(num) || !isFinite(num)) {
        throw new FormBuilderError(
          'INVALID_NUMBER',
          `Field "${field.label}" must be a valid number`,
          400,
          { fieldId: field.id }
        );
      }
      if (field.validation) {
        if (typeof field.validation.min === 'number' && num < field.validation.min) {
          throw new FormBuilderError(
            'VALIDATION_MIN_ERROR',
            `Field "${field.label}" cannot be less than ${field.validation.min}`,
            400,
            { fieldId: field.id, min: field.validation.min }
          );
        }
        if (typeof field.validation.max === 'number' && num > field.validation.max) {
          throw new FormBuilderError(
            'VALIDATION_MAX_ERROR',
            `Field "${field.label}" cannot exceed ${field.validation.max}`,
            400,
            { fieldId: field.id, max: field.validation.max }
          );
        }
      }
      return { valid: true, value: num };
    }

    case 'date': {
      if (typeof rawValue !== 'string') {
        throw new FormBuilderError(
          'INVALID_DATE',
          `Field "${field.label}" must be a valid date string`,
          400,
          { fieldId: field.id }
        );
      }
      const sanitized = stripHtml(rawValue);
      const parsed = Date.parse(sanitized);
      if (isNaN(parsed)) {
        throw new FormBuilderError(
          'INVALID_DATE_FORMAT',
          `Field "${field.label}" is not a valid date`,
          400,
          { fieldId: field.id }
        );
      }
      return { valid: true, value: sanitized };
    }

    case 'dropdown':
    case 'radio': {
      const strVal = typeof rawValue === 'string' ? stripHtml(rawValue) : String(rawValue);
      const allowed = Array.isArray(field.options) ? field.options : [];
      if (!allowed.includes(strVal)) {
        throw new FormBuilderError(
          'INVALID_OPTION_MEMBERSHIP',
          `Selected option "${strVal}" is not a valid option for "${field.label}"`,
          400,
          { fieldId: field.id, allowedOptions: allowed }
        );
      }
      return { valid: true, value: strVal };
    }

    case 'dietary': {
      const strVal = typeof rawValue === 'string' ? stripHtml(rawValue) : String(rawValue);
      const allowed =
        Array.isArray(field.options) && field.options.length > 0
          ? field.options
          : DEFAULT_DIETARY_OPTIONS;
      if (!allowed.includes(strVal)) {
        throw new FormBuilderError(
          'INVALID_OPTION_MEMBERSHIP',
          `Selected dietary option "${strVal}" is not valid`,
          400,
          { fieldId: field.id, allowedOptions: allowed }
        );
      }
      return { valid: true, value: strVal };
    }

    case 'checkbox': {
      const boolVal = Boolean(rawValue);
      if (field.required && !boolVal) {
        throw new FormBuilderError(
          'MISSING_REQUIRED_FIELD',
          `Checkbox "${field.label}" must be accepted`,
          400,
          { fieldId: field.id }
        );
      }
      return { valid: true, value: boolVal };
    }

    case 'multi_checkbox': {
      if (!Array.isArray(rawValue)) {
        throw new FormBuilderError(
          'INVALID_FIELD_TYPE',
          `Field "${field.label}" must be an array of selected options`,
          400,
          { fieldId: field.id }
        );
      }
      const allowed = Array.isArray(field.options) ? field.options : [];
      const sanitizedArray = rawValue.map((item) => stripHtml(String(item)));
      for (const item of sanitizedArray) {
        if (!allowed.includes(item)) {
          throw new FormBuilderError(
            'INVALID_OPTION_MEMBERSHIP',
            `Option "${item}" is not valid for "${field.label}"`,
            400,
            { fieldId: field.id, allowedOptions: allowed }
          );
        }
      }
      return { valid: true, value: sanitizedArray };
    }

    default:
      return { valid: true, value: typeof rawValue === 'string' ? stripHtml(rawValue) : rawValue };
  }
}

/**
 * Fetches the form configuration for an event, including registration count & frozen status.
 */
export async function getEventForm(eventId: string) {
  const client = await pool.connect();
  try {
    // 1. Check registrations count
    const regRes = await client.query(
      `SELECT COUNT(*)::int as count
       FROM bookings
       WHERE event_id = $1 AND status IN ('PENDING_PAYMENT', 'CONFIRMED');`,
      [eventId]
    );
    const registrationCount = regRes.rows[0]?.count || 0;
    const isFrozen = registrationCount > 0;

    // 2. Fetch fields
    const fieldsRes = await client.query(
      `SELECT id, event_id, position, type, label, help_text, required, options, validation, version, created_at, updated_at
       FROM event_form_fields
       WHERE event_id = $1
       ORDER BY position ASC, id ASC;`,
      [eventId]
    );

    const fields = fieldsRes.rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      position: row.position,
      type: row.type,
      label: row.label,
      helpText: row.help_text,
      required: row.required,
      options: row.options || [],
      validation: row.validation || {},
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const maxVersion = fields.reduce((max, f) => Math.max(max, f.version || 1), 1);

    return {
      eventId,
      version: maxVersion,
      isFrozen,
      registrationCount,
      fields,
    };
  } finally {
    client.release();
  }
}

/**
 * Saves/updates custom registration form fields with optimistic locking and frozen-field guard.
 */
export async function saveEventForm(
  eventId: string,
  newFields: FormFieldInput[],
  expectedVersion?: number
) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Check if event exists
    const eventRes = await client.query('SELECT id, title FROM events WHERE id = $1 FOR UPDATE;', [eventId]);
    if (eventRes.rows.length === 0) {
      throw new FormBuilderError('EVENT_NOT_FOUND', `Event ${eventId} not found`, 404);
    }

    // 2. Check registrations count
    const regRes = await client.query(
      `SELECT COUNT(*)::int as count
       FROM bookings
       WHERE event_id = $1 AND status IN ('PENDING_PAYMENT', 'CONFIRMED');`,
      [eventId]
    );
    const registrationCount = regRes.rows[0]?.count || 0;
    const isFrozen = registrationCount > 0;

    // 3. Fetch existing fields
    const currentFieldsRes = await client.query(
      `SELECT id, position, type, label, version
       FROM event_form_fields
       WHERE event_id = $1
       ORDER BY position ASC;`,
      [eventId]
    );
    const currentFields = currentFieldsRes.rows;
    const currentMaxVersion = currentFields.reduce((max, f) => Math.max(max, f.version || 1), 1);

    // 4. Optimistic Version Check
    if (expectedVersion !== undefined && expectedVersion !== currentMaxVersion) {
      throw new FormBuilderError(
        'VERSION_CONFLICT',
        `Form was modified concurrently. Current version is ${currentMaxVersion}, expected ${expectedVersion}.`,
        409,
        { currentVersion: currentMaxVersion, expectedVersion }
      );
    }

    // 5. Frozen Check: if registrations exist, existing fields cannot be removed or have their types altered
    if (isFrozen && currentFields.length > 0) {
      const incomingIds = new Set(newFields.filter((f) => f.id).map((f) => f.id));
      for (const cf of currentFields) {
        if (!incomingIds.has(cf.id)) {
          throw new FormBuilderError(
            'FORM_FROZEN',
            `Existing field "${cf.label}" cannot be removed because registrations already exist for this event.`,
            400,
            { fieldId: cf.id, fieldLabel: cf.label }
          );
        }
      }

      const incomingMap = new Map(newFields.filter((f) => f.id).map((f) => [f.id!, f]));
      for (const cf of currentFields) {
        const incoming = incomingMap.get(cf.id);
        if (incoming && incoming.type !== cf.type) {
          throw new FormBuilderError(
            'FORM_FROZEN',
            `Type of field "${cf.label}" cannot be changed from "${cf.type}" to "${incoming.type}" after registrations exist.`,
            400,
            { fieldId: cf.id, oldType: cf.type, newType: incoming.type }
          );
        }
      }
    }

    const nextVersion = currentMaxVersion + 1;

    // 6. Delete removed fields (only possible if not frozen)
    if (!isFrozen) {
      const incomingIds = newFields.filter((f) => f.id).map((f) => f.id!);
      if (incomingIds.length > 0) {
        await client.query(
          `DELETE FROM event_form_fields
           WHERE event_id = $1 AND id NOT IN (${incomingIds.map((_, i) => `$${i + 2}`).join(',')});`,
          [eventId, ...incomingIds]
        );
      } else {
        await client.query('DELETE FROM event_form_fields WHERE event_id = $1;', [eventId]);
      }
    }

    // 7. Upsert fields
    for (let i = 0; i < newFields.length; i++) {
      const f = newFields[i];
      const position = typeof f.position === 'number' ? f.position : i;
      const options =
        f.type === 'dietary' && (!f.options || f.options.length === 0)
          ? DEFAULT_DIETARY_OPTIONS
          : (f.options || []);

      if (f.id && currentFields.some((cf) => cf.id === f.id)) {
        // Update existing field
        await client.query(
          `UPDATE event_form_fields
           SET position = $1,
               label = $2,
               help_text = $3,
               required = $4,
               options = $5,
               validation = $6,
               version = $7,
               updated_at = NOW()
           WHERE id = $8 AND event_id = $9;`,
          [
            position,
            f.label.trim(),
            f.helpText ? f.helpText.trim() : null,
            Boolean(f.required),
            JSON.stringify(options),
            JSON.stringify(f.validation || {}),
            nextVersion,
            f.id,
            eventId,
          ]
        );
      } else {
        // Insert new field
        await client.query(
          `INSERT INTO event_form_fields (
             id, event_id, position, type, label, help_text, required, options, validation, version
           ) VALUES (
             COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10
           );`,
          [
            f.id || null,
            eventId,
            position,
            f.type,
            f.label.trim(),
            f.helpText ? f.helpText.trim() : null,
            Boolean(f.required),
            JSON.stringify(options),
            JSON.stringify(f.validation || {}),
            nextVersion,
          ]
        );
      }
    }

    await client.query('COMMIT');

    return await getEventForm(eventId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fetches all attendee form submissions for an event (Visible to Organizer Only).
 */
export async function getEventFormSubmissions(eventId: string) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT ra.id as answer_id,
              ra.booking_id,
              ra.field_id,
              ra.field_version,
              ra.value,
              ra.attendee_index,
              b.created_at as registration_date,
              b.status as booking_status,
              u.id as user_id,
              u.display_name as attendee_name,
              u.email as attendee_email,
              eff.label as field_label,
              eff.type as field_type
       FROM registration_answers ra
       JOIN bookings b ON ra.booking_id = b.id
       JOIN users u ON b.user_id = u.id
       JOIN event_form_fields eff ON ra.field_id = eff.id
       WHERE b.event_id = $1 AND b.status IN ('PENDING_PAYMENT', 'CONFIRMED')
       ORDER BY b.created_at DESC, ra.attendee_index ASC, eff.position ASC;`,
      [eventId]
    );

    // Group by booking
    const submissionsMap = new Map<string, any>();
    for (const row of res.rows) {
      if (!submissionsMap.has(row.booking_id)) {
        submissionsMap.set(row.booking_id, {
          bookingId: row.booking_id,
          attendeeName: row.attendee_name,
          attendeeEmail: row.attendee_email,
          userId: row.user_id,
          bookingStatus: row.booking_status,
          registeredAt: row.registration_date,
          answersByAttendee: {} as Record<number, any[]>,
        });
      }

      const sub = submissionsMap.get(row.booking_id);
      if (!sub.answersByAttendee[row.attendee_index]) {
        sub.answersByAttendee[row.attendee_index] = [];
      }
      sub.answersByAttendee[row.attendee_index].push({
        fieldId: row.field_id,
        fieldLabel: row.field_label,
        fieldType: row.field_type,
        value: row.value,
      });
    }

    return {
      eventId,
      totalSubmissions: submissionsMap.size,
      submissions: Array.from(submissionsMap.values()),
    };
  } finally {
    client.release();
  }
}
