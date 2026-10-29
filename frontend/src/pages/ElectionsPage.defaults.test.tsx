import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

// ELEC2-9: the create form starts from the department's election defaults.

const mockGetElections = vi.fn();
const mockGetSettings = vi.fn();

vi.mock('../services/api', () => ({
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getElections: (...args: unknown[]) => mockGetElections(...args) as unknown,
    getSettings: (...args: unknown[]) => mockGetSettings(...args) as unknown,
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: vi.fn().mockResolvedValue({ meetings: [] }) },
  ranksService: { getRanks: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'u1', permissions: ['elections.manage'] },
    checkPermission: () => true,
  }),
}));

import { ElectionsPage } from './ElectionsPage';

async function openCreateDialog() {
  renderWithRouter(<ElectionsPage />);
  await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
  await userEvent.click(await screen.findByRole('button', { name: /^Create Election$/ }));
  return screen.getByRole('dialog');
}

describe('ElectionsPage create form and the department defaults', () => {
  beforeEach(() => {
    mockGetElections.mockReset();
    mockGetElections.mockResolvedValue([]);
    mockGetSettings.mockReset();
  });

  it('starts from the saved defaults', async () => {
    mockGetSettings.mockResolvedValue({
      default_voting_method: 'simple_majority',
      default_victory_condition: 'supermajority',
      default_victory_percentage: 75,
      default_anonymous_voting: false,
      default_allow_write_ins: true,
      default_quorum_type: 'percentage',
      default_quorum_value: 51,
    });
    await openCreateDialog();

    expect(screen.getByLabelText(/How is the Winner Determined\?/)).toHaveValue('simple_majority|supermajority');
    expect(screen.getByLabelText(/Supermajority Percentage/)).toHaveValue(75);
    expect(screen.getByRole('checkbox', { name: 'Anonymous Voting' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Allow Write-in Candidates' })).toBeChecked();
    expect(screen.getByText(/51% of eligible voters must vote/)).toBeInTheDocument();
  });

  it('keeps its own starting values when nothing was saved', async () => {
    mockGetSettings.mockResolvedValue({});
    await openCreateDialog();

    expect(screen.getByLabelText(/How is the Winner Determined\?/)).toHaveValue('simple_majority|most_votes');
    expect(screen.getByRole('checkbox', { name: 'Anonymous Voting' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Allow Write-in Candidates' })).not.toBeChecked();
    expect(screen.queryByText(/must vote/)).not.toBeInTheDocument();
  });
});
