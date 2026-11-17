import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { BellRing, ClipboardCheck } from 'lucide-react';
import type { Election } from '../../../types/election';

const getStats = vi.fn();
vi.mock('../../../services/electionService', () => ({
  electionService: { getStats: (...args: unknown[]) => getStats(...args) as unknown },
}));

import { ElectionPhoneDashboard, type DashboardAction } from './ElectionPhoneDashboard';

const election = (status: string, extra: Partial<Election> = {}) =>
  ({
    id: 'e-1',
    title: 'Line Officers',
    status,
    start_date: '2026-11-10T14:00:00Z',
    end_date: '2999-11-18T23:00:00Z',
    results_visible_immediately: false,
    ballot_items: [],
    ...extra,
  }) as unknown as Election;

const renderDashboard = (
  e: Election,
  options: { actions?: DashboardAction[]; onPrimary?: () => void; onToggleDetails?: () => void } = {}
) =>
  render(
    <MemoryRouter>
      <ElectionPhoneDashboard
        electionId="e-1"
        election={e}
        tz="UTC"
        primaryAction={options.onPrimary ? { label: 'Close Election', onClick: options.onPrimary } : null}
        actions={options.actions ?? []}
        showDetails={false}
        onToggleDetails={options.onToggleDetails ?? (() => undefined)}
      />
    </MemoryRouter>
  );

describe('ElectionPhoneDashboard', () => {
  beforeEach(() => {
    getStats.mockReset();
    getStats.mockResolvedValue({ total_voters: 48, total_eligible_voters: 62, voter_turnout_percentage: 77.4 });
  });

  it('leads an open election with how many have voted out of how many may', async () => {
    renderDashboard(election('open'));

    expect(await screen.findByTestId('dashboard-voted')).toHaveTextContent('48 / 62');
    expect(screen.getByText('members have voted')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Turnout' })).toHaveAttribute('aria-valuenow', '77');
    expect(screen.getByText(/remaining$/)).toBeInTheDocument();
    expect(getStats).toHaveBeenCalledWith('e-1', expect.anything());
  });

  it('runs the step that moves the election on', async () => {
    const onPrimary = vi.fn();
    renderDashboard(election('open'), { onPrimary });

    await userEvent.click(screen.getByRole('button', { name: 'Close Election' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("lists the night's actions as buttons and section links", async () => {
    const remind = vi.fn();
    renderDashboard(election('open'), {
      actions: [
        { key: 'remind', label: 'Remind non-voters', icon: BellRing, onClick: remind },
        { key: 'checkin', label: 'Check members in', icon: ClipboardCheck, to: '/elections/e-1/attendance' },
      ],
    });

    const tonight = screen.getByRole('list', { name: 'Tonight' });
    await userEvent.click(within(tonight).getByRole('button', { name: 'Remind non-voters' }));
    expect(remind).toHaveBeenCalledTimes(1);
    expect(within(tonight).getByRole('link', { name: 'Check members in' })).toHaveAttribute(
      'href',
      '/elections/e-1/attendance'
    );
  });

  it('offers Results as its own address only once there are results', () => {
    const { unmount } = renderDashboard(election('open'));
    expect(screen.queryByRole('link', { name: 'Results' })).not.toBeInTheDocument();
    unmount();

    renderDashboard(election('closed', { closed_at: '2026-11-18T23:00:00Z' }));
    expect(screen.getByRole('link', { name: 'Results' })).toHaveAttribute('href', '/elections/e-1/results');
  });

  it('keeps every section and the full Overview one tap away under More', async () => {
    const onToggleDetails = vi.fn();
    renderDashboard(election('open'), { onToggleDetails });

    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const more = screen.getByRole('navigation', { name: 'All of this election' });
    expect(within(more).getByRole('link', { name: 'Eligibility' })).toHaveAttribute(
      'href',
      '/elections/e-1/eligibility'
    );
    expect(within(more).getByRole('link', { name: 'Integrity & Audit' })).toBeInTheDocument();

    await userEvent.click(within(more).getByRole('button', { name: 'Details and all controls' }));
    expect(onToggleDetails).toHaveBeenCalledTimes(1);
  });

  it('points a draft at a larger screen for setup, and does not ask for a tally', () => {
    renderDashboard(election('draft'));

    expect(screen.getByText(/Set up the ballot, candidates and voters on a tablet or computer/)).toBeInTheDocument();
    expect(screen.getByText(/^Voting opens /)).toBeInTheDocument();
    expect(getStats).not.toHaveBeenCalled();
  });
});
