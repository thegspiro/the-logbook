/**
 * A `?tab=` deep link survives the election loading, and the tab fallback does
 * not push history.
 *
 * `fetchElection` used to call `setActiveTab('results')` whenever the election
 * was closed or `results_visible_immediately` — on every load and every
 * refresh — which overwrote the section the link named and pushed a history
 * entry (react-router's `setSearchParams` navigates with push unless told
 * otherwise). A secretary opening "the eligibility roster for this election"
 * from a colleague's link landed on Results instead, and Back returned to the
 * deep link only to be redirected again. The auto-select now runs only when
 * the URL names no tab, and both it and the tabs fallback use `replace`.
 *
 * Rendered, not source-asserted: the defect is timing (URL after load), and
 * the loaded branch needs its panels stubbed to reach the tab strip.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
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

// Panels are not under test; stub every one the loaded branch can mount.
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

const closedElection = {
  id: 'e-1',
  organization_id: 'o-1',
  title: 'Officer Election',
  election_type: 'officer',
  positions: ['Chief'],
  start_date: '2026-09-01T00:00:00Z',
  end_date: '2026-09-02T00:00:00Z',
  status: 'closed',
  anonymous_voting: true,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: false,
  voting_method: 'simple_majority',
  victory_condition: 'plurality',
};

describe('ElectionDetailPage tab deep link on a closed election (S24)', () => {
  beforeEach(() => {
    getElection.mockReset();
    getElection.mockResolvedValue(closedElection);
  });

  it('keeps the section the link named instead of jumping to Results', async () => {
    window.history.replaceState({}, '', '/elections/e-1?tab=eligibility');
    const before = window.history.length;
    renderWithRouter(<ElectionDetailPage />);

    // The strip renders only once the election has loaded, which is also when
    // fetchElection's auto-select runs; let its navigation settle first.
    await screen.findByRole('tab', { name: /Results/ });
    await act(async () => undefined);

    expect(window.location.search).toBe('?tab=eligibility');
    expect(screen.getByRole('tab', { name: /Eligibility/ })).toHaveAttribute('aria-selected', 'true');
    // No history entry was pushed: Back still leaves the page.
    expect(window.history.length).toBe(before);
  });
});
