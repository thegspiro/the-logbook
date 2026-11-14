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
  event_start: '2026-11-20T23:00:00Z',
  session_date: '2026-11-20',
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
  can_request_info: true,
  can_decide: true,
  can_override: false,
  actions: [],
  ...over,
});

describe('AttendanceWaiverQueuePage — waiting on the member', () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it('badges only the pending rows with a question open', async () => {
    const asked = request('p1', { info_requested_at: '2026-11-12T15:00:00Z', can_request_info: false });
    const plain = request('p2');
    const page = { items: [asked, plain], total: 2, skip: 0, limit: 200 };
    mockList.mockResolvedValue(page);
    renderWithRouter(<AttendanceWaiverQueuePage />);

    const waiting = await screen.findByRole('region', { name: 'Waiting for a decision (2)' });
    expect(within(waiting).getByRole('link', { name: /Member p1/ })).toHaveTextContent('Waiting on member');
    expect(within(waiting).getByRole('link', { name: /Member p2/ })).not.toHaveTextContent('Waiting on member');
  });
});
