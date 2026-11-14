/**
 * The request dialog's document field: shown only when the policy takes
 * documents, required when the policy says so, and sent with the request in
 * one call so a required document can never be left behind.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { AttendanceWaiverEligibility } from '../../types/attendanceWaiver';

const mockSubmit = vi.fn();
const mockSubmitWithAttachments = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: {
    submit: (...args: unknown[]) => mockSubmit(...args) as unknown,
    submitWithAttachments: (...args: unknown[]) => mockSubmitWithAttachments(...args) as unknown,
  },
}));

import AttendanceWaiverRequestDialog from './AttendanceWaiverRequestDialog';

const eligibility = (over: Partial<AttendanceWaiverEligibility> = {}): AttendanceWaiverEligibility => ({
  event_id: 'evt-1',
  allowed: true,
  refusal_code: null,
  refusal: null,
  deadline: null,
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

const note = () => new File(['%PDF-1.4'], 'note.pdf', { type: 'application/pdf' });
const drop = (...files: File[]) =>
  fireEvent.drop(screen.getByRole('button', { name: /drop a document here/i }), { dataTransfer: { files } });
const send = () => screen.getByRole('button', { name: 'Send request' });

describe('AttendanceWaiverRequestDialog documents', () => {
  const onSubmitted = vi.fn();

  beforeEach(() => {
    mockSubmit.mockReset();
    mockSubmitWithAttachments.mockReset();
    onSubmitted.mockReset();
    mockSubmit.mockResolvedValue({ id: 'req-1' });
    mockSubmitWithAttachments.mockResolvedValue({ id: 'req-2' });
  });

  const open = (over: Partial<AttendanceWaiverEligibility> = {}) =>
    renderWithRouter(
      <AttendanceWaiverRequestDialog
        eventTitle="Ladder Drill"
        eligibility={eligibility(over)}
        timezone="UTC"
        onClose={vi.fn()}
        onSubmitted={onSubmitted}
      />
    );

  it('offers no document field when the policy takes none, and sends JSON', async () => {
    const user = userEvent.setup();
    open();
    expect(screen.queryByText('Supporting document')).not.toBeInTheDocument();
    await user.click(send());
    expect(mockSubmit).toHaveBeenCalledWith({ event_id: 'evt-1', category: undefined, reason: undefined });
    expect(mockSubmitWithAttachments).not.toHaveBeenCalled();
  });

  it('refuses to send without a required document', async () => {
    const user = userEvent.setup();
    open({ attachment: 'required' });
    await user.click(send());
    expect(screen.getByRole('alert')).toHaveTextContent('Attach a document to this request.');
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockSubmitWithAttachments).not.toHaveBeenCalled();
  });

  it('sends the request and its document together', async () => {
    const user = userEvent.setup();
    open({ attachment: 'required' });
    const file = note();
    drop(file);
    await user.type(screen.getByLabelText(/Explanation/), 'Back injury');
    await user.click(send());
    expect(mockSubmitWithAttachments).toHaveBeenCalledWith(
      { event_id: 'evt-1', category: undefined, reason: 'Back injury' },
      [file]
    );
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(onSubmitted).toHaveBeenCalledWith({ id: 'req-2' });
  });

  it('sends JSON when an optional document is left out', async () => {
    const user = userEvent.setup();
    open({ attachment: 'optional' });
    expect(screen.getByText(/Supporting document/)).toHaveTextContent('Supporting document (optional)');
    await user.click(send());
    expect(mockSubmit).toHaveBeenCalledWith({ event_id: 'evt-1', category: undefined, reason: undefined });
  });

  it('holds the request while a chosen file would be refused', async () => {
    const user = userEvent.setup();
    open({ attachment: 'optional' });
    drop(new File(['GIF89a'], 'cat.gif', { type: 'image/gif' }));
    await user.click(send());
    expect(screen.getByRole('alert')).toHaveTextContent('cat.gif is not a PDF, JPEG, PNG or HEIC file.');
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockSubmitWithAttachments).not.toHaveBeenCalled();
  });
});
