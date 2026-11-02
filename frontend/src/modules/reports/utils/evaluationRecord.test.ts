import { describe, it, expect } from 'vitest';
import { formatFigure, needsJustification, partItems, withAnswer } from './evaluationRecord';
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
