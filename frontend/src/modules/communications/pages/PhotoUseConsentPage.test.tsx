import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
  useRanks: () => ({ formatRank: (code: string | null) => code ?? '' }),
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

const makeMember = (overrides: Partial<ConsentRosterMember> = {}): ConsentRosterMember => ({
  user_id: 'user-1',
  first_name: 'Dana',
  last_name: 'Agreed',
  email: 'dana@example.org',
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

describe('PhotoUseConsentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const declinedTile = screen.getByRole('button', { name: /Declined/ });
    await user.click(declinedTile);

    expect(screen.getByText('Ray Refused')).toBeInTheDocument();
    expect(screen.queryByText('Dana Agreed')).not.toBeInTheDocument();
    expect(screen.queryByText('Nico Unasked')).not.toBeInTheDocument();

    await user.click(declinedTile);
    expect(screen.getByText('Dana Agreed')).toBeInTheDocument();
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

  it('surfaces a load failure instead of an empty roster', async () => {
    mockGetRoster.mockRejectedValue(new Error('boom'));
    renderWithRouter(<PhotoUseConsentPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('boom'));
  });
});
