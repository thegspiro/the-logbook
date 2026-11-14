/**
 * W50-77 — the Test Ballot section's picker has a label, and the disabled
 * Send button says what enables it. The button used to sit greyed out with no
 * hint, and its "Select a draft election first" toast could never fire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetSettings = vi.fn();
const mockGetElections = vi.fn();

vi.mock('../services/api', () => ({
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getSettings: (...a: unknown[]) => mockGetSettings(...a) as unknown,
    getElections: (...a: unknown[]) => mockGetElections(...a) as unknown,
    updateSettings: vi.fn(),
    sendTestBallot: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ElectionsSettingsPage } from './ElectionsSettingsPage';

describe('ElectionsSettingsPage — Test Ballot section (W50-77)', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockGetElections.mockReset();
    mockGetSettings.mockResolvedValue({ proxy_voting_enabled: false });
    window.history.pushState({}, '', '/elections/settings?tab=test');
  });

  it('labels the picker and says what enables the button', async () => {
    mockGetElections.mockResolvedValue([{ id: 'd1', title: 'Spring Officers', status: 'draft' }]);
    renderWithRouter(<ElectionsSettingsPage />);

    const picker = await screen.findByRole('combobox', { name: 'Draft election' });
    expect(screen.getByRole('button', { name: /Send Test Ballot/ })).toBeDisabled();
    expect(screen.getByText('Choose a draft election to send yourself its test ballot.')).toBeInTheDocument();

    await userEvent.selectOptions(picker, 'd1');
    expect(screen.getByRole('button', { name: /Send Test Ballot/ })).toBeEnabled();
    expect(screen.queryByText('Choose a draft election to send yourself its test ballot.')).not.toBeInTheDocument();
  });

  it('says so when there is no draft to preview', async () => {
    mockGetElections.mockResolvedValue([]);
    renderWithRouter(<ElectionsSettingsPage />);

    expect(
      await screen.findByText('There is no draft election to preview. Create one, then send its test ballot from here.')
    ).toBeInTheDocument();
  });
});
