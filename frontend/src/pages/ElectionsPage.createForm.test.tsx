import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetElections = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getElections: (...args: unknown[]) => mockGetElections(...args) as unknown,
    getElectionSettings: vi.fn().mockRejectedValue(new Error('not needed')),
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: vi.fn().mockResolvedValue({ meetings: [] }) },
  ranksService: {
    getRanks: vi.fn().mockResolvedValue([{ id: 'r-capt', display_name: 'Captain', rank_code: 'captain' }]),
  },
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
  mockGetElections.mockResolvedValue([]);
  renderWithRouter(<ElectionsPage />);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /^Create Election$/ })).toBeInTheDocument();
  });
  await userEvent.click(screen.getByRole('button', { name: /^Create Election$/ }));
  return screen.getByRole('dialog');
}

describe('ElectionsPage create form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the selected winner rule rather than painting it white on white', async () => {
    // The control carried a hard-coded `text-white`, which on the light theme
    // rendered the selected option invisible against the surface — the field
    // read as empty while its helper text described plurality.
    await openCreateDialog();

    const select = screen.getByLabelText(/How is the Winner Determined\?/);

    expect(select).toHaveValue('simple_majority|most_votes');
    expect(select.className).not.toMatch(/\btext-white\b/);
  });

  // Both pickers announced "Time hour", "Time minute" and "Time AM/PM", so the
  // start and end times could not be told apart.
  it('names the start and end times apart', async () => {
    await openCreateDialog();
    expect(screen.getByRole('combobox', { name: 'Start time hour' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'End time hour' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Time hour' })).not.toBeInTheDocument();
  });

  // While the suggestions were open, a full-screen click-away layer covered the
  // Add button, so the first click on Add only closed the list and the typed
  // position was not added. The list now closes when the field loses focus.
  it('closes the suggestions when focus leaves the field', async () => {
    await openCreateDialog();
    const input = screen.getByRole('textbox', { name: 'Position name' });
    await userEvent.type(input, 'Cap');
    expect(await screen.findByRole('listbox', { name: 'Available positions' })).toBeInTheDocument();
    await userEvent.tab();
    expect(screen.queryByRole('listbox', { name: 'Available positions' })).not.toBeInTheDocument();
  });

  it('adds a typed position with Add', async () => {
    await openCreateDialog();
    const input = screen.getByRole('textbox', { name: 'Position name' });
    await userEvent.type(input, 'Engineer');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(input).toHaveValue('');
    expect(screen.getByText('Engineer')).toBeInTheDocument();
  });

  // Five switches decide how a vote runs, and none said what it did. "Show
  // Results Immediately" in particular reveals the live tally and is locked
  // once voting opens, so a newcomer had to guess before it was too late.
  it('describes each voting option', async () => {
    await openCreateDialog();
    expect(screen.getByLabelText('Enable Automatic Runoffs')).toHaveAccessibleDescription(
      /a runoff election is created automatically/
    );
    expect(screen.getByLabelText('Anonymous Voting')).toHaveAccessibleDescription(/without the voter's name/);
    expect(screen.getByLabelText('Allow Write-in Candidates')).toHaveAccessibleDescription(/not on the ballot/);
    expect(screen.getByLabelText('Show Results Immediately')).toHaveAccessibleDescription(
      /cannot be changed after voting opens/
    );
    expect(screen.getByLabelText('Open Automatically at Start Time')).toHaveAccessibleDescription(
      /Ballot emails are still sent separately/
    );
  });
});
