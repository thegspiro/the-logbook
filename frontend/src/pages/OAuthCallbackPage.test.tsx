import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { OAuthCallbackPage } from './OAuthCallbackPage';

// Mock navigate; the page's own routing decision (dashboard vs staying put)
// is asserted through this rather than through an actual route tree.
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockGetCurrentUser = vi.fn();
vi.mock('../services/api', () => ({
  authService: {
    getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args) as unknown,
  },
}));

// The account-boundary purge this test is about: only its call is observed,
// not its bookkeeping. Same fixture shape as authStore.test.ts.
const mockPurgeLocalMemberData = vi.fn(() =>
  Promise.resolve({ drafts: 0, queuedChecks: 0, queuedReports: 0, queuedGeneric: 0, unsyncedDiscarded: 0 })
);
vi.mock('../utils/purgeLocalMemberData', () => ({
  purgeLocalMemberData: (...args: unknown[]) => mockPurgeLocalMemberData(...args) as unknown,
}));

// The real store — this test is about the store's actual purge decision, not
// a mocked stand-in for it.
import { useAuthStore } from '../stores/authStore';

const fakeUser = {
  id: 'new-member',
  username: 'newmember',
  email: 'new@example.com',
  first_name: 'New',
  last_name: 'Member',
  full_name: 'New Member',
  organization_id: 'org1',
  timezone: 'UTC',
  roles: ['member'],
  positions: ['member'],
  rank: null,
  membership_type: 'member',
  permissions: [],
  is_active: true,
  email_verified: true,
};

function renderCallback() {
  return render(
    <MemoryRouter initialEntries={['/auth/callback']}>
      <OAuthCallbackPage />
    </MemoryRouter>
  );
}

describe('OAuthCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, error: null });
    mockGetCurrentUser.mockResolvedValue(fakeUser);
  });

  it('marks the sign-in fresh before resolving the member, so a shared device with no recorded owner is still purged', async () => {
    // No `device_member_id` recorded at all — the exact gap: a bare
    // loadUser() call here (a plain page reload, or this callback before the
    // fix) reads as "nothing to purge" because there's no *different*
    // recorded owner to compare against, and `signInPending` was never set.
    expect(localStorage.getItem('device_member_id')).toBeNull();

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true }));

    expect(mockPurgeLocalMemberData).toHaveBeenCalled();
    expect(localStorage.getItem('device_member_id')).toBe('new-member');
  });

  it('still purges when the device has a different recorded owner', async () => {
    localStorage.setItem('device_member_id', 'previous-member');

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true }));

    expect(mockPurgeLocalMemberData).toHaveBeenCalled();
  });

  it('does not purge when the signed-in member already owns this device', async () => {
    localStorage.setItem('device_member_id', 'new-member');

    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true }));

    expect(mockPurgeLocalMemberData).not.toHaveBeenCalled();
  });

  it('shows the failure state without navigating when the session never establishes', async () => {
    mockGetCurrentUser.mockRejectedValue(Object.assign(new Error('unauthorized'), { response: { status: 401 } }));

    renderCallback();

    await screen.findByText(/sign-in could not be completed/i);
    expect(mockNavigate).not.toHaveBeenCalledWith('/dashboard', { replace: true });
  });
});
