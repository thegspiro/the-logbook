import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import type { AttendanceWaiverActionEntry, AttendanceWaiverRequest } from '../../types/attendanceWaiver';

const mockGet = vi.fn();
const mockRequestInfo = vi.fn();
const mockRespond = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    requestInfo: (...args: unknown[]) => mockRequestInfo(...args) as unknown,
    respond: (...args: unknown[]) => mockRespond(...args) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AttendanceWaiverDecisionPage from './AttendanceWaiverDecisionPage';

const entry = (over: Partial<AttendanceWaiverActionEntry>): AttendanceWaiverActionEntry => ({
  id: 'a1',
  action: 'submitted',
  actor_id: 'user-1',
  actor_name: 'Pat Doe',
  note: null,
  created_at: '2026-11-11T15:00:00Z',
  ...over,
});

const asked = entry({
  id: 'a2',
  action: 'info_requested',
  actor_id: 'off-1',
  actor_name: 'Lt. Smith',
  note: 'Which shift were you covering?',
  created_at: '2026-11-12T15:00:00Z',
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
  info_requested_at: null,
  reconfirm_requested_at: null,
  can_withdraw: false,
  can_respond: false,
  can_confirm: false,
  can_request_info: true,
  can_decide: true,
  can_override: false,
  actions: [entry({})],
  ...over,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/attendance-waivers/req-1']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/attendance-waivers/:id" element={<AttendanceWaiverDecisionPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('AttendanceWaiverDecisionPage — asking for more information', () => {
  beforeEach(() => {
    for (const mock of [mockGet, mockRequestInfo, mockRespond]) mock.mockReset();
    mockGet.mockResolvedValue(request());
  });

  it('asks the member a question and then shows it waiting', async () => {
    mockRequestInfo.mockResolvedValue(
      request({
        info_requested_at: '2026-11-12T15:00:00Z',
        can_request_info: false,
        actions: [entry({}), asked],
      })
    );
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText(/Your question/), '  Which shift were you covering?  ');
    await user.click(screen.getByRole('button', { name: 'Ask the member' }));

    expect(mockRequestInfo).toHaveBeenCalledWith('req-1', 'Which shift were you covering?');
    expect(await screen.findByText(/Waiting on Pat Doe's answer/)).toBeInTheDocument();
    expect(screen.getByText(/You can still decide without it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask the member' })).not.toBeInTheDocument();
    const conversation = screen.getByRole('region', { name: 'Questions and answers' });
    expect(within(conversation).getByText('Which shift were you covering?')).toBeInTheDocument();
    // The decision form stays: a decider need not wait for the answer.
    expect(screen.getByRole('button', { name: 'Record decision' })).toBeInTheDocument();
  });

  it('refuses a blank question without calling the server', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Ask the member' }));
    expect(await screen.findAllByText('Write the question to ask the member.')).not.toHaveLength(0);
    expect(mockRequestInfo).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal and reloads', async () => {
    mockRequestInfo.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { detail: "A question is already waiting on the member's answer." } },
    });
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText(/Your question/), 'Anything else?');
    await user.click(screen.getByRole('button', { name: 'Ask the member' }));
    expect(await screen.findAllByText(/already waiting on the member/)).not.toHaveLength(0);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('offers no question form when the server does not allow one', async () => {
    mockGet.mockResolvedValue(request({ can_request_info: false }));
    renderPage();
    await screen.findByRole('button', { name: 'Record decision' });
    expect(screen.queryByRole('button', { name: 'Ask the member' })).not.toBeInTheDocument();
  });

  it('keeps every earlier round readable', async () => {
    mockGet.mockResolvedValue(
      request({
        actions: [
          entry({}),
          asked,
          entry({
            id: 'a3',
            action: 'member_responded',
            note: 'B shift, for Engine 2.',
            created_at: '2026-11-12T16:00:00Z',
          }),
        ],
      })
    );
    renderPage();
    const conversation = await screen.findByRole('region', { name: 'Questions and answers' });
    const rounds = within(conversation).getAllByRole('listitem');
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toHaveTextContent('Question from Lt. Smith');
    expect(rounds[1]).toHaveTextContent('Answer from Pat Doe');
    expect(rounds[1]).toHaveTextContent('B shift, for Engine 2.');
  });

  it('lets the member answer from the page', async () => {
    mockGet.mockResolvedValue(
      request({
        info_requested_at: '2026-11-12T15:00:00Z',
        can_request_info: false,
        can_decide: false,
        can_respond: true,
        can_withdraw: true,
        actions: [entry({}), asked],
      })
    );
    mockRespond.mockResolvedValue(request({ can_request_info: false, can_decide: false }));
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText(/Your answer/), 'B shift');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(mockRespond).toHaveBeenCalledWith('req-1', 'B shift');
    // The member sees the answer form, not the "waiting" notice meant for deciders.
    expect(screen.queryByText(/Waiting on Pat Doe's answer/)).not.toBeInTheDocument();
  });
});
