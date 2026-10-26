import { test, expect } from '@playwright/test';
import { safeScreenshot } from './screenshot-helper.js';

test.describe('Phase P11 E2E: Custom Registration Form Builder & Submissions', () => {
  const mockEventId = 'mock-evt-1';

  test.beforeEach(async ({ page }) => {
    // Authenticate as organizer
    await page.route('**/api/v1/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'mock-org-user-p11',
            email: 'organizer.ras@campus.edu',
            displayName: 'Robotics Society Organizer',
            globalRole: 'student',
            status: 'active',
            collegeId: '11111111-1111-1111-1111-111111111111',
            organizerMemberships: [
              {
                organizerId: '22222222-2222-2222-2222-222222222222',
                role: 'owner',
                organizerName: 'Robotics & Automation Society',
              },
            ],
          },
        }),
      });
    });

    // Mock form builder get and put
    let currentForm = {
      eventId: mockEventId,
      version: 1,
      isFrozen: false,
      registrationCount: 0,
      fields: [
        {
          id: 'fld-dietary-1',
          position: 0,
          type: 'dietary',
          label: 'Dietary Preference',
          helpText: 'Select your meal option for the lunch session',
          required: true,
          options: ['Vegetarian', 'Vegan', 'Jain', 'Halal', 'No Preference'],
          validation: {},
          version: 1,
        },
      ],
    };

    await page.route(`**/api/v1/events/${mockEventId}/form`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ form: currentForm }),
        });
      } else if (route.request().method() === 'PUT') {
        const payload = JSON.parse(route.request().postData() || '{}');
        currentForm = {
          ...currentForm,
          version: currentForm.version + 1,
          fields: payload.fields.map((f: any, idx: number) => ({
            ...f,
            id: f.id || `fld-${idx}-${Date.now()}`,
            version: currentForm.version + 1,
          })),
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ form: currentForm }),
        });
      }
    });

    // Mock form submissions
    await page.route(`**/api/v1/events/${mockEventId}/form/submissions`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          eventId: mockEventId,
          totalSubmissions: 1,
          submissions: [
            {
              bookingId: 'bkg-demo-101',
              userId: 'usr-student-42',
              attendeeName: 'Aarav Sharma',
              attendeeEmail: 'aarav.sharma@campus.edu',
              bookingStatus: 'CONFIRMED',
              registrationDate: '2026-10-26T10:00:00Z',
              attendees: {
                0: [
                  {
                    fieldId: 'fld-dietary-1',
                    fieldLabel: 'Dietary Preference',
                    fieldType: 'dietary',
                    value: 'Vegetarian',
                  },
                ],
              },
            },
          ],
        }),
      });
    });
  });

  test('Organizer designs custom form, previews, and inspects submissions', async ({ page }, testInfo) => {
    // 1. Visit organizer dashboard
    await page.goto('/organizer');
    await expect(page.getByText('Club Organizer Command Center & Analytics')).toBeVisible();

    // 2. Click Registration Forms tab
    const formsTab = page.getByRole('button', { name: /registration forms \(p11\)/i });
    await expect(formsTab).toBeVisible();
    await formsTab.click();

    // 3. Form Builder interface is visible
    await expect(page.getByText('Registration Form Builder')).toBeVisible();
    await expect(page.getByText('Dietary Preference')).toBeVisible();

    // 4. Switch to Live Preview
    const previewBtn = page.getByRole('button', { name: /live preview/i });
    await previewBtn.click();
    await expect(page.getByText('Attendee Registration Preview')).toBeVisible();

    // Take screenshot of form builder preview
    await safeScreenshot(page, testInfo, 'phase-p11-form-preview.png');

    // 5. Switch back to Editor and add a field
    await page.getByRole('button', { name: 'Editor' }).click();
    const addDropdownBtn = page.getByRole('button', { name: 'Dropdown' });
    await expect(addDropdownBtn).toBeVisible();
    await addDropdownBtn.click();

    // 6. Save form
    const saveBtn = page.getByRole('button', { name: /save form/i });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    await expect(page.getByText(/Registration Form Saved/i)).toBeVisible();

    // 7. Switch to Submissions view
    const submissionsSubTab = page.getByRole('button', { name: /view responses & answers/i });
    await expect(submissionsSubTab).toBeVisible();
    await submissionsSubTab.click();

    await expect(page.getByText('Attendee Questionnaire Responses')).toBeVisible();
    await expect(page.getByText('Aarav Sharma')).toBeVisible();
    await expect(page.getByText('Vegetarian')).toBeVisible();

    // Take screenshot of submissions view
    await safeScreenshot(page, testInfo, 'phase-p11-submissions-view.png');
  });
});
