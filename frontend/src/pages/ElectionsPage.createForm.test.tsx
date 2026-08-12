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
});
