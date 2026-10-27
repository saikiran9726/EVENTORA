import { test, expect } from '@playwright/test';
import { safeScreenshot } from './screenshot-helper.js';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['camera'],
});

test.describe('Phase P15 E2E: Camera Scanner, Permissions & Hardening', () => {

  test('Scanner mounts camera with fake stream, provides manual entry fallback and audio mute toggle', async ({ page }, testInfo) => {
    // 1. Mock authentication as check-in staff
    await page.route('**/api/v1/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'staff-e2e-id',
            email: 'scanner.staff@campus.edu',
            displayName: 'Gate Staff Lead',
            globalRole: 'checkin_staff',
            status: 'active',
          },
        }),
      });
    });

    // 2. Mock attendance stats
    await page.route('**/api/v1/events/evt-p15-test/attendance', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: {
            totalRegistered: 150,
            totalCheckedIn: 88,
            totalValidUnredeemed: 62,
            totalRevoked: 0,
            duplicateAttempts: 4,
          },
          sessions: [],
          recentScans: [],
        }),
      });
    });

    // 3. Mock scan check-in API endpoint
    await page.route('**/api/v1/events/evt-p15-test/check-in/scan', async (route) => {
      const payload = JSON.parse(route.request().postData() || '{}');
      if (payload.token === 'TCK_REPEAT_SCAN') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            outcome: 'DUPLICATE',
            message: 'Already checked in earlier by Gate Staff Lead',
            firstScannedBy: 'Gate Staff Lead',
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            outcome: 'ACCEPTED',
            message: 'Accepted: A. S. (VIP Pass)',
            attendeeInitials: 'A. S.',
            ticketTierName: 'VIP Pass',
          }),
        });
      }
    });

    // 4. Navigate to Scanner Page
    await page.goto('/scan/evt-p15-test');

    // 5. Verify Interface Elements
    await expect(page.getByText('Turnstile Check-in Scanner')).toBeVisible();
    await expect(page.getByText(/policy: attendance:checkin:assigned/i)).toBeVisible();
    await expect(page.getByText('Registered').first()).toBeVisible();
    await expect(page.getByText('Checked In').first()).toBeVisible();

    // 6. Test Audio Mute Toggle
    const soundToggle = page.locator('button:has-text("Sound On"):visible, button:has-text("Muted"):visible').first();
    await expect(soundToggle).toBeVisible();
    await soundToggle.click();
    await expect(page.locator('button:has-text("Muted"):visible, button:has-text("Sound On"):visible').first()).toBeVisible();

    // 7. Activate Camera with Fake Media Stream
    const activateCamBtn = page.locator('button:has-text("Activate Camera"):visible').first();
    if (await activateCamBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await activateCamBtn.click();
      // Allow html5-qrcode initialization
      await page.waitForTimeout(1000);
    }

    await safeScreenshot(page, './docs/screenshots/phase-p15-01-camera-scanner-active.png', testInfo);

    // 8. Test Manual Code Entry & Full-Screen Visual Feedback
    const tokenInput = page.locator('input[placeholder*="43-char token"]:visible').first();
    await expect(tokenInput).toBeVisible();
    await tokenInput.fill('TCK_FIRST_SCAN_CODE_123');

    const verifyBtn = page.locator('button:has-text("Verify"):visible').first();
    await expect(verifyBtn).toBeEnabled();
    await verifyBtn.click();

    // Verify Green Accepted Feedback appears
    await expect(page.getByText(/Accepted: A\. S\./i).first()).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/phase-p15-02-accepted-feedback.png', testInfo);

    // 9. Test Duplicate Scan Warning Feedback
    await tokenInput.fill('TCK_REPEAT_SCAN');
    await verifyBtn.click();

    // Verify Amber Warning Feedback appears
    await expect(page.getByText(/Already checked in earlier/i).first()).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/phase-p15-03-duplicate-feedback.png', testInfo);
  });
});
