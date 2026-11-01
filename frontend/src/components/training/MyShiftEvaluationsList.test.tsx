import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { ShiftEvaluationDetail } from '../../types/training';
import { MyShiftEvaluationsList } from './MyShiftEvaluationsList';

const evaluation: ShiftEvaluationDetail = {
  id: 'ev-1',
  member_id: 'u2',
  member_name: 'Marcus Bell',
  evaluator_id: 'officer-1',
  evaluator_name: 'Sam Okafor',
  shift_id: 'sh1',
  shift_date: '2026-10-23',
  shift_start: null,
  shift_end: null,
  unit_label: 'Ambulance 106',
  scope_key: 'en-1',
  program_names: ['EMT Field Internship'],
  template_id: 'tpl-1',
  template_version: 1,
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
    statistics: ['calls'],
    sections: [
      {
        key: 'comm',
        title: 'Communication & Teamwork',
        column_heading: 'Skill',
        items: [{ key: 'radio', label: 'Radio & Report Communication', comment_always_required: false }],
      },
    ],
    closing_comments_label: 'Preceptor Comments',
    closing_comments_hint: null,
  },
  status: 'submitted',
  header_values: {},
  statistics: { calls: 5 },
  responses: { radio: { rating: 2, not_applicable: false, comment: 'Practice MIST' } },
  closing_comments: 'Good rapport with patients.',
  average_rating: 2,
  rated_count: 1,
  low_rating_count: 1,
  submitted_at: '2026-10-24T11:00:00Z',
  updated_at: '2026-10-24T11:00:00Z',
};

describe('MyShiftEvaluationsList', () => {
  it('opens an evaluation to the form as it was filled out, with a print link', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MyShiftEvaluationsList evaluations={[evaluation]} />);

    expect(screen.getByText('1 to work on')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /EMT Shift Evaluation/ }));

    expect(screen.getByText('1. Radio & Report Communication')).toBeInTheDocument();
    expect(screen.getByText('Practice MIST')).toBeInTheDocument();
    expect(screen.getByText('Good rapport with patients.')).toBeInTheDocument();
    expect(screen.getByText(/Evaluated by Sam Okafor/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Print/ })).toHaveAttribute(
      'href',
      '/scheduling/shift-evaluations/print?id=ev-1'
    );
  });
});
