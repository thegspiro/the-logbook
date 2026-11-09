/**
 * What a screen reader gets from a `rwd-table` once it has become cards.
 *
 * Card mode hides the <thead>, so the column a value belongs to reaches
 * assistive technology only through the cell's `::before` label, which must
 * stay part of the cell's accessible name, and the table, row and cell roles
 * must survive the `display` changes. CI runs this in Chromium and in Mobile
 * Safari, the engine where table semantics are most fragile.
 *
 * The finance Pending approvals table stands in for every reflow table: they
 * share one set of reflow rules in `styles/index.css`.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';

const PERMISSIONS = [...TEST_USER.permissions, 'finance.view', 'finance.approve'];

const PENDING_APPROVALS = [0, 1].map((i) => ({
  stepRecordId: `step-${i}`,
  entityType: 'purchase_request',
  entityId: `entity-${i}`,
  entityTitle: `PR-2026-00${i}4 Replacement SCBA cylinders`,
  entityAmount: i === 0 ? '248750.00' : '187325.50',
  requesterName: i === 0 ? 'Alexandra Ayala-Montgomery' : 'Christopher Vanderbilt-Okonkwo',
  stepName: 'Treasurer review',
  stepOrder: 1,
  submittedAt: '2026-10-14T15:00:00Z',
  assigneeLabel: 'Finance Committee',
  canAct: true,
  requiresOverride: false,
  lateLineCount: 0,
  fundShortfall: null,
  emailDelivery: 'sent',
  emailStatusAt: '2026-10-14T15:00:00Z',
  emailLinkVersion: 1,
  canResendEmail: true,
}));

const CARD_VIEWPORTS = [
  { name: 'iPhone 390x844', width: 390, height: 844 },
  { name: 'iPad portrait 820x1180', width: 820, height: 1180 },
];

const TABLE_VIEWPORT = { name: 'desktop 1920x1080', width: 1920, height: 1080 };

async function openApprovals(page: Page): Promise<void> {
  await signIn(page, { permissions: PERMISSIONS });
  await page.route('**/api/v1/finance/approvals/pending**', (route) => {
    void route.fulfill(json(PENDING_APPROVALS));
  });
  await page.route('**/api/v1/finance/approvals/unrouted**', (route) => {
    void route.fulfill(json([]));
  });
  await page.goto('/finance/approvals');
}

const approvalsTable = (page: Page) =>
  page
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Waiting on', exact: true }) });

test.describe('Reflow table in card mode keeps its column context for screen readers', () => {
  for (const viewport of CARD_VIEWPORTS) {
    test(`/finance/approvals — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openApprovals(page);
      const table = approvalsTable(page);
      await table.waitFor();

      // Card mode: the header row is gone from the accessibility tree...
      await expect(table.getByRole('columnheader')).toHaveCount(0);
      // ...but every row and cell keeps its role, and each value cell is
      // announced with its column's label.
      await expect(table.getByRole('row')).toHaveCount(PENDING_APPROVALS.length);
      await expect(table.getByRole('cell', { name: 'Amount $248,750.00', exact: true })).toHaveCount(1);
      await expect(
        table.getByRole('cell', { name: 'Requested by Christopher Vanderbilt-Okonkwo', exact: true })
      ).toHaveCount(1);
    });
  }

  test(`/finance/approvals — ${TABLE_VIEWPORT.name} (table layout, for contrast)`, async ({ page }) => {
    await page.setViewportSize(TABLE_VIEWPORT);
    await openApprovals(page);
    const table = approvalsTable(page);
    await table.waitFor();

    // Table mode: real column headers, and cells hold only their value.
    await expect(table.getByRole('columnheader', { name: 'Amount', exact: true })).toBeVisible();
    await expect(table.getByRole('cell', { name: '$248,750.00', exact: true })).toHaveCount(1);
  });
});
