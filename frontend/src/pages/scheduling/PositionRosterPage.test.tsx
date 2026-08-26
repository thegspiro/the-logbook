import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockGetPositionRoster = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getPositionRoster: (...a: unknown[]) => mockGetPositionRoster(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import PositionRosterPage from './PositionRosterPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <PositionRosterPage />
    </MemoryRouter>
  );

/** Rank-eligible with an EVOC card and an apparatus clearance behind it. */
const certifiedDriver = {
  user_id: 'u1',
  user_name: 'Alice Adams',
  rank: 'engineer',
  rank_display_name: 'Engineer',
  membership_type: 'active',
  platoon: 'A',
  sources: [{ type: 'rank', label: 'Engineer' }],
  evoc_level_number: 3,
  evoc_level_name: 'EVOC 3 - Engine / Pumper',
  apparatus_cleared: [{ apparatus_id: 'ap1', unit_number: 'E-1', certification_expiration: '2027-01-01' }],
};

/** The gap this page exists to surface: cleared by rank alone, no EVOC. */
const uncertifiedDriver = {
  user_id: 'u2',
  user_name: 'Bob Brown',
  rank: 'lieutenant',
  rank_display_name: 'Lieutenant',
  membership_type: 'active',
  platoon: null,
  sources: [{ type: 'rank', label: 'Lieutenant' }],
  evoc_level_number: null,
  evoc_level_name: null,
  apparatus_cleared: [],
};

const trainedDriver = {
  user_id: 'u3',
  user_name: 'Cleo Cruz',
  rank: 'firefighter',
  rank_display_name: 'Firefighter',
  membership_type: 'active',
  platoon: null,
  sources: [{ type: 'training', label: 'Driver Operator Pipeline' }],
  evoc_level_number: 2,
  evoc_level_name: 'EVOC 2 - Ambulance',
  apparatus_cleared: [],
};

const roster = {
  position: 'driver',
  members: [certifiedDriver, uncertifiedDriver, trainedDriver],
  excluded_membership_types: ['retired'],
  is_open_position: false,
};

describe('PositionRosterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPositionRoster.mockResolvedValue(roster);
  });

  it('defaults to the driver roster', async () => {
    renderPage();
    await screen.findByText('Alice Adams');
    expect(mockGetPositionRoster).toHaveBeenCalledWith('driver');
  });

  it('lists every cleared member with the source of their eligibility', async () => {
    renderPage();
    expect(await screen.findByText('Alice Adams')).toBeInTheDocument();
    expect(screen.getByText('Cleo Cruz')).toBeInTheDocument();
    // The source badge names the specific rank / program, not just its kind.
    expect(screen.getByText('Driver Operator Pipeline')).toBeInTheDocument();
  });

  it('flags members cleared by rank with no EVOC certification behind it', async () => {
    renderPage();
    await screen.findByText('Bob Brown');
    // Bob alone lacks an EVOC level; Cleo has one but is on no apparatus, so
    // the operator note appears for both.
    expect(screen.getByText(/1 with no EVOC certification on file/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Not listed as an operator on any apparatus/i)).toHaveLength(2);
  });

  it('shows EVOC level and apparatus clearances for certified drivers', async () => {
    renderPage();
    await screen.findByText('Alice Adams');
    expect(screen.getByText(/EVOC 3 · EVOC 3 - Engine \/ Pumper/)).toBeInTheDocument();
    expect(screen.getByText('E-1')).toBeInTheDocument();
  });

  it('refetches when the position changes', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Alice Adams');

    mockGetPositionRoster.mockResolvedValue({
      position: 'officer',
      members: [],
      excluded_membership_types: [],
      is_open_position: false,
    });
    await user.selectOptions(screen.getByLabelText('Position'), 'officer');

    await waitFor(() => expect(mockGetPositionRoster).toHaveBeenCalledWith('officer'));
    expect(await screen.findByText(/Nobody is cleared as Officer/i)).toBeInTheDocument();
  });

  it('filters the list by name', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Alice Adams');

    await user.type(screen.getByLabelText('Search'), 'cleo');

    expect(screen.getByText('Cleo Cruz')).toBeInTheDocument();
    expect(screen.queryByText('Alice Adams')).not.toBeInTheDocument();
  });

  it('explains when the position is open to all members', async () => {
    mockGetPositionRoster.mockResolvedValue({ ...roster, is_open_position: true });
    renderPage();
    expect(await screen.findByText(/open-position list/i)).toBeInTheDocument();
  });

  it('styles a held-position source differently from a rank source', async () => {
    // Both resolve through the same slug vocabulary, so their labels can be
    // identical. An unmapped source type falls back to the rank badge, which
    // rendered a position as an indistinguishable second rank chip.
    mockGetPositionRoster.mockResolvedValue({
      ...roster,
      members: [
        {
          ...certifiedDriver,
          // Nulled so the only "Lieutenant" / "Engineer" on screen are the two
          // source badges being compared.
          rank_display_name: null,
          sources: [
            { type: 'rank', label: 'Lieutenant' },
            { type: 'position', label: 'Engineer' },
          ],
        },
      ],
    });
    renderPage();

    const rankBadge = await screen.findByText('Lieutenant');
    const positionBadge = screen.getByText('Engineer');
    expect(rankBadge.className).not.toEqual(positionBadge.className);
  });

  it('shows a certification source with the date it lapses', async () => {
    mockGetPositionRoster.mockResolvedValue({
      position: 'paramedic',
      members: [
        {
          ...certifiedDriver,
          rank_display_name: null,
          sources: [{ type: 'certification', label: 'Paramedic', expires_on: '2029-12-31' }],
        },
      ],
      excluded_membership_types: [],
      is_open_position: false,
    });
    renderPage();

    // The date is the point: a medic cleared today may not be cleared for the
    // shift being staffed next month.
    expect(await screen.findByText(/exp Dec 31, 2029/)).toBeInTheDocument();
  });

  it('flags a certification that lapses inside the warning window', async () => {
    // Rendered in the same amber as the EVOC warning rather than as one more
    // green tick, so an imminent lapse reads as the caution it is.
    const soon = new Date();
    soon.setDate(soon.getDate() + 14);
    const soonISO = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(
      soon.getDate()
    ).padStart(2, '0')}`;

    mockGetPositionRoster.mockResolvedValue({
      position: 'paramedic',
      members: [
        {
          ...certifiedDriver,
          rank_display_name: null,
          sources: [
            { type: 'certification', label: 'Paramedic', expires_on: soonISO },
            { type: 'certification', label: 'Firefighter I', expires_on: null },
          ],
        },
      ],
      excluded_membership_types: [],
      is_open_position: false,
    });
    renderPage();

    // Matched by title rather than label: the Position dropdown also offers a
    // "Paramedic" option now, and only a badge with an expiry carries a title.
    const expiring = await screen.findByTitle(/^Expires/);
    expect(expiring.className).toContain('amber');

    // The non-expiring card keeps the ordinary certification styling.
    expect(screen.getByText('Firefighter I').className).not.toContain('amber');
  });

  it('offers Paramedic as a position distinct from EMT', async () => {
    renderPage();
    await screen.findByText('Alice Adams');

    // Two separate options, not one EMS bucket: a department staffing an ALS
    // unit has to be able to say a medic is required.
    expect(screen.getByRole('option', { name: 'Paramedic' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'EMT' })).toBeInTheDocument();
  });

  it('does not show EVOC warnings for non-driving positions', async () => {
    mockGetPositionRoster.mockResolvedValue({
      position: 'officer',
      members: [{ ...uncertifiedDriver, sources: [{ type: 'rank', label: 'Lieutenant' }] }],
      excluded_membership_types: [],
      is_open_position: false,
    });
    renderPage();
    await screen.findByText('Bob Brown');
    expect(screen.queryByText(/no EVOC certification on file/i)).not.toBeInTheDocument();
  });
});
