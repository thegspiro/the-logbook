import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import type { AttendanceWaiverEligibility, AttendanceWaiverRequest } from '../../types/attendanceWaiver';

const mockEligibility = vi.fn();
const mockGet = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: {
    getEligibility: (...args: unknown[]) => mockEligibility(...args) as unknown,
    get: (...args: unknown[]) => mockGet(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AttendanceWaiverCard from './AttendanceWaiverCard';

const eligibility: AttendanceWaiverEligibility = {
  event_id: 'evt-1',
  allowed: false,
  refusal_code: 'already_requested',
  refusal: 'You have already asked to be excused from this training session.',
  deadline: '2026-11-20T23:00:00Z',
  deadline_preset: 'before_start',
  session_date: '2026-11-20',
  cap: null,
  cap_period: 'calendar_year',
  cap_used: null,
  cap_remaining: null,
  categories: [],
  category_required: false,
  reason_text: 'optional',
  attachment: 'off',
  existing_request_id: 'req-1',
  existing_request_status: 'pending',
};

const request = (over: Partial<AttendanceWaiverRequest> = {}): AttendanceWaiverRequest => ({
  id: 'req-1',
  workflow: 'training_session',
  user_id: 'user-1',
  member_name: 'Pat Doe',
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
  info_requested_at: '2026-11-12T15:00:00Z',
  reconfirm_requested_at: null,
  can_withdraw: true,
  can_respond: true,
  can_confirm: false,
  can_request_info: false,
  can_decide: false,
  can_override: false,
  actions: [],
  ...over,
});

const render = () =>
  renderWithRouter(<AttendanceWaiverCard eventId="evt-1" eventTitle="Ladder Drill" timezone="UTC" />);

describe('AttendanceWaiverCard — a question waiting on the member', () => {
  beforeEach(() => {
    mockEligibility.mockReset();
    mockGet.mockReset();
    mockEligibility.mockResolvedValue(eligibility);
  });

  it('points the member to My Training, where the question is answered', async () => {
    mockGet.mockResolvedValue(request());
    render();
    expect(await screen.findByText(/An officer asked you a question about it/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Answer it on My Training' })).toHaveAttribute(
      'href',
      '/training/my-training'
    );
  });

  it('says nothing of a question when none is open', async () => {
    mockGet.mockResolvedValue(request({ info_requested_at: null, can_respond: false }));
    render();
    expect(await screen.findByText(/It is waiting\s+for a decision/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Answer it on My Training' })).not.toBeInTheDocument();
  });
});
