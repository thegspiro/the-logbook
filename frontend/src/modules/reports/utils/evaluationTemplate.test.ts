import { describe, expect, it } from 'vitest';
import {
  defaultLevels,
  describeGap,
  describeMatching,
  groupDataSources,
  insertStep,
  makeKey,
  moveItem,
  newItem,
  scoringGaps,
  weightTotal,
  withTool,
} from './evaluationTemplate';
import type { EvaluationDataSource, TemplateDefinition, TemplateWorkflow } from '../types/evaluations';

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

describe('groupDataSources', () => {
  const source = (key: string, module: string): EvaluationDataSource => ({
    key,
    label: key,
    unit: 'count',
    module,
    description: '',
    scoreable: true,
  });

  it('groups by module, keeping the catalog order of groups and of sources in each', () => {
    const groups = groupDataSources([
      source('training.hours', 'training'),
      source('events.meeting_attendance_pct', 'meetings'),
      source('shifts.hours', 'scheduling'),
      source('skills.tests_passed', 'training'),
      source('meetings.waivers_summary', 'meetings'),
    ]);
    expect(groups.map((g) => [g.label, g.sources.map((s) => s.key)])).toEqual([
      ['Training', ['training.hours', 'skills.tests_passed']],
      ['Business meetings', ['events.meeting_attendance_pct', 'meetings.waivers_summary']],
      ['Shifts', ['shifts.hours']],
    ]);
  });

  it('puts a module it has no name for under Other, not its slug', () => {
    expect(groupDataSources([source('apparatus.runs', 'apparatus')])).toEqual([
      { label: 'Other', sources: [source('apparatus.runs', 'apparatus')] },
    ]);
  });
});

describe('scoringGaps', () => {
  it('finds nothing when the bands run from the floor to an open top', () => {
    expect(
      scoringGaps(
        [
          { min: 0, max: 10, score: 1 },
          { min: 10, max: null, score: 3 },
        ],
        'hours'
      )
    ).toEqual([]);
  });

  it('finds a hole between bands, below the first, and above a closed top', () => {
    expect(
      scoringGaps(
        [
          { min: 20, max: 30, score: 4 },
          { min: 5, max: 10, score: 2 },
        ],
        'hours'
      )
    ).toEqual([
      { from: 0, to: 5 },
      { from: 10, to: 20 },
      { from: 30, to: null },
    ]);
  });

  it('leaves exactly 100% out of a percentage band that stops at 100', () => {
    expect(scoringGaps([{ min: 0, max: 100, score: 3 }], 'percent')).toEqual([{ from: 100, to: null }]);
    expect(scoringGaps([{ min: 0, max: 101, score: 3 }], 'percent')).toEqual([]);
  });

  it('starts a rating at 1, the lowest a rating average can be', () => {
    expect(scoringGaps([{ min: 1, max: null, score: 3 }], 'rating')).toEqual([]);
  });

  it('reports no gap where bands overlap, which the backend refuses on its own', () => {
    expect(
      scoringGaps(
        [
          { min: 0, max: 20, score: 1 },
          { min: 10, max: null, score: 3 },
        ],
        'count'
      )
    ).toEqual([]);
  });

  it('has nothing to say about a rule with no bands', () => {
    expect(scoringGaps([], 'hours')).toEqual([]);
  });
});

describe('describeGap', () => {
  it('words each kind of gap', () => {
    expect(describeGap({ from: 0, to: 5 }, 'hours')).toBe('below 5');
    expect(describeGap({ from: 10, to: 20 }, 'count')).toBe('from 10 up to 20');
    expect(describeGap({ from: 100, to: null }, 'percent')).toBe('100% and above');
  });
});
