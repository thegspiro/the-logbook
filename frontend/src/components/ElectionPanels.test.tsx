/**
 * The election panels a secretary works in (workflow review W50).
 *
 * The candidate form and the ballot builder's fields were announced by their
 * placeholders or by nothing, every attendance row's button read "Check In",
 * nothing said a check-in after opening does not add a voter, and a closed
 * election's results read as a bare refusal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { Election } from '../types/election';

const mocks = vi.hoisted(() => ({
  getCandidates: vi.fn(),
  getUsers: vi.fn(),
  getAttendees: vi.fn(),
  getResults: vi.fn(),
  getBallotTemplates: vi.fn(),
  getSavedBallotTemplates: vi.fn(),
}));

vi.mock('../services/api', () => ({
  electionService: {
    getCandidates: mocks.getCandidates,
    getAttendees: mocks.getAttendees,
    getResults: mocks.getResults,
    getBallotTemplates: mocks.getBallotTemplates,
    getSavedBallotTemplates: mocks.getSavedBallotTemplates,
  },
  userService: { getUsers: mocks.getUsers },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { CandidateManagement } from './CandidateManagement';
import { BallotBuilder } from './BallotBuilder';
import { MeetingAttendance } from './MeetingAttendance';
import { ElectionResults } from './ElectionResults';

const election = (over: Partial<Election> = {}): Election =>
  ({
    id: 'e-1',
    title: 'Officer Election',
    status: 'draft',
    start_date: '2026-09-30T14:00:00Z',
    end_date: '2099-10-08T02:00:00Z',
    positions: ['Captain', 'Lieutenant'],
    ballot_items: [],
    attendees: [],
    voting_method: 'simple_majority',
    victory_condition: 'most_votes',
    ...over,
  }) as unknown as Election;

const first = <T,>(items: T[]): T => {
  const [item] = items;
  if (item === undefined) throw new Error('expected at least one match');
  return item;
};

describe('election panels', () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
    mocks.getCandidates.mockResolvedValue([]);
    mocks.getUsers.mockResolvedValue([
      { id: 'u-alex', username: 'alex', first_name: 'Alex', last_name: 'Brooks', status: 'active' },
    ]);
    mocks.getAttendees.mockResolvedValue({ attendees: [] });
    mocks.getBallotTemplates.mockResolvedValue([
      {
        id: 'general',
        name: 'General Resolution',
        description: 'A general yes/no vote.',
        type: 'general_vote',
        vote_type: 'approval',
        eligible_voter_types: ['all'],
        require_attendance: true,
        title_template: '{name}',
      },
    ]);
    mocks.getSavedBallotTemplates.mockResolvedValue([]);
  });

  it('names every field of the candidate form', async () => {
    renderWithRouter(<CandidateManagement electionId="e-1" election={election()} />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add Candidate' }));
    expect(screen.getByLabelText('Position')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Member')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toBeInTheDocument();
    expect(screen.getByLabelText('Statement')).toBeInTheDocument();
  });

  it("names the template's title field", async () => {
    renderWithRouter(<BallotBuilder electionId="e-1" election={election()} onUpdate={vi.fn()} />);
    // The header and the empty state both offer it; either opens the picker.
    await userEvent.click(first(await screen.findAllByRole('button', { name: 'Use Template' })));
    await userEvent.click(await screen.findByRole('button', { name: /General Resolution/ }));
    expect(screen.getByLabelText('Title / Topic')).toBeInTheDocument();
  });

  it('names each check-in after its member', async () => {
    renderWithRouter(<MeetingAttendance electionId="e-1" election={election()} onUpdate={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Check in Alex Brooks' })).toBeInTheDocument();
    expect(screen.queryByText(/does not let them vote/)).not.toBeInTheDocument();
  });

  it('says a check-in after opening does not add a voter', async () => {
    renderWithRouter(<MeetingAttendance electionId="e-1" election={election({ status: 'open' })} onUpdate={vi.fn()} />);
    expect(await screen.findByText(/does not let them vote/)).toBeInTheDocument();
  });

  it('no longer promises results at the scheduled end of a closed election', async () => {
    // Closing releases results (W50-10, W50-22); a refusal is shown as the
    // server words it, never as a wait for a date that no longer gates them.
    mocks.getResults.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed',
      response: { status: 403, data: { detail: 'Results not available yet' } },
    });
    renderWithRouter(<ElectionResults electionId="e-1" election={election({ status: 'closed' })} />);
    expect(await screen.findByText(/Results not available yet/)).toBeInTheDocument();
    expect(screen.queryByText(/after the scheduled end/)).not.toBeInTheDocument();
  });
});
