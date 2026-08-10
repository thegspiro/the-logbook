/**
 * Section tally tests.
 *
 * These mirror backend/tests/test_skill_score_breakdown.py::TestSectionTallies
 * deliberately — the examiner's live counts and the filed record's counts have
 * to agree, and the only thing keeping two implementations in step is that they
 * are pinned by the same cases.
 */

import { describe, it, expect } from 'vitest';

import { computeSectionTally } from './skillTestTallies';
import type { CriterionResult, SkillCriterion } from '../types/skillsTesting';

function criterion(overrides: Partial<SkillCriterion> & { id: string }): SkillCriterion {
  return {
    label: overrides.id,
    type: 'pass_fail',
    required: false,
    sort_order: 0,
    ...overrides,
  };
}

describe('computeSectionTally', () => {
  it('counts statements apart from passes', () => {
    // The scoring screen auto-marks statements passed, so a naive count of the
    // passed flag reported two passes for one judged criterion.
    const criteria = [
      criterion({ id: 'criterion-0-0', type: 'statement' }),
      criterion({ id: 'criterion-0-1', required: true }),
    ];
    const results: CriterionResult[] = [
      { criterion_id: 'criterion-0-0', passed: true },
      { criterion_id: 'criterion-0-1', passed: true },
    ];

    const tally = computeSectionTally(criteria, results);

    expect(tally.statements).toBe(1);
    expect(tally.passed).toBe(1);
  });

  it('does not count a scored step that earned nothing as passed', () => {
    const criteria = [
      criterion({ id: 'criterion-0-0', type: 'score', max_score: 1 }),
      criterion({ id: 'criterion-0-1', type: 'score', max_score: 1 }),
    ];
    const results: CriterionResult[] = [
      { criterion_id: 'criterion-0-0', passed: true, score: 1 },
      { criterion_id: 'criterion-0-1', passed: true, score: 0 },
    ];

    const tally = computeSectionTally(criteria, results);

    expect(tally.passed).toBe(0);
    expect(tally.failed).toBe(0);
    expect(tally.earned).toBe(1);
    expect(tally.available).toBe(2);
  });

  it('judges a critical scored step against its passing score', () => {
    const criteria = [
      criterion({ id: 'criterion-0-0', type: 'score', max_score: 4, passing_score: 3, required: true }),
    ];
    const results: CriterionResult[] = [{ criterion_id: 'criterion-0-0', passed: false, score: 2 }];

    const tally = computeSectionTally(criteria, results);

    expect(tally.failed).toBe(1);
    expect(tally.passed).toBe(0);
  });

  it('counts unrecorded steps as not scored', () => {
    const criteria = [
      criterion({ id: 'criterion-0-0', type: 'statement' }),
      criterion({ id: 'criterion-0-1' }),
      criterion({ id: 'criterion-0-2' }),
    ];
    const results: CriterionResult[] = [{ criterion_id: 'criterion-0-2', passed: null }];

    const tally = computeSectionTally(criteria, results);

    expect(tally.notScored).toBe(2);
    expect(tally.statements).toBe(1);
  });

  it('leaves pass/fail steps out of the point pool by default', () => {
    const criteria = [criterion({ id: 'criterion-0-0' }), criterion({ id: 'criterion-0-1' })];
    const results: CriterionResult[] = [
      { criterion_id: 'criterion-0-0', passed: true },
      { criterion_id: 'criterion-0-1', passed: false },
    ];

    const tally = computeSectionTally(criteria, results);

    expect(tally.countsTowardScore).toBe(false);
    expect(tally.earned).toBeNull();
    expect(tally.available).toBeNull();
    expect(tally.passed).toBe(1);
    expect(tally.failed).toBe(1);
  });

  it('gives pass/fail steps points when the template opts in', () => {
    const criteria = [criterion({ id: 'criterion-0-0' }), criterion({ id: 'criterion-0-1', max_score: 4 })];
    const results: CriterionResult[] = [
      { criterion_id: 'criterion-0-0', passed: true },
      { criterion_id: 'criterion-0-1', passed: false },
    ];

    const tally = computeSectionTally(criteria, results, true);

    // 1 point for the unweighted step, 0 of 4 for the weighted one it failed.
    expect(tally.earned).toBe(1);
    expect(tally.available).toBe(5);
  });

  it('matches results by label when the client wrote labels instead of ids', () => {
    const criteria = [criterion({ id: 'criterion-0-0', label: 'Retract the wheels', type: 'score', max_score: 1 })];
    const results: CriterionResult[] = [
      { criterion_id: 'stale-id', criterion_label: 'Retract the wheels', passed: true, score: 1 },
    ];

    expect(computeSectionTally(criteria, results).earned).toBe(1);
  });
});
