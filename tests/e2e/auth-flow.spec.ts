import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Phase 2 E2E: Auth Lifecycle & Role Navigation', () => {
  test('User Journey: Register -> Verify -> Login -> Update Profile & Preferences -> Logout', async ({ page }) => {
    // 1. Visit App
    await page.goto('/');

    // Screenshot initial discover screen
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase2-01-discover-initial.png') });

    // 2. Navigate to Me / Profile (triggers auth redirect since unauthenticated)
    const meNavBtn = page.locator('button:has-text("Me"):visible').first();
    await meNavBtn.click();

    // Expect Sign In page
    await expect(page.getByText('Sign In to Eventora')).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase2-02-signin-page.png') });

    // 3. Navigate to Register
    const createAccountBtn = page.getByRole('button', { name: /create campus account/i });
    await createAccountBtn.click();

    await expect(page.getByText('Join Eventora')).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase2-03-register-page.png') });

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
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase2-04-password-strength.png') });

    // Submit registration
    await page.click('button:has-text("Create Account")');

    // Verification screen should appear with pre-filled token
    await expect(page.getByText('Verify Your College Email')).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase2-05-email-verification.png') });

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
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase2-06-profile-preferences.png') });

    // 7. Update display name
    await page.fill('#display-name', 'Dev E2E Student (Updated)');
    await page.click('button:has-text("Save")');
    await expect(page.getByText('Display name updated successfully')).toBeVisible();

    // 8. Sign Out
    await page.click('button:has-text("Sign Out")');
    // Navigates back to Discover
    await expect(page.getByText('Campus Event Discovery')).toBeVisible();
    await page.screenshot({ path: path.resolve('./docs/screenshots/phase2-07-post-logout.png') });
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
    await expect(page.getByText('QR Ticket Check-in Scanner')).toBeVisible();
    await expect(page.getByText('Policy: attendance:checkin:assigned')).toBeVisible();
  });
});
