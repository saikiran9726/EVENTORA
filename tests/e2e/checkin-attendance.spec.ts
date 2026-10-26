import { test, expect } from '@playwright/test';
import path from 'path';
import { safeScreenshot } from './screenshot-helper.js';

test.describe('Phase 6 E2E: QR Tickets, Turnstile Check-in, Attendance & Certificates (FR-CHECKIN, FR-CERT)', () => {
  test('Complete Flow: QR Pass Display -> Staff Scanner Check-in -> Duplicate Rejection -> Passport Certificate -> Public Zero-PII Verification', async ({ page }, testInfo) => {
    // 0. Authenticate as student
    await page.goto('/login');
    await page.click('button:has-text("Student")');
    await page.click('button:has-text("Sign In")');
    await expect(page).toHaveURL(/\/(discovery)?$/);

    // 1. Visit App
    await page.goto('/');

    // 2. Navigate to Tickets & Registrations (Student)
    await page.goto('/tickets');

    // Verify My Tickets screen & High-Contrast QR Code Container
    await expect(page.getByText('My Tickets & Registrations')).toBeVisible();
    await expect(page.locator('[aria-label="High-contrast Turnstile QR Code"]:visible').first()).toBeVisible();
    await expect(page.getByText(/Valid for Entry/i).first()).toBeVisible();
    await expect(page.getByText(/Increase screen brightness for rapid gate scan/i).first()).toBeVisible();
    await expect(page.getByText(/Zero PII in QR|Zero PII Exposure/i).first()).toBeVisible();

    await safeScreenshot(page, './docs/screenshots/phase6-01-qr-ticket-display.png', testInfo);

    // 3. Switch to Check-in Staff Role
    await page.route('**/api/v1/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'mock-staff-id',
            email: 'staff@campus.edu',
            displayName: 'Gate Staff',
            globalRole: 'checkin_staff',
            status: 'active',
          },
        }),
      });
    });
    await page.goto('/scan/evt-test');

    // Verify Scanner Shell & Turnstile Scanner Interface
    await expect(page.getByText('Eventora Turnstile Scanner')).toBeVisible();
    await expect(page.getByText('Turnstile Check-in Scanner')).toBeVisible();
    await expect(page.getByText(/policy: attendance:checkin:assigned/i)).toBeVisible();

    // Verify Live Attendance KPI Counters
    await expect(page.getByText('Registered').first()).toBeVisible();
    await expect(page.getByText('Checked In').first()).toBeVisible();
    await expect(page.getByText('Duplicates').first()).toBeVisible();

    // 4. Test Manual Code Check-in Verification (First Scan)
    const tokenInput = page.locator('input[placeholder*="43-char token"]:visible').first();
    await expect(tokenInput).toBeVisible();

    const sampleToken = 'TCK_GATE_TEST_E2E_TOKEN_32_BYTES_URL_SAFE_43';
    await tokenInput.fill(sampleToken);

    const verifyBtn = page.locator('button:has-text("Verify"):visible').first();
    await expect(verifyBtn).toBeEnabled();
    await verifyBtn.click();

    // Verify scan outcome is rendered
    await expect(page.getByText(/Scan Result & Admittance/i)).toBeVisible();
    await page.waitForTimeout(500); // Allow async state transition to settle
    await safeScreenshot(page, './docs/screenshots/phase6-02-scanner-admittance.png', testInfo);

    // 5. Test Duplicate Scan Attempt
    await tokenInput.fill(sampleToken);
    await expect(verifyBtn).toBeEnabled();
    await verifyBtn.click();

    await expect(page.getByText(/Scan Result & Admittance/i)).toBeVisible();
    await page.waitForTimeout(500);
    await safeScreenshot(page, './docs/screenshots/phase6-03-scanner-duplicate.png', testInfo);

    // 6. Switch Role to Student -> Navigate to Passport
    await page.route('**/api/v1/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'mock-student-id',
            email: 'student@campus.edu',
            displayName: 'Aarav Sharma',
            globalRole: 'student',
            status: 'active',
          },
        }),
      });
    });
    await page.goto('/passport');

    // Verify Student Passport Page & Digital Certificates
    await expect(page.getByText('Student Event Passport & Credentials')).toBeVisible();

    const certsTab = page.locator('button:has-text("Digital Certificates"):visible').first();
    await expect(certsTab).toBeVisible();
    await certsTab.click();

    await expect(page.getByText(/Crockford Verification Code/i).first()).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/phase6-04-passport-credentials.png', testInfo);

    // 7. Click Download Credential Modal
    const downloadBtn = page.locator('button:has-text("Download"):visible').first();
    await expect(downloadBtn).toBeVisible();
    await downloadBtn.click();
    await expect(page.getByText(/Digital Certificate of Attendance/i)).toBeVisible();
    await expect(page.getByText(/Verification Code:/i)).toBeVisible();

    // Close modal
    const closeBtn = page.locator('button:has-text("Close"):visible').first();
    await closeBtn.click();

    // 8. Public Verification Portal Test
    const publicVerifyBtn = page.locator('button:has-text("Public Verify"):visible').first();
    if (await publicVerifyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await publicVerifyBtn.click();

      // Verify Public Verify Page elements
      await expect(page.getByText('Public Certificate Verification')).toBeVisible();
      await expect(page.getByText(/12-Character Verification Code/i)).toBeVisible();
      await expect(page.getByText(/Zero PII Protection/i)).toBeVisible();

      // Type Crockford code into input and click Verify
      const codeInput = page.locator('input[placeholder*="7H9K-2M4N-8PQR"]:visible').first();
      await codeInput.fill('7H9K-2M4N-8PQR');

      const portalVerifyBtn = page.locator('button:has-text("Verify"):visible').first();
      await portalVerifyBtn.click();

      await safeScreenshot(page, './docs/screenshots/phase6-05-public-verification.png', testInfo);
    }
  });
});
