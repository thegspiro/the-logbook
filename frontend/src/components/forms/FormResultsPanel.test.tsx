/**
 * The Results view stays mounted while the officer switches forms. It must
 * show the selected form's results only, and "Recent answers" must be the
 * newest answers: the API returns submissions newest first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

import FormResultsPanel from './FormResultsPanel';

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

const submission = (id: string, formId: string, data: Record<string, string>): FormSubmission => ({
  id,
  organization_id: 'org-1',
  form_id: formId,
  submitted_at: '2026-09-01T12:00:00Z',
  data,
  is_public_submission: false,
  integration_processed: false,
  created_at: '2026-09-01T12:00:00Z',
});

const page = (submissions: FormSubmission[]) => ({ submissions, total: submissions.length, skip: 0, limit: 100 });

describe('FormResultsPanel', () => {
  beforeEach(() => {
    mockGetForm.mockReset();
    mockGetSubmissions.mockReset();
  });

  it('lists the five newest answers, newest first', async () => {
    mockGetForm.mockResolvedValue({ fields: [field('note', 'Notes')] });
    // Newest first, as the API orders them.
    const subs = ['seventh', 'sixth', 'fifth', 'fourth', 'third', 'second', 'first'].map((v, i) =>
      submission(`s${i}`, 'form-a', { note: v })
    );
    mockGetSubmissions.mockResolvedValue(page(subs));

    render(<FormResultsPanel formId="form-a" />);

    await screen.findByText('Recent answers:');
    expect(screen.getByText('seventh')).toBeInTheDocument();
    expect(screen.getByText('third')).toBeInTheDocument();
    expect(screen.queryByText('second')).not.toBeInTheDocument();
    expect(screen.queryByText('first')).not.toBeInTheDocument();
  });

  it('drops a late response for the form it left', async () => {
    let releaseA: (value: unknown) => void = () => undefined;
    mockGetForm.mockImplementation((id: string) =>
      id === 'form-a'
        ? new Promise((resolve) => {
            releaseA = resolve;
          })
        : Promise.resolve({ fields: [field('b', 'Form B question')] })
    );
    mockGetSubmissions.mockImplementation((id: string) =>
      Promise.resolve(
        page(
          id === 'form-a'
            ? [submission('sa', 'form-a', { a: 'A answer' })]
            : [submission('sb', 'form-b', { b: 'B answer' })]
        )
      )
    );

    const { rerender } = render(<FormResultsPanel formId="form-a" />);
    await waitFor(() => expect(mockGetForm).toHaveBeenCalledWith('form-a'));

    rerender(<FormResultsPanel formId="form-b" />);
    await screen.findByText('B answer');
    releaseA({ fields: [field('a', 'Form A question')] });

    expect(await screen.findByText('B answer')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText('Form B question')).toBeInTheDocument();
    expect(screen.queryByText('Form A question')).not.toBeInTheDocument();
    expect(screen.queryByText('A answer')).not.toBeInTheDocument();
  });
});
