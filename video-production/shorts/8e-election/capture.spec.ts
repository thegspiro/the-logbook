import { test, type Page, type Route } from '@playwright/test';

import { signIn, TEST_USER } from '../../../frontend/src/e2e/helpers';
import {
  SCALE,
  ZONE,
  centre,
  choose,
  dayKey,
  prepare,
  recordShots,
  settle,
  tap,
  zoneDay,
  zoned,
} from '../../lib/recorder';

/**
 * Short 8E — "Running a Department Election".
 *
 * Recorded on a tablet: on a phone the election page sends setup to "a tablet
 * or computer" and offers no candidate screens. The capture stands in for the
 * server with one election whose state each step moves on — created, given
 * candidates, opened, ballots sent, voted on, closed — so every screen agrees
 * with the one before it.
 */

const TABLET = { width: 820, height: 1180 };
const ID = 'election-2027';
const OPENS = zoneDay(1);
const CLOSES = zoneDay(8);
const NOW = new Date().toISOString();

const OFFICES = ['Chief', 'Captain', 'President'];
const SEEDED = [
  {
    name: 'Chris Reyes',
    position: 'Chief',
    statement: 'Twenty years on the line; I want our training budget doubled.',
  },
  { name: 'Jordan Lee', position: 'Captain', statement: 'Steady hands on Engine 1 and a fair duty roster.' },
  { name: 'Sam Ortiz', position: 'Captain', statement: 'More cross-training between companies.' },
  { name: 'Riya Patel', position: 'President', statement: 'Open books and monthly membership updates.' },
];

type Status = 'draft' | 'open' | 'closed';
const state: {
  created: Record<string, unknown> | null;
  status: Status;
  candidates: Record<string, unknown>[];
  emailed: boolean;
} = {
  created: null,
  status: 'draft',
  candidates: [],
  emailed: false,
};

const candidate = (c: { name: string; position: string; statement?: string }, i: number) => ({
  id: `cand-${i + 1}`,
  election_id: ID,
  name: c.name,
  position: c.position,
  statement: c.statement ?? '',
  nomination_date: NOW,
  accepted: true,
  is_write_in: false,
  display_order: i,
  created_at: NOW,
  updated_at: NOW,
});

const ballotItems = () =>
  OFFICES.map((office) => ({
    id: `item-${office.toLowerCase()}`,
    type: 'officer_election',
    title: office === 'Chief' ? 'Fire Chief' : office,
    position: office,
    eligible_voter_types: ['all'],
    vote_type: 'candidate_selection',
  }));

const election = () => ({
  id: ID,
  organization_id: 'org-1',
  election_type: 'general',
  positions: OFFICES,
  anonymous_voting: true,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  voting_method: 'simple_majority',
  enable_runoffs: true,
  runoff_type: 'top_two',
  max_runoff_rounds: 1,
  ...state.created,
  title: String(state.created?.title ?? '2027 Officer Election'),
  start_date: String(state.created?.start_date ?? zoned(OPENS, 18, 0).toISOString()),
  end_date: String(state.created?.end_date ?? zoned(CLOSES, 21, 0).toISOString()),
  status: state.status,
  ballot_items: ballotItems(),
  email_sent: state.emailed,
  ...(state.emailed ? { email_sent_at: NOW } : {}),
  is_runoff: false,
  runoff_round: 0,
  closed_at: state.status === 'closed' ? NOW : null,
  // Votes exist only once voting has run its course.
  total_votes: state.status === 'closed' ? 47 : 0,
  total_voters: state.status === 'closed' ? 47 : 0,
  voter_turnout_percentage: state.status === 'closed' ? 78 : 0,
  created_at: NOW,
  updated_at: NOW,
});

const result = (name: string, votes: number, total: number, winner: boolean, i: number) => ({
  candidate_id: `cand-r${i}`,
  candidate_name: name,
  vote_count: votes,
  percentage: Math.round((votes / total) * 1000) / 10,
  is_winner: winner,
});

const results = () => {
  const positions = [
    {
      position: 'Chief',
      label: 'Fire Chief',
      total: 47,
      rows: [
        ['Dana Smith', 29, true],
        ['Chris Reyes', 18, false],
      ],
    },
    {
      position: 'Captain',
      label: 'Captain',
      total: 47,
      rows: [
        ['Jordan Lee', 26, true],
        ['Sam Ortiz', 21, false],
      ],
    },
    { position: 'President', label: 'President', total: 47, rows: [['Riya Patel', 47, true]] },
  ] as const;
  let n = 0;
  return {
    election_id: ID,
    election_title: election().title,
    status: state.status,
    total_votes: 47,
    total_eligible_voters: 60,
    voter_turnout_percentage: 78.3,
    results_by_position: positions.map((p) => ({
      position: p.position,
      label: p.label,
      ballot_item_id: `item-${p.position.toLowerCase()}`,
      vote_type: 'candidate_selection',
      total_votes: p.total,
      candidates: p.rows.map(([name, votes, win]) => result(name, votes, p.total, win, (n += 1))),
    })),
    overall_results: [],
    quorum_met: true,
  };
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const lastYear = {
  id: 'election-2026',
  title: '2026 Officer Election',
  election_type: 'general',
  start_date: '2025-11-20T23:00:00Z',
  end_date: '2025-11-28T03:00:00Z',
  closed_at: '2025-11-28T03:00:00Z',
  status: 'closed',
  positions: OFFICES,
  total_votes: 44,
  runoff_round: 0,
};

// Registered after signIn's fixtures, so these answer first for /elections.
async function mockElections(page: Page) {
  // The election page lists meetings and pending applicant packages for its
  // setup panels; the fixtures' catch-all answers {} where it reads arrays.
  await page.route('**/api/v1/meetings**', (route) => json(route, { meetings: [], total: 0, skip: 0, limit: 100 }));
  await page.route('**/api/v1/prospective-members/election-packages**', (route) => json(route, []));
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/elections'),
    async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace('/api/v1', '');
      const method = req.method();
      if (path === '/elections' && method === 'POST') {
        state.created = req.postDataJSON() as Record<string, unknown>;
        state.candidates = SEEDED.map(candidate);
        return json(route, election(), 201);
      }
      if (path === '/elections')
        return json(route, state.created ? [{ ...election(), total_votes: 0 }, lastYear] : [lastYear]);
      if (path === '/elections/ballot/lookup') {
        return json(route, { election: election(), candidates: state.candidates });
      }
      if (path === '/elections/ballot/vote/bulk') {
        return json(route, {
          success: true,
          votes_cast: 3,
          abstentions: 0,
          message: 'Your ballot was recorded.',
          receipt_hashes: ['8f3a2c'],
        });
      }
      if (path === `/elections/${ID}`) return json(route, election());
      if (path === `/elections/${ID}/candidates` && method === 'POST') {
        const body = req.postDataJSON() as { name: string; position: string; statement?: string };
        state.candidates = [...state.candidates, candidate(body, state.candidates.length)];
        return json(route, state.candidates[state.candidates.length - 1], 201);
      }
      if (path === `/elections/${ID}/candidates`) return json(route, state.candidates);
      if (path === `/elections/${ID}/open`) {
        state.status = 'open';
        return json(route, election());
      }
      if (path === `/elections/${ID}/close`) {
        state.status = 'closed';
        return json(route, election());
      }
      if (path.startsWith(`/elections/${ID}/ballot-send-jobs`)) {
        state.emailed = true;
        return json(route, {
          id: 'job-1',
          election_id: ID,
          kind: 'ballots',
          status: 'completed',
          created_at: NOW,
          started_at: NOW,
          finished_at: NOW,
          result: {
            success: true,
            recipients_count: 60,
            failed_count: 0,
            skipped_count: 0,
            skipped_details: [],
            message: 'Ballots sent to 60 members.',
          },
          error: null,
        });
      }
      if (path === `/elections/${ID}/results`) return json(route, results());
      if (path === `/elections/${ID}/manual-ballots`) return json(route, { batches: [] });
      // The page runs the vote-integrity check itself; the fixtures' catch-all
      // answers {} and the page reads tampered_vote_ids.length off it.
      if (path === `/elections/${ID}/integrity`) {
        const votes = state.status === 'draft' ? 0 : 47;
        return json(route, {
          election_id: ID,
          total_votes: votes,
          counted_votes: votes,
          pending_paper_votes: 0,
          test_votes: 0,
          valid_signatures: votes,
          unsigned_votes: 0,
          tampered_votes: 0,
          tampered_vote_ids: [],
          chain_verified: true,
          chain_break_at: null,
          integrity_status: 'PASS',
        });
      }
      return route.fallback();
    }
  );
}

test.use({ viewport: TABLET, deviceScaleFactor: SCALE, timezoneId: ZONE, hasTouch: true });

test('capture 8e-election', async ({ page }) => {
  await prepare(page);
  if (process.env.VIDEO_DEBUG) {
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes('/api/v1/'))
        console.log('REQ', r.method(), r.url().replace(/^.*\/api\/v1/, ''));
    });
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300));
    });
  }
  await signIn(page, { permissions: [...TEST_USER.permissions, 'elections.view', 'elections.manage'] });
  await mockElections(page);
  await page.goto('/elections');
  await settle(page);

  const dialog = () => page.getByRole('dialog');

  await recordShots(page, '8e-election', async (shot) => {
    await shot('hook', async () => {
      await page.waitForTimeout(600);
    });
    await shot('create', async () => {
      await tap(page, page.getByRole('button', { name: 'Create Election' }).first());
      await dialog().waitFor();
      const title = dialog().getByLabel('Title');
      await tap(page, title);
      await title.pressSequentially('2027 Officer Election', { delay: 35 });
      const start = dialog().getByLabel('Start Date & Time');
      await tap(page, start);
      await start.fill(dayKey(OPENS));
      await choose(page, dialog().getByLabel('Start time hour'), '6');
      await choose(page, dialog().getByLabel('Start time minute'), '00');
      await choose(page, dialog().getByLabel('Start time AM/PM'), 'PM');
      const end = dialog().getByLabel('End Date & Time');
      await tap(page, end);
      await end.fill(dayKey(CLOSES));
      await choose(page, dialog().getByLabel('End time hour'), '9');
      await choose(page, dialog().getByLabel('End time minute'), '00');
      await choose(page, dialog().getByLabel('End time AM/PM'), 'PM');
      const office = dialog().getByLabel('Position name');
      for (const name of OFFICES) {
        await tap(page, office);
        await office.pressSequentially(name, { delay: 40 });
        await tap(page, dialog().getByRole('button', { name: 'Add', exact: true }));
      }
    });
    await shot('runoffs', async () => {
      // A runoff follows a majority rule; under the default plurality rule
      // only a tie would ever call one.
      await choose(page, dialog().locator('#election-voting-method'), 'simple_majority|majority');
      await page.waitForTimeout(400);
      await tap(page, dialog().getByLabel('Enable Automatic Runoffs'));
      await page.waitForTimeout(500);
    });
    await shot('candidates', async () => {
      await tap(page, dialog().getByRole('button', { name: 'Create Election' }));
      await dialog().waitFor({ state: 'hidden' });
      await settle(page);
      await tap(page, page.getByText('2027 Officer Election').first());
      await settle(page);
      await page.goto(`/elections/${ID}/candidates`);
      await settle(page);
      await tap(page, page.getByRole('button', { name: '+ Add Candidate' }));
      const name = page.locator('#candidate-name');
      await tap(page, name);
      await name.pressSequentially('Dana Smith', { delay: 35 });
      await choose(page, page.locator('#candidate-position'), 'Chief');
      const statement = page.locator('#candidate-statement');
      await tap(page, statement);
      await statement.pressSequentially('Safer scenes, fairer rotations, and every member heard.', { delay: 18 });
      await tap(page, page.getByRole('button', { name: 'Add Candidate', exact: true }));
      await page.getByText('Dana Smith').first().waitFor();
      await centre(page, page.getByText('Dana Smith').first());
    });
    await shot('open', async () => {
      await page.goto(`/elections/${ID}`);
      await settle(page);
      await tap(page, page.getByRole('button', { name: 'Open Election' }).first());
      const confirmOpen = page.getByRole('dialog').getByRole('button', { name: /Open/ });
      await tap(page, confirmOpen.last());
      await page
        .getByRole('button', { name: /Send Ballot Emails/ })
        .first()
        .waitFor();
      await settle(page);
      await tap(page, page.getByRole('button', { name: /Send Ballot Emails/ }).first());
      await tap(page, page.getByRole('button', { name: 'Send Ballots' }));
      // The dialog polls the send job and closes itself when it finishes.
      await page.getByRole('heading', { name: /Send Ballot Emails/ }).waitFor({ state: 'hidden', timeout: 20_000 });
      await page.waitForTimeout(800);
    });
    await shot('vote', async () => {
      // The member's side: the link from their ballot email.
      await page.goto('/ballot?token=demo-ballot-token');
      await settle(page);
      for (const pick of ['Dana Smith', 'Jordan Lee', 'Riya Patel']) {
        await tap(page, page.getByText(pick, { exact: true }).first());
      }
      await tap(page, page.getByRole('button', { name: 'Submit Ballot' }));
      await tap(page, page.getByRole('dialog').getByRole('button', { name: 'Cast Ballot' }));
      await settle(page);
    });
    await shot('results', async () => {
      state.status = 'closed';
      await page.goto(`/elections/${ID}/results`);
      await settle(page);
      await centre(page, page.getByText('Dana Smith').first());
    });
    await shot('outro', async () => {
      await page.waitForTimeout(300);
    });
  });
});
