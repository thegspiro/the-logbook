import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const MEMBER_NAMES = [
  'Alexandra Ayala-Montgomery',
  'Christopher Vandenberghe-Whitfield',
  'Maria-Guadalupe Fernandez-Castellanos',
  'Jonathan Okonkwo-Richardson',
];

const election = {
  id: 'election-1',
  organization_id: 'org-1',
  title: 'Annual Election of Line and Administrative Officers 2026',
  election_type: 'general',
  start_date: '2026-12-01T14:00:00Z',
  end_date: '2026-12-08T23:00:00Z',
  status: 'open',
  anonymous_voting: true,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: true,
  voting_method: 'simple_majority',
  victory_condition: 'most_votes',
  enable_runoffs: false,
  runoff_type: 'top_two',
  max_runoff_rounds: 1,
  is_runoff: false,
  runoff_round: 0,
  ballot_items: [],
  positions: [],
};

const roster = {
  election_id: 'election-1',
  election_title: election.title,
  election_status: 'open',
  total_members: 4,
  total_eligible: 3,
  total_ineligible: 1,
  total_voted: 1,
  total_overrides: 1,
  total_ballots_sent: 1,
  email_sent_at: '2026-11-02T15:00:00Z',
  roster: MEMBER_NAMES.map((fullName, i) => ({
    user_id: `user-${i}`,
    full_name: fullName,
    email: `member${i}@oakville-volunteer-fire.org`,
    membership_type: 'Life Member (Exempt, Twenty-Five Years)',
    has_override: i === 1,
    has_voted: i === 2,
    is_attending: true,
    will_receive_ballot: i !== 3,
    ballot_sent: i === 2,
    eligible_item_count: 3,
    total_item_count: 4,
    ineligibility_reason:
      i === 3 ? 'Did not meet the minimum meeting-attendance requirement for the preceding twelve months' : undefined,
    item_eligibility: [
      { ballot_item_id: 'item-1', ballot_item_title: 'Election of Fire Chief', eligible: true },
      {
        ballot_item_id: 'item-2',
        ballot_item_title: 'Amendment to the Bylaws on Probationary Membership',
        eligible: false,
        reason: 'Probationary members may not vote on bylaw amendments',
      },
    ],
  })),
};

// The voter eligibility roster: expand chevron, member with membership type,
// status badges, item count, ballot delivery with its send time, and the
// ineligibility reason. One row is expanded to show its per-item detail.
test.describe('Voter eligibility roster fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/elections/:id?tab=eligibility — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: [...TEST_USER.permissions, 'elections.view', 'elections.manage'] });
      // The detail page reads both of these on load; the default mock's `{}`
      // has no `meetings` or `batches` array and takes the page down.
      await page.route('**/api/v1/meetings**', (route) =>
        route.fulfill(json({ meetings: [], total: 0, skip: 0, limit: 100 }))
      );
      await page.route('**/api/v1/elections/election-1/manual-ballots**', (route) =>
        route.fulfill(json({ batches: [] }))
      );
      await page.route('**/api/v1/elections/election-1', (route) => route.fulfill(json(election)));
      await page.route('**/api/v1/elections/election-1/eligibility-roster**', (route) => route.fulfill(json(roster)));
      await page.goto('/elections/election-1?tab=eligibility');

      const table = page.getByRole('table', { name: 'Voter eligibility roster' });
      await table.waitFor();
      await table.getByText(MEMBER_NAMES[0] ?? '').click();
      await table.getByText('Per-Item Eligibility').waitFor();
      await expectTableFitsItsCard(table, 'Voter eligibility roster');
    });
  }
});
