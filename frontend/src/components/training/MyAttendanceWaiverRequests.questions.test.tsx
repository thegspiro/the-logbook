import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { AttendanceWaiverActionEntry, AttendanceWaiverRequest } from '../../types/attendanceWaiver';

const mockListMine = vi.fn();
const mockRespond = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: {
    listMine: (...args: unknown[]) => mockListMine(...args) as unknown,
    respond: (...args: unknown[]) => mockRespond(...args) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import MyAttendanceWaiverRequests from './MyAttendanceWaiverRequests';

const entry = (over: Partial<AttendanceWaiverActionEntry>): AttendanceWaiverActionEntry => ({
  id: 'a1',
  action: 'submitted',
  actor_id: 'user-1',
  actor_name: 'Pat Doe',
  note: null,
  created_at: '2026-11-11T15:00:00Z',
  ...over,
});

const firstQuestion = entry({
  id: 'a2',
  action: 'info_requested',
  actor_name: 'Lt. Smith',
  note: 'Which shift?',
  created_at: '2026-11-12T15:00:00Z',
});
const firstAnswer = entry({
  id: 'a3',
  action: 'member_responded',
  note: 'B shift.',
  created_at: '2026-11-12T16:00:00Z',
});
const secondQuestion = entry({
  id: 'a4',
  action: 'info_requested',
  actor_name: 'Lt. Smith',
  note: 'Is there a shift trade on file?',
  created_at: '2026-11-13T15:00:00Z',
});

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
  reason: 'Work',
  submitted_at: '2026-11-11T15:00:00Z',
  decided_at: null,
  decided_by: null,
  decided_by_name: null,
  chief_override: false,
  info_requested_at: '2026-11-13T15:00:00Z',
  reconfirm_requested_at: null,
  can_withdraw: true,
  can_respond: true,
  can_confirm: false,
  can_request_info: false,
  can_decide: false,
  can_override: false,
  actions: [entry({}), firstQuestion, firstAnswer, secondQuestion],
  ...over,
});

const wrap = vi.fn((list: React.ReactNode, needsAnswer: boolean) => (
  <section aria-label="My Waiver Requests" data-needs-answer={String(needsAnswer)}>
    {list}
  </section>
));

describe('MyAttendanceWaiverRequests — answering a question', () => {
  beforeEach(() => {
    mockListMine.mockReset();
    mockRespond.mockReset();
    wrap.mockClear();
  });

  it('shows the open question with an answer form, and the earlier round beneath', async () => {
    mockListMine.mockResolvedValue([request()]);
    renderWithRouter(<MyAttendanceWaiverRequests wrap={wrap} />);
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Lt. Smith asked for more information');
    expect(status).toHaveTextContent('Is there a shift trade on file?');
    expect(screen.getByLabelText(/Your answer/)).toBeInTheDocument();

    const earlier = screen.getByRole('list', { name: 'Questions and answers' });
    expect(within(earlier).getByText('Which shift?')).toBeInTheDocument();
    expect(within(earlier).getByText('B shift.')).toBeInTheDocument();
    // The open question is shown once, with its form, not again in the history.
    expect(within(earlier).queryByText('Is there a shift trade on file?')).not.toBeInTheDocument();
    expect(screen.getByLabelText('My Waiver Requests')).toHaveAttribute('data-needs-answer', 'true');
  });

  it('sends the answer and shows the server’s copy', async () => {
    mockListMine.mockResolvedValue([request()]);
    mockRespond.mockResolvedValue(
      request({
        info_requested_at: null,
        can_respond: false,
        actions: [
          entry({}),
          firstQuestion,
          firstAnswer,
          secondQuestion,
          entry({ id: 'a5', action: 'member_responded', note: 'Yes, with Lee.' }),
        ],
      })
    );
    const user = userEvent.setup();
    renderWithRouter(<MyAttendanceWaiverRequests wrap={wrap} />);
    await user.type(await screen.findByLabelText(/Your answer/), '  Yes, with Lee.  ');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(mockRespond).toHaveBeenCalledWith('req-1', 'Yes, with Lee.');
    expect(await screen.findByText('Yes, with Lee.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Your answer/)).not.toBeInTheDocument();
    expect(screen.getByText('Is there a shift trade on file?')).toBeInTheDocument();
  });

  it('refuses a blank answer without calling the server', async () => {
    mockListMine.mockResolvedValue([request()]);
    const user = userEvent.setup();
    renderWithRouter(<MyAttendanceWaiverRequests wrap={wrap} />);
    await user.click(await screen.findByRole('button', { name: 'Send answer' }));
    expect(await screen.findByText('Write your answer.')).toBeInTheDocument();
    expect(mockRespond).not.toHaveBeenCalled();
  });

  it('shows the refusal and reloads when the request moved on', async () => {
    mockListMine.mockResolvedValue([request()]);
    mockRespond.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { detail: 'This request has already been approved.' } },
    });
    const user = userEvent.setup();
    renderWithRouter(<MyAttendanceWaiverRequests wrap={wrap} />);
    await user.type(await screen.findByLabelText(/Your answer/), 'B shift');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(await screen.findByText('This request has already been approved.')).toBeInTheDocument();
    expect(mockListMine).toHaveBeenCalledTimes(2);
  });

  it('offers no form, and keeps the section closed, with no open question', async () => {
    mockListMine.mockResolvedValue([
      request({ info_requested_at: null, can_respond: false, actions: [entry({}), firstQuestion, firstAnswer] }),
    ]);
    renderWithRouter(<MyAttendanceWaiverRequests wrap={wrap} />);
    expect(await screen.findByText('B shift.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Your answer/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('My Waiver Requests')).toHaveAttribute('data-needs-answer', 'false');
  });
});
