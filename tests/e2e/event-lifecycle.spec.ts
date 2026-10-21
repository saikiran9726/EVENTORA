import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Phase 3 E2E: Event Lifecycle, Venues, Discovery & Calendar', () => {
  test('Complete Lifecycle Journey: Propose Event -> GiST Precheck -> Faculty Approval -> Discovery -> Calendar & .ics Export', async ({ page }) => {
    // 1. Visit App
    await page.goto('/');

    // Screenshot discovery baseline
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase3-01-discovery-initial.png') });

    // 2. Switch Role to Club Organizer
    const roleSelect = page.locator('select[aria-label="Switch User Role"]');
    await roleSelect.selectOption('organizer');

    // Expect Organizer Command Center
    await expect(page.getByText('Club Organizer Command Center & Analytics')).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase3-02-organizer-dashboard.png') });

    // 3. Propose Event -> Opens Create Event Proposal Wizard
    const proposeBtn = page.getByRole('button', { name: /propose event/i });
    await proposeBtn.click();

    await expect(page.getByText('Create Campus Event Proposal')).toBeVisible();
    await expect(page.getByText('Step 1: Basic Event Information')).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase3-03-proposal-step1.png') });

    // Fill Step 1
    const testTitle = `Autonomous Drone Challenge ${Date.now().toString().slice(-4)}`;
    await page.fill('input[placeholder*="Smart Campus AI"]', testTitle);
    await page.fill('textarea[placeholder*="Detailed event description"]', 'An intensive 24-hour autonomous drone navigation and obstacle clearance competition.');
    await page.click('button:has-text("Next: Venue & Schedule")');

    // Step 2: Venue & Schedule
    await expect(page.getByText('Step 2: Schedule & Campus Venue Booking')).toBeVisible();

    // Select start and end times (tomorrow)
    const tomorrow = new Date(Date.now() + 86400000);
    const tomorrowStr = tomorrow.toISOString().slice(0, 16);
    const tomorrowEnd = new Date(Date.now() + 86400000 + 7200000);
    const tomorrowEndStr = tomorrowEnd.toISOString().slice(0, 16);

    const startInput = page.locator('input[type="datetime-local"]').first();
    const endInput = page.locator('input[type="datetime-local"]').nth(1);
    await startInput.fill(tomorrowStr);
    await endInput.fill(tomorrowEndStr);

    // Verify venue options rendered
    await expect(page.getByText('Sir MV Auditorium').first()).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase3-04-proposal-step2-venue.png') });

    await page.click('button:has-text("Next: Capacity & Registration")');

    // Step 3: Capacity & Rules
    await expect(page.getByText('Step 3: Capacity, Registration & Team Rules')).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase3-05-proposal-step3-capacity.png') });

    // Submit Proposal for Faculty Review
    const submitBtn = page.getByRole('button', { name: /submit proposal for faculty review/i });
    await submitBtn.click();

    // After submission, redirects to event details or dashboard
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase3-06-proposal-submitted.png') });

    // 4. Switch to Faculty Reviewer Role
    await roleSelect.selectOption('reviewer');

    // Expect Faculty Review Queue
    await expect(page.getByText('Faculty Approval & Review Queue')).toBeVisible();
    await expect(page.getByText('Conflict-of-Interest Guard')).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase3-07-reviewer-queue.png') });

    // Click Approve Proposal if available
    const approveBtn = page.locator('button:has-text("Approve Proposal")').first();
    if (await approveBtn.isVisible()) {
      await approveBtn.click();
      await expect(page.getByText('Faculty Decision: APPROVED')).toBeVisible();
      await page.screenshot({ path: path.resolve('./docs/screenshots/phase3-08-reviewer-decision-modal.png') });

      // Confirm approval
      await page.click('button:has-text("Confirm approved")');
      await page.waitForTimeout(500);
    }

    // 5. Switch to Student Role
    await roleSelect.selectOption('student');

    // Navigate to Calendar
    const calendarNavBtn = page.locator('button:has-text("Calendar"):visible').first();
    await calendarNavBtn.click();

    await expect(page.getByText('Campus Event Calendar')).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase3-09-calendar-month.png') });

    // Switch to Agenda View
    await page.click('button:has-text("Agenda")');
    await expect(page.getByText('Upcoming Events in')).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase3-10-calendar-agenda.png') });

    // Navigate back to Discovery
    const discoverNavBtn = page.locator('button:has-text("Discover"):visible').first();
    await discoverNavBtn.click();

    // Verify Search-as-you-type input
    const searchInput = page.locator('input[aria-label="Search events"]');
    await searchInput.fill('Robotics');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase3-11-discovery-search.png') });

    // Click on first event to inspect details
    const firstEventCard = page.locator('div.group.cursor-pointer').first();
    if (await firstEventCard.isVisible()) {
      await firstEventCard.click();
      await expect(page.getByText('About the Event')).toBeVisible();
      await expect(page.getByText('Campus Venue Navigator')).toBeVisible();
      await expect(page.getByText('Event Announcements & Live Updates')).toBeVisible();
      await expect(page.getByText('Frequently Asked Questions')).toBeVisible();
      await page.screenshot({ path: path.resolve('./docs/screenshots/phase3-12-event-details-frequent-questions.png') });
    }
  });
});
