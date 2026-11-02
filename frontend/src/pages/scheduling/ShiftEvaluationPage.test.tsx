import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { ShiftEvaluationFormResponse, ShiftEvaluationRoster } from '../../types/training';

const mockGetForm = vi.fn();
const mockGetRoster = vi.fn();
const mockSave = vi.fn();
const mockGetOutsideForm = vi.fn();
const mockGetOutsideRoster = vi.fn();
const mockSaveOutside = vi.fn();
vi.mock('../../services/api', () => ({
  shiftEvaluationService: {
    getForm: (...a: unknown[]) => mockGetForm(...a) as unknown,
    getRoster: (...a: unknown[]) => mockGetRoster(...a) as unknown,
    save: (...a: unknown[]) => mockSave(...a) as unknown,
    getOutsideForm: (...a: unknown[]) => mockGetOutsideForm(...a) as unknown,
    getOutsideRoster: (...a: unknown[]) => mockGetOutsideRoster(...a) as unknown,
    saveOutside: (...a: unknown[]) => mockSaveOutside(...a) as unknown,
  },
}));

const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...a: unknown[]) => mockToastError(...a) as unknown },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let currentUserId = 'officer-1';
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: currentUserId } }),
}));

const mockNavigate = vi.fn();
let params: Record<string, string> = { shiftId: 'sh1', memberId: 'u2', scopeKey: 'en-1' };
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useParams: () => params,
  useNavigate: () => mockNavigate,
}));

import ShiftEvaluationPage from './ShiftEvaluationPage';

const requirement = {
  member_id: 'u2',
  member_name: 'Marcus Bell',
  seat: 'ems',
  scope_key: 'en-1',
  program_names: ['EMT Field Internship'],
  required: true,
  template_options: [{ id: 'tpl-1', name: 'EMT Shift Evaluation' }],
  evaluation: null,
};

const form = (overrides: Partial<ShiftEvaluationFormResponse> = {}): ShiftEvaluationFormResponse => ({
  requirement,
  occasion: 'shift',
  shift_id: 'sh1',
  external_shift_id: null,
  shift_date: '2026-10-23',
  shift_start: '2026-10-23T22:00:00Z',
  shift_end: '2026-10-24T10:00:00Z',
  unit_label: 'Ambulance 106',
  platoon: 'B',
  template_id: 'tpl-1',
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
    header_fields: [
      { key: 'platoon', label: 'Shift (A, B, C)', type: 'choice', options: ['A', 'B', 'C'], required: true },
    ],
    statistics: ['calls', 'transports', 'refusals'],
    sections: [
      {
        key: 'clinical',
        title: 'Clinical Performance',
        column_heading: 'Skill Area',
        items: [
          { key: 'als', label: 'Assist with ALS skills', comment_always_required: true },
          { key: 'vitals', label: 'Vital Signs', comment_always_required: false },
        ],
      },
    ],
    closing_comments_label: 'Preceptor Comments',
    closing_comments_hint: null,
  },
  evaluation: null,
  prefill_statistics: { calls: 5 },
  ...overrides,
});

const roster: ShiftEvaluationRoster = {
  occasion: 'shift',
  shift_id: 'sh1',
  external_shift_id: null,
  shift_date: '2026-10-23',
  shift_start: null,
  shift_end: null,
  unit_label: 'Ambulance 106',
  platoon: 'B',
  requirements: [requirement, { ...requirement, member_id: 'u3', member_name: 'Priya Natarajan', scope_key: 'en-2' }],
};

describe('ShiftEvaluationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUserId = 'officer-1';
    params = { shiftId: 'sh1', memberId: 'u2', scopeKey: 'en-1' };
    mockGetForm.mockReset();
    mockGetForm.mockResolvedValue(form());
    mockGetRoster.mockReset();
    mockGetRoster.mockResolvedValue(roster);
    mockSave.mockReset();
    mockSave.mockImplementation((_s: string, _m: string, _k: string, body: { submit: boolean }) =>
      Promise.resolve({
        ...form().evaluation,
        id: 'ev-1',
        status: body.submit ? 'submitted' : 'draft',
        template: form().template,
        template_id: 'tpl-1',
        updated_at: '2026-10-24T11:00:00Z',
      })
    );
  });

  it('starts from the shift: its platoon and its call count', async () => {
    renderWithRouter(<ShiftEvaluationPage />);

    expect(await screen.findByRole('heading', { name: 'EMT Shift Evaluation — Marcus Bell' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Number of Calls')).toHaveValue('5');
    expect(screen.getByLabelText('Number of Transports')).toHaveValue('');
    expect(mockGetForm).toHaveBeenCalledWith('sh1', 'u2', 'en-1', undefined);
  });

  it('lists what is left instead of submitting an unfinished evaluation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftEvaluationPage />);

    await user.click(await screen.findByRole('button', { name: /Submit evaluation/ }));

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Rate "Assist with ALS skills".')).toBeInTheDocument();
    expect(within(alert).getByText('Enter the number of transports.')).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('submits a finished evaluation and returns to the shift report', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftEvaluationPage />);

    await user.type(await screen.findByLabelText('Number of Transports'), '3');
    await user.type(screen.getByLabelText('Number of Refusals'), '1');
    const als = screen.getByRole('radiogroup', { name: 'Assist with ALS skills rating' });
    await user.click(within(als).getByRole('radio', { name: '3 – Meets Expectations' }));
    await user.type(screen.getByLabelText(/^Comment/), '  12-lead on a chest pain call ');
    const vitals = screen.getByRole('radiogroup', { name: 'Vital Signs rating' });
    await user.click(within(vitals).getByRole('radio', { name: 'N/A – Not Observed' }));
    await user.click(screen.getByRole('button', { name: /Submit evaluation/ }));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith('sh1', 'u2', 'en-1', {
        template_id: 'tpl-1',
        header_values: { platoon: 'B' },
        statistics: { calls: 5, transports: 3, refusals: 1 },
        responses: {
          als: { rating: 3, not_applicable: false, comment: '12-lead on a chest pain call' },
          vitals: { rating: null, not_applicable: true, comment: null },
        },
        closing_comments: null,
        submit: true,
      })
    );
    expect(mockNavigate).toHaveBeenCalledWith('/scheduling?tab=shift-reports&shift=sh1&view=create');
  });

  it('opens a low rating’s comment box and requires it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftEvaluationPage />);

    const vitals = await screen.findByRole('radiogroup', { name: 'Vital Signs rating' });
    await user.click(within(vitals).getByRole('radio', { name: '2 – Needs Improvement' }));

    expect(screen.getByText(/required for a rating of 2 or lower/)).toBeInTheDocument();
  });

  it('will not let a member fill out their own evaluation', async () => {
    currentUserId = 'u2';
    renderWithRouter(<ShiftEvaluationPage />);

    expect(await screen.findByText(/This is your own evaluation/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit evaluation/ })).toBeDisabled();
  });

  it('restores a saved draft', async () => {
    mockGetForm.mockResolvedValue(
      form({
        evaluation: {
          id: 'ev-1',
          member_id: 'u2',
          member_name: 'Marcus Bell',
          evaluator_id: 'officer-1',
          evaluator_name: 'Sam Okafor',
          occasion: 'shift',
          shift_id: 'sh1',
          external_shift_id: null,
          preceptor_name: null,
          shift_date: '2026-10-23',
          shift_start: null,
          shift_end: null,
          unit_label: 'Ambulance 106',
          scope_key: 'en-1',
          program_names: ['EMT Field Internship'],
          template_id: 'tpl-1',
          template_version: 1,
          template: form().template,
          status: 'draft',
          header_values: { platoon: 'C' },
          statistics: { calls: 6 },
          responses: { vitals: { rating: 4, not_applicable: false, comment: null } },
          closing_comments: 'Good start',
          average_rating: 4,
          rated_count: 1,
          low_rating_count: 0,
          submitted_at: null,
          updated_at: '2026-10-24T09:00:00Z',
        },
      })
    );
    renderWithRouter(<ShiftEvaluationPage />);

    expect(await screen.findByText('Draft saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'C' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Number of Calls')).toHaveValue('6');
    const vitals = screen.getByRole('radiogroup', { name: 'Vital Signs rating' });
    expect(within(vitals).getByRole('radio', { name: '4 – Exceeds Expectations' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'Preceptor Comments' })).toHaveValue('Good start');
  });

  it('moves between the shift’s evaluations', async () => {
    renderWithRouter(<ShiftEvaluationPage />);

    const strip = await screen.findByRole('navigation', { name: 'Evaluations on this shift' });
    expect(within(strip).getByRole('link', { name: /Marcus Bell/ })).toHaveAttribute('aria-current', 'page');
    expect(within(strip).getByRole('link', { name: /Priya Natarajan/ })).toHaveAttribute(
      'href',
      '/scheduling/shift-reports/sh1/evaluations/u3/en-2'
    );
  });

  describe('an outside shift', () => {
    const outsideForm = () =>
      form({
        occasion: 'external',
        shift_id: null,
        external_shift_id: 'entry-1',
        unit_label: 'ACFD Medic 101',
        platoon: null,
        prefill_statistics: {},
      });

    beforeEach(() => {
      params = { entryId: 'entry-1', scopeKey: 'en-1' };
      mockGetOutsideForm.mockReset();
      mockGetOutsideForm.mockResolvedValue(outsideForm());
      mockGetOutsideRoster.mockReset();
      mockGetOutsideRoster.mockResolvedValue({
        ...roster,
        occasion: 'external',
        shift_id: null,
        external_shift_id: 'entry-1',
        requirements: [requirement],
      });
      mockSaveOutside.mockReset();
      mockSaveOutside.mockImplementation((_e: string, _k: string, body: { submit: boolean }) =>
        Promise.resolve({
          id: 'ev-1',
          status: body.submit ? 'submitted' : 'draft',
          template: outsideForm().template,
          template_id: 'tpl-1',
          preceptor_name: 'Pat Preceptor',
          updated_at: '2026-10-24T11:00:00Z',
        })
      );
    });

    it('opens the logged shift, suggesting no calls', async () => {
      renderWithRouter(<ShiftEvaluationPage />);

      expect(await screen.findByRole('heading', { name: 'EMT Shift Evaluation — Marcus Bell' })).toBeInTheDocument();
      expect(screen.getByText(/· ACFD Medic 101 · EMT Field Internship/)).toBeInTheDocument();
      expect(screen.getByLabelText('Number of Calls')).toHaveValue('');
      expect(mockGetOutsideForm).toHaveBeenCalledWith('entry-1', 'en-1', undefined);
      expect(mockGetForm).not.toHaveBeenCalled();
      expect(screen.getByRole('link', { name: /Back to outside shifts/ })).toHaveAttribute(
        'href',
        '/training/admin?page=settings&tab=shift-evaluations'
      );
    });

    it('asks for the preceptor before submitting', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ShiftEvaluationPage />);

      await user.click(await screen.findByRole('button', { name: /Submit evaluation/ }));

      const alert = screen.getByRole('alert');
      expect(within(alert).getByText('Enter the preceptor who evaluated the shift.')).toBeInTheDocument();
      expect(mockSaveOutside).not.toHaveBeenCalled();
    });

    it('submits with the preceptor named and returns to the list', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ShiftEvaluationPage />);

      await user.type(await screen.findByRole('textbox', { name: 'Preceptor' }), '  Pat Preceptor ');
      await user.click(screen.getByRole('button', { name: 'B' }));
      await user.type(screen.getByLabelText('Number of Calls'), '6');
      await user.type(screen.getByLabelText('Number of Transports'), '4');
      await user.type(screen.getByLabelText('Number of Refusals'), '1');
      const als = screen.getByRole('radiogroup', { name: 'Assist with ALS skills rating' });
      await user.click(within(als).getByRole('radio', { name: '3 – Meets Expectations' }));
      await user.type(screen.getByLabelText(/^Comment/), 'IV start');
      const vitals = screen.getByRole('radiogroup', { name: 'Vital Signs rating' });
      await user.click(within(vitals).getByRole('radio', { name: '4 – Exceeds Expectations' }));
      await user.click(screen.getByRole('button', { name: /Submit evaluation/ }));

      await waitFor(() =>
        expect(mockSaveOutside).toHaveBeenCalledWith('entry-1', 'en-1', {
          template_id: 'tpl-1',
          header_values: { platoon: 'B' },
          statistics: { calls: 6, transports: 4, refusals: 1 },
          responses: {
            als: { rating: 3, not_applicable: false, comment: 'IV start' },
            vitals: { rating: 4, not_applicable: false, comment: null },
          },
          closing_comments: null,
          preceptor_name: 'Pat Preceptor',
          submit: true,
        })
      );
      expect(mockSave).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/training/admin?page=settings&tab=shift-evaluations');
    });
  });
});
