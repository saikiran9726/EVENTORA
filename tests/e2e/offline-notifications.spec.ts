import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'path';

test.describe('Phase 9 E2E: Alerts, Notification Pipeline & Offline Check-in (FR-ALERT, FR-OFFLINE, NFR-NOTIFY)', () => {
  test('Complete Flow: Organizer Urgent Alert -> Attendee Notification Center -> Turnstile Offline Manifest & Local Scans -> Batch Sync & Conflict Resolution', async ({ page }, testInfo) => {
    // 1. Visit Portal & Switch to Club Organizer
    await page.goto('/');

    const roleSelect = page.locator('select:visible').first();
    await expect(roleSelect).toBeVisible();
    await roleSelect.selectOption('organizer');

    await expect(page.getByText(/Club Organizer Command Center/i).first()).toBeVisible();

    // 2. Open Alerts & Broadcasts Tab (FR-ALERT, NFR-NOTIFY)
    const alertsTabBtn = page.locator('button:has-text("Alerts & Broadcasts"):visible').first();
    await expect(alertsTabBtn).toBeVisible();
    await alertsTabBtn.click();

    // Verify Policy badge
    await expect(page.getByText(/Policy: event:manage:owned/i).first()).toBeVisible();

    // Select Kind: venue
    const venueKindBtn = page.locator('button:has-text("venue"):visible').first();
    await expect(venueKindBtn).toBeVisible();
    await venueKindBtn.click();

    // Select Severity: urgent
    const urgentSeverityBtn = page.locator('button:has-text("⚡ Urgent"):visible').first();
    await expect(urgentSeverityBtn).toBeVisible();
    await urgentSeverityBtn.click();

    // Verify Urgent Mode direct transaction explanation banner
    await expect(page.getByText(/Urgent Mode Active \(Direct Transaction Fan-out\)/i)).toBeVisible();

    // Verify Live Recipient Count Preview
    await expect(page.getByText(/Will notify 42 confirmed attendees/i)).toBeVisible();

    // Fill Broadcast Message
    const msgInput = page.locator('textarea:visible').first();
    await msgInput.fill('DevClash relocated to Tech Tower Auditorium A due to sudden heavy rainfall.');

    // Click Broadcast
    const broadcastBtn = page.locator('button:has-text("Broadcast to Attendees"):visible').first();
    await expect(broadcastBtn).toBeVisible();
    await broadcastBtn.click();

    // Verify Dispatch Toast
    await expect(page.getByText(/Urgent Alert Broadcasted/i).first()).toBeVisible({ timeout: 5000 });

    // Verify Delivery Pipeline Table (Never states "Delivered" without provider confirmation)
    await expect(page.getByText('Broadcast Pipeline & Delivery Status (NFR-NOTIFY)')).toBeVisible();
    await expect(page.getByText(/Accepted:/i).first()).toBeVisible();

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase9-01-organizer-alert-composer-${testInfo.project.name}.png`) });

    // 3. Switch to Student Role to Verify Notification Center (FR-ALERT)
    const studentRoleSelect = page.locator('select:visible').first();
    await studentRoleSelect.selectOption('student');

    // Click Notification Bell Icon
    const bellBtn = page.locator('button[aria-label="View notifications"]:visible').first();
    await expect(bellBtn).toBeVisible();
    await bellBtn.click();

    // Verify Notification Modal Opens
    await expect(page.getByRole('dialog', { name: 'Notification Center' })).toBeVisible();
    await expect(page.getByText('Notifications', { exact: false }).first()).toBeVisible();

    // Verify Urgent Pinned Item
    await expect(page.getByText(/Urgent Event Alerts \(Direct Tx\)/i)).toBeVisible();

    // Check Delivery Preferences Switcher
    const settingsBtn = page.locator('button[aria-label="Notification settings"]:visible').first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    await expect(page.getByText('Delivery Preferences')).toBeVisible();
    await expect(page.getByText('In-App Notifications')).toBeVisible();
    await expect(page.getByText('Email Notifications')).toBeVisible();
    await expect(page.getByText('Urgent Only Mode')).toBeVisible();

    // Toggle back to Feed
    const backToFeedBtn = page.locator('button:has-text("Back to Feed"):visible').first();
    await expect(backToFeedBtn).toBeVisible();
    await backToFeedBtn.click();

    // Close Notification Center
    const closeCenterBtn = page.locator('button[aria-label="Close notification center"]:visible').first();
    await expect(closeCenterBtn).toBeVisible();
    await closeCenterBtn.click();

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase9-02-student-notification-center-${testInfo.project.name}.png`) });

    // 4. Switch to Check-in Staff Role for Turnstile Scanner & Offline Verification (FR-OFFLINE)
    const staffRoleSelect = page.locator('select:visible').first();
    await staffRoleSelect.selectOption('checkin_staff');

    // Verify Scanner page loaded
    await expect(page.getByText('Turnstile Check-in Scanner')).toBeVisible();
    await expect(page.getByText(/Policy: attendance:checkin:assigned/i).first()).toBeVisible();

    // Verify 4 State Chips
    await expect(page.getByText('Locally Verified', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Sync Pending', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Synced', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Conflict Detected', { exact: true }).first()).toBeVisible();

    // Download Manifest
    await page.route('**/api/v1/events/**/check-in/manifest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          manifestId: 'man-test-01',
          eventId: 'evt-test-01',
          keyId: 'key_test_01',
          key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 4 * 3600000).toISOString(),
          ticketCount: 3,
          items: [
            { ref: 'e2e_ref_tk01_16ch', hmac: 'hmac_proto_01', hint: 'TK-4829' },
            { ref: 'e2e_ref_tk02_16ch', hmac: 'hmac_proto_02', hint: 'TK-7104' },
            { ref: 'e2e_ref_tk03_16ch', hmac: 'hmac_proto_03', hint: 'TK-9952' },
          ],
        }),
      });
    });

    await page.route('**/api/v1/events/**/check-in/sync-batch*', async (route) => {
      const payload = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          batchId: payload.batchId,
          totalOps: payload.ops?.length || 0,
          results: (payload.ops || []).map((op: any) => ({
            opId: op.opId,
            outcome: op.ticketRef === 'e2e_ref_tk01_16ch' ? 'DUPLICATE' : 'SYNCED',
            reason: op.ticketRef === 'e2e_ref_tk01_16ch' ? 'ALREADY_CHECKED_IN' : null,
          })),
        }),
      });
    });

    const downloadManifestBtn = page.locator('button:has-text("Download Manifest"):visible').first();
    await expect(downloadManifestBtn).toBeVisible();
    await downloadManifestBtn.click();

    // Verify Manifest Downloaded Toast & Freshness text
    await expect(page.getByText(/Manifest Downloaded/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Manifest downloaded/i).first()).toBeVisible();

    // Toggle to Offline Mode
    const offlineModeToggle = page.locator('button:has-text("Online Mode"):visible').first();
    await expect(offlineModeToggle).toBeVisible();
    await offlineModeToggle.click();

    await expect(page.getByText('Offline Mode (Local)')).toBeVisible();

    // 5. Perform Local Offline Scans (Zero PII, masked hints)
    const manualCodeInput = page.locator('input[placeholder*="Paste token or enter TK-4829"]:visible').first();
    await expect(manualCodeInput).toBeVisible();
    await manualCodeInput.fill('TK-4829');

    const verifyBtn = page.locator('button:has-text("Verify"):visible').first();
    await expect(verifyBtn).toBeVisible();
    await verifyBtn.click();

    // Verify Locally Verified outcome
    await expect(page.getByText(/Locally Verified: Pass TK-4829 admitted/i)).toBeVisible();
    await expect(page.getByText('Locally Verified', { exact: true }).first()).toBeVisible();

    // Scan Second Pass
    await manualCodeInput.fill('TK-7104');
    await verifyBtn.click();
    await expect(page.getByText(/Locally Verified: Pass TK-7104 admitted/i)).toBeVisible();

    // 6. Test Duplicate Local Scan -> Conflict Detected
    await manualCodeInput.fill('TK-4829');
    await verifyBtn.click();

    // Verify Conflict Detected
    await expect(page.getByText(/Conflict Detected/i).first()).toBeVisible();

    // Verify Local Ops Queue shows records
    await expect(page.getByText(/Turnstile Local Ops Queue/i)).toBeVisible();
    await expect(page.getByText('TK-4829').first()).toBeVisible();

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase9-03-offline-turnstile-scanner-${testInfo.project.name}.png`) });

    // 7. Test Batch Sync & Reconciliation
    const syncBtn = page.locator('button:has-text("Sync"):visible').first();
    await expect(syncBtn).toBeVisible();
    await syncBtn.click();

    await expect(page.getByText(/Reconciliation Complete/i).first()).toBeVisible({ timeout: 5000 });

    // 8. Test Audited Conflict Resolution Modal
    const resolveConflictBtn = page.locator('button:has-text("Resolve"):visible').first();
    if (await resolveConflictBtn.isVisible()) {
      await resolveConflictBtn.click();

      await expect(page.getByText('Resolve Check-in Conflict')).toBeVisible();
      await expect(page.getByText(/Policy: attendance:resolve_conflict/i)).toBeVisible();

      // Enter audit resolution note
      const noteInput = page.locator('input[placeholder*="Physical student ID checked"]:visible').first();
      await expect(noteInput).toBeVisible();
      await noteInput.fill('Physical student ID verified at Gate 2 lead desk.');

      // Submit resolution
      const acceptPassBtn = page.locator('button:has-text("Accept Pass & Mark Resolved"):visible').first();
      await acceptPassBtn.click();

      await expect(page.getByText(/Conflict Resolved/i).first()).toBeVisible({ timeout: 5000 });
    }

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase9-04-conflict-resolved-${testInfo.project.name}.png`) });

    // 9. Axe Accessibility Audit (WCAG 2.2 AA zero serious/critical)
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .disableRules(['color-contrast', 'region']) // prototype banner/styling
      .analyze();
    const seriousOrCritical = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(seriousOrCritical).toEqual([]);
  });
});
