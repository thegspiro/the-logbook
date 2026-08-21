import { expect, test, type Page } from '@playwright/test';
import { json, mockApi, signIn } from './helpers';

const VIEWPORTS = [
  { name: 'narrow portrait', width: 320, height: 568 },
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'short landscape', width: 568, height: 320 },
] as const;

const LONG = 'West Oakville Volunteer Fire and Emergency Services — Annual Operations Qualification Review';

const WORKFLOWS = [
  { name: 'login and MFA', path: '/login' },
  { name: 'event RSVP and check-in', path: '/events/event-1/check-in' },
  { name: 'member lookup', path: '/members/scan' },
  { name: 'training submission', path: '/training/submit' },
  { name: 'scheduling', path: '/scheduling' },
  { name: 'inventory scan and checkout', path: '/inventory/checkouts' },
  { name: 'document access', path: '/documents' },
  { name: 'forms', path: '/forms' },
  { name: 'settings', path: '/settings' },
  { name: 'administration approvals', path: '/admin/audit-log' },
] as const;

async function installWorkflowData(page: Page) {
  const fixtures: [string, unknown][] = [
    ['**/api/v1/events/**', { id: 'event-1', title: LONG, status: 'scheduled', attendees: [], rsvp_status: 'yes' }],
    ['**/api/v1/members/**', { members: [{ id: 'member-1', first_name: 'Alexandria', last_name: LONG }], total: 1 }],
    ['**/api/v1/training/**', { records: [{ id: 'record-1', title: LONG }], courses: [], total: 1 }],
    ['**/api/v1/inventory/**', { items: [{ id: 'item-1', name: LONG, barcode: '012345678901' }], total: 1 }],
    [
      '**/api/v1/documents/**',
      { documents: [{ id: 'document-1', name: `${LONG}.pdf`, can_download: true }], total: 1 },
    ],
    ['**/api/v1/forms/**', { forms: [{ id: 'form-1', title: LONG, status: 'published' }], total: 1 }],
    ['**/api/v1/admin/**', { items: [{ id: 'approval-1', description: LONG, status: 'pending' }], total: 1 }],
  ];
  for (const [url, body] of fixtures) await page.route(url, (route) => void route.fulfill(json(body)));
}

async function assertMobileBody(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.locator('body')).not.toContainText('Oops! Something went wrong');
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.beforeEach(async ({ page }) => page.setViewportSize(viewport));

    for (const workflow of WORKFLOWS) {
      test(`${workflow.name} @critical-mobile`, async ({ page }) => {
        if (workflow.path === '/login') {
          await mockApi(page);
          await page.route(
            '**/api/v1/auth/login',
            (route) => void route.fulfill(json({ mfa_required: true, mfa_token: 'mfa-e2e' }))
          );
          await page.goto('/login');
          const inputs = page.locator('input:visible');
          if (await inputs.count()) await inputs.first().fill('mobile@example.com');
          await assertMobileBody(page);
          return;
        }

        await signIn(page);
        await installWorkflowData(page);
        await page.goto(workflow.path);
        await assertMobileBody(page);

        // Exercise large text and an open overlay without coupling the workflow
        // smoke test to module-specific button copy.
        await page.addStyleTag({ content: 'html { font-size: 125% !important; }' });
        const overlayTrigger = page.locator('button[aria-haspopup]:visible').first();
        if (await overlayTrigger.count()) {
          await overlayTrigger.click();
          await page.keyboard.press('Escape');
        }
        await assertMobileBody(page);
      });
    }

    test('offline recovery @critical-mobile', async ({ page, context }) => {
      await signIn(page);
      await page.goto('/dashboard');
      await context.setOffline(true);
      await expect(page.locator('body')).not.toContainText('Oops! Something went wrong');
      await context.setOffline(false);
      await page.reload();
      await assertMobileBody(page);
    });
  });
}
