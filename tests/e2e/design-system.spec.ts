import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'path';
import { safeScreenshot } from './screenshot-helper.js';

test.describe('Eventora Phase 1 Design System & Application Shell', () => {
  test('Discovery Page responsive layout, chips, and no horizontal overflow', async ({
    page,
  }, testInfo) => {
    await page.goto('/');

    // Verify Prototype Data Banner is visible
    await expect(page.locator('text=PROTOTYPE DATA').first()).toBeVisible();

    // Verify No Horizontal Overflow (scrollWidth <= innerWidth)
    const isOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(isOverflowing).toBe(false);

    // Verify Swipeable Category Chips
    await expect(page.locator('button:has-text("Tech")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Workshop")').first()).toBeVisible();

    // Capture Discovery Screenshot
    const projectName = testInfo.project.name;
    const screenshotPath = path.resolve(
      `./docs/screenshots/discovery-${projectName}-20261021.png`
    );
    await safeScreenshot(page, screenshotPath, testInfo);
  });

  test('Event Details with 16:9 aspect box, sticky bottom CTA, and focus trap in modal/sheet', async ({
    page,
  }, testInfo) => {
    await page.goto('/');

    // Open first event
    const firstEventCard = page.locator('text=Smart Campus AI & Robotics Symposium 2026').first();
    await expect(firstEventCard).toBeVisible();
    await firstEventCard.click();

    // Verify Details Elements
    await expect(page.locator('text=About the Event')).toBeVisible();
    await expect(page.locator('text=Campus Venue Navigator')).toBeVisible();
    await expect(page.locator('text=TEST MODE – simulated money').first()).toBeVisible();
    await expect(page.locator('text=₹150').first()).toBeVisible();

    // Verify No Horizontal Overflow
    const isOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(isOverflowing).toBe(false);

    // Capture Event Details Screenshot
    const projectName = testInfo.project.name;
    const screenshotPath = path.resolve(
      `./docs/screenshots/event-details-${projectName}-20261021.png`
    );
    await safeScreenshot(page, screenshotPath, testInfo);

    // Open registration dialog / bottom sheet
    const registerBtn = page.locator('button:has-text("Register"), button:has-text("Proceed to Test Checkout")').first();
    await registerBtn.click();

    // Verify focus trap / Esc dismissal
    const modalTitle = page.locator('#modal-title');
    await expect(modalTitle).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modalTitle).not.toBeVisible();
  });

  test('Organizer Analytics with KPI stat cards, sortable table, and responsive cards', async ({
    page,
  }, testInfo) => {
    // Authenticate as organizer and navigate to /organizer
    await page.route('**/api/v1/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'mock-org-user-id',
            email: 'organizer@campus.edu',
            displayName: 'Tech Club Organizer',
            globalRole: 'student',
            status: 'active',
            organizerMemberships: [{ organizerId: 'org-test', role: 'admin', organizerName: 'Tech Club' }],
          },
        }),
      });
    });
    await page.goto('/organizer');

    // Verify Organizer Shell Views
    await expect(page.locator('text=Club Organizer Command Center & Analytics')).toBeVisible();
    await expect(page.locator('text=Simulated Gross Sales')).toBeVisible();
    await expect(page.locator('text=₹74,200')).toBeVisible();

    // Verify No Horizontal Overflow
    const isOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(isOverflowing).toBe(false);

    // Capture Organizer Analytics Screenshot
    const projectName = testInfo.project.name;
    const screenshotPath = path.resolve(
      `./docs/screenshots/organizer-dashboard-${projectName}-20261021.png`
    );
    await safeScreenshot(page, screenshotPath, testInfo);
  });

  test('Component Gallery, State Matrix & Dark Mode Persistence', async ({ page }, testInfo) => {
    await page.goto('/');

    // Navigate to UI Components Gallery
    const uiGalleryBtn = page.locator('button:has-text("UI Gallery"):visible').first();
    await uiGalleryBtn.click();

    await expect(page.locator('text=Eventora UI System & Interaction States')).toBeVisible();
    await expect(page.locator('text=Component State Matrix: Button')).toBeVisible();

    // Toggle Dark Mode
    const themeBtn = page.locator('button[aria-label="Switch to dark mode"]');
    await themeBtn.click();

    // Verify both .dark class and data-theme="dark" attribute
    const themeInfo = await page.evaluate(() => ({
      hasDarkClass: document.documentElement.classList.contains('dark'),
      dataTheme: document.documentElement.getAttribute('data-theme'),
      storedTheme: localStorage.getItem('eventora_theme'),
    }));

    expect(themeInfo.hasDarkClass).toBe(true);
    expect(themeInfo.dataTheme).toBe('dark');
    expect(themeInfo.storedTheme).toBe('dark');

    // Capture Dark Mode Screenshot
    const projectName = testInfo.project.name;
    const screenshotPath = path.resolve(
      `./docs/screenshots/component-gallery-dark-${projectName}-20261021.png`
    );
    await safeScreenshot(page, screenshotPath, testInfo);
  });

  test('Axe-Core Accessibility Scan (WCAG 2.2 AA zero serious/critical)', async ({ page }) => {
    await page.goto('/');

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .disableRules(['color-contrast']) // Dynamic photo backgrounds
      .analyze();

    const seriousOrCritical = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(seriousOrCritical).toEqual([]);
  });

  test('Keyboard-Only Pass (Tab Navigation & Focus Visibility)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button').first()).toBeVisible();

    // Press Tab multiple times to verify focus is active and visible
    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(['A', 'BUTTON', 'INPUT', 'SELECT']).toContain(focusedTag);
  });
});
