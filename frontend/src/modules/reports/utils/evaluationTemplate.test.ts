import { describe, expect, it } from 'vitest';
import {
  defaultLevels,
  describeMatching,
  insertStep,
  makeKey,
  moveItem,
  newItem,
  weightTotal,
  withTool,
} from './evaluationTemplate';
import type { TemplateDefinition, TemplateWorkflow } from '../types/evaluations';

describe('makeKey', () => {
  it('turns a label into a key the backend accepts', () => {
    expect(makeKey('Teamwork & Conduct', [])).toBe('teamwork_conduct');
    expect(makeKey('2027 Goals', [])).toBe('k_2027_goals');
    expect(makeKey('!!!', [])).toBe('k');
  });

  it('never repeats a key already taken', () => {
    expect(makeKey('Training', ['training'])).toBe('training_2');
    expect(makeKey('Training', ['training', 'training_2'])).toBe('training_3');
  });

  it('stays within fifty characters, suffix included', () => {
    const long = 'a'.repeat(80);
    expect(makeKey(long, [])).toHaveLength(50);
    expect(makeKey(long, ['a'.repeat(50)])).toBe(`${'a'.repeat(48)}_2`);
  });
});

describe('withTool', () => {
  it('drops what the new tool cannot carry', () => {
    const scored = {
      ...newItem('Training', []),
      weight: 30,
      require_example_for: [1, 5],
      data_block: {
        source: 'training.hours',
        scoring_rule: { bands: [{ min: 0, max: null, score: 3 }] },
      },
    };

    const narrative = withTool(scored, 'narrative');

    expect(narrative.levels).toEqual([]);
    expect(narrative.weight).toBe(0);
    expect(narrative.require_example_for).toEqual([]);
    expect(narrative.data_block).toEqual({ source: 'training.hours', scoring_rule: null });
  });

  it('keeps edited levels when moving between scales', () => {
    const item = { ...newItem('Training', []), levels: defaultLevels('labeled_scale').slice(0, 3) };
    expect(withTool(item, 'numeric_scale').levels).toHaveLength(3);
  });
});

describe('weightTotal', () => {
  it('counts only rated items', () => {
    const definition: TemplateDefinition = {
      overall_mode: 'weighted',
      officer_ranks: [],
      sections: [
        {
          key: 's',
          title: 'S',
          description: null,
          officer_only: false,
          items: [
            { ...newItem('A', []), weight: 60 },
            { ...withTool(newItem('B', ['a']), 'meets'), weight: 40 },
            { ...withTool(newItem('C', ['a', 'b']), 'narrative') },
          ],
        },
      ],
    };
    expect(weightTotal(definition)).toBe(100);
  });
});

describe('insertStep', () => {
  const workflow: TemplateWorkflow = {
    reminder_days_before: 3,
    evaluator_may_proceed_without_self_evaluation: true,
    response_window_days: 30,
    steps: [
      {
        key: 'self',
        type: 'self_evaluation',
        label: 'Self',
        actor: { kind: 'member', position_id: null },
        due_days: 14,
      },
      { key: 'eval', type: 'evaluator', label: 'Eval', actor: { kind: 'evaluator', position_id: null }, due_days: 30 },
      {
        key: 'ack',
        type: 'member_acknowledgement',
        label: 'Ack',
        actor: { kind: 'member', position_id: null },
        due_days: 58,
      },
    ],
  };

  it('places an approval before the acknowledgement, due between its neighbours', () => {
    const next = insertStep(workflow, {
      key: 'chief',
      type: 'approval',
      label: 'Chief',
      actor: { kind: 'position', position_id: 'p1' },
      due_days: 0,
    });
    expect(next.steps.map((s) => s.key)).toEqual(['self', 'eval', 'chief', 'ack']);
    expect(next.steps[2]?.due_days).toBe(30);
  });

  it('caps the due date at the step that follows', () => {
    const next = insertStep(workflow, {
      key: 'cal',
      type: 'calibration',
      label: 'Calibration',
      actor: { kind: 'view_all', position_id: null },
      due_days: 90,
    });
    expect(next.steps[2]?.due_days).toBe(58);
  });
});

describe('moveItem', () => {
  it('moves within bounds and ignores moves past the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
});

describe('describeMatching', () => {
  it('reads as a sentence', () => {
    expect(describeMatching('operational', 'probationary')).toBe('Operational members · probationary only');
    expect(describeMatching(null, null)).toBe('All members');
  });
});
