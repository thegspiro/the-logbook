/**
 * The approval page is the officer's half of a Training event whose credit
 * needs confirming. What these cases pin is the payload: an untouched row must
 * return its snapshot override (so approving without edits credits exactly what
 * finalize measured), an edited row sends the officer's figure, 0 is a real
 * value meaning "no credit", and a negative figure never leaves the browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import type { TrainingApprovalData } from '../../services/api';

const mockGetApprovalData = vi.fn();
const mockSubmitApproval = vi.fn();

vi.mock('../../services/api', () => ({
  trainingSessionService: {
    getApprovalData: (...args: unknown[]) => mockGetApprovalData(...args) as unknown,
    submitApproval: (...args: unknown[]) => mockSubmitApproval(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

// Import after the mocks are in place.
import TrainingApprovalPage from './TrainingApprovalPage';

const approval: TrainingApprovalData = {
  id: 'appr-1',
  training_session_id: 'sess-1',
  event_id: 'evt-1',
  status: 'pending',
  approval_deadline: '2026-10-05T23:00:00Z',
  event_title: 'Hose Advancement Drill',
  event_start_datetime: '2026-09-28T22:00:00Z',
  event_end_datetime: '2026-09-29T01:00:00Z',
  course_name: 'Fire Attack Basics',
  credit_hours: 3,
  attendees: [
    {
      user_id: 'u-1',
      user_name: 'Alex Rivera',
      user_email: 'alex@example.org',
      checked_in_at: '2026-09-28T22:00:00Z',
      checked_out_at: '2026-09-29T00:30:00Z',
      calculated_duration_minutes: 150,
      override_check_in_at: null,
      override_check_out_at: null,
      override_duration_minutes: null,
      approved: false,
      notes: null,
    },
    {
      user_id: 'u-2',
      user_name: 'Sam Chen',
      user_email: 'sam@example.org',
      checked_in_at: '2026-09-28T22:10:00Z',
      checked_out_at: '2026-09-29T01:00:00Z',
      calculated_duration_minutes: 170,
      override_check_in_at: null,
      override_check_out_at: null,
      override_duration_minutes: null,
      approved: false,
      notes: null,
    },
  ],
  approved_by: null,
  approved_at: null,
  approval_notes: null,
  created_at: '2026-09-29T01:05:00Z',
};

/** The fixture with an Edit Times override on Alex's row. */
const withAlexOverride = (minutes: number): TrainingApprovalData => ({
  ...structuredClone(approval),
  attendees: approval.attendees.map((a) =>
    a.user_id === 'u-1' ? { ...a, override_duration_minutes: minutes } : { ...a }
  ),
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/training/approve/tok-1']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/training/approve/:token" element={<TrainingApprovalPage />} />
          <Route path="/events/:id" element={<p>Event page</p>} />
          <Route path="/training/admin" element={<p>Training dashboard</p>} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

const httpError = (status: number, detail: string) => ({ response: { status, data: { detail } } });

/** The submitted attendee rows, by user id. */
const submittedAttendees = () => {
  const [, payload] = mockSubmitApproval.mock.calls[0] as [
    string,
    { attendees: Array<{ user_id: string; override_duration_minutes: number | null; approved: boolean }> },
  ];
  return Object.fromEntries(payload.attendees.map((a) => [a.user_id, a]));
};

const approveAndConfirm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Approve and record' }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Approve and record' }));
};

describe('TrainingApprovalPage', () => {
  beforeEach(() => {
    mockGetApprovalData.mockReset();
    mockSubmitApproval.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockGetApprovalData.mockResolvedValue(structuredClone(approval));
    mockSubmitApproval.mockResolvedValue({ message: 'Training approval submitted successfully', status: 'approved' });
  });

  it('renders the roster with the credited minutes prefilled', async () => {
    renderPage();

    expect(await screen.findByRole('link', { name: 'Hose Advancement Drill' })).toHaveAttribute(
      'href',
      '/events/evt-1'
    );
    expect(mockGetApprovalData).toHaveBeenCalledWith('tok-1');
    expect(screen.getByText('Fire Attack Basics')).toBeInTheDocument();
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByText('Sam Chen')).toBeInTheDocument();
    // 22:00Z is 6:00 PM in New York, on the event's own local day.
    expect(screen.getAllByText('6:00 PM').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Approved minutes for Alex Rivera')).toHaveValue(150);
    expect(screen.getByLabelText('Approved minutes for Sam Chen')).toHaveValue(170);
  });

  it('prefills an existing Edit Times override over the credited minutes', async () => {
    mockGetApprovalData.mockResolvedValue(withAlexOverride(120));

    renderPage();

    expect(await screen.findByLabelText('Approved minutes for Alex Rivera')).toHaveValue(120);
  });

  it('sends an untouched row back with its snapshot override and an edited row with the new value', async () => {
    const user = userEvent.setup();
    renderPage();

    const samMinutes = await screen.findByLabelText('Approved minutes for Sam Chen');
    await user.clear(samMinutes);
    await user.type(samMinutes, '90');
    await user.type(screen.getByLabelText('Note for Sam Chen'), 'Left for a call');
    await user.type(screen.getByLabelText('Approval notes (optional)'), '  Good drill  ');

    await approveAndConfirm(user);

    await waitFor(() => expect(mockSubmitApproval).toHaveBeenCalledTimes(1));
    expect(mockSubmitApproval).toHaveBeenCalledWith('tok-1', expect.objectContaining({ approval_notes: 'Good drill' }));
    const rows = submittedAttendees();
    expect(rows['u-1']).toMatchObject({ approved: true, override_duration_minutes: null, notes: null });
    expect(rows['u-2']).toMatchObject({ approved: true, override_duration_minutes: 90, notes: 'Left for a call' });
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Event page')).toBeInTheDocument();
  });

  it('keeps an untouched Edit Times override as the approved figure', async () => {
    mockGetApprovalData.mockResolvedValue(withAlexOverride(120));
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText('Approved minutes for Alex Rivera');
    await approveAndConfirm(user);

    await waitFor(() => expect(mockSubmitApproval).toHaveBeenCalledTimes(1));
    expect(submittedAttendees()['u-1']).toMatchObject({ override_duration_minutes: 120 });
  });

  it('allows 0 approved minutes, meaning no credit', async () => {
    const user = userEvent.setup();
    renderPage();

    const alexMinutes = await screen.findByLabelText('Approved minutes for Alex Rivera');
    await user.clear(alexMinutes);
    await user.type(alexMinutes, '0');

    expect(screen.queryByText(/Enter whole minutes/)).not.toBeInTheDocument();
    await approveAndConfirm(user);

    await waitFor(() => expect(mockSubmitApproval).toHaveBeenCalledTimes(1));
    expect(submittedAttendees()['u-1']).toMatchObject({ override_duration_minutes: 0 });
    // The zeroed member is not counted as credited.
    expect(mockToastSuccess).toHaveBeenCalledWith('Approval recorded: 1 member credited, 1 given no credit');
  });

  it('treats a row edited back to its prefill as untouched', async () => {
    const user = userEvent.setup();
    renderPage();

    const alexMinutes = await screen.findByLabelText('Approved minutes for Alex Rivera');
    await user.clear(alexMinutes);
    await user.type(alexMinutes, '90');
    await user.clear(alexMinutes);
    await user.type(alexMinutes, '150');
    await approveAndConfirm(user);

    await waitFor(() => expect(mockSubmitApproval).toHaveBeenCalledTimes(1));
    expect(submittedAttendees()['u-1']).toMatchObject({ override_duration_minutes: null });
    expect(mockToastSuccess).toHaveBeenCalledWith('Training credit recorded for 2 members');
  });

  it('refuses a negative figure inline and blocks submission', async () => {
    const user = userEvent.setup();
    renderPage();

    const alexMinutes = await screen.findByLabelText('Approved minutes for Alex Rivera');
    await user.clear(alexMinutes);
    await user.type(alexMinutes, '-5');

    expect(screen.getByText('Enter whole minutes, 0 or more.')).toBeInTheDocument();
    expect(alexMinutes).toHaveAttribute('aria-invalid', 'true');
    const approve = screen.getByRole('button', { name: 'Approve and record' });
    expect(approve).toBeDisabled();
    await user.click(approve);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockSubmitApproval).not.toHaveBeenCalled();
  });

  it('refuses a cleared figure rather than guessing what it means', async () => {
    const user = userEvent.setup();
    renderPage();

    const alexMinutes = await screen.findByLabelText('Approved minutes for Alex Rivera');
    await user.clear(alexMinutes);

    expect(screen.getByText('Enter the approved minutes. 0 gives no credit.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and record' })).toBeDisabled();
  });

  it('records nothing until the confirmation is accepted', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText('Approved minutes for Alex Rivera');
    await user.click(screen.getByRole('button', { name: 'Approve and record' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText("Records 2 members' training credit. Approved minutes of 0 give that member no credit.")
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Keep reviewing' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockSubmitApproval).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Approved minutes for Alex Rivera')).toBeInTheDocument();
  });

  it('shows the failure and keeps the edits when recording fails', async () => {
    mockSubmitApproval.mockRejectedValue(httpError(500, 'An unexpected error occurred'));
    const user = userEvent.setup();
    renderPage();

    const alexMinutes = await screen.findByLabelText('Approved minutes for Alex Rivera');
    await user.clear(alexMinutes);
    await user.type(alexMinutes, '90');
    await approveAndConfirm(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('An unexpected error occurred');
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Event page')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Approved minutes for Alex Rivera')).toHaveValue(90);
    expect(screen.getByRole('button', { name: 'Approve and record' })).toBeEnabled();
  });

  it('shows how to get a new link when a reopen expired it while the page was open', async () => {
    mockSubmitApproval.mockRejectedValue(httpError(400, 'This approval link has expired'));
    mockGetApprovalData
      .mockResolvedValueOnce(structuredClone(approval))
      .mockRejectedValueOnce(httpError(400, 'This approval link has expired'));
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText('Approved minutes for Alex Rivera');
    await approveAndConfirm(user);

    expect(
      await screen.findByText("Reopening the event's attendance and finalizing it again issues a new link.")
    ).toBeInTheDocument();
    expect(mockToastError).toHaveBeenCalledWith('This approval link has expired');
    expect(screen.queryByRole('button', { name: 'Approve and record' })).not.toBeInTheDocument();
  });

  it('shows the approval read-only when another officer processed it while the page was open', async () => {
    const processed = structuredClone(approval);
    processed.status = 'approved';
    processed.approved_at = '2026-09-30T14:00:00Z';
    mockSubmitApproval.mockRejectedValue(httpError(400, 'This training session has already been processed'));
    mockGetApprovalData.mockResolvedValueOnce(structuredClone(approval)).mockResolvedValueOnce(processed);
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText('Approved minutes for Alex Rivera');
    await approveAndConfirm(user);

    expect(await screen.findByText('Already approved')).toBeInTheDocument();
    expect(mockToastError).toHaveBeenCalledWith('This training session has already been processed');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and record' })).not.toBeInTheDocument();
  });

  it('shows a processed approval read-only', async () => {
    const processed = withAlexOverride(0);
    processed.status = 'approved';
    processed.approved_at = '2026-09-30T14:00:00Z';
    processed.approval_notes = 'Checked against the sign-in sheet';
    mockGetApprovalData.mockResolvedValue(processed);

    renderPage();

    expect(await screen.findByText('Already approved')).toBeInTheDocument();
    expect(screen.getByText(/^Processed /)).toBeInTheDocument();
    expect(screen.getByText('Checked against the sign-in sheet')).toBeInTheDocument();
    // An approved 0 reads as 0, not as the credited minutes it replaced.
    const alexRow = screen.getByRole('row', { name: /Alex Rivera/ });
    expect(within(alexRow).getByText('0')).toBeInTheDocument();
    expect(within(alexRow).getByText('150')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and record' })).not.toBeInTheDocument();
  });

  it('explains how to get a new link when this one has expired', async () => {
    mockGetApprovalData.mockRejectedValue(httpError(400, 'This approval link has expired'));

    renderPage();

    expect(await screen.findByText('This approval link has expired')).toBeInTheDocument();
    expect(screen.getByText(/finalized again since this link was sent, use the newer link/)).toBeInTheDocument();
    expect(
      screen.getByText("Reopening the event's attendance and finalizing it again issues a new link.")
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the training dashboard' })).toHaveAttribute(
      'href',
      '/training/admin'
    );
    expect(screen.queryByRole('button', { name: 'Approve and record' })).not.toBeInTheDocument();
  });

  it('shows an invalid link without the reopen hint', async () => {
    mockGetApprovalData.mockRejectedValue(httpError(400, 'Invalid approval link'));

    renderPage();

    expect(await screen.findByText('Invalid approval link')).toBeInTheDocument();
    expect(screen.queryByText(/Reopening the event's attendance/)).not.toBeInTheDocument();
    expect(screen.queryByText(/use the newer link/)).not.toBeInTheDocument();
  });

  it('says so when the viewer may not approve', async () => {
    mockGetApprovalData.mockRejectedValue(httpError(403, 'Forbidden'));

    renderPage();

    expect(await screen.findByText(/You are not authorized to approve training credit/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and record' })).not.toBeInTheDocument();
  });
});
