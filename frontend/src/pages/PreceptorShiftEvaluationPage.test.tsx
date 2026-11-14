import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { PublicShiftEvaluationView } from '../types/training';

const mockGet = vi.fn();
const mockSubmit = vi.fn();
vi.mock('../services/publicShiftEvaluationService', () => ({
  publicShiftEvaluationService: {
    get: (...a: unknown[]) => mockGet(...a) as unknown,
    submit: (...a: unknown[]) => mockSubmit(...a) as unknown,
  },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useParams: () => ({ token: 'T'.repeat(43) }),
}));

import PreceptorShiftEvaluationPage from './PreceptorShiftEvaluationPage';

const view: PublicShiftEvaluationView = {
  organization_name: 'Falls Church VFD',
  member_name: 'Terry Member',
  shift_date: '2026-11-10',
  shift_start: null,
  shift_end: null,
  unit_label: 'ACFD Medic 101',
  expires_at: '2026-11-17T19:00:00Z',
  template: {
    name: 'EMT Shift Evaluation',
    scale: [
      { value: 1, label: 'Unsatisfactory' },
      { value: 2, label: 'Needs Improvement' },
      { value: 3, label: 'Meets Expectations' },
      { value: 4, label: 'Exceeds Expectations' },
    ],
    allow_not_applicable: true,
    not_applicable_label: 'Not Observed',
    comment_required_at_or_below: 2,
    header_fields: [],
    statistics: [],
    sections: [
      {
        key: 'clinical',
        title: 'Clinical Performance',
        column_heading: 'Skill Area',
        items: [{ key: 'vitals', label: 'Vital Signs', comment_always_required: false }],
      },
    ],
    closing_comments_label: 'Preceptor Comments',
    closing_comments_hint: null,
  },
};

const httpError = (status: number) => Object.assign(new Error('failed'), { isAxiosError: true, response: { status } });

describe('PreceptorShiftEvaluationPage', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue(view);
    mockSubmit.mockReset();
    mockSubmit.mockResolvedValue({ submitted_at: '2026-11-11T10:00:00Z' });
  });

  it('shows the member, the shift and the unit, and nothing else of theirs', async () => {
    renderWithRouter(<PreceptorShiftEvaluationPage />);

    expect(await screen.findByRole('heading', { name: 'EMT Shift Evaluation — Terry Member' })).toBeInTheDocument();
    expect(screen.getByText('Falls Church VFD')).toBeInTheDocument();
    expect(screen.getByText(/ACFD Medic 101/)).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('T'.repeat(43));
  });

  it('asks for the preceptor’s name before submitting', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PreceptorShiftEvaluationPage />);

    await user.click(await screen.findByRole('button', { name: /Submit evaluation/ }));

    expect(within(screen.getByRole('alert')).getByText('Enter your name.')).toBeInTheDocument();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('submits the answers with the preceptor named, once', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PreceptorShiftEvaluationPage />);

    await user.type(await screen.findByRole('textbox', { name: 'Your name' }), ' Pat Preceptor ');
    const vitals = screen.getByRole('radiogroup', { name: 'Vital Signs rating' });
    await user.click(within(vitals).getByRole('radio', { name: '4 – Exceeds Expectations' }));
    await user.click(screen.getByRole('button', { name: /Submit evaluation/ }));

    await waitFor(() =>
      expect(mockSubmit).toHaveBeenCalledWith('T'.repeat(43), {
        template_id: undefined,
        header_values: {},
        statistics: {},
        responses: { vitals: { rating: 4, not_applicable: false, comment: null } },
        closing_comments: null,
        preceptor_name: 'Pat Preceptor',
        submit: true,
      })
    );
    expect(await screen.findByRole('heading', { name: 'Evaluation submitted' })).toBeInTheDocument();
  });

  it('says an already-submitted link was received', async () => {
    mockGet.mockRejectedValue(httpError(409));
    renderWithRouter(<PreceptorShiftEvaluationPage />);

    expect(await screen.findByRole('heading', { name: 'Evaluation submitted' })).toBeInTheDocument();
  });

  it('says an expired or replaced link is not available', async () => {
    mockGet.mockRejectedValue(httpError(404));
    renderWithRouter(<PreceptorShiftEvaluationPage />);

    expect(await screen.findByRole('heading', { name: 'This link is not available' })).toBeInTheDocument();
  });
});
