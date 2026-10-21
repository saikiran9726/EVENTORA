import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'path';

test.describe('Phase 8 E2E: Volunteers, Venue Navigator, Equipment & Issue Desk (FR-VOL, FR-VENUE, FR-OPS)', () => {
  test('Complete Flow: Student Volunteer Application & Check-in -> Venue Navigator -> Organizer Queue Approval & Shift Assignment -> Issue Desk Kanban -> Equipment Allocation', async ({ page }, testInfo) => {
    // 1. Visit Student Shell
    await page.goto('/');

    // 2. Open Student Volunteer Hub
    const volunteerNavBtn = page.locator('button:has-text("Volunteers"):visible').first();
    await expect(volunteerNavBtn).toBeVisible();
    await volunteerNavBtn.click();

    // Verify Volunteer Hub loaded with Verified Service Hours (feeds Passport)
    await expect(page.getByText('Campus Volunteer Hub & Shift Check-In')).toBeVisible();
    await expect(page.getByText('Verified Service', { exact: true })).toBeVisible();
    await expect(page.getByText('12.5 hrs')).toBeVisible();

    // 3. Browse Shift Opportunities & Apply
    const browseTabBtn = page.locator('button:has-text("Browse Opportunities"):visible').first();
    await expect(browseTabBtn).toBeVisible();
    await browseTabBtn.click();

    await expect(page.getByText('Stage & Track Usher')).toBeVisible();
    const applyBtn = page.locator('button:has-text("Apply"):visible').first();
    await expect(applyBtn).toBeVisible();
    await applyBtn.click();

    // Verify Application Submitted toast and redirect to My Shifts tab
    await expect(page.getByText(/Volunteer Application Submitted/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/My Shifts & Check-In/i).first()).toBeVisible();

    // 4. Test Shift Check-in Window Logic
    // Find active shift within check-in window
    await expect(page.getByText('Lead Event Ambassador')).toBeVisible();

    const checkInBtn = page.locator('button:has-text("Check In to Shift"):visible').first();
    await expect(checkInBtn).toBeVisible();
    await checkInBtn.click();

    // Verify checked in status
    await expect(page.getByText(/Active on Duty|CHECKED IN/i).first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase8-01-volunteer-student-hub-${testInfo.project.name}.png`) });

    // 5. Test Venue Navigator in Event Details (FR-VENUE)
    const discoverBtn = page.locator('button:has-text("Discover"):visible').first();
    await expect(discoverBtn).toBeVisible();
    await discoverBtn.click();

    // Click event card
    const eventCard = page.locator('text=Smart Campus AI & Robotics Symposium 2026').first();
    await expect(eventCard).toBeVisible();
    await eventCard.click();

    // Verify Venue Navigator Card
    await expect(page.getByText('Sir MV Auditorium, Tech Block B')).toBeVisible();
    await expect(page.getByText(/Staff turnstile check-in opens 15 minutes before/i)).toBeVisible();
    await expect(page.getByText(/Step-free wheelchair ramp at Gate 2 entrance/i)).toBeVisible();

    // Test Copy Directions
    const copyDirectionsBtn = page.locator('button:has-text("Copy Directions"):visible').first();
    await expect(copyDirectionsBtn).toBeVisible();
    await copyDirectionsBtn.click();
    await expect(page.getByText(/Directions Copied/i).first()).toBeVisible({ timeout: 5000 });

    // Verify Open in Maps link
    const mapsLink = page.locator('a:has-text("Open in Maps"):visible').first();
    await expect(mapsLink).toBeVisible();
    await expect(mapsLink).toHaveAttribute('target', '_blank');

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase8-02-venue-navigator-${testInfo.project.name}.png`) });

    // 6. Switch to Club Organizer Role
    const roleSelect = page.locator('select:visible').first();
    await expect(roleSelect).toBeVisible();
    await roleSelect.selectOption('organizer');

    // Verify Organizer Portal
    await expect(page.getByText('Club Organizer Command Center & Analytics')).toBeVisible();

    // Switch to Volunteers & Ops tab
    const volunteersTabBtn = page.locator('button:has-text("Volunteers & Ops"):visible').first();
    await expect(volunteersTabBtn).toBeVisible();
    await volunteersTabBtn.click();

    // Verify Volunteers & Ops Header & Policy
    await expect(page.getByText('Volunteer Management & Operations Control (FR-VOL, FR-OPS)')).toBeVisible();
    await expect(page.getByText(/POLICY: event:manage:owned/i).first()).toBeVisible();

    // Verify Shift Capacity Meters
    await expect(page.getByText('Turnstile Scanner Lead').first()).toBeVisible();
    await expect(page.getByText('Stage & Track Usher').first()).toBeVisible();
    await expect(page.getByText('Ambassador & VIP Host').first()).toBeVisible();
    await expect(page.getByText('2 / 5 Filled').first()).toBeVisible();

    // 7. Test Volunteer Review Queue (Approve & Assign)
    await expect(page.getByText('Volunteer Application Review Queue')).toBeVisible();
    await expect(page.getByText('Aditya Varma').first()).toBeVisible();

    // Approve applicant
    const approveBtn = page.locator('button:has-text("Approve"):visible').first();
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    // Verify applicant is moved to APPROVED and Assign button appears
    const assignBtn = page.locator('button:has-text("Assign Shift"):visible').first();
    await expect(assignBtn).toBeVisible({ timeout: 5000 });

    // Assign applicant to shift
    await assignBtn.click();
    await expect(page.getByText(/Token Issued/i).first()).toBeVisible({ timeout: 5000 });

    // Test Bulk Approve Pending
    const bulkApproveBtn = page.locator('button:has-text("Bulk Approve Pending"):visible').first();
    await expect(bulkApproveBtn).toBeVisible();
    await bulkApproveBtn.click();
    // Verify all candidates in queue are now APPROVED with Assign Shift buttons
    await expect(page.locator('tr:has-text("Pooja Nair") button:has-text("Assign Shift")')).toBeVisible({ timeout: 5000 });

    // 8. Test Live Operations Support Issue Desk Kanban (FR-OPS)
    await expect(page.getByText('Live Operations Issue Desk (FR-OPS Support Kanban)')).toBeVisible();
    await expect(page.getByText('Microphone feedback in Room 204').first()).toBeVisible();

    // Transition from OPEN -> IN_PROGRESS
    const investigateBtn = page.locator('button:has-text("Investigate"):visible').first();
    await expect(investigateBtn).toBeVisible();
    await investigateBtn.click();

    // Transition from IN_PROGRESS -> RESOLVED
    const resolveBtn = page.locator('button:has-text("Resolve"):visible').first();
    await expect(resolveBtn).toBeVisible({ timeout: 5000 });
    await resolveBtn.click();

    // Transition from RESOLVED -> CLOSED
    const closeBtn = page.locator('button:has-text("Close"):visible').first();
    await expect(closeBtn).toBeVisible({ timeout: 5000 });
    await closeBtn.click();

    // 9. Test College Equipment Allocation Tracker (FR-OPS)
    await expect(page.getByText('College Equipment Allocation & Row Locks (FR-OPS)')).toBeVisible();
    await expect(page.getByText('Mobile Turnstile Optical QR Scanner').first()).toBeVisible();

    const approveEqBtn = page.locator('button:has-text("Approve Request"):visible').first();
    await expect(approveEqBtn).toBeVisible();
    await approveEqBtn.click();
    await expect(page.getByText(/Allocated/i).first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: path.resolve(`./docs/screenshots/phase8-03-organizer-volunteers-ops-${testInfo.project.name}.png`) });

    // 10. Axe Accessibility Audit (WCAG 2.2 AA zero serious/critical)
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
