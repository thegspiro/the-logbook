/**
 * The navigation layout is the department's, not the browser's.
 *
 * The setup wizard has always asked which arrangement a department wants, but
 * the answer only ever reached the browser that gave it: the wizard wrote
 * `localStorage`, which is where this component read it, and the copy sent to
 * the server sat on the onboarding session and was read by nothing. The
 * officer who ran setup saw their choice; every other member got the default,
 * and no screen anywhere could change it. See KNOWN_LIMITATIONS ONBOARD-5.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const { getBranding } = vi.hoisted(() => ({ getBranding: vi.fn() }));
vi.mock('../../services/api', () => ({
  dashboardService: { getBranding: () => getBranding() as unknown },
}));

vi.mock('../../stores/authStore', () => {
  const state = { user: null, logout: vi.fn() };
  const useAuthStore = Object.assign(
    (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
    { getState: () => state }
  );
  return { useAuthStore };
});

// The shell's ambient machinery — pollers, gestures, shortcuts — is not what
// this file is about, and each would otherwise reach for a timer or the
// network.
vi.mock('../../hooks/useIdleTimer', () => ({ useIdleTimer: () => undefined }));
vi.mock('../../hooks/useKeyboardShortcuts', () => ({ useNavigationShortcuts: () => undefined }));
vi.mock('../../hooks/useNotificationCount', () => ({ useNotificationPoller: () => undefined }));
vi.mock('../../hooks/useOfflineSyncEngine', () => ({ useOfflineSyncEngine: () => undefined }));
vi.mock('../../hooks/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));
vi.mock('../../hooks/useOverlaySurface', () => ({ useAnyOverlaySurface: () => false }));
vi.mock('../../hooks/useScrollToTopOnNavigate', () => ({ useScrollToTopOnNavigate: () => undefined }));
vi.mock('../../hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ pulling: false, refreshing: false, pullDistance: 0 }),
}));
vi.mock('../../contexts/PullToRefreshContext', () => ({ usePullToRefreshContext: () => ({ handler: null }) }));

vi.mock('./TopNavigation', () => ({ TopNavigation: () => <nav data-testid="top-nav" /> }));
vi.mock('./SideNavigation', () => ({ SideNavigation: () => <nav data-testid="side-nav" /> }));
vi.mock('./BottomNavigation', () => ({ BottomNavigation: () => null }));
vi.mock('../PullToRefreshIndicator', () => ({ PullToRefreshIndicator: () => null }));
vi.mock('../ux/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('../ux', () => ({
  TopProgressBar: () => null,
  CommandPalette: () => null,
  PageTransition: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import { AppLayout } from './AppLayout';

const renderShell = () =>
  render(
    <MemoryRouter>
      <AppLayout />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  getBranding.mockReset();
  getBranding.mockResolvedValue({ name: 'Engine Co.', navigation_layout: 'left' });
  localStorage.clear();
});

afterEach(() => localStorage.clear());

describe('the shell arrangement', () => {
  it('follows the department setting when it says top', async () => {
    getBranding.mockResolvedValue({ name: 'Engine Co.', navigation_layout: 'top' });

    renderShell();

    expect(await screen.findByTestId('top-nav')).toBeInTheDocument();
    expect(screen.queryByTestId('side-nav')).not.toBeInTheDocument();
  });

  it('follows the department setting when it says left', async () => {
    renderShell();

    expect(await screen.findByTestId('side-nav')).toBeInTheDocument();
    expect(screen.queryByTestId('top-nav')).not.toBeInTheDocument();
  });

  it('asks the server even when branding is already cached', async () => {
    // The regression this fixes. The fetch used to be skipped whenever a
    // department name was cached, which is survivable for a name and not for a
    // department-wide setting: an officer changing it would never reach a
    // member whose browser already held a value.
    localStorage.setItem('departmentName', 'Engine Co.');
    localStorage.setItem('navigationLayout', 'left');
    getBranding.mockResolvedValue({ name: 'Engine Co.', navigation_layout: 'top' });

    renderShell();

    await waitFor(() => expect(getBranding).toHaveBeenCalled());
    expect(await screen.findByTestId('top-nav')).toBeInTheDocument();
  });

  it('caches the answer so the next load paints in the right shape', async () => {
    getBranding.mockResolvedValue({ name: 'Engine Co.', navigation_layout: 'top' });

    renderShell();

    await waitFor(() => expect(localStorage.getItem('navigationLayout')).toBe('top'));
  });

  it('keeps the painted arrangement when branding cannot be reached', async () => {
    localStorage.setItem('navigationLayout', 'top');
    getBranding.mockRejectedValue(new Error('offline'));

    renderShell();

    expect(await screen.findByTestId('top-nav')).toBeInTheDocument();
  });

  it('re-arranges when Settings announces a change, without a reload', async () => {
    renderShell();
    expect(await screen.findByTestId('side-nav')).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent('branding-updated', { detail: { navigationLayout: 'top' } }));

    expect(await screen.findByTestId('top-nav')).toBeInTheDocument();
    expect(screen.queryByTestId('side-nav')).not.toBeInTheDocument();
  });

  it('ignores a layout value it does not recognise', async () => {
    getBranding.mockResolvedValue({ name: 'Engine Co.', navigation_layout: 'sideways' });

    renderShell();

    expect(await screen.findByTestId('side-nav')).toBeInTheDocument();
  });
});
