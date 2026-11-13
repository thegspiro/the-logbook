/**
 * The wording of voter rules, which the create dialog, the election's rules
 * panel and the settings screen all read from.
 */
import { describe, it, expect } from 'vitest';
import type { ElectionEligibilityRules, ElectionSettings, EligibilityDefaults } from '../../types/election';
import { defaultsForKind, describeEligibilityRules, rowsForRules } from './eligibilityRules';

const typeRules: ElectionEligibilityRules = {
  version: 2,
  attendance: { mode: 'none' },
  types: {
    regular: {
      may_vote: true,
      wait: { months: 12, counted_from: 'joined' },
      attendance: [{ mode: 'count', min_meetings: 6, of_last_meetings: 12, meeting_types: ['business'] }],
    },
    senior: { may_vote: true, wait: null, attendance: [] },
    probationary: { may_vote: false, wait: null, attendance: [] },
    administrative: {
      may_vote: true,
      wait: { months: 6, counted_from: 'type' },
      attendance: [{ mode: 'percent', min_pct: 50, period_months: 12 }],
    },
  },
};

describe('describeEligibilityRules — version 2', () => {
  it('describes each row that sets a rule, and skips the rest', () => {
    expect(describeEligibilityRules(typeRules)).toEqual([
      'Regular members wait 12 months after joining the department, and must have attended at least 6 of their last 12 business meetings',
      'Probationary members may not vote',
      'Administrative members wait 6 months after becoming administrative, and must have attended at least 50% of meetings in the last 12 months',
    ]);
  });

  it("names a row by the department's label when it has one", () => {
    const lines = describeEligibilityRules(
      { ...typeRules, types: { senior: { may_vote: false, wait: null, attendance: [] } } },
      [{ key: 'senior', label: 'Senior', decided_by: 'status', counts_as: 'regular' }]
    );
    expect(lines).toEqual(['Senior members may not vote']);
  });

  it('keeps the version 1 wording', () => {
    expect(
      describeEligibilityRules({
        attendance: { mode: 'count', min_meetings: 2, of_last_meetings: 3 },
        waiting_periods: { probationary: { mode: 'never' } },
      })
    ).toEqual(['Attended at least 2 of their last 3 meetings', 'Probationary members may not vote']);
  });
});

describe('rowsForRules', () => {
  it('adds a row the rules hold that the department no longer lists', () => {
    const rows = rowsForRules(typeRules, [{ key: 'regular', label: 'Regular', decided_by: 'status' }]);
    expect(rows.map((row) => row.key)).toEqual(['regular', 'senior', 'probationary', 'administrative']);
    expect(rows.find((row) => row.key === 'administrative')?.decided_by).toBe('class');
    expect(rows.find((row) => row.key === 'senior')?.label).toBe('Senior');
  });
});

describe('defaultsForKind', () => {
  const defaults = (rules: ElectionEligibilityRules): EligibilityDefaults => ({
    rules,
    default_require_attendance: true,
    default_voter_types: ['all'],
    position_voter_types: {},
  });

  it("uses a kind's own set when it has one, else the regular set", () => {
    const regular = defaults(typeRules);
    const bylaws = defaults({ ...typeRules, types: {} });
    const settings: ElectionSettings = { eligibility: regular, bylaws_eligibility: bylaws, special_eligibility: null };
    expect(defaultsForKind(settings, 'bylaws')).toBe(bylaws);
    expect(defaultsForKind(settings, 'special')).toBe(regular);
    expect(defaultsForKind(settings, 'regular')).toBe(regular);
  });
});
