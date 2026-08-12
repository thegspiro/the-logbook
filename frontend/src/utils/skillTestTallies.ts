/**
 * Skill test section tallies
 *
 * The counts a scorecard shows beside a section heading. Mirrors the backend's
 * build_score_breakdown so the examiner sees the same figures while scoring
 * that the finished record will report; the completed scorecard renders the
 * server's numbers directly rather than these, so the two can never disagree on
 * a filed result.
 *
 * Two rules here are not obvious, and both existed as display bugs:
 *
 * 1. Statements are excluded from every tally. They are read aloud and mark
 *    themselves passed, so counting them reported steps the examiner never
 *    judged — a section holding one statement and one real criterion read
 *    "2 passed".
 *
 * 2. Non-critical scored steps are excluded from the pass/fail tallies. The
 *    scoring screen stamps `passed: true` on every one of them whatever number
 *    it records, because only critical steps can fail on points — so a step
 *    scored 0 of 1 was counted as "passed". Their contribution is the point
 *    total shown alongside, and nothing else.
 */

import type { CriterionResult, SkillCriterion } from '../types/skillsTesting';

export interface SectionTally {
  /** Points earned / available from point-carrying steps; null when the
   *  section holds none and so contributed nothing to the percentage. */
  earned: number | null;
  available: number | null;
  countsTowardScore: boolean;
  passed: number;
  failed: number;
  notScored: number;
  statements: number;
}

function findResult(results: CriterionResult[], criterion: SkillCriterion): CriterionResult | undefined {
  return results.find((r) => r.criterion_id === criterion.id || r.criterion_label === criterion.label);
}

/** What a criterion is worth toward the percentage, or null if it carries no
 *  points. Mirrors _criterion_point_value in skills_testing_service.py. */
function pointValue(criterion: SkillCriterion, scorePassFailCriteria: boolean): number | null {
  if (criterion.type === 'score') {
    const max = criterion.max_score;
    return max != null && max > 0 ? max : null;
  }
  if (criterion.type === 'pass_fail' && scorePassFailCriteria) {
    const max = criterion.max_score;
    return max != null && max > 0 ? max : 1;
  }
  return null;
}

type Outcome = 'passed' | 'failed' | 'not_scored' | 'statement' | 'points';

/** Mirrors _criterion_outcome in skills_testing_service.py. */
function outcomeOf(criterion: SkillCriterion, result: CriterionResult | undefined): Outcome {
  if (criterion.type === 'statement') return 'statement';

  const isCritical = criterion.required;
  if (criterion.type === 'score' && !isCritical) return 'points';

  if (!result) return 'not_scored';
  if (criterion.type === 'score') {
    if (result.score == null) return 'not_scored';
    return result.score >= (criterion.passing_score ?? 0) ? 'passed' : 'failed';
  }
  if (result.passed == null) return 'not_scored';
  return result.passed ? 'passed' : 'failed';
}

export function computeSectionTally(
  criteria: SkillCriterion[],
  results: CriterionResult[],
  scorePassFailCriteria = false
): SectionTally {
  let earned = 0;
  let available = 0;
  const counts = { passed: 0, failed: 0, notScored: 0, statements: 0 };

  for (const criterion of criteria) {
    const result = findResult(results, criterion);

    const worth = pointValue(criterion, scorePassFailCriteria);
    if (worth != null) {
      available += worth;
      if (criterion.type === 'score') {
        if (result?.score != null) earned += result.score;
      } else if (result?.passed === true) {
        earned += worth;
      }
    }

    switch (outcomeOf(criterion, result)) {
      case 'statement':
        counts.statements += 1;
        break;
      case 'passed':
        counts.passed += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
      case 'not_scored':
        counts.notScored += 1;
        break;
      case 'points':
        break;
    }
  }

  const countsTowardScore = available > 0;
  return {
    earned: countsTowardScore ? earned : null,
    available: countsTowardScore ? available : null,
    countsTowardScore,
    ...counts,
  };
}
