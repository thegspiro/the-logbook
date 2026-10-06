/**
 * W50-11 — the create form sets how many each race elects. A voter may pick
 * as many as there are seats, so the seat count carries the per-race cap with
 * it; ranked choice elects one per race, so choosing it resets both to 1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetElections = vi.fn();
const mockCreateElection = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getElections: (...args: unknown[]) => mockGetElections(...args) as unknown,
    createElection: (...args: unknown[]) => mockCreateElection(...args) as unknown,
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
  renderWithRouter(<ElectionsPage />);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /^Create Election$/ })).toBeInTheDocument();
  });
  await userEvent.click(screen.getByRole('button', { name: /^Create Election$/ }));
}

describe('ElectionsPage seats per race (W50-11)', () => {
  beforeEach(() => {
    mockGetElections.mockReset();
    mockCreateElection.mockReset();
    mockGetElections.mockResolvedValue([]);
  });

  it('defaults to one seat and accepts a multi-seat race', async () => {
    await openCreateDialog();
    const seats = screen.getByLabelText('Seats per Race');
    expect(seats).toHaveValue(1);

    // A controlled number field re-clamps on every keystroke, so set it whole.
    fireEvent.change(seats, { target: { value: '2' } });
    expect(seats).toHaveValue(2);
  });

  it('elects one per race under ranked choice', async () => {
    await openCreateDialog();
    const seats = screen.getByLabelText('Seats per Race');
    fireEvent.change(seats, { target: { value: '3' } });
    expect(seats).toHaveValue(3);

    await userEvent.selectOptions(screen.getByLabelText(/How is the Winner Determined\?/), 'ranked_choice|majority');
    expect(seats).toHaveValue(1);
    expect(seats).toBeDisabled();
  });
});
