import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import type { AttendanceWaiverRequest } from '../../types/attendanceWaiver';

const mockGet = vi.fn();
const mockConfirm = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    confirm: (...args: unknown[]) => mockConfirm(...args) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AttendanceWaiverDecisionPage from './AttendanceWaiverDecisionPage';

/** A request whose session moved to 27 November, as a decider sees it while it waits. */
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
  reason: 'Flu',
  submitted_at: '2026-11-11T15:00:00Z',
  decided_at: null,
  decided_by: null,
  decided_by_name: null,
  chief_override: false,
  info_requested_at: null,
  reconfirm_requested_at: '2026-11-13T12:00:00Z',
  can_withdraw: false,
  can_respond: false,
  can_confirm: false,
  can_request_info: false,
  can_decide: false,
  can_override: false,
  actions: [
    {
      id: 'a1',
      action: 'rescheduled',
      actor_id: null,
      actor_name: null,
      note: 'The training session moved from November 20, 2026 at 6:00 PM to November 27, 2026 at 6:00 PM.',
      created_at: '2026-11-13T12:00:00Z',
    },
  ],
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

describe('AttendanceWaiverDecisionPage — a moved session', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockConfirm.mockReset();
    mockGet.mockResolvedValue(moved());
  });

  it('tells a decider it waits on the member, with the decision disabled', async () => {
    renderPage();
    expect(await screen.findByText('Waiting for Pat Doe to confirm the new date')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record decision' })).toBeDisabled();
    expect(screen.queryByRole('radio', { name: 'Approve' })).not.toBeInTheDocument();
    // The move is in the history, in the backend's words.
    expect(screen.getByText('Session rescheduled')).toBeInTheDocument();
    expect(screen.getByText(/moved from November 20, 2026/)).toBeInTheDocument();
  });

  it('lets the member confirm from the request page', async () => {
    mockGet.mockResolvedValue(moved({ can_confirm: true, can_withdraw: true }));
    mockConfirm.mockResolvedValue(moved({ reconfirm_requested_at: null, can_withdraw: true }));
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText(/Do you still need to be excused\?/)).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for Pat Doe/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(mockConfirm).toHaveBeenCalledWith('req-1');
    await vi.waitFor(() => expect(screen.queryByText(/Do you still need/)).not.toBeInTheDocument());
  });

  it('shows neither once the member has confirmed', async () => {
    mockGet.mockResolvedValue(moved({ reconfirm_requested_at: null, can_decide: true }));
    renderPage();
    expect(await screen.findByRole('radio', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for Pat Doe/)).not.toBeInTheDocument();
  });
});
