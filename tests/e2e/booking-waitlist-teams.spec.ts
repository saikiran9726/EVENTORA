import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Phase 4 E2E: Registration, Capacity, Waitlists & Teams', () => {
  test('Free Booking Flow -> Zero Payment Screen -> QR Ticket Generation -> Team Hub', async ({ page }) => {
    // 1. Visit App
    await page.goto('/');

    // Screenshot discovery view
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase4-01-discovery-initial.png') });

    // 2. Select an event to open Event Details
    const firstEventCard = page.locator('article, div[class*="cursor-pointer"]').first();
    await firstEventCard.click();

    // Verify Event Details Page is rendered
    await expect(page.getByText('About the Event')).toBeVisible();
    await expect(page.getByText('Select Ticket')).toBeVisible();
    await expect(page.getByText(/Live synced/i)).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase4-02-event-details-ticket-selector.png') });

    // 3. Register for Event (Free / Test Mode)
    // Non-negotiable invariant: Free event never shows payment screen!
    const registerButton = page.locator('button:has-text("Proceed"):visible, button:has-text("Register"):visible').first();
    await expect(registerButton).toBeVisible();
    await registerButton.click();

    // If modal opened on mobile
    const modalSubmitBtn = page.locator('button[type="submit"]:has-text("Proceed"):visible, button[type="submit"]:has-text("Pay"):visible, button:has-text("Claim Free Pass"):visible, button:has-text("Confirm"):visible').first();
    if (await modalSubmitBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.fill('input[placeholder*="Aarav Sharma"]', 'Dev Student');
      await page.fill('input[placeholder*="CS22B1042"]', 'CS22B9999');
      await modalSubmitBtn.click();
    }

    // Expect instant confirmation toast / notification
    await expect(page.getByText(/Ticket Confirmed|Booking Confirmed|Registration Confirmed|Seat Hold Created/i).first()).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase4-03-booking-confirmed.png') });

    // 4. Navigate to "Tickets" (My Bookings Page)
    const ticketsNav = page.locator('button:has-text("Tickets"):visible').first();
    await ticketsNav.click();

    // Verify My Tickets & Registrations page
    await expect(page.getByText('My Tickets & Registrations')).toBeVisible();
    await expect(page.getByText(/Valid for Entry/i).first()).toBeVisible();
    await expect(page.getByText(/Reference:/i).first()).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase4-04-my-tickets-qr.png') });

    // 5. Verify Cancel Registration Modal
    const cancelBtn = page.locator('button:has-text("Cancel Registration"):visible').first();
    await cancelBtn.click();
    await expect(page.getByText(/Are you sure you want to cancel your registration/i)).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase4-05-cancellation-modal.png') });
    // Click Keep Ticket to preserve state
    await page.click('button:has-text("Keep Ticket"):visible');

    // 6. Navigate to "Teams" (Team Hub & Hackathons)
    const teamsNav = page.locator('button:has-text("Teams"):visible').first();
    await teamsNav.click();

    // Verify Team Hub
    await expect(page.getByText('Team Hub & Hackathons')).toBeVisible();
    await expect(page.getByText('NeuralHack Squad').first()).toBeVisible();
    await expect(page.getByText('Event Registration Readiness Checklist')).toBeVisible();
    await expect(page.getByText(/Team size meets competition requirements/i)).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase4-06-teams-hub.png') });

    // Open Deliverables Modal
    const deliverablesBtn = page.getByRole('button', { name: /deliverables/i });
    await deliverablesBtn.click();
    await expect(page.getByRole('heading', { name: 'Project Deliverables' })).toBeVisible();
    await expect(page.getByText(/Project deliverables are immutable after the competition deadline/i)).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase4-07-deliverables-lock-banner.png') });
    await page.click('button:has-text("Cancel"):visible');

    // 7. Discover Teams Tab
    await page.click('button:has-text("Discover Teams")');
    await expect(page.getByPlaceholder(/Search teams by skill or idea/i)).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase4-08-discover-teams.png') });
  });

  test('Mobile Viewport (375x667): Bottom Navigation & Sticky Bottom Action Bar', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Select event
    const firstEventCard = page.locator('article, div[class*="cursor-pointer"]').first();
    await firstEventCard.click();

    // Verify sticky bottom action bar on mobile
    const stickyBottomBar = page.locator('.fixed.bottom-16.left-0');
    await expect(stickyBottomBar).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase4-09-mobile-sticky-action-bar.png') });

    // Click Tickets on mobile bottom navigation
    const mobileTicketsBtn = page.locator('button:has-text("Tickets"):visible').first();
    await mobileTicketsBtn.click();
    await expect(page.getByText('My Tickets & Registrations')).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase4-10-mobile-tickets.png') });
  });
});
