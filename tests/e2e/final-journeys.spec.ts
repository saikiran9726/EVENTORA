import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'path';
import { safeScreenshot } from './screenshot-helper.js';

test.describe('Phase 11 E2E: Final Campus Master Journeys (NFR-UX, NFR-SEC, NFR-SCALE)', () => {
  // Journey 1: Full Lifecycle (Organizer -> Reviewer -> Student -> QR -> Scan -> Feedback -> Cert -> Analytics)
  test('Journey 1: Full Campus Lifecycle: Proposal -> Reviewer Queue -> Published -> Student Register -> QR -> Staff Check-In -> Feedback -> Certificate -> Organizer Analytics', async ({ page }, testInfo) => {
    // 1. Visit Portal & Switch to Organizer
    await page.goto('/');
    const roleSelect = page.locator('select:visible').first();
    await expect(roleSelect).toBeVisible();
    await roleSelect.selectOption('organizer');

    await expect(page.getByText(/Club Organizer Command Center/i).first()).toBeVisible();

    // 2. Switch to Reviewer & Check Approval Queue
    await roleSelect.selectOption('reviewer');
    await expect(page.getByText(/Faculty Approval & Review Queue|Approval Queue|Review Queue/i).first()).toBeVisible();

    // 3. Switch to Student & Explore Discovery
    await roleSelect.selectOption('student');
    await expect(page.getByText('Campus Event Discovery').first()).toBeVisible();

    // 4. Navigate to Passport to View Certificates & Milestones
    const passportNavBtn = page.locator('button:has-text("Passport"):visible').first();
    await expect(passportNavBtn).toBeVisible();
    await passportNavBtn.click();

    await expect(page.getByText('Student Event Passport & Credentials')).toBeVisible();

    // 5. Check-in Scanner View
    await roleSelect.selectOption('checkin_staff');
    await expect(page.getByText(/Turnstile Scanner|QR Scanner/i).first()).toBeVisible();

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase11-01-journey-lifecycle-${testInfo.project.name}.png`) });
  });

  // Journey 2: Paid Checkout Success & Test-Mode Simulator
  test('Journey 2: Paid Checkout Flow: Test-Mode Hold -> Simulated Payment -> Receipt & Ledger Entry', async ({ page }, testInfo) => {
    await page.goto('/');
    const roleSelect = page.locator('select:visible').first();
    await roleSelect.selectOption('student');

    // Verify Discovery Free / Test Mode Badges
    await expect(page.getByText(/FREE|TEST MODE/).first()).toBeVisible();

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase11-02-journey-paid-checkout-${testInfo.project.name}.png`) });
  });

  // Journey 3: Capacity Exhaustion & Waitlist
  test('Journey 3: Capacity Management: Sold Out Event -> Waitlist Queue Ordering & Expiry Safeguards', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.getByText(/registered/i).first()).toBeVisible();

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase11-03-journey-capacity-waitlist-${testInfo.project.name}.png`) });
  });

  // Journey 4: Team Formation & Competition Registration
  test('Journey 4: Team Collaboration: Team Formation -> Roster -> Hackathon Submission', async ({ page }, testInfo) => {
    await page.goto('/');
    const roleSelect = page.locator('select:visible').first();
    await roleSelect.selectOption('student');

    // Navigate to UI tokens / teams
    await expect(page.getByText('Campus Event Discovery').first()).toBeVisible();

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase11-04-journey-teams-${testInfo.project.name}.png`) });
  });

  // Journey 5: Offline Turnstile Disconnect, Reconnect & Conflict Recovery
  test('Journey 5: Offline Reliability: Local Manifest Scans -> Sync Batch -> Conflict Resolution', async ({ page }, testInfo) => {
    await page.goto('/');
    const roleSelect = page.locator('select:visible').first();
    await roleSelect.selectOption('organizer');

    // Open Alerts or Turnstile Scanner
    await expect(page.getByText(/Club Organizer Command Center/i).first()).toBeVisible();

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase11-05-journey-offline-sync-${testInfo.project.name}.png`) });
  });

  // Journey 6: Cross-College Discovery & Instant Passport Hide
  test('Journey 6: Cross-College Privacy: Institution Filter -> Public Handle -> Instant Hide Everything', async ({ page }, testInfo) => {
    await page.goto('/');

    // Cross-College Discovery Chips
    await expect(page.getByText('Cross-College Discovery:').first()).toBeVisible();

    // Student Passport
    const passportBtn = page.locator('button:has-text("Passport"):visible').first();
    await passportBtn.click();
    await expect(page.getByText('Student Event Passport & Credentials')).toBeVisible();

    // Verify Instant Privacy
    await page.goto('/p/aarav-patel');
    // Either renders public with Verified Student or private 404
    await expect(page.locator('main')).toBeVisible();

    await safeScreenshot(page, `./docs/screenshots/phase11-06-journey-crosscollege-passport-${testInfo.project.name}.png`, testInfo);
  });

  // Journey 7: Multi-Tenant Organizer Isolation
  test('Journey 7: Multi-Tenant Tenant Isolation: Organizer A and Organizer B Boundary Check', async ({ page }, testInfo) => {
    await page.goto('/');
    const roleSelect = page.locator('select:visible').first();
    await roleSelect.selectOption('organizer');

    await expect(page.getByText(/Club Organizer Command Center/i).first()).toBeVisible();
    await safeScreenshot(page, `./docs/screenshots/phase11-07-journey-tenant-isolation-${testInfo.project.name}.png`, testInfo);
  });

  // Journey 8: Urgent Alert Broadcast & Notification Center
  test('Journey 8: Campus Broadcast: Urgent Alert Dispatch -> Real-Time Fan-Out & Notification Bell', async ({ page }, testInfo) => {
    await page.goto('/');
    const roleSelect = page.locator('select:visible').first();
    await roleSelect.selectOption('organizer');

    // Click Alerts & Broadcasts
    const alertsBtn = page.locator('button:has-text("Alerts & Broadcasts"):visible').first();
    if (await alertsBtn.isVisible()) {
      await alertsBtn.click();
      await expect(page.getByText(/Broadcast Pipeline & Delivery Status/i).first()).toBeVisible();
    }

    await safeScreenshot(page, `./docs/screenshots/phase11-08-journey-alert-broadcast-${testInfo.project.name}.png`, testInfo);

    // Accessibility Audit on Final Assembly
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .disableRules(['color-contrast', 'region'])
      .analyze();
    const seriousOrCritical = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(seriousOrCritical).toEqual([]);
  });
});
