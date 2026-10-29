import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetSettings = vi.fn();
const mockGetElections = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
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

  it('opens on Proxy Voting', async () => {
    renderWithRouter(<ElectionsSettingsPage />);

    expect(await screen.findByRole('switch', { name: 'Allow proxy voting' })).toBeInTheDocument();
  });

  // ELEC2-9: the create-election form now starts from these, so they have
  // controls of their own.
  it('shows the stored defaults under ?tab=defaults', async () => {
    window.history.pushState({}, '', '/elections/settings?tab=defaults');
    renderWithRouter(<ElectionsSettingsPage />);

    expect(await screen.findByLabelText('How is the winner determined?')).toHaveValue('ranked_choice|majority');
    expect(screen.getByRole('switch', { name: 'Anonymous voting' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Allow write-in candidates' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Quorum')).toHaveValue('percentage');
    expect(screen.getByLabelText('Percentage who must vote')).toHaveValue(40);
  });

  it('saves a winner rule as its method and condition, and clears the percentage', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/elections/settings?tab=defaults');
    renderWithRouter(<ElectionsSettingsPage />);

    await user.selectOptions(
      await screen.findByLabelText('How is the winner determined?'),
      'simple_majority|supermajority'
    );

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1));
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      ...stored,
      default_voting_method: 'simple_majority',
      default_victory_condition: 'supermajority',
      default_victory_percentage: null,
    });
  });

  it('clears a count over 100 when the quorum becomes a percentage', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue({ ...stored, default_quorum_type: 'count', default_quorum_value: 150 });
    window.history.pushState({}, '', '/elections/settings?tab=defaults');
    renderWithRouter(<ElectionsSettingsPage />);

    await user.selectOptions(await screen.findByLabelText('Quorum'), 'percentage');

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1));
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ default_quorum_type: 'percentage', default_quorum_value: null })
    );
  });

  it('saving another section leaves the stored defaults as they were', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionsSettingsPage />);

    await user.click(await screen.findByRole('switch', { name: 'Allow proxy voting' }));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1));
    expect(mockUpdateSettings).toHaveBeenCalledWith({ ...stored, proxy_voting_enabled: true });
  });
});
