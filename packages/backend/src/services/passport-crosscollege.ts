import { pool } from '../db/index.js';

export interface CollegeRecord {
  id: string;
  name: string;
  domain: string;
  status: string;
  publicDiscovery: boolean;
  participationStatus: 'none' | 'pending' | 'participating';
  verifiedAt: string | null;
  verifiedBy: string | null;
}

export interface PublicEventItem {
  id: string;
  collegeId: string;
  collegeName: string;
  organizerId: string;
  organizerName: string;
  isOrganizerVerified: boolean;
  title: string;
  slug: string;
  description: string;
  category: string;
  tags: string[];
  department: string | null;
  format: string;
  startsAt: string;
  endsAt: string;
  attendeeBucket: string; // Bucketed count, e.g. "25+ attendees", strips raw count
  eligibility: any;
  visibility: 'public';
}

export interface StudentAchievementRecord {
  id: string;
  userId: string;
  type: 'ATTENDANCE' | 'VOLUNTEER' | 'CERTIFICATE' | 'TEAM_PARTICIPATION';
  sourceEventId: string;
  sourceRefId: string;
  eventTitle: string;
  eventDate: string;
  verificationStatus: 'VERIFIED' | 'PENDING' | 'REVOKED';
  visibility: 'private' | 'public';
  createdAt: string;
}

export interface PassportSettingsRecord {
  userId: string;
  isPublic: boolean;
  slug: string;
  showAttendance: boolean;
  showVolunteer: boolean;
  showCertificates: boolean;
  updatedAt: string;
}

export interface PublicPassportData {
  displayName: string;
  slug: string;
  collegeName: string;
  verifiedStudent: boolean;
  achievements: Array<{
    id: string;
    type: string;
    title: string;
    eventDate: string;
    badgeLabel: string;
    verificationStatus: string;
  }>;
}

// -------------------------------------------------------------
// 1. Colleges Management (FR-XCOL)
// -------------------------------------------------------------

export async function getColleges(): Promise<CollegeRecord[]> {
  const query = `
    SELECT 
      id,
      name,
      domain,
      status,
      public_discovery AS "publicDiscovery",
      participation_status AS "participationStatus",
      verified_at AS "verifiedAt",
      verified_by AS "verifiedBy"
    FROM colleges
    ORDER BY participation_status DESC, name ASC;
  `;
  const { rows } = await pool.query(query);
  return rows;
}

export async function verifyCollege(params: {
  collegeId: string;
  participationStatus: 'none' | 'pending' | 'participating';
  adminId: string;
}): Promise<CollegeRecord> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateQuery = `
      UPDATE colleges
      SET 
        participation_status = $1::college_participation_status,
        verified_at = CASE WHEN $1::text = 'participating' THEN NOW() ELSE verified_at END,
        verified_by = CASE WHEN $1::text = 'participating' THEN $2::uuid ELSE verified_by END
      WHERE id = $3::uuid
      RETURNING 
        id, name, domain, status, 
        public_discovery AS "publicDiscovery",
        participation_status AS "participationStatus",
        verified_at AS "verifiedAt",
        verified_by AS "verifiedBy";
    `;
    const { rows } = await client.query(updateQuery, [
      params.participationStatus,
      params.adminId,
      params.collegeId,
    ]);

    if (rows.length === 0) {
      throw new Error('COLLEGE_NOT_FOUND');
    }

    // Write audit log
    await client.query(
      `
      INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
      VALUES ($1::uuid, 'COLLEGE_VERIFIED', 'college', $2::text, $3::jsonb);
    `,
      [params.adminId, params.collegeId, JSON.stringify({ participationStatus: params.participationStatus })]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// -------------------------------------------------------------
// 2. Organizer Verification (FR-XCOL)
// -------------------------------------------------------------

export async function verifyOrganizer(params: {
  organizerId: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  evidenceRef: string;
  adminId: string;
}): Promise<any> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const upsertQuery = `
      INSERT INTO organizer_verifications (organizer_id, status, evidence_ref, reviewed_by, reviewed_at)
      VALUES ($1::uuid, $2::organizer_verification_status, $3, $4::uuid, NOW())
      RETURNING id, organizer_id AS "organizerId", status, evidence_ref AS "evidenceRef", reviewed_at AS "reviewedAt";
    `;
    const { rows } = await client.query(upsertQuery, [
      params.organizerId,
      params.status,
      params.evidenceRef || 'Admin verified institution charter',
      params.adminId,
    ]);

    if (params.status === 'VERIFIED') {
      await client.query(
        `UPDATE organizer_profiles SET status = 'verified' WHERE id = $1::uuid;`,
        [params.organizerId]
      );
    }

    // Write audit log
    await client.query(
      `
      INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
      VALUES ($1::uuid, 'ORGANIZER_VERIFIED', 'organizer', $2::text, $3::jsonb);
    `,
      [params.adminId, params.organizerId, JSON.stringify({ status: params.status })]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getOrganizerVerification(organizerId: string): Promise<any> {
  const query = `
    SELECT 
      ov.id,
      ov.organizer_id AS "organizerId",
      ov.status,
      ov.evidence_ref AS "evidenceRef",
      ov.reviewed_at AS "reviewedAt",
      (ov.status = 'VERIFIED') AS "isVerified"
    FROM organizer_verifications ov
    WHERE ov.organizer_id = $1
    ORDER BY ov.created_at DESC
    LIMIT 1;
  `;
  const { rows } = await pool.query(query, [organizerId]);
  if (rows.length === 0) {
    return {
      organizerId,
      status: 'PENDING',
      isVerified: false,
      evidenceRef: null,
      reviewedAt: null,
    };
  }
  return rows[0];
}

// -------------------------------------------------------------
// 3. Public Cross-College Discovery (FR-XCOL)
// -------------------------------------------------------------

export function bucketAttendeeCount(count: number): string {
  if (count <= 0) return 'New Event';
  if (count < 25) return '< 25 attendees';
  if (count < 50) return '25+ attendees';
  if (count < 100) return '50+ attendees';
  if (count < 250) return '100+ attendees';
  return '250+ attendees';
}

export async function getPublicCrossCollegeEvents(filter: {
  collegeId?: string;
  q?: string;
  category?: string;
  from?: string;
  to?: string;
}): Promise<PublicEventItem[]> {
  // CRITICAL RULE: Evaluated in SQL (WHERE), never filtered in app code
  // Returns ONLY visibility='public' AND organizer verified AND college participating
  const conditions: string[] = [
    `e.visibility = 'public'`,
    `e.status IN ('published', 'completed')`,
    `c.participation_status = 'participating'`,
    `ov.status = 'VERIFIED'`,
  ];
  const params: any[] = [];
  let paramIdx = 1;

  if (filter.collegeId) {
    conditions.push(`e.college_id = $${paramIdx++}`);
    params.push(filter.collegeId);
  }

  if (filter.category) {
    conditions.push(`e.category ILIKE $${paramIdx++}`);
    params.push(filter.category);
  }

  if (filter.q) {
    conditions.push(`(e.title ILIKE $${paramIdx} OR e.description ILIKE $${paramIdx})`);
    params.push(`%${filter.q}%`);
    paramIdx++;
  }

  if (filter.from) {
    conditions.push(`e.starts_at >= $${paramIdx++}`);
    params.push(filter.from);
  }

  if (filter.to) {
    conditions.push(`e.starts_at <= $${paramIdx++}`);
    params.push(filter.to);
  }

  const query = `
    SELECT 
      e.id,
      e.college_id AS "collegeId",
      c.name AS "collegeName",
      e.organizer_id AS "organizerId",
      op.display_name AS "organizerName",
      TRUE AS "isOrganizerVerified",
      e.title,
      e.slug,
      e.description,
      e.category,
      e.tags,
      e.department,
      e.format,
      e.starts_at AS "startsAt",
      e.ends_at AS "endsAt",
      e.eligibility,
      e.visibility,
      COALESCE((
        SELECT COUNT(*)::int 
        FROM bookings b 
        WHERE b.event_id = e.id AND b.status = 'CONFIRMED'
      ), 0) AS raw_count
    FROM events e
    INNER JOIN colleges c ON c.id = e.college_id
    INNER JOIN organizer_profiles op ON op.id = e.organizer_id
    INNER JOIN organizer_verifications ov ON ov.organizer_id = op.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.starts_at ASC;
  `;

  const { rows } = await pool.query(query, params);

  // Strip exact count to coarse bucket; strip contact emails and attendee lists
  return rows.map((r) => ({
    id: r.id,
    collegeId: r.collegeId,
    collegeName: r.collegeName,
    organizerId: r.organizerId,
    organizerName: r.organizerName,
    isOrganizerVerified: r.isOrganizerVerified,
    title: r.title,
    slug: r.slug,
    description: r.description,
    category: r.category,
    tags: r.tags || [],
    department: r.department,
    format: r.format,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    attendeeBucket: bucketAttendeeCount(r.raw_count),
    eligibility: r.eligibility || {},
    visibility: 'public',
  }));
}

// -------------------------------------------------------------
// 4. Cross-College Registration Eligibility Check (FR-XCOL)
// -------------------------------------------------------------

export async function checkRegistrationEligibility(
  eventId: string,
  user: { collegeId: string; department?: string | null; year?: number | null }
): Promise<{ eligible: boolean; reason?: string; message?: string }> {
  const query = `SELECT id, college_id, eligibility, visibility FROM events WHERE id = $1;`;
  const { rows } = await pool.query(query, [eventId]);

  if (rows.length === 0) {
    return { eligible: false, reason: 'EVENT_NOT_FOUND', message: 'Event not found.' };
  }

  const event = rows[0];
  const eligibility = event.eligibility || {};

  // 1. College Restriction check
  if (Array.isArray(eligibility.colleges) && eligibility.colleges.length > 0) {
    if (!eligibility.colleges.includes(user.collegeId)) {
      return {
        eligible: false,
        reason: 'COLLEGE_INELIGIBLE',
        message: 'This event is restricted to students of specific participating institutions.',
      };
    }
  }

  // 2. Department Restriction check
  if (Array.isArray(eligibility.departments) && eligibility.departments.length > 0) {
    if (!user.department || !eligibility.departments.includes(user.department)) {
      return {
        eligible: false,
        reason: 'DEPARTMENT_INELIGIBLE',
        message: `This event is restricted to students of: ${eligibility.departments.join(', ')}.`,
      };
    }
  }

  // 3. Year Restriction check
  if (Array.isArray(eligibility.years) && eligibility.years.length > 0) {
    if (!user.year || !eligibility.years.includes(user.year)) {
      return {
        eligible: false,
        reason: 'YEAR_INELIGIBLE',
        message: `This event is restricted to year(s): ${eligibility.years.join(', ')}.`,
      };
    }
  }

  return { eligible: true };
}

// -------------------------------------------------------------
// 5. Student Event Passport & Achievements (FR-PASS)
// -------------------------------------------------------------

export async function getOrCreatePassportSettings(userId: string): Promise<PassportSettingsRecord> {
  const query = `
    SELECT 
      user_id AS "userId",
      is_public AS "isPublic",
      slug,
      show_attendance AS "showAttendance",
      show_volunteer AS "showVolunteer",
      show_certificates AS "showCertificates",
      updated_at AS "updatedAt"
    FROM passport_settings
    WHERE user_id = $1;
  `;
  const { rows } = await pool.query(query, [userId]);
  if (rows.length > 0) {
    return rows[0];
  }

  // Generate unique slug
  const userRes = await pool.query(`SELECT display_name FROM users WHERE id = $1;`, [userId]);
  const baseSlug = (userRes.rows[0]?.display_name || 'student')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const candidateSlug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;

  const insertQuery = `
    INSERT INTO passport_settings (user_id, is_public, slug, show_attendance, show_volunteer, show_certificates)
    VALUES ($1, FALSE, $2, TRUE, TRUE, TRUE)
    ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
    RETURNING 
      user_id AS "userId",
      is_public AS "isPublic",
      slug,
      show_attendance AS "showAttendance",
      show_volunteer AS "showVolunteer",
      show_certificates AS "showCertificates",
      updated_at AS "updatedAt";
  `;
  const insertRes = await pool.query(insertQuery, [userId, candidateSlug]);
  return insertRes.rows[0];
}

export async function updatePassportSettings(
  userId: string,
  params: {
    isPublic?: boolean;
    slug?: string;
    showAttendance?: boolean;
    showVolunteer?: boolean;
    showCertificates?: boolean;
  }
): Promise<PassportSettingsRecord> {
  const current = await getOrCreatePassportSettings(userId);

  const isPublic = params.isPublic !== undefined ? params.isPublic : current.isPublic;
  const slug = params.slug ? params.slug.toLowerCase().trim() : current.slug;
  const showAttendance = params.showAttendance !== undefined ? params.showAttendance : current.showAttendance;
  const showVolunteer = params.showVolunteer !== undefined ? params.showVolunteer : current.showVolunteer;
  const showCertificates = params.showCertificates !== undefined ? params.showCertificates : current.showCertificates;

  const updateQuery = `
    UPDATE passport_settings
    SET 
      is_public = $1,
      slug = $2,
      show_attendance = $3,
      show_volunteer = $4,
      show_certificates = $5,
      updated_at = NOW()
    WHERE user_id = $6
    RETURNING 
      user_id AS "userId",
      is_public AS "isPublic",
      slug,
      show_attendance AS "showAttendance",
      show_volunteer AS "showVolunteer",
      show_certificates AS "showCertificates",
      updated_at AS "updatedAt";
  `;
  const { rows } = await pool.query(updateQuery, [
    isPublic,
    slug,
    showAttendance,
    showVolunteer,
    showCertificates,
    userId,
  ]);
  return rows[0];
}

/**
 * Server-only achievement recorder. Triggered exclusively by checkins, volunteer_records, certificates.
 */
export async function recordServerAchievement(params: {
  userId: string;
  type: 'ATTENDANCE' | 'VOLUNTEER' | 'CERTIFICATE' | 'TEAM_PARTICIPATION';
  sourceEventId: string;
  sourceRefId: string;
  verificationStatus?: 'VERIFIED' | 'PENDING' | 'REVOKED';
  visibility?: 'private' | 'public';
}): Promise<any> {
  const query = `
    INSERT INTO student_achievements (
      user_id, type, source_event_id, source_ref_id, verification_status, visibility
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (type, source_ref_id)
    DO UPDATE SET 
      verification_status = EXCLUDED.verification_status,
      visibility = EXCLUDED.visibility
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    params.userId,
    params.type,
    params.sourceEventId,
    params.sourceRefId,
    params.verificationStatus || 'VERIFIED',
    params.visibility || 'public',
  ]);
  return rows[0];
}

/**
 * Revokes achievement when source certificate or ticket is revoked.
 */
export async function revokeServerAchievement(
  type: 'ATTENDANCE' | 'VOLUNTEER' | 'CERTIFICATE' | 'TEAM_PARTICIPATION',
  sourceRefId: string
): Promise<boolean> {
  const query = `
    UPDATE student_achievements
    SET verification_status = 'REVOKED'
    WHERE type = $1 AND source_ref_id = $2;
  `;
  const res = await pool.query(query, [type, sourceRefId]);
  return (res.rowCount ?? 0) > 0;
}

export async function getStudentAchievements(userId: string): Promise<StudentAchievementRecord[]> {
  const query = `
    SELECT 
      sa.id,
      sa.user_id AS "userId",
      sa.type,
      sa.source_event_id AS "sourceEventId",
      sa.source_ref_id AS "sourceRefId",
      e.title AS "eventTitle",
      e.starts_at AS "eventDate",
      sa.verification_status AS "verificationStatus",
      sa.visibility,
      sa.created_at AS "createdAt"
    FROM student_achievements sa
    INNER JOIN events e ON e.id = sa.source_event_id
    WHERE sa.user_id = $1
    ORDER BY sa.created_at DESC;
  `;
  const { rows } = await pool.query(query, [userId]);
  return rows;
}

/**
 * Public Passport Resolver (FR-PASS)
 * Evaluated in SQL (WHERE).
 * 404 when not public (indistinguishable from nonexistent).
 * Zero PII returned (no email, phone, or roll number).
 */
export async function getPublicPassport(slug: string): Promise<PublicPassportData | null> {
  // CRITICAL RULE: evaluated in SQL WHERE, never in memory after fetch
  const passportQuery = `
    SELECT 
      ps.user_id AS "userId",
      ps.is_public AS "isPublic",
      ps.slug,
      ps.show_attendance AS "showAttendance",
      ps.show_volunteer AS "showVolunteer",
      ps.show_certificates AS "showCertificates",
      u.display_name AS "displayName",
      c.name AS "collegeName"
    FROM passport_settings ps
    INNER JOIN users u ON u.id = ps.user_id
    INNER JOIN colleges c ON c.id = u.college_id
    WHERE ps.slug = $1 AND ps.is_public = TRUE;
  `;
  const { rows: passportRows } = await pool.query(passportQuery, [slug]);

  if (passportRows.length === 0) {
    return null; // Signals 404
  }

  const p = passportRows[0];

  // Types filter determined in SQL
  const allowedTypes: string[] = ['TEAM_PARTICIPATION'];
  if (p.showAttendance) allowedTypes.push('ATTENDANCE');
  if (p.showVolunteer) allowedTypes.push('VOLUNTEER');
  if (p.showCertificates) allowedTypes.push('CERTIFICATE');

  const achievementsQuery = `
    SELECT 
      sa.id,
      sa.type,
      e.title,
      e.starts_at AS "eventDate",
      sa.verification_status AS "verificationStatus",
      CASE 
        WHEN sa.type = 'CERTIFICATE' THEN 'Verified Certificate'
        WHEN sa.type = 'VOLUNTEER' THEN 'Verified Volunteer Service'
        WHEN sa.type = 'ATTENDANCE' THEN 'Event Check-in Admitted'
        ELSE 'Team Participation'
      END AS "badgeLabel"
    FROM student_achievements sa
    INNER JOIN events e ON e.id = sa.source_event_id
    WHERE sa.user_id = $1 
      AND sa.visibility = 'public' 
      AND sa.verification_status = 'VERIFIED'
      AND sa.type = ANY($2::achievement_type[])
    ORDER BY e.starts_at DESC;
  `;
  const { rows: achievements } = await pool.query(achievementsQuery, [p.userId, allowedTypes]);

  return {
    displayName: p.displayName,
    slug: p.slug,
    collegeName: p.collegeName,
    verifiedStudent: true,
    achievements,
  };
}
