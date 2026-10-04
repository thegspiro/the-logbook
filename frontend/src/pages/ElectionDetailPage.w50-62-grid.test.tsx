/**
 * W50-62 — at 390px the info card's grid computed `0px 247px`: the Positions
 * cell carried an unconditional `col-span-2` on a `grid-cols-1` grid, which
 * forces an implicit second track, collapsing "Start Date" and painting
 * "Voting Method" over "Anonymous Voting". The span now applies only from
 * `md`, and the title row wraps rather than pushing the status pill past the
 * viewport edge.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';

const getElection = vi.fn();
vi.mock('../services/api', () => ({
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    getSettings: vi.fn().mockResolvedValue({}),
    getCandidates: vi.fn().mockResolvedValue([]),
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
vi.mock('../components/CandidateManagement', () => ({ CandidateManagement: () => null, default: () => null }));
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

// The grid cell and the title row are plain divs; the fix is a class on each,
// which no role or label reaches.
const cellAround = (el: HTMLElement) =>
  // eslint-disable-next-line testing-library/no-node-access -- see above
  el.parentElement;

const draft = {
  id: 'e-1',
  organization_id: 'o-1',
  title: 'Officer Election',
  election_type: 'officer',
  positions: ['Chief'],
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

describe('ElectionDetailPage info card on a phone (W50-62)', () => {
  beforeEach(() => {
    getElection.mockReset();
    getElection.mockResolvedValue(draft);
  });

  it('spans the Positions cell only from md, and lets the title row wrap', async () => {
    renderWithRouter(<ElectionDetailPage />);
    const positions = await screen.findByText('Positions');
    const cell = cellAround(positions);
    expect(cell).toHaveClass('md:col-span-2');
    expect(cell).not.toHaveClass('col-span-2');

    const pill = screen.getByText('draft');
    expect(pill).toHaveClass('shrink-0');
    expect(cellAround(pill)).toHaveClass('flex-wrap');
  });
});
