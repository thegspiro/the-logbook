import { describe, it, expect } from 'vitest';
import { figureDetail, formatFigure, needsJustification, partItems, withAnswer } from './evaluationRecord';
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
