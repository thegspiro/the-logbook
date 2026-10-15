import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockList = vi.fn();
const mockImportable = vi.fn();
const mockFile = vi.fn();
const mockRemove = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    getElectionResults: (...a: unknown[]) => mockList(...a) as unknown,
    getImportableElections: (...a: unknown[]) => mockImportable(...a) as unknown,
    fileElectionResult: (...a: unknown[]) => mockFile(...a) as unknown,
    removeElectionResult: (...a: unknown[]) => mockRemove(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => toastSuccess(...a) as unknown,
    error: (...a: unknown[]) => toastError(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import { ElectionResultsPanel } from './ElectionResultsPanel';
import { renderWithRouter } from '../../../test/utils';

const filed = {
  id: 'r1',
  minutes_id: 'm1',
  election_id: 'e1',
  election_title: 'Officer election',
  election_closed_at: '2026-10-01T20:00:00Z',
  captured_by_name: 'Sam Secretary',
  created_at: '2026-10-02T12:00:00Z',
  snapshot: {
    total_eligible_voters: 12,
    total_votes: 9,
    voter_turnout_percentage: 75,
    quorum_met: true,
    results_by_position: [
      {
        position: 'Chief',
        total_votes: 9,
        candidates: [
          { candidate_name: 'Alex Adams', vote_count: 6, percentage: 66.7, is_winner: true },
          { candidate_name: 'Blake Brown', vote_count: 3, percentage: 33.3, is_winner: false },
        ],
      },
    ],
  },
};

describe('ElectionResultsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReset();
    mockImportable.mockReset();
    mockFile.mockReset();
    mockRemove.mockReset();
    mockList.mockResolvedValue([filed]);
    mockImportable.mockResolvedValue([]);
  });

  it('shows the filed tally with turnout, quorum and the winner', async () => {
    renderWithRouter(<ElectionResultsPanel minutesId="m1" canFile={false} canRemoveDrafted={false} />);

    expect(await screen.findByRole('heading', { name: 'Officer election' })).toBeInTheDocument();
    expect(screen.getByText(/12 eligible · 9 ballots cast · 75% turnout · Quorum met/)).toBeInTheDocument();
    expect(screen.getByText(/Filed .* by Sam Secretary/)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Results for Chief' });
    expect(within(table).getByText('Winner')).toBeInTheDocument();
    expect(within(table).getByText('Blake Brown')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'File an election result' })).not.toBeInTheDocument();
  });

  it('renders nothing for a reader when no result is filed', async () => {
    mockList.mockResolvedValue([]);
    const { container } = renderWithRouter(
      <ElectionResultsPanel minutesId="m1" canFile={false} canRemoveDrafted={false} />
    );
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the results cannot be loaded and the user cannot edit', async () => {
    mockList.mockRejectedValue(new Error('404'));
    const { container } = renderWithRouter(
      <ElectionResultsPanel minutesId="m1" canFile={false} canRemoveDrafted={false} />
    );
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('invites a manager to file one when none is filed', async () => {
    mockList.mockResolvedValue([]);
    renderWithRouter(<ElectionResultsPanel minutesId="m1" canFile canRemoveDrafted />);
    expect(await screen.findByText(/No election results filed/)).toBeInTheDocument();
  });

  it('files a closed election from the picker', async () => {
    mockList.mockResolvedValueOnce([]).mockResolvedValue([filed]);
    mockImportable.mockResolvedValue([
      {
        id: 'e1',
        title: 'Officer election',
        closed_at: '2026-10-01T20:00:00Z',
        positions: ['Chief'],
        already_imported: false,
      },
      { id: 'e0', title: 'Last year', closed_at: '2025-10-01T20:00:00Z', positions: [], already_imported: true },
    ]);
    mockFile.mockResolvedValue(filed);
    const user = userEvent.setup();
    renderWithRouter(<ElectionResultsPanel minutesId="m1" canFile canRemoveDrafted />);

    await user.click(await screen.findByRole('button', { name: 'File an election result' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('button', { name: 'Already filed' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'File result' }));

    expect(mockFile).toHaveBeenCalledWith('m1', 'e1');
    expect(toastSuccess).toHaveBeenCalledWith('Filed the result of Officer election');
    expect(await screen.findByRole('heading', { name: 'Officer election' })).toBeInTheDocument();
  });

  it('says so when there is no closed election', async () => {
    mockList.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithRouter(<ElectionResultsPanel minutesId="m1" canFile canRemoveDrafted />);

    await user.click(await screen.findByRole('button', { name: 'File an election result' }));
    expect(await screen.findByText('There are no closed elections to file.')).toBeInTheDocument();
  });

  it('reports a refusal from the server', async () => {
    mockList.mockResolvedValue([]);
    mockImportable.mockResolvedValue([{ id: 'e1', title: 'Officer election', already_imported: false }]);
    mockFile.mockRejectedValue(new Error('Only a closed election has a result to file with the minutes'));
    const user = userEvent.setup();
    renderWithRouter(<ElectionResultsPanel minutesId="m1" canFile canRemoveDrafted />);

    await user.click(await screen.findByRole('button', { name: 'File an election result' }));
    await user.click(await screen.findByRole('button', { name: 'File result' }));

    expect(toastError).toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('removes a filed result only after confirmation', async () => {
    mockRemove.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithRouter(<ElectionResultsPanel minutesId="m1" canFile canRemoveDrafted />);

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(mockRemove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(await screen.findByRole('button', { name: 'Remove result' }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('m1', 'r1'));
  });
  describe('after the minutes were circulated', () => {
    const addendum = { ...filed, id: 'r2', is_addendum: true };

    beforeEach(() => {
      mockList.mockReset();
      mockList.mockResolvedValue([filed, addendum]);
    });

    it('labels an addendum and offers no way to remove it', async () => {
      renderWithRouter(<ElectionResultsPanel minutesId="m1" canFile canRemoveDrafted={false} />);

      expect(await screen.findByText('Addendum')).toBeInTheDocument();
      expect(screen.getByText(/not part of the text that was adopted/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    });

    it('keeps Remove on a drafted result but not on the addendum beside it', async () => {
      renderWithRouter(<ElectionResultsPanel minutesId="m1" canFile canRemoveDrafted />);

      await screen.findByText('Addendum');
      expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    });

    it('says the result will be filed as a permanent addendum and flags the election held here', async () => {
      mockImportable.mockResolvedValue([
        { id: 'e2', title: 'Run-off', already_imported: false, linked_to_meeting: true },
        { id: 'e3', title: 'Other vote', already_imported: false, linked_to_meeting: false },
      ]);
      const user = userEvent.setup();
      renderWithRouter(<ElectionResultsPanel minutesId="m1" canFile canRemoveDrafted={false} />);

      await user.click(await screen.findByRole('button', { name: 'File an election result' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/filed as a permanent, dated addendum/)).toBeInTheDocument();
      expect(await within(dialog).findAllByText('Held at this meeting')).toHaveLength(1);
    });

    it('does not mention an addendum while the minutes are still a draft', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ElectionResultsPanel minutesId="m1" canFile canRemoveDrafted />);

      await user.click(await screen.findByRole('button', { name: 'File an election result' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).queryByText(/permanent, dated addendum/)).not.toBeInTheDocument();
    });
  });
});
