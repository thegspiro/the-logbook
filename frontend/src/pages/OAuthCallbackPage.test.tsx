/**
 * The OAuth callback is a sign-in, and the device-owner boundary depends on
 * it saying so.
 *
 * Drafts and the offline queues live in the browser profile, so a station
 * laptop hands whatever the last member left to whoever signs in next unless
 * something purges at the account boundary. The store draws that boundary at
 * sign-in — but its flag is module state, and the provider redirect reloads
 * the whole app, so an OAuth sign-in arrives looking exactly like a page
 * refresh. On a device with no recorded owner, which is every device the first
 * time this ships, that read the previous member's work as the new member's
 * own and left it in place to be synced under their name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const mockGetCurrentUser = vi.fn();
vi.mock('../services/api', () => ({
  authService: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args) as unknown,
  },
}));

const emptyPurge = { drafts: 0, queuedChecks: 0, queuedReports: 0, queuedGeneric: 0, unsyncedDiscarded: 0 };
const mockPurgeLocalMemberData = vi.fn(() => Promise.resolve({ ...emptyPurge }));
vi.mock('../utils/purgeLocalMemberData', () => ({
  purgeLocalMemberData: (...args: unknown[]) => mockPurgeLocalMemberData(...args) as unknown,
}));

vi.mock('../services/apiClient', () => ({
  markLoginComplete: vi.fn(),
  clearTempAccessToken: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router', () => ({ useNavigate: () => mockNavigate }));

// Repository convention: the mocked dependencies above are in place first.
import { OAuthCallbackPage } from './OAuthCallbackPage';
import { useAuthStore } from '../stores/authStore';

const fakeUser = {
  id: 'u1',
  username: 'testuser',
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
  is_active: true,
  organization_id: 'org-1',
  permissions: [],
  positions: [],
};

describe('OAuthCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockPurgeLocalMemberData.mockResolvedValue({ ...emptyPurge });
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, error: null });
  });

  it('discards work left on a device whose owner was never recorded', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUser);

    render(<OAuthCallbackPage />);

    await waitFor(() => expect(mockPurgeLocalMemberData).toHaveBeenCalled());
    expect(localStorage.getItem('device_member_id')).toBe('u1');
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true }));
  });

  it('keeps the signing-in member’s own work', async () => {
    localStorage.setItem('device_member_id', 'u1');
    mockGetCurrentUser.mockResolvedValue(fakeUser);

    render(<OAuthCallbackPage />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true }));
    expect(mockPurgeLocalMemberData).not.toHaveBeenCalled();
  });
});
