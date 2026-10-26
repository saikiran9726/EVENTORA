import { test, expect } from '@playwright/test';
import { safeScreenshot } from './screenshot-helper.js';

test.describe('Phase 2 E2E: Auth Lifecycle & Role Navigation', () => {
  test('User Journey: Register -> Verify -> Login -> Update Profile & Preferences -> Logout', async ({ page }, testInfo) => {
    // 1. Visit App
    await page.goto('/');

    // Screenshot initial discover screen
    await safeScreenshot(page, './docs/screenshots/phase2-01-discover-initial.png', testInfo);

    // 2. Navigate to Me / Profile (triggers auth redirect since unauthenticated)
    const meNavBtn = page.locator('button:has-text("Me"):visible').first();
    await meNavBtn.click();

    // Expect Sign In page
    await expect(page.getByText('Sign In to Eventora')).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/phase2-02-signin-page.png', testInfo);

    // 3. Navigate to Register
    const createAccountBtn = page.getByRole('button', { name: /create campus account/i });
    await createAccountBtn.click();

    await expect(page.getByText('Join Eventora')).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/phase2-03-register-page.png', testInfo);

    // 4. Fill registration form
    const uniqueId = Date.now().toString().slice(-6);
    const testEmail = `student.e2e.${uniqueId}@campus.edu`;

    await page.fill('#reg-name', 'Dev E2E Student');
    await page.fill('#reg-email', testEmail);

    // Password strength check
    await page.fill('#reg-password', 'Weak');
    await expect(page.getByText('Weak')).toBeVisible();

    await page.fill('#reg-password', 'Eventora#Test2026!');
    await expect(page.getByText('Strong')).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/phase2-04-password-strength.png', testInfo);

    // Submit registration
    await page.click('button:has-text("Create Account")');

    // Verification screen should appear with pre-filled token
    await expect(page.getByText('Verify Your College Email')).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/phase2-05-email-verification.png', testInfo);

    // Click verify
    await page.click('button:has-text("Verify Email & Activate")');
    await expect(page.getByText('Email Verified!')).toBeVisible();

    // Proceed to sign in
    await page.click('button:has-text("Proceed to Sign In")');
    await expect(page.getByText('Sign In to Eventora')).toBeVisible();

    // 5. Sign In with created credentials
    await page.fill('#login-email', testEmail);
    await page.fill('#login-password', 'Eventora#Test2026!');
    await page.click('button:has-text("Sign In")');

    // 6. After login with return path, navigates to Profile
    await page.waitForTimeout(500);

    const profileNavBtn = page.locator('button:has-text("Me"):visible').first();
    if (await profileNavBtn.isVisible()) {
      await profileNavBtn.click();
    }

    await expect(page.getByText('Account & Preferences')).toBeVisible();
    await expect(page.getByText(testEmail)).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/phase2-06-profile-preferences.png', testInfo);

    // 7. Update display name
    await page.fill('#display-name', 'Dev E2E Student (Updated)');
    await page.click('button:has-text("Save")');
    await expect(page.getByText('Display name updated successfully')).toBeVisible();

    // 8. Sign Out
    await page.click('button:has-text("Sign Out")');
    // Navigates back to Discover
    await expect(page.getByText('Campus Event Discovery')).toBeVisible();
    await safeScreenshot(page, './docs/screenshots/phase2-07-post-logout.png', testInfo);
  });

  test('Role Navigation Matrix differences across all canonical shells', async ({ page }) => {
    await page.goto('/');

    const roleSelect = page.getByLabel('Switch User Role');

    // 1. Student Shell
    await roleSelect.selectOption('student');
    await expect(page.getByText('Campus Event Discovery')).toBeVisible();
    await expect(page.locator('button:has-text("Discover"):visible').first()).toBeVisible();
    await expect(page.locator('button:has-text("Calendar"):visible').first()).toBeVisible();
    await expect(page.locator('button:has-text("Tickets"):visible').first()).toBeVisible();
    await expect(page.locator('button:has-text("Passport"):visible').first()).toBeVisible();

    // 2. Organizer Shell
    await roleSelect.selectOption('organizer');
    await expect(page.getByText('Organizer Command Center')).toBeVisible();
    await expect(page.locator('button:has-text("Overview"):visible').first()).toBeVisible();
    await expect(page.locator('button:has-text("Roster"):visible').first()).toBeVisible();

    // 3. Reviewer Shell
    await roleSelect.selectOption('reviewer');
    await expect(page.getByText('Faculty Approval & Review Queue')).toBeVisible();
    await expect(page.getByText('Policy: event:review')).toBeVisible();

    // 4. Admin Shell
    await roleSelect.selectOption('admin');
    await expect(page.getByText('Campus System Administration')).toBeVisible();
    await expect(page.getByText('Policy: user:manage')).toBeVisible();

    // 5. Check-in Staff Shell
    await roleSelect.selectOption('checkin_staff');
    await expect(page.getByText('Turnstile Check-in Scanner')).toBeVisible();
    await expect(page.getByText('Policy: attendance:checkin:assigned')).toBeVisible();
  });

  test('Session expiration: 401 triggers expired modal and redirects back to original route after re-login', async ({ page }) => {
    // 1. Visit App and navigate to Profile
    await page.goto('/');

    const meNavBtn = page.locator('button:has-text("Me"):visible').first();
    await meNavBtn.click();
    await expect(page.getByText('Sign In to Eventora')).toBeVisible();

    // 2. Register & login a test student
    const createAccountBtn = page.getByRole('button', { name: /create campus account/i });
    await createAccountBtn.click();

    const uniqueId = Date.now().toString().slice(-6);
    const testEmail = `expiry.student.${uniqueId}@campus.edu`;

    await page.fill('#reg-name', 'Expiry Test Student');
    await page.fill('#reg-email', testEmail);
    await page.fill('#reg-password', 'Eventora#Test2026!');
    await page.click('button:has-text("Create Account")');

    await expect(page.getByText('Verify Your College Email')).toBeVisible();
    await page.click('button:has-text("Verify Email & Activate")');
    await expect(page.getByText('Email Verified!')).toBeVisible();

    await page.click('button:has-text("Proceed to Sign In")');
    await page.fill('#login-email', testEmail);
    await page.fill('#login-password', 'Eventora#Test2026!');
    await page.click('button:has-text("Sign In")');

    // Should be on profile page
    await expect(page.getByText('Account & Preferences')).toBeVisible();

    // 3. Intercept next /me or API call with 401 Unauthorized to simulate expired session
    await page.route('**/api/v1/me/preferences', (route) => {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Session expired due to inactivity',
            requestId: 'req-expired-test',
          },
        }),
      });
    });

    // Trigger state change that hits /api/v1/me/preferences
    const emailToggle = page.locator('input[type="checkbox"]').first();
    if (await emailToggle.isVisible()) {
      await emailToggle.click();
    }

    // 4. Session Expired modal must pop up
    await expect(page.getByText('Session Expired')).toBeVisible();
    await expect(page.getByText('Sign In Again')).toBeVisible();

    // 5. Click "Sign In Again"
    await page.click('button:has-text("Sign In Again")');
    await expect(page.getByText('Sign In to Eventora')).toBeVisible();

    // 6. Unroute mock so backend responds normally
    await page.unroute('**/api/v1/me/preferences');

    // 7. Sign in again
    await page.fill('#login-email', testEmail);
    await page.fill('#login-password', 'Eventora#Test2026!');
    await page.click('button:has-text("Sign In")');

    // 8. Must return user back to the Profile page ('Account & Preferences')
    await expect(page.getByText('Account & Preferences')).toBeVisible();
    await expect(page.getByText(testEmail)).toBeVisible();
  });
});
