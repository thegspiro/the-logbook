/**
 * Deleting a submission is permanent, so the viewer asks first and reports
 * the server's reason when the delete is refused.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { FormSubmission } from '../../services/api';

const mockGetForm = vi.fn();
const mockGetSubmissions = vi.fn();
const mockDeleteSubmission = vi.fn();

vi.mock('../../services/api', () => ({
  formsService: {
    getForm: (...args: unknown[]) => mockGetForm(...args) as unknown,
    getSubmissions: (...args: unknown[]) => mockGetSubmissions(...args) as unknown,
    deleteSubmission: (...args: unknown[]) => mockDeleteSubmission(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import SubmissionViewer from './SubmissionViewer';

const submission: FormSubmission = {
  id: 'sub-1',
  organization_id: 'org-1',
  form_id: 'form-1',
  submitted_at: '2026-09-01T12:00:00Z',
  data: {},
  submitter_name: 'Pat Rivera',
  is_public_submission: false,
  integration_processed: false,
  created_at: '2026-09-01T12:00:00Z',
};

const openDeleteDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Submission by Pat Rivera' }));
  await user.click(screen.getByRole('button', { name: 'Delete submission by Pat Rivera' }));
  return screen.findByRole('dialog', { name: 'Delete this submission?' });
};

describe('SubmissionViewer delete', () => {
  beforeEach(() => {
    mockGetForm.mockReset();
    mockGetSubmissions.mockReset();
    mockDeleteSubmission.mockReset();
    mockGetForm.mockResolvedValue({ fields: [] });
    mockGetSubmissions.mockResolvedValue({ submissions: [submission], total: 1, skip: 0, limit: 20 });
    mockDeleteSubmission.mockResolvedValue(undefined);
  });

  it('asks first, and Keep it deletes nothing', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SubmissionViewer formId="form-1" allowDelete />);

    const dialog = await openDeleteDialog(user);
    expect(dialog).toHaveTextContent('The submission from Pat Rivera is deleted permanently');
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockDeleteSubmission).not.toHaveBeenCalled();
  });

  it('deletes once confirmed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SubmissionViewer formId="form-1" allowDelete />);

    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Delete submission' }));

    await waitFor(() => expect(mockDeleteSubmission).toHaveBeenCalledWith('form-1', 'sub-1'));
  });

  it("shows the server's reason when the delete is refused", async () => {
    mockDeleteSubmission.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 409',
      response: { status: 409, data: { detail: 'This submission has already been processed' } },
    });
    const user = userEvent.setup();
    renderWithRouter(<SubmissionViewer formId="form-1" allowDelete />);

    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Delete submission' }));

    expect(await screen.findByText('This submission has already been processed')).toBeInTheDocument();
  });
});
