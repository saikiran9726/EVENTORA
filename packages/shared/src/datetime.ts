/**
 * Eventora IST (Indian Standard Time, UTC+05:30) Date and Time Utilities
 *
 * All campus event times, ticket windows, and audit timestamps are formatted
 * in Indian Standard Time (Asia/Kolkata) using ECMAScript Intl.DateTimeFormat.
 */

export const IST_TIMEZONE = 'Asia/Kolkata';

export interface ISTFormatOptions {
  includeTime?: boolean;
  includeSeconds?: boolean;
  format?: 'full' | 'long' | 'medium' | 'short';
  hour12?: boolean;
}

/**
 * Parses any valid date input (ISO string, timestamp number, or Date instance)
 * into a verified Date object. Throws if the input is invalid.
 */
export function parseDate(dateInput: string | number | Date): Date {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date input: ${String(dateInput)}`);
  }
  return date;
}

/**
 * Formats a date into a localized Indian Standard Time (IST) date string.
 * Example: "29 Oct 2026"
 */
export function formatISTDate(
  dateInput: string | number | Date,
  options?: { monthFormat?: 'numeric' | '2-digit' | 'short' | 'long' }
): string {
  const date = parseDate(dateInput);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    day: 'numeric',
    month: options?.monthFormat || 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * Formats a time into localized Indian Standard Time (IST) 12-hour or 24-hour format with suffix.
 * Example: "06:30 PM IST" or "18:30 IST"
 */
export function formatISTTime(
  dateInput: string | number | Date,
  options?: { hour12?: boolean; includeSeconds?: boolean; includeTimeZoneName?: boolean }
): string {
  const date = parseDate(dateInput);
  const hour12 = options?.hour12 ?? true;
  const timeStr = new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: options?.includeSeconds ? '2-digit' : undefined,
    hour12,
  }).format(date);

  return options?.includeTimeZoneName ?? true ? `${timeStr} IST` : timeStr;
}

/**
 * Formats a date and time into a complete localized Indian Standard Time (IST) representation.
 * Example: "29 Oct 2026, 06:30 PM IST"
 */
export function formatISTDateTime(
  dateInput: string | number | Date,
  options?: { hour12?: boolean; includeSeconds?: boolean }
): string {
  const dateStr = formatISTDate(dateInput);
  const timeStr = formatISTTime(dateInput, options);
  return `${dateStr}, ${timeStr}`;
}

/**
 * Formats an event date range cleanly in IST.
 * If start and end are on the same day: "29 Oct 2026, 10:00 AM – 05:00 PM IST"
 * If start and end are on different days: "29 Oct 2026, 10:00 AM – 30 Oct 2026, 05:00 PM IST"
 */
export function formatISTDateRange(
  startInput: string | number | Date,
  endInput: string | number | Date
): string {
  const startDate = parseDate(startInput);
  const endDate = parseDate(endInput);

  const startDateStr = formatISTDate(startDate);
  const endDateStr = formatISTDate(endDate);

  const startTimeStr = formatISTTime(startDate, { includeTimeZoneName: false });
  const endTimeStr = formatISTTime(endDate, { includeTimeZoneName: true });

  if (startDateStr === endDateStr) {
    return `${startDateStr}, ${startTimeStr} – ${endTimeStr}`;
  }
  return `${startDateStr}, ${startTimeStr} – ${endDateStr}, ${endTimeStr}`;
}
