import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { AttendanceWaiverRequest } from '../../types/attendanceWaiver';

const mockList = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: { list: (...args: unknown[]) => mockList(...args) as unknown },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import AttendanceWaiverQueuePage from './AttendanceWaiverQueuePage';

const request = (id: string, over: Partial<AttendanceWaiverRequest> = {}): AttendanceWaiverRequest => ({
  id,
  workflow: 'training_session',
  user_id: `user-${id}`,
  member_name: `Member ${id}`,
  event_id: 'evt-1',
  event_title: 'Ladder Drill',
  event_start: '2026-11-20T23:00:00Z',
  session_date: '2026-11-20',
  status: 'pending',
  category: null,
  reason: 'private',
  submitted_at: '2026-11-11T15:00:00Z',
  decided_at: null,
  decided_by: null,
  decided_by_name: null,
  chief_override: false,
  can_withdraw: false,
  can_decide: true,
  can_override: false,
  actions: [],
  ...over,
});

const page = (items: AttendanceWaiverRequest[], total = items.length, skip = 0) => ({
  items,
  total,
  skip,
  limit: 50,
});

describe('AttendanceWaiverQueuePage', () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it('lists pending requests first, then decided ones, each linking to its decision page', async () => {
    const pending = request('p1');
    const decided = request('d1', { status: 'approved', decided_by_name: 'Lt. Smith', can_decide: false });
    mockList.mockImplementation((params: { status?: string }) =>
      Promise.resolve(params.status === 'pending' ? page([pending]) : page([pending, decided]))
    );
    renderWithRouter(<AttendanceWaiverQueuePage />);

    const waiting = await screen.findByRole('region', { name: 'Waiting for a decision (1)' });
    expect(within(waiting).getByRole('link', { name: /Member p1/ })).toHaveAttribute('href', '/attendance-waivers/p1');
    const decidedSection = screen.getByRole('region', { name: 'Decided and closed' });
    expect(within(decidedSection).getByRole('link', { name: /Member d1/ })).toBeInTheDocument();
    // A pending row is listed once, under pending, though the unfiltered page carries it too.
    expect(within(decidedSection).queryByText('Member p1')).not.toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith({ status: 'pending', limit: 200 });
    expect(mockList).toHaveBeenCalledWith({ skip: 0, limit: 50 });
    // The reason is for the decision page, not a shared list.
    expect(screen.queryByText('private')).not.toBeInTheDocument();
  });

  it('pages through decided requests', async () => {
    mockList.mockImplementation((params: { status?: string; skip?: number }) => {
      if (params.status === 'pending') return Promise.resolve(page([]));
      return Promise.resolve(
        params.skip === 0
          ? page([request('d1', { status: 'denied' })], 2, 0)
          : page([request('d2', { status: 'approved' })], 2, 1)
      );
    });
    const user = userEvent.setup();
    renderWithRouter(<AttendanceWaiverQueuePage />);
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Member d2')).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith({ skip: 1, limit: 50 });
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('says so when the viewer decides nothing', async () => {
    mockList.mockResolvedValue(page([]));
    renderWithRouter(<AttendanceWaiverQueuePage />);
    expect(await screen.findByText('No waiver requests for you')).toBeInTheDocument();
  });

  it('shows a load failure', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    renderWithRouter(<AttendanceWaiverQueuePage embedded />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  it('says when each pending request closes, and lists expired requests with the closed ones', async () => {
    const pending = request('p1', { expires_at: '2026-11-28T05:00:00Z' });
    const expired = request('e1', { status: 'expired', can_decide: false, expires_at: null });
    mockList.mockImplementation((params: { status?: string }) =>
      Promise.resolve(params.status === 'pending' ? page([pending]) : page([pending, expired]))
    );
    renderWithRouter(<AttendanceWaiverQueuePage />);

    const waiting = await screen.findByRole('region', { name: 'Waiting for a decision (1)' });
    expect(within(waiting).getByText(/^Closes undecided on Saturday, November 28, 2026/)).toBeInTheDocument();
    const closed = screen.getByRole('region', { name: 'Decided and closed' });
    expect(within(closed).getByRole('link', { name: /Member e1/ })).toBeInTheDocument();
    expect(within(closed).getByText('Expired')).toBeInTheDocument();
    expect(within(closed).queryByText(/Closes undecided/)).not.toBeInTheDocument();
  });
});
