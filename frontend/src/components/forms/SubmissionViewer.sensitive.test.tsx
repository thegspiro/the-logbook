/**
 * SubmissionViewer — answers to Sensitive fields.
 *
 * The API returns them in `sensitive_answers` to a viewer allowed to see them,
 * and otherwise sets `sensitive_withheld`. The viewer shows the first under a
 * lock and says plainly when the second applies, and the CSV download never
 * carries them, whoever downloads it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { FormField, FormSubmission } from '../../services/api';

const mockGetForm = vi.fn();
const mockGetSubmissions = vi.fn();
const mockBuildCsv = vi.fn();

vi.mock('../../services/api', () => ({
  formsService: {
    getForm: (...args: unknown[]) => mockGetForm(...args) as unknown,
    getSubmissions: (...args: unknown[]) => mockGetSubmissions(...args) as unknown,
  },
}));

vi.mock('../../utils/csv', () => ({
  buildCsv: (...args: unknown[]) => mockBuildCsv(...args) as unknown,
  downloadCsv: vi.fn(),
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import SubmissionViewer from './SubmissionViewer';

const field = (id: string, label: string, is_sensitive = false): FormField => ({
  id,
  form_id: 'form-1',
  label,
  field_type: 'text',
  required: false,
  sort_order: 0,
  width: 'full',
  is_sensitive,
  created_at: '2026-10-25T00:00:00Z',
  updated_at: '2026-10-25T00:00:00Z',
});

const fields = [field('name', 'Full name'), field('history', 'Criminal history', true)];

const submission = (overrides: Partial<FormSubmission>): FormSubmission => ({
  id: 'sub-1',
  organization_id: 'org-1',
  form_id: 'form-1',
  submitted_at: '2026-10-25T12:00:00Z',
  data: { name: 'Pat Rivera' },
  submitter_name: 'Pat Rivera',
  is_public_submission: true,
  integration_processed: false,
  created_at: '2026-10-25T12:00:00Z',
  ...overrides,
});

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Submission by Pat Rivera' }));
};

describe('SubmissionViewer sensitive answers', () => {
  beforeEach(() => {
    mockGetForm.mockReset();
    mockGetSubmissions.mockReset();
    mockBuildCsv.mockReset();
    mockGetForm.mockResolvedValue({ fields });
    mockBuildCsv.mockReturnValue('csv');
  });

  it('shows a revealed answer under its label, marked sensitive', async () => {
    mockGetSubmissions.mockResolvedValue({
      submissions: [submission({ sensitive_answers: { history: 'Convicted of DUI in 2019' } })],
      total: 1,
      skip: 0,
      limit: 20,
    });
    const user = userEvent.setup();
    renderWithRouter(<SubmissionViewer formId="form-1" />);

    await open(user);

    expect(screen.getByText('Convicted of DUI in 2019')).toBeInTheDocument();
    expect(screen.getByText('(sensitive)')).toBeInTheDocument();
    expect(screen.queryByText(/Restricted/)).not.toBeInTheDocument();
  });

  it('says when answers were withheld', async () => {
    mockGetSubmissions.mockResolvedValue({
      submissions: [submission({ sensitive_withheld: true })],
      total: 1,
      skip: 0,
      limit: 20,
    });
    const user = userEvent.setup();
    renderWithRouter(<SubmissionViewer formId="form-1" />);

    await open(user);

    expect(screen.getByText(/Restricted: this submission has answers to sensitive questions/)).toBeInTheDocument();
    expect(screen.getByText('Pat Rivera', { selector: 'p' })).toBeInTheDocument();
  });

  it('leaves sensitive answers out of the CSV even for a viewer who can see them', async () => {
    mockGetSubmissions.mockResolvedValue({
      submissions: [submission({ sensitive_answers: { history: 'Convicted of DUI in 2019' } })],
      total: 1,
      skip: 0,
      limit: 20,
    });
    const user = userEvent.setup();
    renderWithRouter(<SubmissionViewer formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: /CSV/i }));

    expect(mockBuildCsv).toHaveBeenCalledTimes(1);
    const csv = JSON.stringify(mockBuildCsv.mock.calls[0]);
    expect(csv).toContain('Pat Rivera');
    expect(csv).not.toContain('Convicted of DUI');
    expect(csv).not.toContain('Criminal history');
  });
});
