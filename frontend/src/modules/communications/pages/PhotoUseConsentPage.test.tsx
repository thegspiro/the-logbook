import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import PhotoUseConsentPage from './PhotoUseConsentPage';
import type { ConsentRoster, ConsentRosterMember } from '../../../types/user';

const mockGetRoster = vi.fn();

vi.mock('../../../services/api', () => ({
  userService: {
    getPhotoUseConsentRoster: (...args: unknown[]) => mockGetRoster(...args) as unknown,
  },
}));

vi.mock('../../../hooks/useRanks', () => ({
  // Ordered the way the real hook orders them: by sort_order, senior first.
  // Alphabetically this list reads captain, firefighter, lieutenant — which is
  // exactly what the rank sort must NOT produce.
  useRanks: () => ({
    ranks: [
      { rank_code: 'captain', display_name: 'Captain' },
      { rank_code: 'lieutenant', display_name: 'Lieutenant' },
      { rank_code: 'firefighter', display_name: 'Firefighter' },
    ],
    formatRank: (code: string | null) => code ?? '',
  }),
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

const makeMember = (overrides: Partial<ConsentRosterMember> = {}): ConsentRosterMember => ({
  user_id: 'user-1',
  first_name: 'Dana',
  last_name: 'Agreed',
  photo_url: null,
  rank: 'firefighter',
  station: 'Station 1',
  membership_number: '101',
  member_status: 'active',
  status: 'granted',
  granted: true,
  decided_at: '2026-05-04T15:00:00Z',
  ...overrides,
});

const roster: ConsentRoster = {
  consent_type: 'photo_use',
  summary: { granted: 1, declined: 1, not_answered: 1, total: 3 },
  members: [
    makeMember(),
    makeMember({
      user_id: 'user-2',
      first_name: 'Ray',
      last_name: 'Refused',
      membership_number: '102',
      status: 'declined',
      granted: false,
    }),
    makeMember({
      user_id: 'user-3',
      first_name: 'Nico',
      last_name: 'Unasked',
      membership_number: '103',
      status: 'not_answered',
      granted: null,
      decided_at: null,
    }),
  ],
};

/**
 * Four members chosen so alphabetical and seniority orders disagree, and so a
 * null exists for rank, station and decided_at. The array order is deliberately
 * NOT the surname order, so "unsorted means the server's order" is a real
 * assertion rather than a coincidence of the fixture.
 */
const sortingRoster: ConsentRoster = {
  consent_type: 'photo_use',
  summary: { granted: 2, declined: 1, not_answered: 1, total: 4 },
  members: [
    makeMember({
      user_id: 'user-1',
      first_name: 'Dana',
      last_name: 'Agreed',
      rank: 'lieutenant',
      station: 'Station 2',
    }),
    makeMember({
      user_id: 'user-4',
      first_name: 'Ada',
      last_name: 'Chief',
      rank: 'captain',
      station: 'Station 2',
      membership_number: '104',
      decided_at: '2026-03-01T09:00:00Z',
    }),
    makeMember({
      user_id: 'user-2',
      first_name: 'Ray',
      last_name: 'Refused',
      rank: 'firefighter',
      station: 'Station 10',
      membership_number: '102',
      status: 'declined',
      granted: false,
      decided_at: '2026-01-02T09:00:00Z',
    }),
    makeMember({
      user_id: 'user-3',
      first_name: 'Nico',
      last_name: 'Unasked',
      rank: null,
      station: null,
      membership_number: '103',
      status: 'not_answered',
      granted: null,
      decided_at: null,
    }),
  ],
};

const SERVER_ORDER = ['Dana Agreed', 'Ada Chief', 'Ray Refused', 'Nico Unasked'];

/**
 * Each body row holds exactly one link — the member's name — so this reads the
 * rendered order without depending on column positions.
 */
const rowNames = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getByRole('link').textContent);

const lastName = () => {
  const names = rowNames();
  return names[names.length - 1];
};

describe('PhotoUseConsentPage', () => {
  beforeEach(() => {
    // mockReset, not clearAllMocks: a queued mockResolvedValueOnce survives
    // clearAllMocks and would be handed to whichever test calls next.
    mockGetRoster.mockReset();
    mockGetRoster.mockResolvedValue(roster);
  });

  it('lists members on both sides of the choice, and those who never answered', async () => {
    renderWithRouter(<PhotoUseConsentPage />);

    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();
    expect(screen.getByText('Ray Refused')).toBeInTheDocument();
    expect(screen.getByText('Nico Unasked')).toBeInTheDocument();

    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0] as HTMLElement).getByText('Agreed')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Declined')).toBeInTheDocument();
    // A member who was never asked is reported as such, not folded into
    // "Declined" — same effect, different remedy.
    expect(within(rows[2] as HTMLElement).getByText('Not answered')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('—')).toBeInTheDocument();
  });

  it('filters to one status when its tile is pressed, and clears on a second press', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    const declinedTile = screen.getByRole('button', { name: /^Declined/ });
    await user.click(declinedTile);

    expect(screen.getByText('Ray Refused')).toBeInTheDocument();
    expect(screen.queryByText('Dana Agreed')).not.toBeInTheDocument();
    expect(screen.queryByText('Nico Unasked')).not.toBeInTheDocument();

    await user.click(declinedTile);
    expect(screen.getByText('Dana Agreed')).toBeInTheDocument();
  });

  it('carries no contact fields for the search to match on', async () => {
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    // The member directory gates email on the org's contact-visibility
    // setting; this page must not be a way around it.
    expect(screen.queryByText(/@example\.org/)).not.toBeInTheDocument();
  });

  it('searches by name', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search members'), 'refused');

    expect(screen.getByText('Ray Refused')).toBeInTheDocument();
    expect(screen.queryByText('Dana Agreed')).not.toBeInTheDocument();
  });

  it('re-requests the roster with inactive members when the toggle is set', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    await waitFor(() => expect(mockGetRoster).toHaveBeenCalledWith(false));

    await user.click(screen.getByLabelText('Include inactive members'));

    await waitFor(() => expect(mockGetRoster).toHaveBeenCalledWith(true));
  });

  it('re-requests the roster when refresh is pressed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();
    expect(mockGetRoster).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Refresh photo use consents' }));

    await waitFor(() => expect(mockGetRoster).toHaveBeenCalledTimes(2));
    expect(mockGetRoster).toHaveBeenLastCalledWith(false);
  });

  it('links each member to their own record', async () => {
    renderWithRouter(<PhotoUseConsentPage />);

    expect(await screen.findByRole('link', { name: 'Dana Agreed' })).toHaveAttribute('href', '/members/user-1');
    expect(screen.getByRole('link', { name: 'Nico Unasked' })).toHaveAttribute('href', '/members/user-3');
  });

  it('reports the roster breakdown in words for assistive technology', async () => {
    renderWithRouter(<PhotoUseConsentPage />);

    expect(
      await screen.findByRole('img', {
        name: 'Of 3 members, 1 agreed, 1 declined and 1 have not answered.',
      })
    ).toBeInTheDocument();
  });

  it('surfaces a load failure instead of an empty roster', async () => {
    mockGetRoster.mockRejectedValue(new Error('boom'));
    renderWithRouter(<PhotoUseConsentPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('boom'));
  });

  it('ignores a stale response that resolves after a newer request for a different toggle state', async () => {
    // Checking the box fires a request that is left pending; unchecking it
    // again immediately after fires a second request that resolves right
    // away. The first request, now stale, resolves last. The roster shown
    // must reflect the toggle's current (unchecked) value — the stale
    // response must not overwrite it just because it arrived later.
    const rosterWithInactive: ConsentRoster = {
      ...roster,
      summary: { ...roster.summary, total: 4 },
      members: [...roster.members, makeMember({ user_id: 'user-4', first_name: 'Ivy', last_name: 'Inactive' })],
    };
    let resolveStale: (value: ConsentRoster) => void = () => {};
    const stalePending = new Promise<ConsentRoster>((resolve) => {
      resolveStale = resolve;
    });

    mockGetRoster
      .mockResolvedValueOnce(roster) // initial mount, includeInactive=false
      .mockReturnValueOnce(stalePending) // checked -> includeInactive=true
      .mockResolvedValueOnce(roster); // unchecked again -> includeInactive=false

    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    const checkbox = screen.getByLabelText('Include inactive members');
    await user.click(checkbox);
    await user.click(checkbox);
    await waitFor(() => expect(mockGetRoster).toHaveBeenCalledTimes(3));

    // The newer (unchecked) request already resolved with no Ivy.
    expect(screen.queryByText('Ivy Inactive')).not.toBeInTheDocument();

    // The stale checked-state request resolves after the fact; it must be
    // ignored rather than replacing the current, correct roster. `act` flushes
    // the state update (if any) synchronously so the assertion below is not a
    // race against React's own scheduling.
    await act(async () => {
      resolveStale(rosterWithInactive);
      await stalePending;
    });
    expect(screen.queryByText('Ivy Inactive')).not.toBeInTheDocument();
  });
});

describe('PhotoUseConsentPage sorting', () => {
  beforeEach(() => {
    mockGetRoster.mockReset();
    mockGetRoster.mockResolvedValue(sortingRoster);
  });

  const header = (name: string) => screen.getByRole('button', { name });

  it('leaves the roster in the order the server sent until a column is chosen', async () => {
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    expect(rowNames()).toEqual(SERVER_ORDER);
  });

  it('sorts members by surname, and reverses on a second click', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.click(header('Member'));
    expect(rowNames()).toEqual(['Dana Agreed', 'Ada Chief', 'Ray Refused', 'Nico Unasked']);

    await user.click(header('Member'));
    expect(rowNames()).toEqual(['Nico Unasked', 'Ray Refused', 'Ada Chief', 'Dana Agreed']);
  });

  it('returns to the server order on a third click', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.click(header('Member'));
    await user.click(header('Member'));
    await user.click(header('Member'));

    expect(rowNames()).toEqual(SERVER_ORDER);
    expect(screen.getByLabelText('Sort members')).toHaveValue('');
  });

  it('orders ranks by seniority, not alphabetically', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.click(header('Rank'));

    // Alphabetically this would be Chief (captain), Refused (firefighter),
    // Agreed (lieutenant) — the department's own order is captain,
    // lieutenant, firefighter.
    expect(rowNames()).toEqual(['Ada Chief', 'Dana Agreed', 'Ray Refused', 'Nico Unasked']);
  });

  it('keeps members with no rank at the bottom in both directions', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.click(header('Rank'));
    expect(lastName()).toBe('Nico Unasked');

    // Reversing the sort must reorder the answers, not float the blank to the
    // top. This is the deliberate divergence from the shared sortItems helper.
    await user.click(header('Rank'));
    expect(lastName()).toBe('Nico Unasked');
  });

  it('orders the photo use column by the answer rather than by its label', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.click(header('Photo use'));
    let rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0] as HTMLElement).getByText('Agreed')).toBeInTheDocument();
    expect(within(rows[3] as HTMLElement).getByText('Not answered')).toBeInTheDocument();

    await user.click(header('Photo use'));
    rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0] as HTMLElement).getByText('Not answered')).toBeInTheDocument();
    expect(within(rows[3] as HTMLElement).getByText('Agreed')).toBeInTheDocument();
  });

  it('sorts undecided members last when ordering by decision date', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.click(header('Decided'));
    expect(rowNames()).toEqual(['Ray Refused', 'Ada Chief', 'Dana Agreed', 'Nico Unasked']);

    await user.click(header('Decided'));
    expect(rowNames()).toEqual(['Dana Agreed', 'Ada Chief', 'Ray Refused', 'Nico Unasked']);
  });

  it('orders stations numerically rather than as text', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.click(header('Station'));

    // "Station 10" sorts after "Station 2" — a plain string compare gets this
    // backwards, and a department numbers its stations past nine.
    expect(rowNames()).toEqual(['Dana Agreed', 'Ada Chief', 'Ray Refused', 'Nico Unasked']);
  });

  it('marks the sorted column for assistive technology', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.click(header('Rank'));

    const columns = screen.getAllByRole('columnheader');
    // aria-sort belongs on the columnheader, not on the button inside it.
    expect(columns[1]).toHaveAttribute('aria-sort', 'ascending');
    expect(columns[0]).toHaveAttribute('aria-sort', 'none');
  });

  it('drives the same order from the compact sort control', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    // The select is hidden by a CSS class, not by JS, so it is in the DOM at
    // every width under jsdom — no viewport mocking is involved here.
    await user.selectOptions(screen.getByLabelText('Sort members'), 'status:desc');
    expect(rowNames()[0]).toBe('Nico Unasked');

    // ...and the two controls are one piece of state, not two.
    await user.click(header('Rank'));
    expect(screen.getByLabelText('Sort members')).toHaveValue('rank:asc');
  });
});

describe('PhotoUseConsentPage station filter', () => {
  beforeEach(() => {
    mockGetRoster.mockReset();
    mockGetRoster.mockResolvedValue(sortingRoster);
  });

  it('narrows the roster to one station', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by station'), 'Station 2');

    expect(rowNames()).toEqual(['Dana Agreed', 'Ada Chief']);
    expect(screen.getByText('Showing 2 of 4 active members.')).toBeInTheDocument();
  });

  it('offers a bucket for members with no station on record', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by station'), 'No station');

    expect(rowNames()).toEqual(['Nico Unasked']);
  });

  it('offers stations in numeric order', async () => {
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    const options = within(screen.getByLabelText('Filter by station'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['All stations', 'Station 2', 'Station 10', 'No station']);
  });

  it('is hidden when every member is at the same station', async () => {
    mockGetRoster.mockResolvedValue(roster);
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    // One real choice is furniture, not a control.
    expect(screen.queryByLabelText('Filter by station')).not.toBeInTheDocument();
  });

  it('names each applied filter in a chip that clears only itself', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by station'), 'Station 2');
    await user.click(screen.getByRole('button', { name: /^Agreed/ }));

    expect(screen.getByText('Photo use: Agreed')).toBeInTheDocument();
    // "Station 2" is also a table cell and a select option, so the assertion
    // is scoped to the chip row rather than made against the whole page.
    const chipRow = screen.getByRole('group', { name: 'Filtered by' });
    expect(within(chipRow).getByText('Station 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove the station filter' }));

    expect(screen.queryByRole('button', { name: 'Remove the station filter' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Filter by station')).toHaveValue('all');
    expect(screen.getByText('Photo use: Agreed')).toBeInTheDocument();
  });

  it('counts as a filter in the empty state, and is cleared by Clear filters', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by station'), 'Station 2');
    await user.type(screen.getByLabelText('Search members'), 'zzz');

    expect(screen.getByText('No members match these filters')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(rowNames()).toEqual(SERVER_ORDER);
    expect(screen.getByLabelText('Filter by station')).toHaveValue('all');
    expect(screen.getByLabelText('Search members')).toHaveValue('');
  });

  it('does not reset the chosen column when filters are cleared', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rank' }));
    await user.selectOptions(screen.getByLabelText('Filter by station'), 'Station 2');
    await user.click(screen.getByRole('button', { name: 'Clear all' }));

    // A sort hides nothing, so clearing the filters must not discard it.
    expect(rowNames()).toEqual(['Ada Chief', 'Dana Agreed', 'Ray Refused', 'Nico Unasked']);
  });

  it('drops a station the inactive toggle removed from the roster', async () => {
    const withStation7: ConsentRoster = {
      ...sortingRoster,
      summary: { ...sortingRoster.summary, total: 5 },
      members: [
        ...sortingRoster.members,
        makeMember({
          user_id: 'user-5',
          first_name: 'Ivy',
          last_name: 'Inactive',
          station: 'Station 7',
          membership_number: '105',
          member_status: 'inactive',
        }),
      ],
    };
    mockGetRoster
      .mockResolvedValueOnce(sortingRoster) // mount
      .mockResolvedValueOnce(withStation7) // include inactive
      .mockResolvedValueOnce(sortingRoster); // back to active only

    const user = userEvent.setup();
    renderWithRouter(<PhotoUseConsentPage />);
    expect(await screen.findByText('Dana Agreed')).toBeInTheDocument();

    const checkbox = screen.getByLabelText('Include inactive members');
    await user.click(checkbox);
    await screen.findByText('Ivy Inactive');
    await user.selectOptions(screen.getByLabelText('Filter by station'), 'Station 7');
    expect(rowNames()).toEqual(['Ivy Inactive']);

    await user.click(checkbox);

    // Falling back to "all" beats an empty table whose cause is collapsed
    // inside a select the reader has stopped looking at.
    await waitFor(() => expect(screen.getByLabelText('Filter by station')).toHaveValue('all'));
    expect(rowNames()).toEqual(SERVER_ORDER);
  });
});
