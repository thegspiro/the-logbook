import { test, type Page, type Route } from '@playwright/test';

import { TEST_USER, signIn } from '../../../frontend/src/e2e/helpers';
import { SCALE, SCREEN, centre, choose, prepare, recordShots, settle, tap } from '../../lib/recorder';

/**
 * Short 8F — "Adding a New Member to the System".
 *
 * Serves a small roster at GET /users and adds whatever POST /users receives
 * to it, so the list the form returns to shows the new member. Email is
 * reported as set up (the temporary password is emailed) and membership
 * numbers as assigned automatically, the two cases the narration describes as
 * the default. Every name, address and number is invented; the phone numbers
 * are in the 555-01xx range set aside for fiction.
 */

const ORG = 'org-1';

interface Member {
  id: string;
  organization_id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  display_name: string;
  membership_number: string;
  rank: string;
  station: string;
  status: string;
  member_class: string;
  member_status: string;
}

const member = (n: number, first: string, last: string, rank: string, standing = 'regular'): Member => ({
  id: `member-${n}`,
  organization_id: ORG,
  username: `${first}_${last}`.toLowerCase(),
  email: `${first}.${last}@example.com`.toLowerCase(),
  first_name: first,
  last_name: last,
  full_name: `${first} ${last}`,
  display_name: `${first} ${last}`,
  membership_number: `OFD-${String(140 + n).padStart(4, '0')}`,
  rank,
  station: 'Station 1',
  status: 'active',
  member_class: 'operational',
  member_status: standing,
});

const RANKS = [
  ['chief', 'Chief'],
  ['captain', 'Captain'],
  ['lieutenant', 'Lieutenant'],
  ['firefighter', 'Firefighter'],
  ['probationary_firefighter', 'Probationary Firefighter'],
].map(([code, name], i) => ({
  id: `rank-${code}`,
  organization_id: ORG,
  rank_code: code,
  display_name: name,
  description: null,
  sort_order: i,
  is_active: true,
  eligible_positions: null,
  default_permission_count: 0,
}));

const POSITIONS = ['Secretary', 'Treasurer', 'Training Officer', 'Safety Officer'].map((name) => ({
  id: `position-${name.toLowerCase().replace(/ /g, '-')}`,
  name,
  kind: 'office',
  mirrors_rank: false,
  permissions: [],
}));

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// Registered after signIn's fixtures, so these answer first for their URLs.
async function mockMembers(page: Page) {
  const roster: Member[] = [
    member(1, 'Alex', 'Johnson', 'captain'),
    member(2, 'Dana', 'Smith', 'lieutenant'),
    member(3, 'Chris', 'Patel', 'firefighter'),
    member(4, 'Morgan', 'Lee', 'firefighter'),
    member(5, 'Sam', 'Okafor', 'firefighter'),
    member(6, 'Taylor', 'Brooks', 'probationary_firefighter', 'probationary'),
  ];

  await page.route(
    (url) => url.pathname === '/api/v1/users',
    async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as Record<string, string>;
        const first = body.first_name ?? '';
        const last = body.last_name ?? '';
        const created: Member = {
          ...member(roster.length + 1, first, last, body.rank ?? ''),
          email: body.email ?? '',
          member_status: body.member_status ?? 'probationary',
        };
        roster.push(created);
        return json(route, created, 201);
      }
      return json(route, roster);
    }
  );
  await page.route('**/api/v1/users/welcome-email-available', (route) => json(route, { available: true }));
  await page.route('**/api/v1/organization/settings/membership-id/preview', (route) =>
    json(route, { enabled: true, next_id: `OFD-${String(141 + roster.length).padStart(4, '0')}` })
  );
  await page.route(
    (url) => url.pathname === '/api/v1/operational-ranks',
    (route) => json(route, RANKS)
  );
  await page.route(
    (url) => url.pathname === '/api/v1/roles',
    (route) => json(route, POSITIONS)
  );
}

async function type(page: Page, id: string, text: string) {
  const field = page.locator(`#${id}`);
  await tap(page, field);
  await field.pressSequentially(text, { delay: 14 });
  await page.waitForTimeout(60);
}

test.use({ viewport: SCREEN, deviceScaleFactor: SCALE, timezoneId: 'America/Chicago' });

test('capture 8f-new-member', async ({ page }) => {
  if (process.env.VIDEO_DEBUG) {
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/')) console.log('REQ', r.method(), r.url().replace(/^.*\/api\/v1/, ''));
    });
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300));
    });
  }
  await prepare(page);
  await signIn(page, { permissions: [...TEST_USER.permissions, 'users.create'] });
  await mockMembers(page);
  await page.goto('/members');
  await settle(page);

  await recordShots(page, '8f-new-member', async (shot) => {
    await shot('hook', async () => {
      await page.waitForTimeout(600);
    });
    await shot('add', async () => {
      await tap(page, page.getByRole('main').getByRole('button', { name: 'Add', exact: true }));
      await settle(page);
    });
    await shot('details', async () => {
      await type(page, 'add-firstName', 'Jordan');
      await type(page, 'add-lastName', 'Reyes');
      await type(page, 'add-street', '412 Maple Street');
      await type(page, 'add-city', 'Oakville');
      await type(page, 'add-state', 'IL');
      await type(page, 'add-zipCode', '60001');
      await type(page, 'add-primaryPhone', '(555) 014-2271');
      await type(page, 'add-email', 'jordan.reyes@example.com');
    });
    await shot('password', async () => {
      await centre(page, page.getByText('Set initial password', { exact: true }));
    });
    await shot('standing', async () => {
      await centre(page, page.locator('#add-member-status'));
      await page.waitForTimeout(900);
      await choose(page, page.locator('#add-rank'), 'probationary_firefighter');
      await page.waitForTimeout(400);
      await centre(page, page.locator('#add-role'));
    });
    await shot('contact', async () => {
      await type(page, 'add-emergencyName1', 'Maria Reyes');
      await type(page, 'add-emergencyRelationship1', 'Mother');
      await type(page, 'add-emergencyPhone1', '(555) 014-3380');
    });
    await shot('save', async () => {
      await tap(page, page.getByRole('button', { name: 'Save Member' }));
      await page.waitForURL(/\/members$/);
      await settle(page);
      await centre(page, page.getByText('Jordan Reyes').locator('visible=true').first());
    });
    await shot('import', async () => {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(700);
      await tap(page, page.getByRole('main').getByRole('button', { name: 'Import', exact: true }));
      await settle(page);
      await centre(page, page.getByRole('heading', { name: 'How to Import Members' }));
    });
    await shot('outro', async () => {
      await page.waitForTimeout(300);
    });
  });
});
