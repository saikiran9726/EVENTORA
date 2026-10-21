import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Phase 5 E2E: Test-Mode Paid Checkout, Receipts & Ledger (FR-PAY)', () => {
  test('End-to-End Paid Checkout -> Simulator Payment -> Digital Receipt -> Organizer Ledger', async ({ page }) => {
    // 1. Visit App
    await page.goto('/');

    // 2. Select an event card to view details
    const firstEventCard = page.locator('article, div[class*="cursor-pointer"]').first();
    await firstEventCard.click();

    await expect(page.getByText('About the Event')).toBeVisible();

    // Verify test mode / server pricing indicators on details
    await expect(page.getByText(/Campus Event Registration|Ticket Tiers/i)).toBeVisible();

    // 3. Open Registration Form
    const registerBtn = page.locator('button:has-text("Register"):visible, button:has-text("Proceed"):visible').first();
    await registerBtn.click();

    // Fill form if opened in modal
    const nameInput = page.locator('input[placeholder*="Aarav Sharma"]:visible');
    if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await nameInput.fill('Priya Patel');
      await page.fill('input[placeholder*="CS22B1042"]:visible', 'CS22B2005');
      const submitBtn = page.locator('button[type="submit"]:visible');
      await submitBtn.click();
    }

    // 4. Verification: Should arrive at Checkout Page or trigger hold
    // In our App.tsx, paid registration triggers onProceedToCheckout -> activeRoute = 'checkout'
    // Or we can verify the CheckoutPage elements directly
    const testModeBanner = page.locator('text=TEST MODE – simulated money').first();
    await expect(testModeBanner).toBeVisible({ timeout: 6000 });
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase5-01-checkout-hold.png') });

    // Verify Order Summary and Countdown Timer
    await expect(page.getByText('Order Summary')).toBeVisible();
    await expect(page.getByText(/Hold expires in/i)).toBeVisible();
    await expect(page.getByText(/Grand Total/i)).toBeVisible();
    await expect(page.getByText(/paise/i).first()).toBeVisible();

    // 5. Simulate Payment Success
    const paySuccessBtn = page.locator('button:has-text("Pay"):visible, button:has-text("Simulate Success"):visible').first();
    await expect(paySuccessBtn).toBeVisible();
    await paySuccessBtn.click();

    // 6. Verify Digital Receipt Generation
    await expect(page.getByText(/Payment Confirmed & Verified/i).first()).toBeVisible({ timeout: 6000 });
    await expect(page.getByText(/Receipt Number/i).first()).toBeVisible();
    await expect(page.getByText(/Total Paid/i).first()).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase5-02-digital-receipt.png') });

    // 7. Click View Tickets
    const viewTicketsBtn = page.locator('button:has-text("View QR Tickets"):visible').first();
    await expect(viewTicketsBtn).toBeVisible();
    await viewTicketsBtn.click();

    // Verify My Tickets page
    await expect(page.getByText('My Tickets & Registrations')).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase5-03-passport-tickets.png') });

    // 8. Test Organizer Scoped Ledger View
    // Switch role to Organizer via header role selector
    const roleSelect = page.locator('select').first();
    if (await roleSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
      await roleSelect.selectOption('organizer');

      // Verify Organizer Dashboard loaded
      await expect(page.getByText('Club Organizer Command Center')).toBeVisible();

      // Click Sales & Ledger tab
      const ledgerTab = page.locator('button:has-text("Sales & Ledger"):visible').first();
      await expect(ledgerTab).toBeVisible();
      await ledgerTab.click();

      // Verify Financial KPI cards
      await expect(page.getByText('Simulated Gross Sales')).toBeVisible();
      await expect(page.getByText('Simulated Refunds')).toBeVisible();
      await expect(page.getByText('Net Revenue')).toBeVisible();

      // Verify Ledger Table
      await expect(page.getByText('Organizer Financial Ledger & Audit Trail')).toBeVisible();
      await expect(page.getByText('Entry Type')).toBeVisible();
      await expect(page.getByText('SALE').first()).toBeVisible();

      await page.screenshot({ path: path.resolve('./docs/screenshots/phase5-04-organizer-ledger.png') });
    }
  });
});
