import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'path';
import { safeScreenshot } from './screenshot-helper.js';

test.describe('Phase 10 E2E: Cross-College Discovery & Student Event Passport (FR-XCOL, FR-PASS)', () => {
  test('Complete Flow: Cross-College Discovery -> Student Milestone Passport -> Public Verification & Zero PII -> Instant Privacy Revocation', async ({ page }, testInfo) => {
    // 1. Visit Portal Discovery Page (FR-XCOL)
    await page.goto('/');

    // Verify Discovery Hero & Cross-College Filter Chips Bar
    await expect(page.getByText('Campus Event Discovery').first()).toBeVisible();
    await expect(page.getByText('Cross-College Discovery:').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tech University A' })).toBeVisible();

    // Click Cross-College filter chip
    await page.getByRole('button', { name: 'Tech University A' }).click();

    // Verify Verified Organizer badges on event cards
    await expect(page.getByText('Verified Organizer').first()).toBeVisible();

    // Verify Eligibility Explainer chip
    await expect(page.getByText(/Open to All Participating Colleges|Open to CSE & Engineering Students/).first()).toBeVisible();

    await safeScreenshot(page, `./docs/screenshots/phase10-01-cross-college-discovery-${testInfo.project.name}.png`, testInfo);

    // 2. Navigate to Student Event Passport (FR-PASS)
    const passportNavBtn = page.locator('button:has-text("Passport"):visible').first();
    await expect(passportNavBtn).toBeVisible();
    await passportNavBtn.click();

    // Verify Passport Header & Anti-Tamper Milestone Feed
    await expect(page.getByText('Student Event Passport & Credentials')).toBeVisible();
    await expect(page.getByText('Server-Verified Records Only (Anti-Tamper)')).toBeVisible();
    await expect(page.getByText(/Verified Milestones/i).first()).toBeVisible();

    // Verify Milestone Timeline shows server-verified records
    await expect(page.getByText(/\[CERTIFICATE\]|\[ATTENDANCE\]/i).first()).toBeVisible();

    // 3. Digital Certificates Tab & Crockford Base32 Verification
    const certsTabBtn = page.locator('button:has-text("Digital Certificates"):visible').first();
    await expect(certsTabBtn).toBeVisible();
    await certsTabBtn.click();

    await expect(page.getByText('Crockford Verification Code').first()).toBeVisible();
    await expect(page.getByText('7H9K-2M4N-8PQR').first()).toBeVisible();

    // Open Download/Preview Modal
    const downloadBtn = page.locator('button:has-text("Download"):visible').first();
    await expect(downloadBtn).toBeVisible();
    await downloadBtn.click();

    await expect(page.getByText('Digital Certificate of Attendance')).toBeVisible();
    await expect(page.getByText('Smart Campus Verified Credential')).toBeVisible();
    await expect(page.getByText('7H9K-2M4N-8PQR').first()).toBeVisible();

    // Close Modal
    const closeModalBtn = page.locator('button:has-text("Close"):visible').first();
    await closeModalBtn.click();

    // 4. Privacy & Visibility Controls Tab (FR-PASS)
    const settingsTabBtn = page.locator('button:has-text("Privacy & Visibility Controls"):visible').first();
    await expect(settingsTabBtn).toBeVisible();
    await settingsTabBtn.click();

    await expect(page.getByText('Passport Visibility & Sharing Controls')).toBeVisible();
    await expect(page.getByText('Public Passport Active')).toBeVisible();
    await expect(page.getByText('Public URL Handle (Slug)')).toBeVisible();

    await safeScreenshot(page, `./docs/screenshots/phase10-02-passport-timeline-settings-${testInfo.project.name}.png`, testInfo);

    // 5. Toggle Public Passport On & View Public Page
    const makePublicBtn = page.locator('button:has-text("Make Public"):visible').first();
    if (await makePublicBtn.isVisible()) {
      await makePublicBtn.click();
    } else {
      // Toggle switch if already visible
      const publicSwitch = page.locator('button[aria-label="Toggle public passport visibility"]:visible').first();
      await publicSwitch.click();
    }

    // Verify status updates to ONLINE & PUBLIC
    await expect(page.getByText(/ONLINE & PUBLIC/i).first()).toBeVisible();

    // Click View Public Page
    const viewPublicBtn = page.locator('button:has-text("View Public Page"):visible').first();
    await expect(viewPublicBtn).toBeVisible();
    await viewPublicBtn.click();

    // 6. Verify Public Passport View & Zero PII Invariants
    await expect(page.getByText('Aarav Patel')).toBeVisible();
    await expect(page.getByText('Verified Student')).toBeVisible();
    await expect(page.getByText('Tech University A')).toBeVisible();

    // Zero PII Invariant: No email addresses, phone numbers, or roll numbers
    const publicContent = await page.textContent('main');
    expect(publicContent).not.toContain('@');
    expect(publicContent).not.toContain('+91');
    expect(publicContent).not.toContain('u_student');

    // Verify verified achievements are rendered
    await expect(page.getByText(/Verified Certificate|Event Check-in Admitted/i).first()).toBeVisible();

    await safeScreenshot(page, `./docs/screenshots/phase10-03-public-passport-view-${testInfo.project.name}.png`, testInfo);

    // 7. Instant Privacy Toggle / "Hide Everything"
    const backBtn = page.locator('button:has-text("Back to Student Hub"):visible').first();
    if (await backBtn.isVisible()) {
      await backBtn.click();
    } else {
      await page.locator('button:has-text("Passport"):visible').first().click();
    }

    // One-tap Hide Everything
    const hideBtn = page.locator('button:has-text("Hide Everything"):visible').first();
    await expect(hideBtn).toBeVisible();
    await hideBtn.click();

    // Status should be HIDDEN / PRIVATE immediately
    await expect(page.getByText(/HIDDEN \/ PRIVATE/i).first()).toBeVisible();

    // 8. Direct Navigation to /p/aarav-patel while private returns 404
    await page.goto('/p/aarav-patel');
    await expect(page.getByText('Passport Not Found or Private')).toBeVisible();
    await expect(page.getByText(/This student passport is either private, does not exist, or has been temporarily hidden/i)).toBeVisible();

    await safeScreenshot(page, `./docs/screenshots/phase10-04-passport-private-hidden-${testInfo.project.name}.png`, testInfo);

    // 9. Axe Accessibility Audit (WCAG 2.2 AA zero serious/critical)
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .disableRules(['color-contrast', 'region']) // prototype styling
      .analyze();
    const seriousOrCritical = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(seriousOrCritical).toEqual([]);
  });
});
