import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { AttendanceWaiverEligibility, AttendanceWaiverRequest } from '../../types/attendanceWaiver';

const mockEligibility = vi.fn();
const mockGet = vi.fn();
const mockConfirm = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: {
    getEligibility: (...args: unknown[]) => mockEligibility(...args) as unknown,
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    confirm: (...args: unknown[]) => mockConfirm(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AttendanceWaiverCard from './AttendanceWaiverCard';

const eligibility: AttendanceWaiverEligibility = {
  event_id: 'evt-1',
  allowed: false,
  refusal_code: 'already_requested',
  refusal: 'You have already asked to be excused from this training session.',
  deadline: '2026-11-27T23:00:00Z',
  deadline_preset: 'before_start',
  session_date: '2026-11-27',
  cap: null,
  cap_period: 'calendar_year',
  cap_used: null,
  cap_remaining: null,
  categories: [],
  category_required: false,
  reason_text: 'optional',
  existing_request_id: 'req-1',
  existing_request_status: 'pending',
};

/** The member's request after the session moved to 27 November: it waits on them. */
const moved = (over: Partial<AttendanceWaiverRequest> = {}): AttendanceWaiverRequest => ({
  id: 'req-1',
  workflow: 'training_session',
  user_id: 'user-1',
  member_name: 'Pat Doe',
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
  reconfirm_requested_at: '2026-11-13T12:00:00Z',
  can_withdraw: true,
  can_respond: false,
  can_confirm: true,
  can_request_info: false,
  can_decide: false,
  can_override: false,
  actions: [],
  ...over,
});

const render = () =>
  renderWithRouter(<AttendanceWaiverCard eventId="evt-1" eventTitle="Ladder Drill" timezone="UTC" />);

describe('AttendanceWaiverCard — a moved session', () => {
  beforeEach(() => {
    mockEligibility.mockReset();
    mockGet.mockReset();
    mockConfirm.mockReset();
    mockEligibility.mockResolvedValue(eligibility);
  });

  it('asks the member to confirm the new date, then reloads', async () => {
    mockGet.mockResolvedValueOnce(moved());
    mockGet.mockResolvedValueOnce(moved({ reconfirm_requested_at: null, can_confirm: false }));
    mockConfirm.mockResolvedValue(moved({ reconfirm_requested_at: null, can_confirm: false }));
    const user = userEvent.setup();
    render();
    expect(await screen.findByText(/This session moved to .*November 27, 2026/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(mockConfirm).toHaveBeenCalledWith('req-1');
    expect(await screen.findByText(/It is waiting for a decision/)).toBeInTheDocument();
  });
});
