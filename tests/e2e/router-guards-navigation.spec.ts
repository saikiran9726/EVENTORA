import { test, expect } from '@playwright/test';

test.describe('Phase P06 E2E: React Router DOM v6, Guards & Navigation Integrity', () => {
  test('1. Deep links survive page reload without resetting to root or losing state', async ({ page }) => {
    // 1a. Calendar deep link
    await page.goto('/calendar');
    await expect(page.getByText('Campus Event Calendar')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Campus Event Calendar')).toBeVisible();
    expect(page.url()).toContain('/calendar');

    // 1b. Teams deep link
    await page.goto('/teams');
    await expect(page.getByText('Team Hub & Hackathons')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Team Hub & Hackathons')).toBeVisible();
    expect(page.url()).toContain('/teams');

    // 1c. Volunteer Hub deep link
    await page.goto('/volunteers');
    await expect(page.getByText('Campus Volunteer Hub & Shift Check-In')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Campus Volunteer Hub & Shift Check-In')).toBeVisible();
    expect(page.url()).toContain('/volunteers');
  });

  test('2. Logged-out redirect preserves returnTo and navigates back upon login', async ({ page }) => {
    // Unauthenticated user attempts to access /profile directly
    await page.goto('/profile');

    // Must be redirected to /login with returnTo query param
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fprofile/);
    await expect(page.getByText('Sign In to Eventora')).toBeVisible();

    // Register a new student to authenticate
    const createAccountBtn = page.getByRole('button', { name: /create campus account/i });
    await createAccountBtn.click();

    // Confirm returnTo preserved in URL
    await expect(page).toHaveURL(/\/register\?returnTo=%2Fprofile/);

    const uniqueId = Date.now().toString().slice(-6);
    const testEmail = `nav.guard.${uniqueId}@campus.edu`;

    await page.fill('#reg-name', 'Nav Guard Student');
    await page.fill('#reg-email', testEmail);
    await page.fill('#reg-password', 'Eventora#Test2026!');
    await page.click('button:has-text("Create Account")');

    await expect(page.getByText('Verify Your College Email')).toBeVisible();
    await page.click('button:has-text("Verify Email & Activate")');
    await expect(page.getByText('Email Verified!')).toBeVisible();

    // Sign in
    await page.click('button:has-text("Proceed to Sign In")');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fprofile/);

    await page.fill('#login-email', testEmail);
    await page.fill('#login-password', 'Eventora#Test2026!');
    await page.click('button:has-text("Sign In")');

    // Must be redirected back to the preserved returnTo destination (/profile)
    await expect(page.getByText('Account & Preferences')).toBeVisible();
    await expect(page.getByText(testEmail)).toBeVisible();
    expect(page.url()).toContain('/profile');
  });

  test('3. 404 Catch-All renders NotFoundPage and allows clean return to Discovery', async ({ page }) => {
    // Navigate to an unknown route
    await page.goto('/non-existent-campus-endpoint-404');

    // Verify 404 page content
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByText('Page Not Found')).toBeVisible();
    await expect(
      page.getByText('The event or page you are looking for does not exist or may have been concluded.')
    ).toBeVisible();

    // Click recovery button to return to discovery
    await page.click('button:has-text("Discover Events")');

    // Should return to '/'
    await expect(page.getByText('Campus Event Discovery')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('4. Role-guarded routes render 403 ForbiddenPage for unauthorized roles', async ({ page }) => {
    // Mock student session without admin/reviewer privileges
    await page.route('**/api/v1/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'mock-student-id',
            email: 'student.regular@campus.edu',
            displayName: 'Regular Student',
            globalRole: 'student',
            status: 'active',
            organizerMemberships: [],
            staffAssignments: [],
          },
        }),
      });
    });

    // Attempt to access Admin Portal (/admin)
    await page.goto('/admin');

    // Expect 403 Access Denied
    await expect(page.getByText('403 — Access Denied')).toBeVisible();
    await expect(
      page.getByText('You do not have the required role privileges to access this campus portal.')
    ).toBeVisible();
    await expect(page.getByText('Required: admin')).toBeVisible();

    // Click Discover Events
    await page.click('button:has-text("Discover Events")');
    await expect(page.getByText('Campus Event Discovery')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');

    // Attempt to access Faculty Review Queue (/review)
    await page.goto('/review');
    await expect(page.getByText('403 — Access Denied')).toBeVisible();
    await expect(
      page.getByText('You do not have the required role privileges to access this campus portal.')
    ).toBeVisible();
    await expect(page.getByText('Required: admin or reviewer')).toBeVisible();
  });

  test('5. Browser back and forward history buttons navigate correctly between routes', async ({ page }) => {
    // Start at root
    await page.goto('/');
    await expect(page.getByText('Campus Event Discovery')).toBeVisible();

    // Navigate to Calendar
    await page.goto('/calendar');
    await expect(page.getByText('Campus Event Calendar')).toBeVisible();
    expect(page.url()).toContain('/calendar');

    // Navigate to Teams
    await page.goto('/teams');
    await expect(page.getByText('Team Hub & Hackathons')).toBeVisible();
    expect(page.url()).toContain('/teams');

    // Click Browser Back -> returns to Calendar
    await page.goBack();
    await expect(page.getByText('Campus Event Calendar')).toBeVisible();
    expect(page.url()).toContain('/calendar');

    // Click Browser Back again -> returns to Root
    await page.goBack();
    await expect(page.getByText('Campus Event Discovery')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');

    // Click Browser Forward -> returns to Calendar
    await page.goForward();
    await expect(page.getByText('Campus Event Calendar')).toBeVisible();
    expect(page.url()).toContain('/calendar');
  });
});
