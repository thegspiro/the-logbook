import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import type { AttendanceWaiverRequest } from '../../types/attendanceWaiver';

const { meeting, training } = vi.hoisted(() => ({
  meeting: { list: vi.fn(), get: vi.fn() },
  training: { list: vi.fn(), get: vi.fn() },
}));
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: training,
  meetingWaiverService: meeting,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AttendanceWaiverQueuePage from './AttendanceWaiverQueuePage';
import AttendanceWaiverDecisionPage from './AttendanceWaiverDecisionPage';
import { MEETING_WAIVER_WORKFLOW } from '../../utils/attendanceWaiverWorkflows';

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
  reason: 'Out of town',
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
  attachments: [
    { id: 'a1', ordinal: 1, filename: 'x.pdf', mime_type: 'application/pdf', file_size: 1, uploaded_at: '' },
  ],
  actions: [],
  ...over,
});

const at = (url: string, element: React.ReactNode, path: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ConfirmProvider>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('the waiver queue on the meeting workflow', () => {
  beforeEach(() => {
    meeting.list.mockReset();
    training.list.mockReset();
    meeting.list.mockResolvedValue({ items: [request()], total: 1, skip: 0, limit: 50 });
  });

  it('lists the meeting API’s requests and links each to its meeting decision page', async () => {
    at(
      '/meetings/waiver-requests',
      <AttendanceWaiverQueuePage workflow={MEETING_WAIVER_WORKFLOW} />,
      '/meetings/waiver-requests'
    );
    const row = await screen.findByRole('link', { name: /Pat Doe/ });
    expect(row).toHaveAttribute('href', '/meetings/waiver-requests/req-1');
    expect(screen.getByText('Members asking to be excused from a business meeting')).toBeInTheDocument();
    expect(training.list).not.toHaveBeenCalled();
  });
});

describe('the decision page on the meeting workflow', () => {
  beforeEach(() => {
    meeting.get.mockReset();
    training.get.mockReset();
    meeting.get.mockResolvedValue(request());
  });

  it('loads through the meeting API, labels the meeting and leads back to the meeting queue', async () => {
    at(
      '/meetings/waiver-requests/req-1',
      <AttendanceWaiverDecisionPage workflow={MEETING_WAIVER_WORKFLOW} />,
      '/meetings/waiver-requests/:id'
    );
    expect(await screen.findByText('Pat Doe asks to be excused')).toBeInTheDocument();
    expect(meeting.get).toHaveBeenCalledWith('req-1');
    expect(training.get).not.toHaveBeenCalled();
    expect(screen.getByText('Meeting')).toBeInTheDocument();
  });

  it('sends a viewer who may not see the request back to the meeting queue', async () => {
    meeting.get.mockRejectedValue(Object.assign(new Error('Not found'), { response: { status: 404 } }));
    at(
      '/meetings/waiver-requests/req-1',
      <AttendanceWaiverDecisionPage workflow={MEETING_WAIVER_WORKFLOW} />,
      '/meetings/waiver-requests/:id'
    );
    expect(await screen.findByRole('link', { name: 'All waiver requests' })).toHaveAttribute(
      'href',
      '/meetings/waiver-requests'
    );
  });

  it('shows no document list for a meeting request', async () => {
    at(
      '/meetings/waiver-requests/req-1',
      <AttendanceWaiverDecisionPage workflow={MEETING_WAIVER_WORKFLOW} />,
      '/meetings/waiver-requests/:id'
    );
    await screen.findByText('Pat Doe asks to be excused');
    expect(screen.queryByText(/x\.pdf|waiver-attachment/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Documents/i })).not.toBeInTheDocument();
  });
});
