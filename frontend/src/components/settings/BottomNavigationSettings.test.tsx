import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSetMyBottomNavigation = vi.fn();
vi.mock('../../services/userServices', () => ({
  userService: {
    setMyBottomNavigation: (...args: unknown[]) => mockSetMyBottomNavigation(...args) as unknown,
  },
}));

let mockEnabled: Set<string> | null = null;
vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: mockEnabled,
    isModuleOn: (k: string) => mockEnabled === null || mockEnabled.has(k),
    isLoading: false,
  }),
}));

// Import after the mocks are in place.
import { useAuthStore } from '../../stores/authStore';
import type { CurrentUser } from '../../types/auth';
import { BottomNavigationSettings } from './BottomNavigationSettings';

function signIn(overrides: Partial<CurrentUser> = {}): void {
  useAuthStore.setState({
    user: {
      id: 'user-1',
      username: 'jdoe',
      email: 'jdoe@example.com',
      organization_id: 'org-1',
      timezone: 'America/New_York',
      roles: [],
      positions: [],
      rank: null,
      membership_type: 'active',
      permissions: ['storefront.view'],
      is_active: true,
      email_verified: true,
      mfa_enabled: false,
      password_expired: false,
      must_change_password: false,
      bottom_nav_slots: null,
      ...overrides,
    },
    isAuthenticated: true,
  });
}

const slotValues = (): string[] => screen.getAllByRole('combobox').map((select) => (select as HTMLSelectElement).value);

describe('BottomNavigationSettings', () => {
  beforeEach(() => {
    mockEnabled = null;
    mockSetMyBottomNavigation.mockReset();
    mockSetMyBottomNavigation.mockImplementation((slots: string[] | null) => Promise.resolve(slots));
    signIn();
  });

  it('starts on exactly what the bar shows for a member who has never chosen', () => {
    render(<BottomNavigationSettings />);
    expect(slotValues()).toEqual(['/events', '/scheduling']);
    expect(screen.queryByRole('button', { name: 'Use the default tabs' })).not.toBeInTheDocument();
  });

  it('offers Settings (the member account) and not Home', () => {
    render(<BottomNavigationSettings />);
    const left = screen.getByLabelText<HTMLSelectElement>('Left of Add');
    const options = Array.from(left.options).map((option) => option.textContent);
    expect(options).toContain('Settings');
    expect(options).not.toContain('Home');
  });

  it('saves the new pair to the account and updates the bar immediately', async () => {
    const user = userEvent.setup();
    render(<BottomNavigationSettings />);

    await user.selectOptions(screen.getByLabelText('Right of Add'), '/account');

    expect(mockSetMyBottomNavigation).toHaveBeenCalledWith(['/events', '/account']);
    await waitFor(() => expect(useAuthStore.getState().user?.bottom_nav_slots).toEqual(['/events', '/account']));
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
  });

  it('will not offer the tab already in the other slot', () => {
    render(<BottomNavigationSettings />);
    const right = screen.getByLabelText<HTMLSelectElement>('Right of Add');
    const events = Array.from(right.options).find((option) => option.value === '/events');
    expect(events?.disabled).toBe(true);
  });

  it('returns to the defaults by clearing the saved choice', async () => {
    const user = userEvent.setup();
    signIn({ bottom_nav_slots: ['/documents', '/account'] });
    render(<BottomNavigationSettings />);
    expect(slotValues()).toEqual(['/documents', '/account']);

    await user.click(screen.getByRole('button', { name: 'Use the default tabs' }));

    expect(mockSetMyBottomNavigation).toHaveBeenCalledWith(null);
    await waitFor(() => expect(slotValues()).toEqual(['/events', '/scheduling']));
    expect(screen.queryByRole('button', { name: 'Use the default tabs' })).not.toBeInTheDocument();
  });

  it('keeps the pick and offers a retry when the save fails', async () => {
    const user = userEvent.setup();
    mockSetMyBottomNavigation.mockReset();
    mockSetMyBottomNavigation.mockRejectedValueOnce(new Error('offline'));
    mockSetMyBottomNavigation.mockImplementation((slots: string[] | null) => Promise.resolve(slots));
    render(<BottomNavigationSettings />);

    await user.selectOptions(screen.getByLabelText('Left of Add'), '/members');

    const retry = await screen.findByRole('button', { name: /retry/ });
    expect(slotValues()).toEqual(['/members', '/scheduling']);
    expect(useAuthStore.getState().user?.bottom_nav_slots).toBeNull();

    await user.click(retry);

    expect(mockSetMyBottomNavigation).toHaveBeenLastCalledWith(['/members', '/scheduling']);
    await waitFor(() => expect(useAuthStore.getState().user?.bottom_nav_slots).toEqual(['/members', '/scheduling']));
  });
});
