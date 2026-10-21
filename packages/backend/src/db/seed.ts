import { db } from './index.js';
import {
  colleges,
  users,
  userPreferences,
  organizerProfiles,
  organizerMembers,
  eventStaffAssignments,
} from './schema.js';
import { hashPassword } from '../services/auth.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export async function seedDatabase() {
  const seedPassword = process.env.SEED_PASSWORD || 'Eventora#Test2026!';
  const hashedPassword = await hashPassword(seedPassword);

  console.log('[Seed] Seeding college entity...');
  let college = await db.query.colleges.findFirst({
    where: eq(colleges.domain, 'campus.edu'),
  });

  if (!college) {
    const [created] = await db
      .insert(colleges)
      .values({
        name: 'Smart Campus Institute of Technology',
        domain: 'campus.edu',
        status: 'active',
        publicDiscovery: true,
      })
      .returning();
    college = created;
  }

  console.log('[Seed] Seeding accounts for all 6 canonical roles...');

  const accountsToSeed = [
    // Students x 3
    {
      email: 'student1@campus.edu',
      displayName: 'Aarav Sharma',
      globalRole: 'student' as const,
      status: 'active' as const,
    },
    {
      email: 'student2@campus.edu',
      displayName: 'Priya Iyer',
      globalRole: 'student' as const,
      status: 'active' as const,
    },
    {
      email: 'student3@campus.edu',
      displayName: 'Rohan Deshmukh',
      globalRole: 'student' as const,
      status: 'active' as const,
    },
    // Organizer A & B
    {
      email: 'organizer.ras@campus.edu',
      displayName: 'Karan Patel (RAS Lead)',
      globalRole: 'student' as const,
      status: 'active' as const,
      club: 'Robotics & Automation Society (RAS)',
    },
    {
      email: 'organizer.dsc@campus.edu',
      displayName: 'Ananya Roy (DSC Lead)',
      globalRole: 'student' as const,
      status: 'active' as const,
      club: 'Developer Student Club (DSC)',
    },
    // Faculty Reviewer
    {
      email: 'reviewer.faculty@campus.edu',
      displayName: 'Dr. S. Ramanujan (HOD CSE)',
      globalRole: 'reviewer' as const,
      status: 'active' as const,
    },
    // Platform Administrator
    {
      email: 'admin.system@campus.edu',
      displayName: 'Eventora Root Administrator',
      globalRole: 'admin' as const,
      status: 'active' as const,
    },
    // Volunteer
    {
      email: 'volunteer.lead@campus.edu',
      displayName: 'Neha Verma (Volunteer Coordinator)',
      globalRole: 'student' as const,
      status: 'active' as const,
      volunteerStaff: true,
    },
    // Check-in Staff
    {
      email: 'checkin.gate@campus.edu',
      displayName: 'Vikram Joshi (Gate Check-in Staff)',
      globalRole: 'student' as const,
      status: 'active' as const,
      checkinStaff: true,
    },
  ];

  for (const acc of accountsToSeed) {
    let existingUser = await db.query.users.findFirst({
      where: eq(users.email, acc.email),
    });

    if (!existingUser) {
      const [newUser] = await db
        .insert(users)
        .values({
          collegeId: college.id,
          email: acc.email,
          passwordHash: hashedPassword,
          displayName: acc.displayName,
          globalRole: acc.globalRole,
          status: acc.status,
          emailVerifiedAt: new Date(),
        })
        .returning();
      existingUser = newUser;

      // Seed preferences
      await db.insert(userPreferences).values({
        userId: existingUser.id,
        emailEnabled: true,
        inappEnabled: true,
        theme: 'light',
        locale: 'en-IN',
      });

      // Seed organizer clubs if applicable
      if (acc.club) {
        const [profile] = await db
          .insert(organizerProfiles)
          .values({
            collegeId: college.id,
            displayName: acc.club,
            status: 'verified',
            createdBy: existingUser.id,
          })
          .returning();

        await db.insert(organizerMembers).values({
          organizerId: profile.id,
          userId: existingUser.id,
          role: 'owner',
          status: 'active',
        });
      }

      // Seed staff capabilities
      if (acc.checkinStaff) {
        await db.insert(eventStaffAssignments).values({
          eventId: crypto.randomUUID(), // Placeholder event assignment
          userId: existingUser.id,
          capability: 'checkin',
          grantedBy: existingUser.id,
        });
      }

      if (acc.volunteerStaff) {
        await db.insert(eventStaffAssignments).values({
          eventId: crypto.randomUUID(),
          userId: existingUser.id,
          capability: 'volunteer_lead',
          grantedBy: existingUser.id,
        });
      }
    }
  }

  console.log('[Seed] Database successfully seeded with test accounts.');
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
