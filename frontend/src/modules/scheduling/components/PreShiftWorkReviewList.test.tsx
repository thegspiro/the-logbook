import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { PreShiftWorkSession } from '../services/api';

const mockReview = vi.fn();
vi.mock('../services/api', () => ({
  schedulingService: {
    reviewPreShiftWork: (...a: unknown[]) => mockReview(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/Chicago',
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import toast from 'react-hot-toast';
import PreShiftWorkReviewList from './PreShiftWorkReviewList';

const pending: PreShiftWorkSession = {
  id: 'pw-1',
  shift_id: 'shift-1',
  user_id: 'member-1',
  user_name: 'Jane Doe',
  started_at: '2026-10-10T20:00:00Z',
  ended_at: '2026-10-10T21:10:00Z',
  duration_minutes: 70,
  note: 'Equipment check',
  status: 'pending',
  shift_is_finalized: false,
};

const renderList = (
  sessions: PreShiftWorkSession[],
  opts: { currentUserId?: string; canManage?: boolean; onReviewed?: (s: PreShiftWorkSession) => void } = {}
) =>
  render(
    <PreShiftWorkReviewList
      sessions={sessions}
      currentUserId={opts.currentUserId ?? 'officer-1'}
      canManage={opts.canManage ?? false}
      onReviewed={opts.onReviewed ?? vi.fn()}
    />
  );

beforeEach(() => {
  mockReview.mockReset();
  mockReview.mockResolvedValue({ ...pending, status: 'approved', approved_minutes: 60 });
  vi.mocked(toast.error).mockReset();
});

describe('PreShiftWorkReviewList', () => {
  it('approves with the minutes the officer credits', async () => {
    const onReviewed = vi.fn();
    const user = userEvent.setup();
    renderList([pending], { onReviewed });

    const minutes = screen.getByLabelText('Minutes to credit');
    expect(minutes).toHaveValue(70);
    await user.clear(minutes);
    await user.type(minutes, '60');
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(mockReview).toHaveBeenCalledWith('pw-1', {
      decision: 'approve',
      approved_minutes: 60,
      ended_at: undefined,
    });
    expect(onReviewed).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
  });

  it('rejects without sending minutes', async () => {
    const user = userEvent.setup();
    renderList([pending]);

    await user.click(screen.getByRole('button', { name: 'Reject' }));

    expect(mockReview).toHaveBeenCalledWith('pw-1', {
      decision: 'reject',
      approved_minutes: undefined,
      ended_at: undefined,
    });
  });

  it('tells a shift officer their own time needs someone else, and offers no buttons', () => {
    renderList([{ ...pending, user_id: 'officer-1' }], { currentUserId: 'officer-1', canManage: false });

    expect(screen.getByText(/someone with scheduling management must approve it/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('lets scheduling.manage approve their own time', () => {
    renderList([{ ...pending, user_id: 'officer-1' }], { currentUserId: 'officer-1', canManage: true });

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('asks for an end time on a session the member never ended', async () => {
    const user = userEvent.setup();
    renderList([{ ...pending, status: 'active', ended_at: null, duration_minutes: null }]);

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(mockReview).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Enter when this pre-shift work ended.');
    expect(screen.getByLabelText('Ended at')).toBeInTheDocument();
  });

  it('shows a decided session without actions', () => {
    renderList([{ ...pending, status: 'approved', approved_minutes: 60, reviewed_by_name: 'Olive Officer' }]);

    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText(/1h 0m credited by Olive Officer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});
