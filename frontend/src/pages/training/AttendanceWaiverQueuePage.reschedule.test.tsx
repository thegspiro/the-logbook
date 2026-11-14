import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
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
  event_start: '2026-11-27T23:00:00Z',
  session_date: '2026-11-27',
  status: 'pending',
  category: null,
  reason: null,
  submitted_at: '2026-11-11T15:00:00Z',
  decided_at: null,
  decided_by: null,
  decided_by_name: null,
  chief_override: false,
  info_requested_at: null,
  reconfirm_requested_at: null,
  can_withdraw: false,
  can_respond: false,
  can_confirm: false,
  can_request_info: false,
  can_decide: true,
  can_override: false,
  actions: [],
  ...over,
});

describe('AttendanceWaiverQueuePage — a moved session', () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it('badges the rows that wait on their member to confirm the new date', async () => {
    const waiting = request('w1', { reconfirm_requested_at: '2026-11-13T12:00:00Z', can_decide: false });
    const ready = request('r1');
    mockList.mockResolvedValue({ items: [waiting, ready], total: 2, skip: 0, limit: 200 });
    renderWithRouter(<AttendanceWaiverQueuePage />);

    const waitingRow = await screen.findByRole('link', { name: /Member w1/ });
    expect(within(waitingRow).getByText('Session moved: member to confirm')).toBeInTheDocument();
    const readyRow = screen.getByRole('link', { name: /Member r1/ });
    expect(within(readyRow).queryByText('Session moved: member to confirm')).not.toBeInTheDocument();
  });
});
