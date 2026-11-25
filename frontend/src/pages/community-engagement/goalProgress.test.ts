import { describe, it, expect } from 'vitest';
import type { OutreachGoalProgress } from '../../services/outreachGoalServices';
import { behindPace, goalFigures, goalPercent, goalStatus, pacePercent } from './goalProgress';

const goal = (overrides: Partial<OutreachGoalProgress>): OutreachGoalProgress => ({
  id: 'g1',
  year: 2026,
  kind: 'outreach',
  measure_id: null,
  outreach_metric: 'events_held',
  label: 'Events held',
  target: 200,
  actual: 50,
  pace_target: 100,
  met: false,
  on_pace: false,
  ...overrides,
});

describe('goalStatus', () => {
  it('reads met, on pace or behind during the year', () => {
    expect(goalStatus(goal({ met: true, on_pace: true }), false)).toBe('met');
    expect(goalStatus(goal({ on_pace: true }), false)).toBe('on_pace');
    expect(goalStatus(goal({}), false)).toBe('behind');
  });

  it('reads missed once the year is over, never behind', () => {
    expect(goalStatus(goal({}), true)).toBe('missed');
    expect(goalStatus(goal({ met: true }), true)).toBe('met');
  });
});

describe('goalPercent and pacePercent', () => {
  it('measure the bar and the mark against the target, capped at full', () => {
    expect(goalPercent(goal({}))).toBe(25);
    expect(pacePercent(goal({}))).toBe(50);
    expect(goalPercent(goal({ actual: 260 }))).toBe(100);
  });
});

describe('goalFigures', () => {
  it('reads as what was reached of the target, fractions kept', () => {
    expect(goalFigures(goal({ actual: 1250, target: 2000 }))).toBe('1,250 of 2,000');
    expect(goalFigures(goal({ actual: 12.5, target: 40 }))).toBe('12.5 of 40');
  });
});

describe('behindPace', () => {
  it('keeps only goals behind their pace, the furthest behind first', () => {
    const goals = [
      goal({ id: 'a', label: 'A', actual: 90, pace_target: 100 }),
      goal({ id: 'b', label: 'B', actual: 10, pace_target: 100 }),
      goal({ id: 'c', label: 'C', on_pace: true, actual: 120 }),
      goal({ id: 'd', label: 'D', met: true, actual: 300 }),
    ];
    expect(behindPace(goals).map((g) => g.id)).toEqual(['b', 'a']);
  });
});
