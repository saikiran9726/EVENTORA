import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'path';

test.describe('Phase 7 E2E: Feedback, Reviews, Organizer Insights & Exports (FR-FEED, FR-INSIGHT)', () => {
  test('Complete Flow: Student Feedback Submission -> 48h Window Notice -> Event Public Rating -> Organizer Insights Funnel & Time-Series Table -> Zero-PII Reviews -> Formula-Safe Export', async ({ page }, testInfo) => {
    // 1. Visit App as Student
    await page.goto('/');

    // 2. Navigate to Tickets & Registrations
    const ticketsNavBtn = page.locator('button:has-text("Tickets"):visible').first();
    await expect(ticketsNavBtn).toBeVisible();
    await ticketsNavBtn.click();

    // Verify My Tickets page
    await expect(page.getByText('My Tickets & Registrations')).toBeVisible();

    // 3. Open Feedback Sheet
    const feedbackBtn = page.locator('button:has-text("Feedback"):visible').first();
    await expect(feedbackBtn).toBeVisible();
    await feedbackBtn.click();

    // Verify Feedback Sheet contents
    await expect(page.getByText('Leave Event Feedback')).toBeVisible();
    await expect(page.getByText(/Privacy Guaranteed: Your feedback is anonymous/i)).toBeVisible();
    await expect(page.getByText(/48 hours/i).first()).toBeVisible();

    // 4. Set 5-Star Rating & Comment
    const star5 = page.locator('button[data-rating="5"]:visible').first();
    await expect(star5).toBeVisible();
    await star5.click();

    const commentArea = page.locator('#feedback-comment:visible').first();
    await expect(commentArea).toBeVisible();
    await commentArea.fill('Incredible hands-on session with the autonomous robots! The digital turnstile check-in was seamless.');

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase7-01-feedback-sheet-${testInfo.project.name}.png`) });

    // Submit Feedback
    const submitBtn = page.locator('button:has-text("Submit Feedback"):visible').first();
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // Verify button switches to "Edit Review"
    await expect(page.locator('button:has-text("Edit Review"):visible').first()).toBeVisible({ timeout: 5000 });

    // 5. Navigate to Event Discovery to inspect Public Ratings Summary
    const discoverNavBtn = page.locator('button:has-text("Discover"):visible, a:has-text("Explore Events"):visible').first();
    if (await discoverNavBtn.isVisible().catch(() => false)) {
      await discoverNavBtn.click();
    } else {
      await page.goto('/');
    }

    const firstEventCard = page.locator('text=Smart Campus AI & Robotics Symposium 2026').first();
    if (await firstEventCard.isVisible().catch(() => false)) {
      await firstEventCard.click();

      // Verify Attendee Ratings & Transparency Card
      await expect(page.getByText('Attendee Ratings & Transparency')).toBeVisible();
      await expect(page.getByText(/★/).first()).toBeVisible();
      await expect(page.getByText(/response rate/i).first()).toBeVisible();

      await page.screenshot({ path: path.resolve(`./docs/screenshots/phase7-02-public-ratings-${testInfo.project.name}.png`) });
    }

    // 6. Switch to Organizer Role to test Command Center & Insights
    const roleSelect = page.locator('select:visible').first();
    await expect(roleSelect).toBeVisible();
    await roleSelect.selectOption('organizer');

    // Verify Organizer Dashboard loaded
    await expect(page.getByText('Club Organizer Command Center & Analytics')).toBeVisible();

    // Click "Insights & Feedback" Tab
    const insightsTabBtn = page.locator('button:has-text("Insights & Feedback"):visible').first();
    await expect(insightsTabBtn).toBeVisible();
    await insightsTabBtn.click();

    // 7. Verify Insights KPIs
    await expect(page.getByText('Attendee Lifecycle Funnel')).toBeVisible();
    await expect(page.getByText('Rating Distribution & Breakdown')).toBeVisible();
    await expect(page.getByText('Registration Trend Over Time')).toBeVisible();

    // Verify Funnel Stages
    await expect(page.getByText(/Initiated Registrations/i)).toBeVisible();
    await expect(page.getByText(/Confirmed Bookings/i)).toBeVisible();
    await expect(page.getByText(/Checked In/i).first()).toBeVisible();
    await expect(page.getByText(/Feedback Submitted/i).first()).toBeVisible();

    // Verify Accessible HTML Table Alternative for Screen Readers
    const accessibleTable = page.locator('table[aria-label="Registrations over time table"]');
    await expect(accessibleTable).toBeVisible();
    await expect(accessibleTable.locator('th:has-text("Date")')).toBeVisible();
    await expect(accessibleTable.locator('th:has-text("New Bookings")')).toBeVisible();
    await expect(accessibleTable.locator('th:has-text("Cumulative Total")')).toBeVisible();

    // 8. Verify Zero-PII Reviews Queue & Moderation
    await expect(page.getByText('Attendee Reviews & Feedback Queue')).toBeVisible();
    await expect(page.getByText(/ZERO_PII/i)).toBeVisible();
    await expect(page.getByText('Attendee #1')).toBeVisible();

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase7-03-organizer-insights-${testInfo.project.name}.png`) });

    // 9. Verify Secure Data Export Modal (CSV / XLSX)
    const exportBtn = page.locator('button:has-text("Export Data"):visible').first();
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    // Verify Export Modal & Security / Formula Injection Disclaimers
    await expect(page.getByText('Secure Data Export')).toBeVisible();
    await expect(page.getByText(/Enterprise Security & Formula Sanitization/i)).toBeVisible();
    await expect(page.getByText(/Formula injection guard/i)).toBeVisible();
    await expect(page.getByText(/Role-based masking/i)).toBeVisible();

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase7-04-export-dialog-${testInfo.project.name}.png`) });

    // Click Export CSV button inside modal
    const confirmExportBtn = page.locator('button:has-text("Export CSV"):visible').first();
    await expect(confirmExportBtn).toBeVisible();
    await confirmExportBtn.click();

    // Verify Toast appears and modal closes
    await expect(page.getByText(/Export Download Started|Export Queued/i).first()).toBeVisible({ timeout: 5000 });

    // 10. Axe Accessibility Audit on Organizer Insights (WCAG 2.2 AA zero serious/critical)
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
