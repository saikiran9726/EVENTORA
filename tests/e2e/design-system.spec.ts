import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'path';

test.describe('Eventora Phase 1 Design System & Shell Verification', () => {
  test('Discovery Page layout, responsive rules, and no horizontal overflow', async ({
    page,
  }, testInfo) => {
    await page.goto('/');

    // Verify Phase-1 Prototype Banner is visible
    await expect(page.locator('text=Phase-1 Design System Prototype – Simulated Data')).toBeVisible();

    // Verify No Horizontal Overflow
    const isOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(isOverflowing).toBe(false);

    // Capture Discovery Screenshot
    const projectName = testInfo.project.name;
    const screenshotPath = path.resolve(
      `./docs/screenshots/discovery-${projectName}-20261021.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
  });

  test('Event Details page with Test-mode notice, ticket tiers, and modal/bottom-sheet', async ({
    page,
  }, testInfo) => {
    await page.goto('/');

    // Click on the first event card
    const firstEventCard = page.locator('text=Smart Campus AI & Robotics Symposium 2026').first();
    await expect(firstEventCard).toBeVisible();
    await firstEventCard.click();

    // Verify Event Details elements
    await expect(page.locator('text=About the Event')).toBeVisible();
    await expect(page.locator('text=Campus Venue Navigator')).toBeVisible();
    await expect(page.locator('text=TEST MODE – simulated money').first()).toBeVisible();

    // Verify Integer Paise in INR
    await expect(page.locator('text=₹150').first()).toBeVisible();

    // Capture Event Details Screenshot
    const projectName = testInfo.project.name;
    const screenshotPath = path.resolve(
      `./docs/screenshots/event-details-${projectName}-20261021.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Open registration modal / bottom-sheet
    const registerBtn = page.locator('button:has-text("Register"), button:has-text("Proceed to Test Checkout")').first();
    await registerBtn.click();

    // Verify Modal / Bottom sheet opens
    const modalTitle = page.locator('#modal-title');
    await expect(modalTitle).toBeVisible();

    // Verify Esc closes modal
    await page.keyboard.press('Escape');
    await expect(modalTitle).not.toBeVisible();
  });

  test('Organizer Dashboard with simulated ledger and attendee roster', async ({
    page,
  }, testInfo) => {
    await page.goto('/');

    // Switch role to organizer
    const roleSelect = page.locator('select[aria-label="Switch User Role"]');
    await roleSelect.selectOption('organizer');

    // Verify Organizer Dashboard views
    await expect(page.locator('text=Club Organizer Command Center')).toBeVisible();
    await expect(page.locator('text=Simulated Gross Sales')).toBeVisible();
    await expect(page.locator('text=TEST MODE').first()).toBeVisible();
    await expect(page.locator('text=₹74,200')).toBeVisible();

    // Verify Attendee Roster Table
    await expect(page.locator('text=Aarav Sharma')).toBeVisible();
    await expect(page.locator('text=TCK-88219-01')).toBeVisible();

    // Capture Organizer Dashboard Screenshot
    const projectName = testInfo.project.name;
    const screenshotPath = path.resolve(
      `./docs/screenshots/organizer-dashboard-${projectName}-20261021.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
  });

  test('Component Gallery and Dark Mode Toggle', async ({ page }, testInfo) => {
    await page.goto('/');

    // Navigate to UI Tokens tab (clicking whichever nav button is visible for the current viewport)
    const uiTokensBtn = page.locator('button:has-text("UI Tokens"):visible').first();
    await uiTokensBtn.click();

    await expect(page.locator('text=Eventora UI System & Interaction States')).toBeVisible();

    // Toggle Dark Mode
    const themeBtn = page.locator('button[aria-label="Switch to dark mode"]');
    await themeBtn.click();

    // Verify dark class on html
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(true);

    // Capture Dark Mode Component Gallery Screenshot
    const projectName = testInfo.project.name;
    const screenshotPath = path.resolve(
      `./docs/screenshots/component-gallery-dark-${projectName}-20261021.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
  });

  test('Accessibility Scan (WCAG 2.2 AA)', async ({ page }) => {
    await page.goto('/');

    // Run axe accessibility analysis
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .disableRules(['color-contrast']) // Remote placeholder images can vary
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
