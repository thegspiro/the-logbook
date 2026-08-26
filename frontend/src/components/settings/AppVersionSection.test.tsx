import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockForceAppRefresh = vi.fn();
const mockPurgeAppCaches = vi.fn();
const mockCanReachServer = vi.fn();
const mockReloadForNewVersion = vi.fn();
const mockFetchServerBuildId = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../utils/forceAppRefresh', () => ({
  forceAppRefresh: () => mockForceAppRefresh() as Promise<'reloading' | 'unreachable'>,
  // Reached through the real updateRecovery module, which the component now
  // applies updates with.
  purgeAppCaches: () => mockPurgeAppCaches() as Promise<void>,
  canReachServer: () => mockCanReachServer() as Promise<boolean>,
}));

vi.mock('../../utils/serviceWorkerUpdate', () => ({
  reloadForNewVersion: () => mockReloadForNewVersion() as Promise<void>,
}));

// Pinned rather than inherited from the runner's TZ: the component formats
// the release date in the *department's* timezone, and a test that agreed with
// UTC only because CI happens to run in UTC would prove nothing.
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

let mockBuildTime: string | undefined;
vi.mock('../../utils/appVersion', async () => {
  const actual = await vi.importActual<typeof import('../../utils/appVersion')>('../../utils/appVersion');
  return {
    ...actual,
    getCurrentBuildId: () => 'local-build-1234567890',
    getCurrentBuildTime: () => mockBuildTime,
    fetchServerBuildId: () => mockFetchServerBuildId() as Promise<string | null>,
  };
});

vi.mock('react-hot-toast', () => ({
  default: {
    success: (msg: string) => mockToastSuccess(msg) as unknown,
    error: (msg: string) => mockToastError(msg) as unknown,
  },
}));

// Imported after the mocks are registered.
import { AppVersionSection } from './AppVersionSection';

beforeEach(() => {
  vi.clearAllMocks();
  mockForceAppRefresh.mockResolvedValue('reloading');
  mockReloadForNewVersion.mockResolvedValue(undefined);
  mockPurgeAppCaches.mockResolvedValue(undefined);
  mockCanReachServer.mockResolvedValue(true);
  mockBuildTime = '2026-08-25T19:14:00Z';
  // updateRecovery persists its escalation ladder, which would otherwise leak
  // between tests.
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppVersionSection', () => {
  it('shows the running build so a member can quote it to support', () => {
    renderWithRouter(<AppVersionSection />);
    // formatBuildId truncates to the first 12 characters.
    expect(screen.getByText('local-build-')).toBeInTheDocument();
  });

  // The build id is random hex: on its own it cannot tell a member — or the
  // officer helping them over the phone — whether they are one deployment
  // behind or twenty.
  it('dates the running build in the department timezone', () => {
    renderWithRouter(<AppVersionSection />);
    expect(screen.getByText(/^Released Aug 25, 2026, 3:14 PM$/)).toBeInTheDocument();
  });

  it('omits the release date when the build was not stamped with one', () => {
    mockBuildTime = undefined;
    renderWithRouter(<AppVersionSection />);
    expect(screen.queryByText(/Released/)).not.toBeInTheDocument();
    expect(screen.getByText('local-build-')).toBeInTheDocument();
  });

  it('reports an up-to-date app without reloading it', async () => {
    mockFetchServerBuildId.mockResolvedValue('local-build-1234567890');
    const user = userEvent.setup();
    renderWithRouter(<AppVersionSection />);

    await user.click(screen.getByRole('button', { name: /check for updates/i }));

    expect(await screen.findByText(/running the latest version/i)).toBeInTheDocument();
    expect(mockReloadForNewVersion).not.toHaveBeenCalled();
  });

  it('swaps the service worker before reloading when a newer build is live', async () => {
    mockFetchServerBuildId.mockResolvedValue('server-build-0987654321');
    const user = userEvent.setup();
    renderWithRouter(<AppVersionSection />);

    await user.click(screen.getByRole('button', { name: /check for updates/i }));

    await waitFor(() => expect(mockReloadForNewVersion).toHaveBeenCalledTimes(1));
  });

  it('surfaces a failed check instead of implying the app is current', async () => {
    mockFetchServerBuildId.mockResolvedValue(null);
    const user = userEvent.setup();
    renderWithRouter(<AppVersionSection />);

    await user.click(screen.getByRole('button', { name: /check for updates/i }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith("Couldn't reach the server to check for updates."));
    expect(screen.queryByText(/running the latest version/i)).not.toBeInTheDocument();
    expect(mockReloadForNewVersion).not.toHaveBeenCalled();
  });

  it('requires confirmation before force-refreshing', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AppVersionSection />);

    await user.click(screen.getByRole('button', { name: /^force refresh$/i }));

    expect(await screen.findByText(/force refresh this device\?/i)).toBeInTheDocument();
    expect(mockForceAppRefresh).not.toHaveBeenCalled();
  });

  it('does nothing when the confirmation is declined', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AppVersionSection />);

    await user.click(screen.getByRole('button', { name: /^force refresh$/i }));
    await user.click(await screen.findByRole('button', { name: /keep browsing/i }));

    await waitFor(() => expect(screen.queryByText(/force refresh this device\?/i)).not.toBeInTheDocument());
    expect(mockForceAppRefresh).not.toHaveBeenCalled();
  });

  it('purges and reloads once confirmed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AppVersionSection />);

    await user.click(screen.getByRole('button', { name: /^force refresh$/i }));

    // Both the page and the dialog carry a "Force refresh" button once the
    // dialog is open, so scope the click to the dialog.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^force refresh$/i }));

    await waitFor(() => expect(mockForceAppRefresh).toHaveBeenCalledTimes(1));
  });

  it('explains a refused refresh and frees the button instead of spinning forever', async () => {
    mockForceAppRefresh.mockResolvedValue('unreachable');
    const user = userEvent.setup();
    renderWithRouter(<AppVersionSection />);

    await user.click(screen.getByRole('button', { name: /^force refresh$/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^force refresh$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing was cleared/i);
    expect(mockToastError).toHaveBeenCalledWith('Cannot reach the server — nothing was cleared.');
    // Left enabled so the member can retry once they have signal.
    await waitFor(() => expect(screen.getByRole('button', { name: /^force refresh$/i })).toBeEnabled());
  });

  it('says so instead of promising a reload when recovery is exhausted', async () => {
    localStorage.setItem(
      'logbook:update-attempts',
      JSON.stringify({ buildId: 'server-build-9999999999', attempts: 2, at: Date.now() })
    );
    mockFetchServerBuildId.mockResolvedValue('server-build-9999999999');
    renderWithRouter(<AppVersionSection />);

    await userEvent.click(screen.getByRole('button', { name: /check for updates/i }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        'A new version is available, but this device could not install it. Try Force refresh below.'
      )
    );
    // Two reloads have already failed for this build; a third would be a lie.
    expect(mockReloadForNewVersion).not.toHaveBeenCalled();
  });
});
