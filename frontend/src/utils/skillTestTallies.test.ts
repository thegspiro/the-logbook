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
  describe('per-step score modes', () => {
    // Mirrors backend/tests/test_skill_score_breakdown.py::TestPerCriterionScoreModes.
    const questions = (overrides: Partial<SkillCriterion>) => [
      criterion({ id: 'criterion-0-0' }),
      criterion({ id: 'criterion-0-1', ...overrides }),
    ];
    const marks: CriterionResult[] = [
      { criterion_id: 'criterion-0-0', passed: true },
      { criterion_id: 'criterion-0-1', passed: false },
    ];

    it('costs nothing when no mode is set', () => {
      const tally = computeSectionTally(questions({}), marks);

      expect(tally.deducted).toBe(0);
      expect(tally.available).toBeNull();
      expect(tally.failed).toBe(1);
    });

    it('deducts the configured points on a recorded fail', () => {
      const tally = computeSectionTally(questions({ score_mode: 'deduct', deduction_points: 2 }), marks);

      expect(tally.deducted).toBe(2);
      // A deduction must not enlarge the pool — a candidate who performs the
      // step correctly should read the same score as one whose sheet omits it.
      expect(tally.available).toBeNull();
    });

    it('defaults an unweighted deduction to one point', () => {
      expect(computeSectionTally(questions({ score_mode: 'deduct' }), marks).deducted).toBe(1);
    });

    it('charges nothing for a deduct step that passed or was left unscored', () => {
      const criteria = questions({ score_mode: 'deduct' });

      expect(computeSectionTally(criteria, [{ criterion_id: 'criterion-0-1', passed: true }]).deducted).toBe(0);
      expect(computeSectionTally(criteria, []).deducted).toBe(0);
    });

    it('counts a section as scored when it only deducts', () => {
      const tally = computeSectionTally(questions({ score_mode: 'deduct' }), marks);

      // It earns nothing and still moves the percentage, so reporting it as
      // "not scored" would leave the number unaccounted for.
      expect(tally.countsTowardScore).toBe(true);
    });

    it('puts a points-mode step into the pool instead', () => {
      const tally = computeSectionTally(questions({ score_mode: 'points', max_score: 4 }), marks);

      expect(tally.available).toBe(4);
      expect(tally.earned).toBe(0);
      expect(tally.deducted).toBe(0);
    });

    it('lets an explicit none override the template-wide setting', () => {
      const tally = computeSectionTally(questions({ score_mode: 'none' }), marks, true);

      // Only the unset step follows the toggle; the opted-out one stays out.
      expect(tally.available).toBe(1);
      expect(tally.earned).toBe(1);
    });

    it('ignores a mode on a type that does not honour it', () => {
      const criteria = [criterion({ id: 'criterion-0-0', type: 'statement', score_mode: 'deduct' })];

      expect(computeSectionTally(criteria, [{ criterion_id: 'criterion-0-0', passed: false }]).deducted).toBe(0);
    });
  });
});
