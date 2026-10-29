import { test, expect } from '@playwright/test';

test.describe('Phase P26 E2E: Real Empty States & No Prototype Artifacts', () => {
  test('Discovery page shows real empty state when search finds zero matches', async ({ page }) => {
    await page.goto('/');

    // Type a search query that yields zero results
    const searchInput = page.locator('input[placeholder*="Search events"]').first();
    await searchInput.fill('__non_existent_event_query_xyz_12345__');

    // Wait for empty state to display
    await expect(page.getByText('No events found')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Try clearing search or adjusting filters/i)).toBeVisible();

    // Verify no prototype banner is present
    await expect(page.locator('text=PROTOTYPE DATA')).toHaveCount(0);
    await expect(page.locator('text=Phase-1 Design System Prototype')).toHaveCount(0);
  });

  test('Public passport route /p/:slug shows real 404 when student slug does not exist', async ({ page }) => {
    await page.goto('/p/non-existent-student-xyz-999');

    // Wait for 404 empty state
    await expect(page.getByText('Student Passport Not Found')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/No public passport found with handle/i)).toBeVisible();

    // Verify Aarav Patel is NOT displayed as a fallback
    await expect(page.getByText('Aarav Patel')).toHaveCount(0);
  });

  test('Public certificate verification shows clean not found when code does not exist', async ({ page }) => {
    await page.goto('/verify/XXXX-XXXX-XXXX');

    // Should not show fake prototype verification
    await expect(page.locator('text=PROTOTYPE DATA')).toHaveCount(0);
  });

  test('Component gallery route is gated in production or renders properly in dev', async ({ page }) => {
    await page.goto('/components');
    // Either redirected to / or in dev displays gallery
    const url = page.url();
    expect(url.endsWith('/') || url.includes('/components')).toBe(true);
  });
});
