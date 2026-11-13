import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import type { AttendanceWaiverRequest } from '../../types/attendanceWaiver';

const mockGet = vi.fn();
const mockApprove = vi.fn();
const mockDeny = vi.fn();
const mockOverride = vi.fn();
const mockWithdraw = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    approve: (...args: unknown[]) => mockApprove(...args) as unknown,
    deny: (...args: unknown[]) => mockDeny(...args) as unknown,
    override: (...args: unknown[]) => mockOverride(...args) as unknown,
    withdraw: (...args: unknown[]) => mockWithdraw(...args) as unknown,
  },
}));

const mockDownload = vi.fn();
vi.mock('../../services/waiverAttachmentService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/waiverAttachmentService')>();
  return {
    ...actual,
    waiverAttachmentService: {
      downloadAttachment: (...args: unknown[]) => mockDownload(...args) as unknown,
      addAttachments: vi.fn(),
    },
  };
});

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AttendanceWaiverDecisionPage from './AttendanceWaiverDecisionPage';

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
  category: 'Illness',
  reason: 'Flu',
  submitted_at: '2026-11-11T15:00:00Z',
  decided_at: null,
  decided_by: null,
  decided_by_name: null,
  chief_override: false,
  info_requested_at: null,
  reconfirm_requested_at: null,
  can_respond: false,
  can_confirm: false,
  can_request_info: false,
  can_withdraw: false,
  can_decide: true,
  can_override: false,
  actions: [
    {
      id: 'a1',
      action: 'submitted',
      actor_id: 'user-1',
      actor_name: 'Pat Doe',
      note: null,
      created_at: '2026-11-11T15:00:00Z',
    },
  ],
  ...over,
});

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ConfirmProvider>
        <Routes>
          <Route path="/attendance-waivers/:id" element={<AttendanceWaiverDecisionPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('AttendanceWaiverDecisionPage', () => {
  beforeEach(() => {
    for (const mock of [mockGet, mockApprove, mockDeny, mockOverride, mockWithdraw]) mock.mockReset();
    mockGet.mockResolvedValue(request());
  });

  it('lists the filed documents under their neutral names, for download', async () => {
    const document = {
      id: 'att-1',
      ordinal: 1,
      filename: 'waiver-attachment-1.pdf',
      mime_type: 'application/pdf',
      file_size: 2048,
      uploaded_at: '2026-11-11T15:00:00Z',
    };
    mockGet.mockResolvedValue(request({ attachments: [document] }));
    const user = userEvent.setup();
    renderAt('/attendance-waivers/req-1');
    await user.click(await screen.findByRole('button', { name: 'Download waiver-attachment-1.pdf' }));
    expect(mockDownload).toHaveBeenCalledWith('req-1', document);
  });

  it('shows no documents section when none are filed and none can be', async () => {
    mockGet.mockResolvedValue(request({ attachments: [], can_attach: false }));
    renderAt('/attendance-waivers/req-1');
    expect(await screen.findByText('Pat Doe asks to be excused')).toBeInTheDocument();
    expect(screen.queryByText('Supporting documents')).not.toBeInTheDocument();
  });

  it('pre-selects the emailed choice and decides nothing on load', async () => {
    renderAt('/attendance-waivers/req-1?action=deny');
    expect(await screen.findByRole('radio', { name: 'Deny' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Approve' })).not.toBeChecked();
    expect(mockGet).toHaveBeenCalledWith('req-1');
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockDeny).not.toHaveBeenCalled();
  });

  it('ignores an unknown action in the link', async () => {
    renderAt('/attendance-waivers/req-1?action=approve-all');
    expect(await screen.findByRole('radio', { name: 'Approve' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Deny' })).not.toBeChecked();
  });

  it('shows the reason and category the server returned', async () => {
    renderAt('/attendance-waivers/req-1');
    expect(await screen.findByText('Flu')).toBeInTheDocument();
    expect(screen.getByText('Illness')).toBeInTheDocument();
  });

  it('shows no reason when the server withheld it', async () => {
    mockGet.mockResolvedValue(request({ reason: null, category: null }));
    renderAt('/attendance-waivers/req-1');
    await screen.findByText(/Pat Doe asks to be excused/);
    expect(screen.queryByText('Reason')).not.toBeInTheDocument();
  });

  it('refuses a denial with no note', async () => {
    const user = userEvent.setup();
    renderAt('/attendance-waivers/req-1?action=deny');
    await user.click(await screen.findByRole('button', { name: 'Record decision' }));
    expect(screen.getByText('Tell the member why the request is denied.', { selector: 'p' })).toBeInTheDocument();
    expect(mockDeny).not.toHaveBeenCalled();
  });

  it('denies with the note after one confirmation', async () => {
    mockDeny.mockResolvedValue(request({ status: 'denied', can_decide: false }));
    const user = userEvent.setup();
    renderAt('/attendance-waivers/req-1?action=deny');
    await user.type(await screen.findByLabelText(/Note to the member/), ' Mandatory drill ');
    await user.click(screen.getByRole('button', { name: 'Record decision' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Deny this request?' });
    expect(mockDeny).not.toHaveBeenCalled();
    await user.click(within(confirmDialog).getByRole('button', { name: 'Deny' }));
    expect(mockDeny).toHaveBeenCalledWith('req-1', 'Mandatory drill');
    expect(await screen.findByText('Denied')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record decision' })).not.toBeInTheDocument();
  });

  it('approves without a note, and not at all when the approver goes back', async () => {
    mockApprove.mockResolvedValue(request({ status: 'approved', can_decide: false }));
    const user = userEvent.setup();
    renderAt('/attendance-waivers/req-1?action=approve');
    await user.click(await screen.findByRole('button', { name: 'Record decision' }));
    await user.click(await screen.findByRole('button', { name: 'Go back' }));
    expect(mockApprove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Record decision' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Approve this request?' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Approve' }));
    expect(mockApprove).toHaveBeenCalledWith('req-1', undefined);
  });

  it('asks for a choice when the link carried none', async () => {
    const user = userEvent.setup();
    renderAt('/attendance-waivers/req-1');
    await user.click(await screen.findByRole('button', { name: 'Record decision' }));
    expect(screen.getByText('Choose approve or deny.', { selector: 'p' })).toBeInTheDocument();
  });

  it('shows the server’s refusal when someone else decided first', async () => {
    mockApprove.mockRejectedValue({
      response: { status: 400, data: { detail: 'This request was already decided.' } },
      isAxiosError: true,
    });
    const user = userEvent.setup();
    renderAt('/attendance-waivers/req-1?action=approve');
    await user.click(await screen.findByRole('button', { name: 'Record decision' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Approve this request?' })).getByRole('button', {
        name: 'Approve',
      })
    );
    expect(await screen.findByText('This request was already decided.')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('offers no decision form to a viewer who may not decide', async () => {
    mockGet.mockResolvedValue(request({ can_decide: false, status: 'approved' }));
    renderAt('/attendance-waivers/req-1?action=approve');
    await screen.findByText(/Pat Doe asks to be excused/);
    expect(screen.queryByRole('button', { name: 'Record decision' })).not.toBeInTheDocument();
  });

  it('offers the Chief override only when the server allows it, and requires a reason', async () => {
    mockGet.mockResolvedValue(request({ status: 'denied', can_decide: false, can_override: true }));
    mockOverride.mockResolvedValue(request({ status: 'approved', chief_override: true, can_decide: false }));
    const user = userEvent.setup();
    renderAt('/attendance-waivers/req-1');
    await user.click(await screen.findByRole('button', { name: 'Approve on override' }));
    expect(screen.getByText('Give a reason for the override.', { selector: 'p' })).toBeInTheDocument();
    expect(mockOverride).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Reason for the override/), 'Documented emergency');
    await user.click(screen.getByRole('button', { name: 'Approve on override' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Override the denial?' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Approve on override' }));
    expect(mockOverride).toHaveBeenCalledWith('req-1', 'Documented emergency');
  });

  it('hides the override from a viewer the server does not allow', async () => {
    mockGet.mockResolvedValue(request({ status: 'denied', can_decide: false, can_override: false }));
    renderAt('/attendance-waivers/req-1');
    await screen.findByText(/Pat Doe asks to be excused/);
    expect(screen.queryByRole('button', { name: 'Approve on override' })).not.toBeInTheDocument();
  });

  it('says a request it may not see was not found', async () => {
    mockGet.mockRejectedValue({ response: { status: 404, data: { detail: 'Request not found' } }, isAxiosError: true });
    renderAt('/attendance-waivers/req-9');
    expect(await screen.findByText('This request was not found, or it is not one you can see.')).toBeInTheDocument();
  });
});
