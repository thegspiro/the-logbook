import { expect, test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [...TEST_USER.permissions, 'members.manage_id_cards'];

const MEMBER_NAMES: [string, string][] = [
  ['Alexandra', 'Ayala-Montgomery'],
  ['Christopher', 'Vanderbilt-Okonkwo'],
  ['Maximiliano', 'Fitzgerald-Hernandez'],
  ['Bartholomew', 'Kowalczyk-Richardson'],
];

const RANKS = ['battalion_chief', 'captain', 'lieutenant', 'firefighter'];

const ROSTER = MEMBER_NAMES.map(([firstName, lastName], i) => ({
  id: `member-${i}`,
  organization_id: 'org-1',
  username: `${firstName.toLowerCase()}.${lastName.toLowerCase()}`,
  email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@northfield-oakville-fire.gov`,
  first_name: firstName,
  last_name: lastName,
  rank: RANKS[i] ?? 'firefighter',
  membership_number: `NOFR-2019-00${i + 41}`,
  phone: `(555) 867-53${i}9`,
  mobile: `(555) 201-44${i}7`,
  status: i === 2 ? 'probationary' : 'active',
  hire_date: `201${i + 2}-04-17`,
  roles: [],
  positions: [],
}));

// rwd-table-xwide's threshold, 78rem. A card at least this wide must show
// the roster as a table.
const XWIDE_TIER_PX = 78 * 16;

const CONTACT_INFO = { enabled: true, show_email: true, show_phone: true, show_mobile: true };

// The member roster sets a member's name and username beside rank, member
// number, phone and email, status, hire date and three actions. On a tablet or
// a laptop that is wider than the roster card, which hid the actions off to
// the right of every row.
test.describe('Members — roster table', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/members — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route(
        (url) => url.pathname === '/api/v1/users',
        (route) => {
          void route.fulfill(json(ROSTER));
        }
      );
      await page.route('**/api/v1/users/contact-info-enabled**', (route) => {
        void route.fulfill(json(CONTACT_INFO));
      });
      await page.goto('/members');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Rank', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Member roster table');
      // Cards always fit their box, so the fit check above passes in card
      // layout too. The roster once went to cards on every screen because its
      // tier was wider than the ~1278px the capped page column gives any card;
      // the header row is visible only in table layout, so this pins that a
      // card wide enough for the tier keeps the table.
      const room = await table.evaluate((el) => el.closest('.rwd-table-container')?.clientWidth ?? 0);
      if (room >= XWIDE_TIER_PX) {
        await expect(table.locator('thead'), 'Member roster shows as cards in a desktop-width card').toBeVisible();
      }
    });
  }
});
