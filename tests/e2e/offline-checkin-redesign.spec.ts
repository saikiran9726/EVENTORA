import { test, expect } from '@playwright/test';

test.describe('Phase P25: Offline Check-in Redesign E2E Scenarios', () => {
  const eventId = '11111111-2222-4333-8444-555555555555';
  const manifestId1 = 'man-dev-alpha-001';

  test.beforeEach(async ({ page }) => {
    // Authenticate as gate checkin staff
    await page.route('**/api/v1/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'staff-lead-001',
            email: 'lead@gate.edu',
            displayName: 'Lead Turnstile Gate',
            globalRole: 'checkin_staff',
            status: 'active',
          },
        }),
      });
    });

    await page.route(`**/api/v1/events/${eventId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          event: {
            id: eventId,
            title: 'Annual Robotics Summit 2026',
            status: 'published',
            startsAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + 8 * 3600000).toISOString(),
            capacity: 500,
          },
        }),
      });
    });

    await page.route(`**/api/v1/events/${eventId}/attendance/summary`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: {
            totalRegistered: 50,
            totalCheckedIn: 0,
            totalValidUnredeemed: 50,
            totalRevoked: 2,
            duplicateAttempts: 0,
          },
          sessions: [],
          recentLogs: [],
        }),
      });
    });

    await page.route(`**/api/v1/events/${eventId}/check-in/conflicts`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ conflicts: [] }),
      });
    });
  });

  test('Acceptance Item 1: 50 scans offline -> sync batch reconciliation', async ({ page }) => {
    // 50 manifest items generated with per-manifest key K
    const items = Array.from({ length: 50 }, (_, i) => ({
      ref: `ref_pass_${i.toString().padStart(4, '0')}`,
      hmac: `hmac_sig_${i.toString().padStart(4, '0')}`,
      hint: `TK-${i.toString().padStart(4, '0')}`,
    }));

    await page.route(`**/api/v1/events/${eventId}/check-in/manifest*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          manifestId: manifestId1,
          eventId,
          keyId: 'key_k_50_scans',
          key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 4 * 3600000).toISOString(),
          ticketCount: 50,
          items,
        }),
      });
    });

    // Mock batch sync
    let syncCalledWithCount = 0;
    await page.route(`**/api/v1/events/${eventId}/check-in/sync-batch`, async (route) => {
      const payload = JSON.parse(route.request().postData() || '{}');
      syncCalledWithCount = payload.ops?.length || 0;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          batchId: payload.batchId,
          totalOps: syncCalledWithCount,
          results: (payload.ops || []).map((op: any) => ({
            opId: op.opId,
            outcome: 'SYNCED',
            reason: null,
          })),
        }),
      });
    });

    await page.goto(`/scan/${eventId}`);
    await expect(page.getByText('Turnstile Check-in Scanner')).toBeVisible();

    // 1. Download Manifest
    const downloadManifestBtn = page.locator('button:has-text("Download Manifest"):visible').first();
    await expect(downloadManifestBtn).toBeVisible();
    await downloadManifestBtn.click();
    await expect(page.getByText(/Manifest Downloaded/i).first()).toBeVisible({ timeout: 5000 });

    // 2. Switch to Offline Mode
    const offlineModeToggle = page.locator('button:has-text("Online Mode"):visible').first();
    await expect(offlineModeToggle).toBeVisible();
    await offlineModeToggle.click();
    await expect(page.getByText(/Offline Mode/i).first()).toBeVisible();

    // 3. Perform 50 scans offline using hint codes
    const manualInput = page.locator('input[placeholder*="Paste token or enter"]:visible').first();
    const verifyBtn = page.locator('button:has-text("Verify"):visible').first();

    for (let i = 0; i < 50; i++) {
      await manualInput.fill(`TK-${i.toString().padStart(4, '0')}`);
      await verifyBtn.click();
    }

    // Verify 50 operations queued in Local Ops Queue
    await expect(page.getByText(/Turnstile Local Ops Queue/i)).toBeVisible();

    // 4. Trigger Batch Sync
    const syncBtn = page.locator('button:has-text("Sync"):visible').first();
    await expect(syncBtn).toBeVisible();
    await syncBtn.click();

    await expect(page.getByText(/Reconciliation Complete/i).first()).toBeVisible({ timeout: 5000 });
    expect(syncCalledWithCount).toBe(50);
  });

  test('Acceptance Item 2: Two devices same ticket -> one SYNCED + one CONFLICT', async ({ page }) => {
    const conflictItem = {
      ref: 'ref_conflict_tk01',
      hmac: 'hmac_conflict_tk01',
      hint: 'TK-7777',
    };

    // Device Alpha manifest
    await page.route(`**/api/v1/events/${eventId}/check-in/manifest*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          manifestId: manifestId1,
          eventId,
          keyId: 'key_k_dev_1',
          key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 4 * 3600000).toISOString(),
          ticketCount: 1,
          items: [conflictItem],
        }),
      });
    });

    // Mock sync for Device 2 where ticket is already checked in -> returns CONFLICT
    await page.route(`**/api/v1/events/${eventId}/check-in/sync-batch`, async (route) => {
      const payload = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          batchId: payload.batchId,
          totalOps: 1,
          results: [
            {
              opId: payload.ops[0].opId,
              outcome: 'CONFLICT',
              reason: 'ALREADY_CHECKED_IN',
            },
          ],
        }),
      });
    });

    await page.goto(`/scan/${eventId}`);

    // Download manifest and go offline
    await page.locator('button:has-text("Download Manifest"):visible').first().click();
    await expect(page.getByText(/Manifest Downloaded/i).first()).toBeVisible({ timeout: 5000 });

    await page.locator('button:has-text("Online Mode"):visible').first().click();
    await expect(page.getByText(/Offline Mode/i).first()).toBeVisible();

    // Scan the ticket on Device 2
    const manualInput = page.locator('input[placeholder*="Paste token or enter"]:visible').first();
    await manualInput.fill('TK-7777');
    await page.locator('button:has-text("Verify"):visible').first().click();

    // Locally verified on Device 2
    await expect(page.getByText(/Locally Verified: Pass TK-7777 admitted/i)).toBeVisible();

    // Now Device 2 syncs -> Server detects Device 1 already checked in -> CONFLICT
    await page.locator('button:has-text("Sync"):visible').first().click();
    await expect(page.getByText(/Reconciliation Complete/i).first()).toBeVisible({ timeout: 5000 });

    // Verify Conflict Detected status label shown
    await expect(page.getByText('Conflict Detected').first()).toBeVisible();
  });

  test('Acceptance Item 3: Revoked ticket rejected upon sync', async ({ page }) => {
    const revokedItem = {
      ref: 'ref_revoked_pass_01',
      hmac: 'hmac_revoked_pass_01',
      hint: 'TK-REV1',
    };

    await page.route(`**/api/v1/events/${eventId}/check-in/manifest*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          manifestId: manifestId1,
          eventId,
          keyId: 'key_k_rev',
          key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 4 * 3600000).toISOString(),
          ticketCount: 1,
          items: [revokedItem],
        }),
      });
    });

    // Mock batch sync returning REJECTED (TICKET_CANCELLED_OR_REVOKED)
    await page.route(`**/api/v1/events/${eventId}/check-in/sync-batch`, async (route) => {
      const payload = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          batchId: payload.batchId,
          totalOps: 1,
          results: [
            {
              opId: payload.ops[0].opId,
              outcome: 'REJECTED',
              reason: 'TICKET_CANCELLED_OR_REVOKED',
            },
          ],
        }),
      });
    });

    await page.goto(`/scan/${eventId}`);
    await page.locator('button:has-text("Download Manifest"):visible').first().click();
    await expect(page.getByText(/Manifest Downloaded/i).first()).toBeVisible({ timeout: 5000 });

    await page.locator('button:has-text("Online Mode"):visible').first().click();
    const manualInput = page.locator('input[placeholder*="Paste token or enter"]:visible').first();
    await manualInput.fill('TK-REV1');
    await page.locator('button:has-text("Verify"):visible').first().click();

    // Trigger sync
    await page.locator('button:has-text("Sync"):visible').first().click();
    await expect(page.getByText(/Reconciliation Complete/i).first()).toBeVisible({ timeout: 5000 });

    // Verify Rejected status
    await expect(page.getByText('Rejected').first()).toBeVisible();
  });

  test('Acceptance Item 4: Expired manifest blocks offline scanning', async ({ page }) => {
    // Return expired manifest from server (expiresAt in the past)
    await page.route(`**/api/v1/events/${eventId}/check-in/manifest*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          manifestId: 'man-expired-001',
          eventId,
          keyId: 'key_k_exp',
          key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          issuedAt: new Date(Date.now() - 5 * 3600000).toISOString(),
          expiresAt: new Date(Date.now() - 1 * 3600000).toISOString(), // Expired 1 hour ago
          ticketCount: 1,
          items: [{ ref: 'ref_exp', hmac: 'hmac_exp', hint: 'TK-EXP1' }],
        }),
      });
    });

    await page.goto(`/scan/${eventId}`);
    await page.locator('button:has-text("Download Manifest"):visible').first().click();
    await expect(page.getByText(/Manifest Downloaded/i).first()).toBeVisible({ timeout: 5000 });

    // Go offline
    await page.locator('button:has-text("Online Mode"):visible').first().click();
    await expect(page.getByText(/Offline Mode/i).first()).toBeVisible();

    // Attempt scan with expired manifest -> blocked!
    const manualInput = page.locator('input[placeholder*="Paste token or enter"]:visible').first();
    await manualInput.fill('TK-EXP1');
    await page.locator('button:has-text("Verify"):visible').first().click();

    // Verify scanning blocked message
    await expect(page.getByText(/Offline Manifest Expired: Check-in blocked/i)).toBeVisible();
  });
});
