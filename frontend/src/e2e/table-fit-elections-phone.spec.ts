import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const VOIDED_AT = '2026-12-03T18:45:00Z';

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

const forensics = {
  election_id: 'election-1',
  election_title: election.title,
  election_status: 'open',
  anonymous_voting: true,
  voting_method: 'simple_majority',
  created_at: '2026-11-01T15:00:00Z',
  vote_integrity: {
    election_id: 'election-1',
    total_votes: 4,
    counted_votes: 4,
    pending_paper_votes: 0,
    test_votes: 0,
    valid_signatures: 4,
    unsigned_votes: 0,
    tampered_votes: 0,
    tampered_vote_ids: [],
    chain_verified: true,
    integrity_status: 'PASS',
  },
  deleted_votes: {
    count: 4,
    paper_batch_count: 0,
    records: [0, 1, 2, 3].map((i) => ({
      vote_id: `7f3c9a1e-4b2d-4e8f-9a6b-1c2d3e4f5a6${i}`,
      candidate_id: null,
      position: 'Deputy Chief of Operations and Emergency Medical Services',
      deleted_at: VOIDED_AT,
      deleted_by: 'user-1',
      deletion_reason:
        'Voter reported casting the ballot on a shared station computer that another member had left signed in',
      is_manual: false,
      manual_batch_id: null,
    })),
  },
  rollback_history: [],
  voting_tokens: { total_issued: 4, total_used: 1, total_superseded: 1, total_expired: 1, total_live: 1, records: [] },
  audit_log: {
    total_entries: 4,
    entries: [0, 1, 2, 3].map((i) => ({
      id: `audit-${i}`,
      timestamp: VOIDED_AT,
      event_type: 'member_voting_wait_override_changed',
      severity: i % 2 ? 'warning' : 'critical',
      user_id: 'user-1',
      ip_address: null,
      event_data: {},
    })),
  },
  anomaly_detection: { suspicious_ips: {} },
  voting_timeline: {},
  voting_timeline_timezone: null,
};

async function openIntegrity(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await signIn(page, { permissions: [...TEST_USER.permissions, 'elections.view', 'elections.manage'] });
  // The detail page reads both of these on load; the default mock's `{}` has
  // no `meetings` or `batches` array and takes the page down.
  await page.route('**/api/v1/meetings**', (route) =>
    route.fulfill(json({ meetings: [], total: 0, skip: 0, limit: 100 }))
  );
  await page.route('**/api/v1/elections/election-1/manual-ballots**', (route) => route.fulfill(json({ batches: [] })));
  await page.route('**/api/v1/elections/election-1', (route) => route.fulfill(json(election)));
  await page.route('**/api/v1/elections/election-1/forensics', (route) => route.fulfill(json(forensics)));
  await page.goto('/elections/election-1/integrity');
}

// Voided votes in the integrity report: a shortened vote id, the position, a
// free-text reason and the time it was voided.
test.describe('Voided votes table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/elections/:id/integrity voided votes — ${viewport.name}`, async ({ page }) => {
      await openIntegrity(page, viewport);

      const table = page.getByRole('table', { name: 'Voided votes' });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Voided votes table');
    });
  }
});

// The election's audit log: a long written-out time, a snake_case event type
// with no break opportunity, and a severity badge.
test.describe('Audit log entries table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/elections/:id/integrity audit log — ${viewport.name}`, async ({ page }) => {
      await openIntegrity(page, viewport);

      const table = page.getByRole('table', { name: 'Audit log entries' });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Audit log entries table');
    });
  }
});
