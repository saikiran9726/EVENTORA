import { pool } from '../db/index.js';

/**
 * Transliterates unicode strings (accents, diacritics, symbols)
 * into a URL-friendly ASCII slug base.
 */
export function transliterateToSlug(input: string): string {
  if (!input || typeof input !== 'string') return 'event';

  let s = input.trim();

  // 1. Decompose accented unicode characters and strip diacritical marks
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

  // 2. Expand common symbol characters into readable words
  s = s
    .replace(/&/g, ' and ')
    .replace(/@/g, ' at ')
    .replace(/%/g, ' percent ')
    .replace(/\+/g, ' plus ')
    .replace(/#/g, ' hash ');

  // 3. Convert to lowercase
  s = s.toLowerCase();

  // 4. Strip any character that is not alphanumeric, hyphen, or space
  s = s.replace(/[^a-z0-9\s-]/g, '');

  // 5. Replace runs of whitespace and underscores with a single hyphen
  s = s.replace(/[\s_-]+/g, '-');

  // 6. Trim leading and trailing hyphens
  s = s.replace(/^-+|-+$/g, '');

  // Fallback if title contained only non-alphanumeric characters
  if (!s) s = 'event';

  // Cap base length at 100 chars
  if (s.length > 100) s = s.slice(0, 100).replace(/-+$/, '');

  return s;
}

/**
 * Generates a guaranteed-unique slug for an event by checking the database
 * with retry logic and transliteration.
 */
export async function generateUniqueSlug(
  title: string,
  clientOrPoolOrDb: any = pool,
  maxRetries = 10
): Promise<string> {
  const base = transliterateToSlug(title);

  const checkSlugExists = async (slugToCheck: string): Promise<boolean> => {
    if (clientOrPoolOrDb && typeof clientOrPoolOrDb.query === 'function') {
      const res = await clientOrPoolOrDb.query(
        'SELECT 1 FROM events WHERE slug = $1 LIMIT 1;',
        [slugToCheck]
      );
      return res.rows.length > 0;
    }
    // Drizzle instance fallback or direct pool
    const res = await pool.query(
      'SELECT 1 FROM events WHERE slug = $1 LIMIT 1;',
      [slugToCheck]
    );
    return res.rows.length > 0;
  };

  // 1. Try base slug first
  const exists = await checkSlugExists(base);
  if (!exists) {
    return base;
  }

  // 2. Collision detected: Retry with random alphanumeric suffixes
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const suffix = Math.random().toString(36).substring(2, 6);
    const candidate = `${base}-${suffix}`;

    const candidateExists = await checkSlugExists(candidate);
    if (!candidateExists) {
      return candidate;
    }
  }

  // 3. Fallback timestamp-based guaranteed-unique slug
  return `${base}-${Date.now().toString(36)}`;
}
