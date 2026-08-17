import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockForceAppRefresh = vi.fn();
const mockReloadForNewVersion = vi.fn();
const mockFetchServerBuildId = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../utils/forceAppRefresh', () => ({
  forceAppRefresh: () => mockForceAppRefresh() as Promise<'reloading' | 'unreachable'>,
}));

vi.mock('../../utils/serviceWorkerUpdate', () => ({
  reloadForNewVersion: () => mockReloadForNewVersion() as Promise<void>,
}));

vi.mock('../../utils/appVersion', async () => {
  const actual = await vi.importActual<typeof import('../../utils/appVersion')>('../../utils/appVersion');
  return {
    ...actual,
    getCurrentBuildId: () => 'local-build-1234567890',
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
});
