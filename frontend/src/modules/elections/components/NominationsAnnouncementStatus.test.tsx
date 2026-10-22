/**
 * The nominations-open announcement is a background job; the Nominations tab
 * says whether every member was told, using the backend's own message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { BallotSendJob } from '../../../types/election';

const mockWaitForBallotSendJob = vi.fn();

vi.mock('../../../services/api', () => ({
  electionService: {
    waitForBallotSendJob: (...args: unknown[]) => mockWaitForBallotSendJob(...args) as unknown,
  },
}));

import { NominationsAnnouncementStatus } from './NominationsAnnouncementStatus';

const job = (overrides: Partial<BallotSendJob>): BallotSendJob => ({
  id: 'job-1',
  election_id: 'e1',
  kind: 'announcement',
  status: 'completed',
  created_at: '2026-10-21T12:00:00Z',
  started_at: '2026-10-21T12:00:01Z',
  finished_at: '2026-10-21T12:00:40Z',
  result: null,
  error: null,
  ...overrides,
});

const outcome = (success: boolean, message: string) => ({
  success,
  recipients_count: 0,
  failed_count: 0,
  skipped_count: 0,
  skipped_details: [],
  message,
});

describe('NominationsAnnouncementStatus', () => {
  beforeEach(() => {
    mockWaitForBallotSendJob.mockReset();
    mockWaitForBallotSendJob.mockResolvedValue(null);
  });

  it('says it is sending, then reloads the election once the job finishes', async () => {
    const onFinished = vi.fn();
    render(
      <NominationsAnnouncementStatus
        electionId="e1"
        announcement={job({ status: 'running' })}
        onFinished={onFinished}
      />
    );

    expect(screen.getByText('Emailing members that nominations are open…')).toBeInTheDocument();
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(mockWaitForBallotSendJob).toHaveBeenCalledWith('e1', 'job-1', expect.any(Function));
  });

  it('reloads even when the job fails while being watched', async () => {
    mockWaitForBallotSendJob.mockRejectedValue(new Error('SMTP down'));
    const onFinished = vi.fn();
    render(
      <NominationsAnnouncementStatus electionId="e1" announcement={job({ status: 'queued' })} onFinished={onFinished} />
    );

    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
  });

  it('shows the backend message when every member was told, without polling', () => {
    const onFinished = vi.fn();
    render(
      <NominationsAnnouncementStatus
        electionId="e1"
        announcement={job({ result: outcome(true, 'Nominations announcement emailed to 40 member(s).') })}
        onFinished={onFinished}
      />
    );

    expect(screen.getByText('Nominations announcement emailed to 40 member(s).')).toBeInTheDocument();
    expect(mockWaitForBallotSendJob).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('warns when members were missed and says the managers were told', () => {
    render(
      <NominationsAnnouncementStatus
        electionId="e1"
        announcement={job({
          result: outcome(false, 'Nominations announcement emailed to 38 member(s); 2 could not be reached.'),
        })}
        onFinished={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('2 could not be reached');
    expect(screen.getByRole('alert')).toHaveTextContent('The election managers have been emailed');
  });

  it('warns with the server reason when the announcement did not go out', () => {
    render(
      <NominationsAnnouncementStatus
        electionId="e1"
        announcement={job({ status: 'failed', error: 'The nominations announcement was interrupted.' })}
        onFinished={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('The nominations announcement did not go out.');
    expect(screen.getByRole('alert')).toHaveTextContent('The nominations announcement was interrupted.');
  });
});
