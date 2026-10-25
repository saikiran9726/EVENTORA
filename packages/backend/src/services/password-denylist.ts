/**
 * Common password denylist and weak password detector.
 * Prevents account takeover and brute-force via common credentials.
 */

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  'password123!',
  'password1234!',
  'p@ssword',
  'p@ssword1',
  'p@ssword123',
  'p@ssword123!',
  'admin',
  'admin123',
  'admin123!',
  'administrator',
  'administrator123',
  'administrator123!',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'welcome',
  'welcome1',
  'welcome123',
  'welcome123!',
  'letmein123',
  'letmein123!',
  'changeme123',
  'changeme123!',
  'iloveyou123',
  'iloveyou123!',
  'monkey123',
  'dragon123',
  'master123',
  'sunshine123',
  'campus123',
  'campus123!',
  'student123',
  'student123!',
  'eventora123',
  'eventora123!',
]);

export function isCommonPassword(password: string): boolean {
  if (!password || typeof password !== 'string') return true;
  const lower = password.toLowerCase().trim();
  if (COMMON_PASSWORDS.has(lower)) return true;

  // Check alphanumeric representation
  const alphanumeric = lower.replace(/[^a-z0-9]/g, '');
  if (COMMON_PASSWORDS.has(alphanumeric)) return true;

  return false;
}
