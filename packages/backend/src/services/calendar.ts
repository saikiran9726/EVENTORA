import type { Event, Venue } from '../db/schema.js';

function formatIcsDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function escapeIcsText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Generates an RFC 5545 compliant iCalendar string for an event
 */
export function generateIcsCalendar(event: Event, venue?: Venue | null): string {
  const uid = `${event.id}@campus.eventora.edu`;
  const dtStamp = formatIcsDate(new Date());
  const dtStart = formatIcsDate(new Date(event.startsAt));
  const dtEnd = formatIcsDate(new Date(event.endsAt));
  const summary = escapeIcsText(event.title);
  const description = escapeIcsText(event.description);
  const location = venue
    ? escapeIcsText(`${venue.name}, ${venue.building}`)
    : escapeIcsText(event.format === 'online' ? 'Online / Remote' : 'Campus Venue');

  const lines = [
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
    `STATUS:${event.status.toUpperCase()}`,
    `SEQUENCE:${event.version}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n') + '\r\n';
}
