import type { Event, Venue } from '../db/schema.js';

/**
 * Formats a JavaScript Date as an RFC 5545 UTC timestamp (e.g. 20261027T164500Z)
 */
export function formatIcsDate(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date for iCalendar formatting');
  }
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * Escapes characters per RFC 5545 Section 3.3.11 (TEXT values).
 * Escapes backslashes, semicolons, commas, and newlines.
 */
export function escapeIcsText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n');
}

/**
 * Folds lines longer than 75 octets per RFC 5545 Section 3.1.
 * Continuation lines begin with a single SPACE (0x20).
 */
export function foldIcsLine(line: string): string {
  const MAX_OCTETS = 75;
  if (Buffer.byteLength(line, 'utf8') <= MAX_OCTETS) {
    return line;
  }

  const parts: string[] = [];
  let remaining = line;
  let isFirst = true;

  while (remaining.length > 0) {
    const maxOctets = isFirst ? MAX_OCTETS : MAX_OCTETS - 1;
    let sliceLen = maxOctets;

    // Shrink slice if multi-byte characters push over maxOctets
    while (Buffer.byteLength(remaining.slice(0, sliceLen), 'utf8') > maxOctets && sliceLen > 1) {
      sliceLen--;
    }

    const chunk = remaining.slice(0, sliceLen);
    remaining = remaining.slice(sliceLen);

    if (isFirst) {
      parts.push(chunk);
      isFirst = false;
    } else {
      parts.push(' ' + chunk);
    }
  }

  return parts.join('\r\n');
}

/**
 * Maps internal event status to RFC 5545 VEVENT STATUS property.
 * RFC 5545 valid values: "CONFIRMED", "CANCELLED", "TENTATIVE".
 */
export function mapIcsStatus(status: string): string {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'published') return 'CONFIRMED';
  if (normalized === 'cancelled') return 'CANCELLED';
  return 'TENTATIVE';
}

/**
 * Generates an RFC 5545 compliant iCalendar string for an event.
 * Follows RFC 5545 syntax: CRLF endings, line folding, timezone UTC format, and text escaping.
 */
export function generateIcsCalendar(event: Event, venue?: Venue | null): string {
  const uid = `${event.id}@campus.eventora.edu`;
  const dtStamp = formatIcsDate(new Date());
  const dtStart = formatIcsDate(new Date(event.startsAt));
  const dtEnd = formatIcsDate(new Date(event.endsAt));
  const summary = escapeIcsText(event.title);
  const description = escapeIcsText(event.description || '');
  const location = venue
    ? escapeIcsText(`${venue.name}, ${venue.building}`)
    : escapeIcsText(event.format === 'online' ? 'Online / Remote' : 'Campus Venue');
  const icsStatus = mapIcsStatus(event.status);
  const sequence = event.version || 0;

  const rawLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Eventora//Smart Campus Event Management System//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    `STATUS:${icsStatus}`,
    `SEQUENCE:${sequence}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return rawLines.map(foldIcsLine).join('\r\n') + '\r\n';
}
