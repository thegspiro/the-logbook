import { describe, it, expect } from 'vitest';
import {
  compareSelfEvaluation,
  figureDetail,
  formatFigure,
  gradeCounts,
  needsJustification,
  partItems,
  withAnswer,
} from './evaluationRecord';
import type { TemplateDefinition, TemplateItem } from '../types/evaluations';

function item(key: string, include = true): TemplateItem {
  return {
    key,
    label: key,
    help_text: null,
    tool: 'narrative',
    levels: [],
    allow_na: false,
    weight: 0,
    require_example_for: [],
    checklist_options: [],
    comment: 'optional',
    include_in_self_evaluation: include,
    data_block: null,
  };
}

describe('formatFigure', () => {
  it('formats each unit', () => {
    expect(formatFigure({ available: true, value: 66.666 }, 'percent')).toBe('66.7%');
    expect(formatFigure({ available: true, value: 11.5 }, 'hours')).toBe('11.5 h');
    expect(formatFigure({ available: true, value: 4.2 }, 'rating')).toBe('4.2 / 5');
    expect(formatFigure({ available: true, value: 1200 }, 'count')).toBe('1,200');
  });

  it("gives the server's reason when a figure is unavailable", () => {
    expect(formatFigure({ available: false, value: null, note: 'Call tracking is off.' }, 'percent')).toBe(
      'Call tracking is off.'
    );
    expect(formatFigure(undefined, 'count')).toBe('Not measured');
  });

  it('lists labels, with expiry dates where given', () => {
    expect(
      formatFigure(
        { available: true, value: [{ label: 'EMT', expires_on: '2027-03-01' }, { label: 'Safety Officer' }] },
        'list'
      )
    ).toBe('EMT (expires Mar 1, 2027), Safety Officer');
    expect(formatFigure({ available: true, value: [] }, 'list')).toBe('None');
  });
});

describe('form helpers', () => {
  const definition: TemplateDefinition = {
    overall_mode: 'none',
    officer_ranks: [],
    sections: [{ key: 's', title: 'S', description: null, officer_only: false, items: [item('a'), item('b', false)] }],
  };

  it('a self-evaluation answers only the items included in it', () => {
    expect(partItems(definition, 'self_evaluation').map((i) => i.key)).toEqual(['a']);
    expect(partItems(definition, 'evaluator').map((i) => i.key)).toEqual(['a', 'b']);
  });

  it('merges one answer without touching the rest', () => {
    const next = withAnswer({ answers: { a: { text: 'x' } } }, 'b', { text: 'y' });
    expect(next.answers).toEqual({ a: { text: 'x' }, b: { text: 'y' } });
  });

  it('asks for a justification only when the rating departs from a suggestion', () => {
    expect(needsJustification({ rating: 3 }, 4)).toBe(true);
    expect(needsJustification({ rating: 4 }, 4)).toBe(false);
    expect(needsJustification({ rating: 3 }, undefined)).toBe(false);
    expect(needsJustification(undefined, 4)).toBe(false);
  });
});

describe('figureDetail', () => {
  it('states the counts behind a rate', () => {
    expect(figureDetail('events.meeting_attendance_pct', { available: true, value: 75, attended: 6, held: 8 })).toBe(
      '6 of 8 meetings attended'
    );
    expect(figureDetail('training.requirements_met_pct', { available: true, value: 100, met: 1, total: 1 })).toBe(
      '1 of 1 requirement met'
    );
    expect(
      figureDetail('training.session_attendance_pct', {
        available: true,
        value: 90,
        attended: 9,
        held: 12,
        excused: 2,
        required_pct: 60,
        requirement: 'Drill attendance',
      })
    ).toBe('9 of 10 sessions attended (2 excused); Drill attendance requires 60%');
  });

  it('says when a call response rate was capped', () => {
    expect(
      figureDetail('calls.response_pct', {
        available: true,
        value: 100,
        responses: 130,
        department_calls: 120,
        capped: true,
      })
    ).toBe(
      "130 responses to 120 department calls; shown as 100% because shift call credit exceeds the department's call log"
    );
  });

  it('names hours for other agencies left out, and only when there are some', () => {
    expect(figureDetail('shifts.hours', { available: true, value: 40, external_hours: 12.5 })).toBe(
      'Not included: 12.5 h for other agencies'
    );
    expect(figureDetail('shifts.hours', { available: true, value: 40, external_hours: 0 })).toBeNull();
  });

  it('says what a total is made of, ahead of what was left out', () => {
    expect(
      figureDetail('training.hours', {
        available: true,
        value: 68.75,
        breakdown: '9 training records: Continuing Education 68.75 h',
      })
    ).toBe('9 training records: Continuing Education 68.75 h');
    expect(
      figureDetail('shifts.hours', { available: true, value: 40, external_hours: 12.5, breakdown: '4 shifts' })
    ).toBe('4 shifts. Not included: 12.5 h for other agencies');
    expect(figureDetail('shifts.count', { available: true, value: 4, external_shifts: 0, breakdown: '40 h' })).toBe(
      '40 h'
    );
  });

  it("shows a waiver summary's outcomes", () => {
    expect(
      figureDetail('meetings.waivers_summary', { available: true, value: 3, breakdown: '2 approved, 1 denied' })
    ).toBe('2 approved, 1 denied');
  });

  it('shows nothing for an older snapshot without counts, or an unavailable figure', () => {
    expect(figureDetail('events.meeting_attendance_pct', { available: true, value: 75 })).toBeNull();
    expect(figureDetail('calls.response_pct', { available: false, value: null, note: 'x' })).toBeNull();
    expect(figureDetail('calls.response_pct', undefined)).toBeNull();
  });
});

describe('gradeCounts', () => {
  const row = (overall_grade: string | null) => ({ overall_grade }) as Parameters<typeof gradeCounts>[0][number];

  it('counts each grade in grade order, then other results, and skips ungraded rows', () => {
    expect(
      gradeCounts([row('Outstanding'), row('Needs improvement'), row(null), row('72% (weighted)'), row('Outstanding')])
    ).toEqual([
      { label: 'Needs improvement', count: 1 },
      { label: 'Outstanding', count: 2 },
      { label: '72% (weighted)', count: 1 },
    ]);
  });
});

describe('compareSelfEvaluation', () => {
  const levels = [1, 2, 3, 4, 5].map((value) => ({ value, label: `L${value}`, anchor: null }));
  const definition: TemplateDefinition = {
    overall_mode: 'none',
    officer_ranks: [],
    sections: [
      {
        key: 's',
        title: 'S',
        description: null,
        officer_only: false,
        weight: 0,
        items: [
          { ...item('scale'), tool: 'labeled_scale', levels },
          { ...item('meets'), tool: 'meets' },
          { ...item('notes') },
          { ...item('evaluator_only', false), tool: 'labeled_scale', levels },
        ],
      },
    ],
  };

  it('flags a gap of two levels, and a different answer on meets / does not meet', () => {
    const rows = compareSelfEvaluation(
      definition,
      { answers: { scale: { rating: 5 }, meets: { rating: 1 } } },
      { answers: { scale: { rating: 3 }, meets: { rating: 0 } } }
    );
    expect(rows).toEqual([
      { key: 'scale', label: 'scale', self: 'L5', evaluator: 'L3', differs: true },
      { key: 'meets', label: 'meets', self: 'Meets', evaluator: 'Does not meet', differs: true },
    ]);
  });

  it('does not flag one level apart, an unrated item or one marked not applicable', () => {
    const rows = compareSelfEvaluation(
      definition,
      { answers: { scale: { rating: 4 }, meets: { na: true } } },
      { answers: { scale: { rating: 3 } } }
    );
    expect(rows.map((row) => [row.self, row.evaluator, row.differs])).toEqual([
      ['L4', 'L3', false],
      ['Not applicable', 'Not rated', false],
    ]);
  });
});
