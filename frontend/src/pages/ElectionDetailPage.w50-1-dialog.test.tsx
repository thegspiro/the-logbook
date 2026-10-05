/**
 * W50-1 — a refused delete tells the officer why.
 *
 * `DELETE /elections/{id}` now answers 409 in two cases: the election has
 * runoff children that must go first, and the database still references the
 * election from a record the cascade does not cover. Both carry their reason
 * in `detail`; the dialog must show that text, keep itself open with the
 * typed reason intact, and not treat the refusal as a success (no navigation,
 * no success toast).
 *
 * Rendered rather than source-asserted: the behaviour lives in the page's
 * handler (which maps the error to the dialog's `error` prop) and the
 * dialog's alert region together.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter, mockNavigate } from '../test/utils';

const getElection = vi.fn();
const deleteElection = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...a: unknown[]) => toastSuccess(...a) as unknown, error: vi.fn() },
}));
vi.mock('../services/api', () => ({
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    deleteElection: (...a: unknown[]) => deleteElection(...a) as unknown,
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
  return { ...actual, useParams: () => ({ electionId: 'e-1' }), useNavigate: () => mockNavigate };
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

const baseElection = {
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

/** The shape axios hands a caller for a FastAPI 409 (`main.py` adds `code`). */
const conflict = (detail: string) =>
  Object.assign(new Error('Request failed with status code 409'), {
    response: { status: 409, statusText: 'Conflict', data: { detail, code: 'LB-API-409' } },
  });

const RUNOFF_DETAIL = 'This election has runoff election(s) that must be deleted first: Officer Election - Runoff 1';
const REFERENCED_DETAIL = 'This election is still referenced by other records and could not be deleted';

async function openDeleteDialog() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Delete Election' }));
  return { user, dialog: screen.getByRole('dialog', { name: /Delete/ }) };
}

describe('ElectionDetailPage delete refused with 409 (W50-1)', () => {
  beforeEach(() => {
    getElection.mockReset();
    deleteElection.mockReset();
    toastSuccess.mockReset();
    mockNavigate.mockReset();
    window.history.replaceState({}, '', '/elections/e-1');
  });

  it('shows the runoff-child reason in the dialog and keeps the typed reason', async () => {
    getElection.mockResolvedValue(baseElection);
    deleteElection.mockRejectedValue(conflict(RUNOFF_DETAIL));
    renderWithRouter(<ElectionDetailPage />);

    const { user, dialog } = await openDeleteDialog();
    const reason = 'Election was created against the wrong bylaws';
    await user.type(within(dialog).getByLabelText(/Reason for Deletion/), reason);
    await user.click(within(dialog).getByRole('button', { name: 'Permanently Delete Election' }));

    expect(deleteElection).toHaveBeenCalledWith('e-1', reason);
    const alert = await within(dialog).findByText(RUNOFF_DETAIL, { exact: false });
    expect(alert).toBeInTheDocument();
    expect(within(dialog).queryByText(/LB-SYS-001/)).not.toBeInTheDocument();
    // The refusal is not a success: the dialog stays, with the reason ready for a retry.
    expect(screen.getByRole('dialog', { name: /Delete/ })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Reason for Deletion/)).toHaveValue(reason);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows the "still referenced" reason for a draft, which needs no typed reason', async () => {
    getElection.mockResolvedValue({ ...baseElection, status: 'draft' });
    deleteElection.mockRejectedValue(conflict(REFERENCED_DETAIL));
    renderWithRouter(<ElectionDetailPage />);

    const { user, dialog } = await openDeleteDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Delete Draft' }));

    expect(deleteElection).toHaveBeenCalledWith('e-1', undefined);
    expect(await within(dialog).findByText(REFERENCED_DETAIL, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /Delete/ })).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
