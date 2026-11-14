/**
 * The Candidates tab carries a count, as the Ballot tab does, so an officer
 * sees an empty slate from the tab bar (W50-76). The count is the list the
 * tab shows: the same filter (`nomineesOf`) and, once the tab is open, the
 * same rows as they change.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { Candidate } from '../types/election';

const getElection = vi.fn();
const getCandidates = vi.fn();
vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    getSettings: vi.fn().mockResolvedValue({}),
    getCandidates: (...a: unknown[]) => getCandidates(...a) as unknown,
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: vi.fn().mockResolvedValue({ meetings: [] }) },
}));
vi.mock('../modules/prospective-members/services/api', () => ({
  electionPackageService: { getPendingPackages: vi.fn().mockResolvedValue([]) },
  applicantService: { assignToElection: vi.fn() },
}));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ electionId: 'e-1' }) };
});
vi.mock('../stores/authStore', () => {
  const state = { checkPermission: () => true, user: { id: 'u-1' } };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../components/ElectionResults', () => ({ ElectionResults: () => null, default: () => null }));
vi.mock('../components/ElectionBallot', () => ({ ElectionBallot: () => null, default: () => null }));
// Stands in for the tab's own list: a button reports a third nominee the way
// an officer adding one does.
vi.mock('../components/CandidateManagement', () => {
  const Stub = ({ onCandidatesChange }: { onCandidatesChange?: (all: Candidate[]) => void }) => (
    <button
      type="button"
      onClick={() =>
        onCandidatesChange?.([
          ...nominees,
          { id: 'c-4', election_id: 'e-1', name: 'Dana Diaz', position: 'Chief' } as Candidate,
        ])
      }
    >
      Add a nominee
    </button>
  );
  return { CandidateManagement: Stub, default: Stub };
});
vi.mock('../components/BallotBuilder', () => ({ BallotBuilder: () => null, default: () => null }));
vi.mock('../components/MeetingAttendance', () => ({ MeetingAttendance: () => null, default: () => null }));
vi.mock('../components/VoterOverrideManagement', () => ({ VoterOverrideManagement: () => null, default: () => null }));
vi.mock('../components/ProxyVotingManagement', () => ({ ProxyVotingManagement: () => null, default: () => null }));
vi.mock('../modules/elections/components/EligibilityRoster', () => ({
  EligibilityRoster: () => null,
  default: () => null,
}));
vi.mock('../modules/elections/components/RunoffChain', () => ({ RunoffChain: () => null, default: () => null }));
vi.mock('../modules/elections/components/PublishResultsPanel', () => ({
  PublishResultsPanel: () => null,
  default: () => null,
}));
vi.mock('../components/election-detail/PaperBallotBatchesPanel', () => ({
  PaperBallotBatchesPanel: () => null,
  default: () => null,
}));
vi.mock('../components/election-detail/LiveTurnoutPanel', () => ({
  LiveTurnoutPanel: () => null,
  default: () => null,
}));
vi.mock('../components/election-detail/NominationsPanel', () => ({
  NominationsPanel: () => null,
  default: () => null,
}));

import ElectionDetailPage from './ElectionDetailPage';

// The CandidateManagement stub reads this at click time, after this module
// has run, although its mock factory is hoisted above it.
const nominees = [
  { id: 'c-1', election_id: 'e-1', name: 'Alex Adams', position: 'Chief' },
  { id: 'c-2', election_id: 'e-1', name: 'Blake Brown', position: 'Chief' },
] as Candidate[];
// The Approve option a ballot item's first vote materialises as a candidate
// row: a choice, not a nominee, so it is not counted (W50-24).
const itemOption = { id: 'c-3', election_id: 'e-1', name: 'Approve', position: 'item-1' } as Candidate;

const draft = {
  id: 'e-1',
  organization_id: 'o-1',
  title: 'Officer Election',
  election_type: 'officer',
  positions: ['Chief'],
  ballot_items: [{ id: 'item-1', type: 'general_vote', title: 'Adopt the bylaws', vote_type: 'approval' }],
  start_date: '2026-09-29T00:00:00Z',
  end_date: '2026-10-02T05:45:00Z',
  status: 'draft',
  anonymous_voting: true,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: false,
  voting_method: 'simple_majority',
  victory_condition: 'plurality',
};

describe('ElectionDetailPage Candidates tab count', () => {
  beforeEach(() => {
    getElection.mockReset();
    getElection.mockResolvedValue(draft);
    getCandidates.mockReset();
    getCandidates.mockResolvedValue([...nominees, itemOption]);
  });

  it('counts the nominees on the tab, leaving out ballot-item options', async () => {
    renderWithRouter(<ElectionDetailPage />);

    expect(await screen.findByRole('tab', { name: /^Candidates\s*2$/ })).toBeInTheDocument();
  });

  it('follows the list as the officer changes it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionDetailPage />);

    await user.click(await screen.findByRole('tab', { name: /^Candidates\s*2$/ }));
    await user.click(screen.getByRole('button', { name: 'Add a nominee' }));

    expect(screen.getByRole('tab', { name: /^Candidates\s*3$/ })).toBeInTheDocument();
  });

  it('shows no count while there are no nominees', async () => {
    getCandidates.mockResolvedValue([itemOption]);
    renderWithRouter(<ElectionDetailPage />);

    const tab = await screen.findByRole('tab', { name: /^Candidates/ });
    await waitFor(() => expect(getCandidates).toHaveBeenCalled());
    expect(tab).toHaveAccessibleName('Candidates');
  });
});
