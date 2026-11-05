import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [...TEST_USER.permissions, 'members.manage_id_cards'];

// The ID cards page shows a "turned off" notice unless the integration reports connected.
const CONNECTED_INTEGRATIONS = [{ integration_type: 'nfc-id-cards', status: 'connected' }];

const OUTCOMES = ['checked_in', 'already_checked_in', 'member_inactive', 'unknown_card'];
const MEMBERS = ['Alexandra Ayala-Montgomery', 'Christopher Vanderbilt-Okonkwo', 'Maximiliano Fitzgerald-Hernandez'];

const CARD_TAPS = {
  items: OUTCOMES.map((outcome, i) => {
    const unknown = outcome === 'unknown_card';
    return {
      id: `tap-${i}`,
      tappedAt: `2026-10-1${i}T22:45:00Z`,
      outcome,
      source: i % 2 ? 'kiosk' : 'station',
      tagId: unknown ? null : `tag-${i}`,
      cardUidPreview: unknown ? null : `9F${i}A`,
      cardLabel: 'Replacement ID card (Station 14 issue)',
      unknownCardKey: unknown ? '04A1B2C3D4E5F6' : null,
      userId: unknown ? null : `user-${i}`,
      memberName: unknown ? null : (MEMBERS[i] ?? null),
      locationId: 'location-1',
      locationName: 'Station 14 Apparatus Bay Training Classroom',
      operatorId: 'operator-1',
      operatorName: 'Captain Josephine Abernathy-Whitfield',
      targetType: 'event',
      targetId: 'event-1',
      targetName: 'Quarterly Hazardous Materials Operations Refresher Drill',
    };
  }),
  total: OUTCOMES.length,
  limit: 50,
  offset: 0,
};

// The ID card tap log lists every tap with its time, outcome, member, card,
// reader and what it checked into. Its card is `overflow-hidden`, so on a
// tablet or a laptop a table wider than the card is clipped rather than
// scrolled, and the last columns cannot be reached at all.
test.describe('Member ID cards — tap log table', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/members/admin/id-cards?tab=taps — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/integrations/connected**', (route) => {
        void route.fulfill(json(CONNECTED_INTEGRATIONS));
      });
      await page.route('**/api/v1/nfc-tags/taps**', (route) => {
        void route.fulfill(json(CARD_TAPS));
      });
      await page.goto('/members/admin/id-cards?tab=taps');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Outcome' }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'ID card tap log table');
    });
  }
});
