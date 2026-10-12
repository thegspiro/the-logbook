/**
 * Tests for the member audit history page.
 *
 * What this pins:
 *  - the Event Type dropdown offers only filters the endpoint can serve
 *  - the expanded entry does not print raw ids for people the row already names
 *  - each entry carries its time as well as its date
 *  - the header name comes from the roles read, never the full profile read,
 *    because the latter writes a "Member profile viewed" audit entry
 */

import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetHistory = vi.fn();
const mockGetUserRoles = vi.fn();
const mockGetUserWithRoles = vi.fn();

vi.mock('../services/userServices', () => ({
  userService: {
    getMemberAuditHistory: (...args: unknown[]) => mockGetHistory(...args) as unknown,
    getUserRoles: (...args: unknown[]) => mockGetUserRoles(...args) as unknown,
    getUserWithRoles: (...args: unknown[]) => mockGetUserWithRoles(...args) as unknown,
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
    mockGetHistory.mockReset();
    mockGetHistory.mockResolvedValue([entry]);
    mockGetUserRoles.mockReset();
    mockGetUserRoles.mockResolvedValue({
      user_id: 'user-1',
      username: 'eadeyemi',
      full_name: 'Emeka Adeyemi',
      roles: [],
    });
    mockGetUserWithRoles.mockReset();
    mockGetUserWithRoles.mockResolvedValue({ id: 'user-1', full_name: 'Emeka Adeyemi' });
  });

  // The full-profile read writes a "Member profile viewed" audit entry, so
  // using it for the header put a row into this history on every visit.
  describe('member name source', () => {
    it('shows the name from the roles read and never reads the full profile', async () => {
      renderWithRouter(<MemberAuditHistoryPage />);

      expect(await screen.findByText('Emeka Adeyemi')).toBeInTheDocument();
      expect(mockGetUserRoles).toHaveBeenCalledTimes(1);
      expect(mockGetUserRoles).toHaveBeenCalledWith('user-1');
      expect(mockGetUserWithRoles).not.toHaveBeenCalled();
    });

    it('falls back to the username when there is no full name', async () => {
      mockGetUserRoles.mockResolvedValue({ user_id: 'user-1', username: 'eadeyemi', roles: [] });
      renderWithRouter(<MemberAuditHistoryPage />);

      expect(await screen.findByText('eadeyemi')).toBeInTheDocument();
      expect(mockGetUserWithRoles).not.toHaveBeenCalled();
    });
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

  // Every entry on a busy day read "9/28/2026", so an officer could not tell
  // which of two changes came last.
  it('shows the time of each entry, not only the date', async () => {
    renderWithRouter(<MemberAuditHistoryPage />);

    await screen.findByText('Member profile updated: rank');
    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument();
  });

  it('offers no details toggle when nothing is left to show', async () => {
    mockGetHistory.mockResolvedValue([
      { ...entry, event_data: { updated_user_id: 'a8c2c854', updated_by: '256605cb' } },
    ]);

    renderWithRouter(<MemberAuditHistoryPage />);

    expect(await screen.findByText('Member profile updated: rank')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /expand details/i })).not.toBeInTheDocument();
  });

  // A visit used to read the history twice, and re-read the member on every
  // filter change.
  describe('load count', () => {
    it('reads the member and the history once for a visit', async () => {
      renderWithRouter(<MemberAuditHistoryPage />);

      await screen.findByText('Member profile updated: rank');
      expect(mockGetUserRoles).toHaveBeenCalledTimes(1);
      expect(mockGetHistory).toHaveBeenCalledTimes(1);
      expect(mockGetHistory).toHaveBeenCalledWith('user-1', 1, undefined);
    });

    // StrictMode outermost: nested inside renderWithRouter's wrapper, React
    // does not re-run the mount effects, and the test would pass for nothing.
    // main.tsx mounts the app this way, so this is the dev-server visit.
    it('reads the member once under StrictMode', async () => {
      render(
        <StrictMode>
          <MemoryRouter>
            <MemberAuditHistoryPage />
          </MemoryRouter>
        </StrictMode>
      );

      await screen.findByText('Member profile updated: rank');
      expect(mockGetUserRoles).toHaveBeenCalledTimes(1);
      expect(mockGetUserWithRoles).not.toHaveBeenCalled();
    });

    it('re-reads only the history when the filter changes', async () => {
      const user = userEvent.setup();
      renderWithRouter(<MemberAuditHistoryPage />);
      await screen.findByText('Member profile updated: rank');

      await user.selectOptions(screen.getByLabelText(/filter/i), 'status_change');

      await waitFor(() => expect(mockGetHistory).toHaveBeenCalledWith('user-1', 1, 'status_change'));
      expect(mockGetHistory).toHaveBeenCalledTimes(2);
      expect(mockGetUserRoles).toHaveBeenCalledTimes(1);
      expect(mockGetUserWithRoles).not.toHaveBeenCalled();
    });
  });
});

describe('MemberAuditHistoryPage — a malformed member response', () => {
  beforeEach(() => {
    mockGetHistory.mockReset();
    mockGetHistory.mockResolvedValue([entry]);
    mockGetUserRoles.mockReset();
    mockGetUserWithRoles.mockReset();
  });

  // The history is requested only once a member with an id has loaded. A 200
  // whose body is not a member (a captive portal's page) used to leave the
  // officer on "Loading audit history..." indefinitely, with nothing to retry.
  it.each([
    ['an HTML page', '<html>Sign in to Wi-Fi</html>'],
    ['an object with no id', {}],
  ])('reports a failed load for %s instead of spinning forever', async (_label, body) => {
    mockGetUserRoles.mockResolvedValue(body);
    renderWithRouter(<MemberAuditHistoryPage />);

    expect(await screen.findByText('Unable to load member information.')).toBeInTheDocument();
    expect(screen.queryByText('Loading audit history...')).not.toBeInTheDocument();
    expect(mockGetHistory).not.toHaveBeenCalled();
  });
});
