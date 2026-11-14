import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { AttendanceWaiverEligibility, AttendanceWaiverRequest } from '../../types/attendanceWaiver';

const { meeting, training } = vi.hoisted(() => ({
  meeting: {
    getEligibility: vi.fn(),
    get: vi.fn(),
    respond: vi.fn(),
    confirm: vi.fn(),
    submit: vi.fn(),
    submitWithAttachments: vi.fn(),
  },
  training: { getEligibility: vi.fn(), get: vi.fn() },
}));
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: training,
  meetingWaiverService: meeting,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AttendanceWaiverCard from './AttendanceWaiverCard';
import { MEETING_WAIVER_WORKFLOW } from '../../utils/attendanceWaiverWorkflows';

const eligibility = (over: Partial<AttendanceWaiverEligibility> = {}): AttendanceWaiverEligibility => ({
  event_id: 'evt-1',
  allowed: true,
  refusal_code: null,
  refusal: null,
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
  existing_request_id: null,
  existing_request_status: null,
  ...over,
});

const request = (over: Partial<AttendanceWaiverRequest> = {}): AttendanceWaiverRequest => ({
  id: 'req-1',
  workflow: 'business_meeting',
  user_id: 'user-1',
  member_name: 'Pat Doe',
  event_id: 'evt-1',
  event_title: 'November Business Meeting',
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
  can_withdraw: true,
  can_respond: false,
  can_confirm: false,
  can_request_info: false,
  can_decide: false,
  can_override: false,
  actions: [],
  ...over,
});

const render = () =>
  renderWithRouter(
    <AttendanceWaiverCard
      eventId="evt-1"
      eventTitle="November Business Meeting"
      timezone="UTC"
      workflow={MEETING_WAIVER_WORKFLOW}
    />
  );

describe('AttendanceWaiverCard on a business meeting', () => {
  beforeEach(() => {
    Object.values(meeting).forEach((m) => m.mockReset());
    Object.values(training).forEach((m) => m.mockReset());
  });

  it('asks the meeting API and words the offer for a meeting', async () => {
    meeting.getEligibility.mockResolvedValue(eligibility());
    render();
    expect(await screen.findByText(/This meeting counts toward your meeting attendance/)).toBeInTheDocument();
    expect(meeting.getEligibility).toHaveBeenCalledWith('evt-1');
    expect(training.getEligibility).not.toHaveBeenCalled();
  });

  it('answers an officer’s question on the card, since meetings have no list of requests', async () => {
    meeting.getEligibility.mockResolvedValue(
      eligibility({ allowed: false, existing_request_id: 'req-1', existing_request_status: 'pending' })
    );
    meeting.get.mockResolvedValue(request({ info_requested_at: '2026-11-12T15:00:00Z', can_respond: true }));
    meeting.respond.mockResolvedValue(request());
    const user = userEvent.setup();
    render();

    const answer = await screen.findByLabelText(/Your answer/);
    expect(screen.queryByRole('link', { name: /My Training/ })).not.toBeInTheDocument();
    await user.type(answer, 'I am on shift that night.');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(meeting.respond).toHaveBeenCalledWith('req-1', 'I am on shift that night.');
  });

  it('confirms a moved meeting through the meeting API', async () => {
    meeting.getEligibility.mockResolvedValue(
      eligibility({ allowed: false, existing_request_id: 'req-1', existing_request_status: 'pending' })
    );
    meeting.get.mockResolvedValue(request({ reconfirm_requested_at: '2026-11-13T12:00:00Z', can_confirm: true }));
    meeting.confirm.mockResolvedValue(request());
    const user = userEvent.setup();
    render();

    expect(await screen.findByText(/This meeting moved to/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(meeting.confirm).toHaveBeenCalledWith('req-1');
  });

  it('never offers documents for a meeting, whatever a stored policy says', async () => {
    meeting.getEligibility.mockResolvedValue(eligibility({ attachment: 'required' }));
    meeting.submit.mockResolvedValue(request());
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: /Request to be excused/ }));
    expect(screen.queryByText(/Supporting document/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(meeting.submit).toHaveBeenCalledWith(expect.objectContaining({ event_id: 'evt-1' }));
    expect(meeting.submitWithAttachments).not.toHaveBeenCalled();
  });
});
