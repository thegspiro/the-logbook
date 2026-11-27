/**
 * The Submissions tab keeps one viewer mounted and swaps its formId when an
 * officer picks another form. Each form must load its own field labels and
 * start at its own first page, and a slow response for the form just left
 * must not land under the new one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { FormField, FormSubmission } from '../../services/api';

const mockGetForm = vi.fn();
const mockGetSubmissions = vi.fn();

vi.mock('../../services/api', () => ({
  formsService: {
    getForm: (...args: unknown[]) => mockGetForm(...args) as unknown,
    getSubmissions: (...args: unknown[]) => mockGetSubmissions(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import SubmissionViewer from './SubmissionViewer';

const field = (id: string, label: string): FormField => ({
  id,
  form_id: 'x',
  label,
  field_type: 'text',
  required: false,
  sort_order: 0,
  width: 'full',
  created_at: '2026-09-01T12:00:00Z',
  updated_at: '2026-09-01T12:00:00Z',
});

const submission = (id: string, formId: string, data: Record<string, string>, name: string): FormSubmission => ({
  id,
  organization_id: 'org-1',
  form_id: formId,
  submitted_at: '2026-09-01T12:00:00Z',
  data,
  submitter_name: name,
  is_public_submission: false,
  integration_processed: false,
  created_at: '2026-09-01T12:00:00Z',
});

const formA = { fields: [field('a-name', 'Full name')] };
const formB = { fields: [field('b-unit', 'Apparatus unit')] };
const subA = submission('sub-a', 'form-a', { 'a-name': 'Pat' }, 'Pat Rivera');
const subB = submission('sub-b', 'form-b', { 'b-unit': 'E1' }, 'Sam Ortiz');

describe('SubmissionViewer switching forms', () => {
  beforeEach(() => {
    mockGetForm.mockReset();
    mockGetSubmissions.mockReset();
    mockGetForm.mockImplementation((id: string) => Promise.resolve(id === 'form-a' ? formA : formB));
    mockGetSubmissions.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'form-a'
          ? { submissions: [subA], total: 45, skip: 0, limit: 20 }
          : { submissions: [subB], total: 1, skip: 0, limit: 20 }
      )
    );
  });

  it("loads the new form's field labels", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithRouter(<SubmissionViewer formId="form-a" />);
    await screen.findByRole('button', { name: 'Submission by Pat Rivera' });

    rerender(<SubmissionViewer formId="form-b" />);
    await user.click(await screen.findByRole('button', { name: 'Submission by Sam Ortiz' }));

    expect(mockGetForm).toHaveBeenCalledWith('form-b');
    expect(await screen.findByText('Apparatus unit')).toBeInTheDocument();
    expect(screen.queryByText('b-unit')).not.toBeInTheDocument();
  });

  it('starts the new form at its first page', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithRouter(<SubmissionViewer formId="form-a" />);
    await screen.findByRole('button', { name: 'Submission by Pat Rivera' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mockGetSubmissions).toHaveBeenCalledWith('form-a', { skip: 20, limit: 20 }));

    rerender(<SubmissionViewer formId="form-b" />);

    await screen.findByRole('button', { name: 'Submission by Sam Ortiz' });
    expect(mockGetSubmissions).toHaveBeenCalledWith('form-b', { skip: 0, limit: 20 });
    expect(mockGetSubmissions).not.toHaveBeenCalledWith('form-b', { skip: 20, limit: 20 });
  });

  it('drops a late response for the form it left', async () => {
    let releaseA: (value: unknown) => void = () => undefined;
    mockGetSubmissions.mockImplementation((id: string) =>
      id === 'form-a'
        ? new Promise((resolve) => {
            releaseA = resolve;
          })
        : Promise.resolve({ submissions: [subB], total: 1, skip: 0, limit: 20 })
    );
    const { rerender } = renderWithRouter(<SubmissionViewer formId="form-a" />);
    await waitFor(() => expect(mockGetSubmissions).toHaveBeenCalledWith('form-a', { skip: 0, limit: 20 }));

    rerender(<SubmissionViewer formId="form-b" />);
    await screen.findByRole('button', { name: 'Submission by Sam Ortiz' });
    releaseA({ submissions: [subA], total: 1, skip: 0, limit: 20 });

    expect(await screen.findByRole('button', { name: 'Submission by Sam Ortiz' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submission by Pat Rivera' })).not.toBeInTheDocument();
  });
});
