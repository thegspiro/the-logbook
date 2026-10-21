/**
 * The publish toggle must not be offered for an election the backend will
 * refuse to publish.
 *
 * `PATCH /elections/{id}` allows only `end_date` while an election is OPEN and
 * rejects `results_visible_immediately` with a 400 (live counts during voting
 * invite strategic voting). The panel used to render an enabled "Publish
 * Results" button for open elections anyway, so every press was a guaranteed
 * error toast; it now shows an explanatory line until voting closes.
 * Separately, "Send Report" emails the officer who pressed it
 * (`generate_and_send_election_report` with `requested_by`), never the
 * eligible voters the old copy promised, and the toast names the address the
 * backend actually sent to.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { Election } from '../../../types/election';

const mockUpdateElection = vi.fn();
const mockSendReport = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: vi.fn(),
  },
}));

vi.mock('../../../services/api', () => ({
  electionService: {
    updateElection: (...args: unknown[]) => mockUpdateElection(...args) as unknown,
    sendReport: (...args: unknown[]) => mockSendReport(...args) as unknown,
  },
}));

import { PublishResultsPanel } from './PublishResultsPanel';

const baseElection = {
  id: 'e1',
  title: 'Chief Election',
  status: 'open',
  results_visible_immediately: false,
  total_votes: 4,
  total_voters: 4,
} as unknown as Election;

describe('PublishResultsPanel (S19)', () => {
  beforeEach(() => {
    mockUpdateElection.mockReset();
    mockSendReport.mockReset();
    mockToastSuccess.mockReset();
  });

  it('does not offer an enabled publish toggle while the election is open', () => {
    renderWithRouter(<PublishResultsPanel electionId="e1" election={baseElection} />);

    // Either hide the control or disable it: what must not exist is an
    // enabled button whose only possible outcome is a 400.
    const enabledPublish = screen
      .queryAllByRole('button', { name: /publish results/i })
      .filter((button) => !(button as HTMLButtonElement).disabled);
    expect(enabledPublish).toHaveLength(0);
    expect(mockUpdateElection).not.toHaveBeenCalled();
  });

  it('describes the report as going to the officer, not to all eligible voters', () => {
    renderWithRouter(<PublishResultsPanel electionId="e1" election={{ ...baseElection, status: 'closed' }} />);

    expect(screen.getByRole('button', { name: /send report/i })).toBeInTheDocument();
    expect(screen.getByText('Email the results report to yourself')).toBeInTheDocument();
    expect(screen.queryByText(/all eligible voters/i)).not.toBeInTheDocument();
  });

  it('confirms the address the backend sent the report to', async () => {
    mockSendReport.mockResolvedValue({ success: true, message: 'Election report sent to clerk@test.com' });
    renderWithRouter(<PublishResultsPanel electionId="e1" election={{ ...baseElection, status: 'closed' }} />);

    await userEvent.click(screen.getByRole('button', { name: /send report/i }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Election report sent to clerk@test.com'));
    expect(mockSendReport).toHaveBeenCalledWith('e1');
  });

  it('offers no publish switch on a closed election, whose close released the results', () => {
    renderWithRouter(<PublishResultsPanel electionId="e1" election={{ ...baseElection, status: 'closed' }} />);

    expect(screen.getByText('Results are visible to members')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish results|hide results/i })).not.toBeInTheDocument();
    expect(mockUpdateElection).not.toHaveBeenCalled();
  });

  it('says an open election keeps results hidden until voting closes', () => {
    renderWithRouter(<PublishResultsPanel electionId="e1" election={baseElection} />);

    expect(screen.getByText('Results are hidden while voting is open')).toBeInTheDocument();
  });
});
