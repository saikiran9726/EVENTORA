import { test, expect } from '@playwright/test';
import { safeScreenshot } from './screenshot-helper.js';

test.describe('Phase P10 E2E: Free and Paid Event Proposal Wizard', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as active club organizer
    await page.route('**/api/v1/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'mock-org-user-p10',
            email: 'organizer.ras@campus.edu',
            displayName: 'Robotics Society Organizer',
            globalRole: 'student',
            status: 'active',
            collegeId: '11111111-1111-1111-1111-111111111111',
            organizerMemberships: [
              {
                organizerId: '22222222-2222-2222-2222-222222222222',
                role: 'lead',
                organizerName: 'Robotics & Automation Society',
              },
            ],
          },
        }),
      });
    });
  });

  test('Creates a Free Event proposal with server draft save and no payment screen', async ({ page }, testInfo) => {
    // 1. Visit Organizer Command Center
    await page.goto('/organizer');
    await expect(page.getByText('Club Organizer Command Center & Analytics')).toBeVisible();

    // 2. Click Propose Event button
    const proposeBtn = page.getByRole('button', { name: /propose event/i });
    await proposeBtn.click();

    await expect(page.getByText('Create Campus Event Proposal')).toBeVisible();
    await expect(page.getByText('Step 1: Basic Event Information')).toBeVisible();

    // 3. Fill Step 1
    const freeTitle = `Free Open Source Hackathon ${Date.now().toString().slice(-4)}`;
    await page.fill('input[placeholder*="Smart Campus AI"]', freeTitle);
    await page.fill(
      'textarea[placeholder*="Detailed event description"]',
      'A completely free student hackathon focused on open source software contributions and campus impact.'
    );

    // Test Server-Side Draft Save (Rule 5: No localStorage)
    const saveDraftBtn = page.getByRole('button', { name: /save draft/i });
    await expect(saveDraftBtn).toBeVisible();

    // Verify localStorage draft is NOT used
    const localDraft = await page.evaluate(() => localStorage.getItem('eventora_event_draft'));
    expect(localDraft).toBeNull();

    await page.click('button:has-text("Next: Venue & Schedule")');

    // 4. Step 2: Schedule & Venue with IST Timezone Display
    await expect(page.getByText('Step 2: Schedule & Campus Venue Booking')).toBeVisible();
    await expect(page.getByText(/IST \/ Indian Standard Time, UTC\+5:30/i).first()).toBeVisible();

    const tomorrow = new Date(Date.now() + 86400000);
    const tomorrowStr = tomorrow.toISOString().slice(0, 16);
    const tomorrowEnd = new Date(Date.now() + 86400000 + 14400000);
    const tomorrowEndStr = tomorrowEnd.toISOString().slice(0, 16);

    const startInput = page.locator('input[type="datetime-local"]').first();
    const endInput = page.locator('input[type="datetime-local"]').nth(1);
    await startInput.fill(tomorrowStr);
    await endInput.fill(tomorrowEndStr);

    await page.click('button:has-text("Next: Capacity")');

    // 5. Step 3: Pricing & Capacity
    await expect(page.getByText(/Step 3: Capacity/i)).toBeVisible();
    await expect(page.getByText('Event Pricing Model')).toBeVisible();

    // Select Free Registration segmented button
    const freeBtn = page.getByRole('button', { name: /\[ Free \]/i });
    await expect(freeBtn).toBeVisible();
    await freeBtn.click();

    // Verify Free Event explanatory note
    await expect(
      page.getByText(/Free Event: Attendees can register instantly/i)
    ).toBeVisible();

    await safeScreenshot(page, './docs/screenshots/p10-free-event-wizard.png', testInfo);

    // 6. Submit Proposal
    const submitBtn = page.getByRole('button', { name: /submit proposal for faculty review/i });
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // Verify draft not in localStorage after submit
    const finalLocalDraft = await page.evaluate(() => localStorage.getItem('eventora_event_draft'));
    expect(finalLocalDraft).toBeNull();
  });

  test('Creates a Paid Event proposal with ₹ to integer paise conversion and currency INR', async ({ page }, testInfo) => {
    await page.goto('/organizer');
    await expect(page.getByText('Club Organizer Command Center & Analytics')).toBeVisible();

    const proposeBtn = page.getByRole('button', { name: /propose event/i });
    await proposeBtn.click();

    await expect(page.getByText('Create Campus Event Proposal')).toBeVisible();

    // Step 1
    const paidTitle = `Advanced Drone Workshop ${Date.now().toString().slice(-4)}`;
    await page.fill('input[placeholder*="Smart Campus AI"]', paidTitle);
    await page.fill(
      'textarea[placeholder*="Detailed event description"]',
      'An intensive paid certification workshop covering drone assembly, flight controllers, and avionics.'
    );
    await page.click('button:has-text("Next: Venue & Schedule")');

    // Step 2
    await expect(page.getByText('Step 2: Schedule & Campus Venue Booking')).toBeVisible();
    const nextWeek = new Date(Date.now() + 7 * 86400000);
    const nextWeekStr = nextWeek.toISOString().slice(0, 16);
    const nextWeekEnd = new Date(Date.now() + 7 * 86400000 + 14400000);
    const nextWeekEndStr = nextWeekEnd.toISOString().slice(0, 16);

    const startInput = page.locator('input[type="datetime-local"]').first();
    const endInput = page.locator('input[type="datetime-local"]').nth(1);
    await startInput.fill(nextWeekStr);
    await endInput.fill(nextWeekEndStr);
    await page.click('button:has-text("Next: Capacity")');

    // Step 3
    await expect(page.getByText(/Step 3: Capacity/i)).toBeVisible();

    // Select Paid Mode
    const paidBtn = page.getByRole('button', { name: /\[ Paid \]/i });
    await paidBtn.click();

    // Verify INR Currency Indicator
    await expect(page.getByText(/Allowed Currency: INR/i)).toBeVisible();

    // Input ₹ 499.50 and assert calculated integer paise helper
    const priceInput = page.locator('input[placeholder="250"]');
    await priceInput.fill('499.50');

    // Expect live paise calculation: 49,950 paise
    await expect(page.getByText(/49,950 paise/i)).toBeVisible();

    await safeScreenshot(page, './docs/screenshots/p10-paid-event-wizard.png', testInfo);

    // Verify Proposal Summary displays Paid status
    await expect(page.getByText('Paid / Ticketed', { exact: true })).toBeVisible();
  });
});
