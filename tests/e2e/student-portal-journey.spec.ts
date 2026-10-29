import { test, expect } from '@playwright/test';
import { safeScreenshot } from './screenshot-helper.js';

async function mockStudentSession(page: any) {
  await page.route('**/api/v1/me', async (route: any) => {
    const user = {
      id: 'mock-p24-student-id',
      email: 'student.portal@campus.edu',
      displayName: 'Aarav Patel (Student)',
      globalRole: 'student',
      status: 'active',
      department: 'Computer Science & Engineering',
      year: 3,
      college: {
        id: 'mock-col-1',
        name: 'Smart Campus Institute of Technology',
        domain: 'campus.edu',
      },
      organizerMemberships: [],
      staffAssignments: [],
      preferences: {
        emailEnabled: true,
        inappEnabled: true,
        theme: 'light',
        locale: 'en-IN',
      },
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user }),
    });
  });

  await page.route('**/api/v1/me/bookings', async (route: any) => {
    const bookings = [
      {
        id: 'bk-p24-1',
        ticketId: 'tkt-p24-1',
        eventId: 'evt-robotics-2026',
        eventTitle: 'Autonomous Robotics Annual Symposium 2026',
        status: 'CONFIRMED',
        totalPaise: 0,
        createdAt: new Date().toISOString(),
        ticketCode: 'EVT-ROBOT-8921',
        qrPayload: 'https://eventora.campus.edu/verify/EVT-ROBOT-8921',
        startsAt: new Date(Date.now() + 5 * 86400000).toISOString(),
        endsAt: new Date(Date.now() + 5 * 86400000 + 4 * 3600000).toISOString(),
        venueName: 'Sir MV Auditorium',
        isCheckedIn: false,
      },
      {
        id: 'bk-p24-2',
        ticketId: 'tkt-p24-2',
        eventId: 'evt-drone-derby',
        eventTitle: 'National Autonomous Drone Derby',
        status: 'PENDING_PAYMENT',
        totalPaise: 49900,
        createdAt: new Date().toISOString(),
        ticketCode: 'EVT-DRONE-4410',
        startsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
        endsAt: new Date(Date.now() + 10 * 86400000 + 3 * 3600000).toISOString(),
        venueName: 'Central Ground Arena',
      },
      {
        id: 'bk-p24-3',
        ticketId: 'tkt-p24-3',
        eventId: 'evt-past-hackathon',
        eventTitle: 'Inter-College 36-Hour Hackathon 2025',
        status: 'CONFIRMED',
        totalPaise: 25000,
        createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
        ticketCode: 'EVT-HACK-1029',
        startsAt: new Date(Date.now() - 30 * 86400000).toISOString(),
        endsAt: new Date(Date.now() - 28 * 86400000).toISOString(),
        venueName: 'Kalam Seminar Hall',
        isCheckedIn: true,
      },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ bookings }),
    });
  });

  await page.route('**/api/v1/events/evt-robotics-2026/materials', async (route: any) => {
    const materials = [
      {
        id: 'mat-1',
        eventId: 'evt-robotics-2026',
        title: 'ROS2 Node Composition Slides',
        description: 'Comprehensive presentation deck on micro-ROS and robotics perception.',
        fileName: 'ros2-composition-deck.pdf',
        fileSizeBytes: 2450000,
        mimeType: 'application/pdf',
        fileUrl: '#',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'mat-2',
        eventId: 'evt-robotics-2026',
        title: 'Starter Sensor Kit Handout',
        description: 'Wiring diagrams and pinouts for LiDAR breakout boards.',
        fileName: 'sensor-pinout-guide.png',
        fileSizeBytes: 820000,
        mimeType: 'image/png',
        fileUrl: '#',
        createdAt: new Date().toISOString(),
      },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ materials }),
    });
  });

  await page.route('**/api/v1/me/notifications', async (route: any) => {
    const notifications = [
      {
        id: 'notif-1',
        userId: 'mock-p24-student-id',
        type: 'event_alert',
        eventId: 'evt-robotics-2026',
        title: 'Keynote Schedule Confirmed',
        body: 'Opening address by Dean of Robotics begins at 9:30 AM.',
        severity: 'info',
        payload: {},
        readAt: null,
        createdAt: new Date().toISOString(),
      },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ notifications, unreadCount: 1 }),
    });
  });
}

test.describe('Phase P24 E2E: Complete Student Portal Restoration & Journey', () => {
  test('Complete Student Journey: Shell -> My Tickets -> Upcoming/Past -> QR Pass -> Materials -> Resume Payment -> Calendar -> Teams -> Volunteers -> Profile Logout', async ({ page }, testInfo) => {
    await mockStudentSession(page);

    // 1. Visit Student Discovery
    await page.goto('/');
    await expect(page.getByText(/Campus Event Discovery|EVENTORA/i).first()).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/p24-01-student-discovery.png', testInfo);

    // 2. Navigate to Tickets & My Events
    await page.goto('/tickets');
    await expect(page.getByText('My Tickets & Registrations')).toBeVisible();

    // Verify Upcoming Events Tab and status badges
    await expect(page.getByText('Upcoming Events')).toBeVisible();
    await expect(page.getByText('Autonomous Robotics Annual Symposium 2026')).toBeVisible();
    await expect(page.getByText('CONFIRMED')).toBeVisible();

    // Verify Resume-Checkout CTA for Pending Booking
    await expect(page.getByText(/Resume Checkout/i)).toBeVisible();

    // Open Event Materials modal
    const materialsBtn = page.locator('button:has-text("Event Materials")').first();
    await expect(materialsBtn).toBeVisible();
    await materialsBtn.click();

    // Verify materials loaded in modal
    await expect(page.getByText('ROS2 Node Composition Slides')).toBeVisible();
    await expect(page.getByText('Starter Sensor Kit Handout')).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/p24-02-event-materials-modal.png', testInfo);

    // Close Materials modal
    await page.locator('button:has-text("Close")').click();

    // Check Past & Completed Tab
    const pastTabBtn = page.locator('button:has-text("Past & Completed")');
    await pastTabBtn.click();
    await expect(page.getByText('Inter-College 36-Hour Hackathon 2025')).toBeVisible();
    await expect(page.getByText('CHECKED IN')).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/p24-03-past-tickets.png', testInfo);

    // Switch back to Upcoming tab
    await page.locator('button:has-text("Upcoming Events")').click();

    // Open Cancel Registration dialog
    const cancelBtn = page.locator('button:has-text("Cancel")').first();
    await cancelBtn.click();
    await expect(page.getByText(/Cancel Registration & Refund Policy/i)).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/p24-04-cancel-refund-modal.png', testInfo);
    await page.locator('button:has-text("Keep Pass")').click();

    // 3. Navigate to Campus Calendar
    await page.goto('/calendar');
    await expect(page.getByText('Campus Event Calendar')).toBeVisible();
    await expect(page.getByText(/Add Event to Calendar|iCalendar Exported|Agenda|Month/i).first()).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/p24-05-campus-calendar.png', testInfo);

    // 4. Navigate to Teams Hub
    await page.goto('/teams');
    await expect(page.getByText('Team Hub & Hackathons')).toBeVisible();
    await expect(page.getByText('My Teams')).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/p24-06-teams-hub.png', testInfo);

    // 5. Navigate to Volunteer Hub
    await page.goto('/volunteers');
    await expect(page.getByText('Campus Volunteer Hub & Shift Check-In')).toBeVisible();
    await expect(page.getByText(/Verified Service|My Shifts/i).first()).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/p24-07-volunteer-hub.png', testInfo);

    // 6. Navigate to Passport
    await page.goto('/passport');
    await expect(page.getByText(/Student Event Passport & Credentials|Verified Student|Credentials/i).first()).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/p24-08-student-passport.png', testInfo);

    // 7. Notification Bell Feed
    const bellBtn = page.locator('button[aria-label="View notifications"]').first();
    await bellBtn.click();
    await expect(page.getByText('Notifications')).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/p24-09-notifications-drawer.png', testInfo);
    await page.locator('button[aria-label="Close notification center"]').click();

    // 8. Profile & Preferences & Sign Out
    await page.goto('/profile');
    await expect(page.getByText('Account & Preferences')).toBeVisible();
    await expect(page.getByText('Aarav Patel (Student)')).toBeVisible();
    await expect(page.getByText('Computer Science & Engineering')).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/p24-10-profile-preferences.png', testInfo);

    // Click Sign Out
    const signOutBtn = page.locator('button:has-text("Sign Out")').first();
    await expect(signOutBtn).toBeVisible();
    await signOutBtn.click();
    await expect(page).toHaveURL(/\/(login)?$/);
  });
});
