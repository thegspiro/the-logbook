import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetSettings = vi.fn();
const mockGetElections = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getSettings: (...a: unknown[]) => mockGetSettings(...a) as unknown,
    getElections: (...a: unknown[]) => mockGetElections(...a) as unknown,
    updateSettings: (...a: unknown[]) => mockUpdateSettings(...a) as unknown,
    sendTestBallot: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ElectionsSettingsPage } from './ElectionsSettingsPage';

const stored = {
  default_voting_method: 'ranked_choice',
  default_victory_condition: 'majority',
  default_anonymous_voting: false,
  default_allow_write_ins: true,
  default_quorum_type: 'percentage',
  default_quorum_value: 40,
  proxy_voting_enabled: false,
  max_proxies_per_person: 1,
};

describe('ElectionsSettingsPage', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockGetElections.mockReset();
    mockUpdateSettings.mockReset();
    mockGetSettings.mockResolvedValue({ ...stored });
    mockGetElections.mockResolvedValue([]);
    mockUpdateSettings.mockImplementation((data: unknown) => Promise.resolve(data));
    window.history.pushState({}, '', '/elections/settings');
  });

  // election_defaults are stored but neither the create form nor the backend
  // create path reads them, so a Defaults section only claimed an effect it
  // did not have (pitfall #19).
  it('offers no Defaults section and opens on Proxy Voting', async () => {
    renderWithRouter(<ElectionsSettingsPage />);

    expect(await screen.findByRole('switch', { name: 'Allow proxy voting' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Defaults/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Default Election Settings')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Default Voting Method')).not.toBeInTheDocument();
  });

  it('falls back to Proxy Voting for an old ?tab=defaults link', async () => {
    window.history.pushState({}, '', '/elections/settings?tab=defaults');
    renderWithRouter(<ElectionsSettingsPage />);

    expect(await screen.findByRole('switch', { name: 'Allow proxy voting' })).toBeInTheDocument();
  });

  it('saving another section leaves the stored defaults as they were', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionsSettingsPage />);

    await user.click(await screen.findByRole('switch', { name: 'Allow proxy voting' }));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1));
    expect(mockUpdateSettings).toHaveBeenCalledWith({ ...stored, proxy_voting_enabled: true });
  });
});
