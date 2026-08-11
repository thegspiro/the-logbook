/**
 * Tests for the member audit history page.
 *
 * Two things this pins:
 *  - the Event Type dropdown offers only filters the endpoint can serve
 *  - the expanded entry does not print raw ids for people the row already names
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetHistory = vi.fn();

vi.mock('../services/userServices', () => ({
  userService: {
    getMemberAuditHistory: (...args: unknown[]) => mockGetHistory(...args) as unknown,
    getUserWithRoles: vi.fn().mockResolvedValue({ id: 'user-1', full_name: 'Emeka Adeyemi' }),
  },
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ userId: 'user-1' }),
  };
});

import MemberAuditHistoryPage from './MemberAuditHistoryPage';

const entry = {
  id: 1,
  timestamp: '2026-08-09T14:30:00Z',
  event_type: 'user_profile_updated',
  severity: 'info',
  description: 'Member profile updated: rank',
  changed_by_username: 'chief',
  event_data: {
    updated_user_id: 'a8c2c854-7bb9-458c-bba4-dd99d88e5167',
    updated_by: '256605cb-e6e5-4183-aae9-23bb9eecd7ea',
    is_self_update: false,
    fields_updated: ['rank'],
  },
};

describe('MemberAuditHistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHistory.mockResolvedValue([entry]);
  });

  // A sign-in is not a member-management event, so this endpoint never returns
  // one — the option could only ever produce an empty list.
  it('offers no Logins filter', async () => {
    renderWithRouter(<MemberAuditHistoryPage />);

    expect(await screen.findByLabelText(/filter/i)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Logins' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Profile Updates' })).toBeInTheDocument();
  });

  it('does not print raw ids for people the entry already names', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberAuditHistoryPage />);

    await user.click(await screen.findByRole('button', { name: /expand details/i }));

    expect(screen.getByText('Fields Updated')).toBeInTheDocument();
    expect(screen.queryByText(/a8c2c854-7bb9-458c-bba4-dd99d88e5167/)).not.toBeInTheDocument();
    expect(screen.queryByText(/256605cb-e6e5-4183-aae9-23bb9eecd7ea/)).not.toBeInTheDocument();
  });

  it('offers no details toggle when nothing is left to show', async () => {
    mockGetHistory.mockResolvedValue([
      { ...entry, event_data: { updated_user_id: 'a8c2c854', updated_by: '256605cb' } },
    ]);

    renderWithRouter(<MemberAuditHistoryPage />);

    expect(await screen.findByText('Member profile updated: rank')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /expand details/i })).not.toBeInTheDocument();
  });
});
