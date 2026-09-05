import { describe, it, expect } from 'vitest';
import {
  CellTone,
  Standing,
  cellFor,
  daysUntilExpiry,
  evaluateCell,
  evaluateMember,
  evaluationBasis,
  isMetTone,
  rankMembers,
  requirementMeta,
  requirementStanding,
  rollUpRequirements,
  toneOf,
} from './complianceMatrixModel';
import type { RequirementRollup } from './complianceMatrixModel';
import type {
  ComplianceMatrixCell,
  ComplianceMatrixMember,
  ComplianceMatrixRequirement,
} from '@/services/communicationsServices';

/**
 * The evaluation cutoff every comparison is made against — what the backend
 * reports as `as_of`. Defaults to today so the existing cases keep their
 * meaning; the cutoff-specific cases pass an explicit date.
 */
const AS_OF = new Date().toISOString().slice(0, 10);

/** A calendar date `days` from today, as the backend would send it. */
const dateOffset = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const cell = (overrides: Partial<ComplianceMatrixCell> = {}): ComplianceMatrixCell => ({
  requirement_id: 'r1',
  requirement_name: 'Company Training Hours',
  status: 'completed',
  ...overrides,
});

const requirement = (overrides: Partial<ComplianceMatrixRequirement> = {}): ComplianceMatrixRequirement => ({
  id: 'r1',
  name: 'Company Training Hours',
  requirement_type: 'hours',
  frequency: 'annual',
  target: 24,
  target_unit: 'hours',
  ...overrides,
});

const member = (overrides: Partial<ComplianceMatrixMember> = {}): ComplianceMatrixMember => ({
  user_id: 'u1',
  member_name: 'Boyle, Devon',
  requirements: [cell()],
  completion_pct: 100,
  ...overrides,
});

describe('toneOf', () => {
  it('reads a completed requirement with no expiry as met', () => {
    expect(toneOf(cell({ status: 'completed' }), AS_OF)).toBe(CellTone.MET);
  });

  it('treats a verified record the same as a completed one', () => {
    expect(toneOf(cell({ status: 'verified' }), AS_OF)).toBe(CellTone.MET);
  });

  it('flags a certification expiring inside the renewal window as due soon', () => {
    expect(toneOf(cell({ status: 'completed', expiry_date: dateOffset(30) }), AS_OF)).toBe(CellTone.SOON);
  });

  it('leaves a certification outside the renewal window as met', () => {
    expect(toneOf(cell({ status: 'completed', expiry_date: dateOffset(200) }), AS_OF)).toBe(CellTone.MET);
  });

  it('trusts the date over the status when a "completed" cert is already past it', () => {
    // The backend can report completed with a stale expiry; a member holding a
    // lapsed card is not met, whatever the row says.
    expect(toneOf(cell({ status: 'completed', expiry_date: dateOffset(-5) }), AS_OF)).toBe(CellTone.LAPSED);
  });

  it('maps expired, in_progress and not_started', () => {
    expect(toneOf(cell({ status: 'expired' }), AS_OF)).toBe(CellTone.LAPSED);
    expect(toneOf(cell({ status: 'in_progress' }), AS_OF)).toBe(CellTone.SHORT);
    expect(toneOf(cell({ status: 'not_started' }), AS_OF)).toBe(CellTone.MISSING);
  });
});

describe('daysUntilExpiry', () => {
  it('is null when there is no expiry date', () => {
    expect(daysUntilExpiry(cell(), AS_OF)).toBeNull();
  });

  it('is negative once the date has passed', () => {
    expect(daysUntilExpiry(cell({ expiry_date: dateOffset(-10) }), AS_OF)).toBe(-10);
  });
});

describe('evaluateCell', () => {
  it('states countable progress against the target', () => {
    const result = evaluateCell(
      cell({
        status: 'in_progress',
        progress_current: 18,
        progress_required: 24,
        progress_unit: 'hours',
      }),
      requirement(),
      AS_OF
    );
    expect(result.progressLabel).toBe('18 of 24 hours');
    expect(result.pct).toBe(75);
    expect(result.tone).toBe(CellTone.SHORT);
  });

  it('does not invent a partial bar for a pass/fail requirement', () => {
    const met = evaluateCell(cell({ status: 'completed' }), requirement({ target: null }), AS_OF);
    const missing = evaluateCell(cell({ status: 'not_started' }), requirement({ target: null }), AS_OF);
    expect(met.pct).toBe(100);
    expect(missing.pct).toBe(0);
  });

  it('describes a certification by its remaining life', () => {
    const soon = evaluateCell(cell({ expiry_date: dateOffset(30) }), requirement(), AS_OF);
    const healthy = evaluateCell(cell({ expiry_date: dateOffset(300) }), requirement(), AS_OF);
    expect(soon.progressLabel).toBe('Expires in 30 days');
    expect(healthy.progressLabel).toBe('Valid for 300 more days');
  });

  it('says how long ago a lapsed certification expired', () => {
    const result = evaluateCell(cell({ status: 'expired', expiry_date: dateOffset(-41) }), requirement(), AS_OF);
    expect(result.progressLabel).toBe('Lapsed 41 days ago');
  });

  it('falls back to "Nothing recorded" when there is neither a count nor a date', () => {
    const result = evaluateCell(cell({ status: 'not_started' }), requirement({ target: null }), AS_OF);
    expect(result.progressLabel).toBe('Nothing recorded');
  });

  it('accounts for a reduced target rather than showing an unexplained number', () => {
    const result = evaluateCell(
      cell({
        status: 'in_progress',
        progress_current: 18,
        progress_required: 20,
        base_required: 24,
        progress_unit: 'hours',
        waived_months: 2,
      }),
      requirement(),
      AS_OF
    );
    expect(result.waiverNote).toBe('Target reduced 24 → 20 hours for 2 waived months');
  });

  it('adds no waiver note when no months were waived', () => {
    expect(evaluateCell(cell(), requirement(), AS_OF).waiverNote).toBeNull();
  });

  it('labels the row with the date that decides it', () => {
    const expiring = evaluateCell(cell({ expiry_date: '2026-11-12' }), requirement(), AS_OF);
    const windowed = evaluateCell(
      cell({ status: 'not_started', window_start: '2026-01-01', window_end: '2026-12-31' }),
      requirement(),
      AS_OF
    );
    expect(expiring.dateLabel).toBe('Expires Nov 12, 2026');
    // The year prints once when both ends share it.
    expect(windowed.dateLabel).toBe('Window Jan 1 – Dec 31, 2026');
  });

  it('keeps both years on a window that crosses one', () => {
    const crossing = evaluateCell(
      cell({ status: 'not_started', window_start: '2026-11-01', window_end: '2027-01-31' }),
      requirement(),
      AS_OF
    );
    expect(crossing.dateLabel).toBe('Window Nov 1, 2026 – Jan 31, 2027');
  });

  it('survives a payload with none of the added fields', () => {
    // An older backend sends only the original four keys.
    const result = evaluateCell(
      { requirement_id: 'r1', requirement_name: 'Old', status: 'not_started' },
      undefined,
      AS_OF
    );
    expect(result.tone).toBe(CellTone.MISSING);
    expect(result.pct).toBe(0);
    expect(result.progressLabel).toBe('Nothing recorded');
    expect(result.dateLabel).toBe('No date on record');
  });
});

describe('evaluateMember', () => {
  const reqs = new Map([['r1', requirement()]]);

  it('counts met cells and open items', () => {
    const result = evaluateMember(
      member({
        requirements: [
          cell({ requirement_id: 'r1', status: 'completed' }),
          cell({ requirement_id: 'r2', status: 'expired' }),
          cell({ requirement_id: 'r3', status: 'not_started' }),
        ],
        standing: 'non_compliant',
      }),
      reqs,
      AS_OF
    );
    expect(result.met).toBe(1);
    expect(result.total).toBe(3);
    expect(result.open).toBe(2);
    expect(result.pct).toBe(33);
  });

  it("prefers the backend's standing, which knows the org thresholds", () => {
    const result = evaluateMember(member({ standing: 'at_risk' }), reqs, AS_OF);
    expect(result.standing).toBe(Standing.AT_RISK);
  });

  it('falls back to a derived standing when the server omits it', () => {
    const behind = evaluateMember(
      member({
        requirements: [cell({ status: 'not_started' })],
        completion_pct: 0,
      }),
      reqs,
      AS_OF
    );
    expect(behind.standing).toBe(Standing.NON_COMPLIANT);

    const clear = evaluateMember(member({ requirements: [cell()] }), reqs, AS_OF);
    expect(clear.standing).toBe(Standing.COMPLIANT);
  });
});

describe('a certification expiring soon', () => {
  const reqs = new Map([['r1', requirement()]]);

  it('still counts as met, so the tally cannot contradict the standing', () => {
    // Found on screen, not in a test: a member sat under "Compliant" reading
    // "1 of 2 met · 1 open item". A cert valid for another 26 days is met
    // today; the tone is a renewal warning, not a failure.
    const result = evaluateMember(
      member({
        standing: 'compliant',
        completion_pct: 100,
        requirements: [
          cell({ requirement_id: 'r1', status: 'completed' }),
          cell({ requirement_id: 'r2', status: 'completed', expiry_date: dateOffset(26) }),
        ],
      }),
      reqs,
      AS_OF
    );

    expect(result.met).toBe(2);
    expect(result.open).toBe(0);
    expect(result.pct).toBe(100);
    expect(result.standing).toBe(Standing.COMPLIANT);
    // The warning survives where it belongs — on the row.
    expect(result.cells[1]?.tone).toBe(CellTone.SOON);
  });

  it('agrees with the backend tally for a partially compliant member', () => {
    const result = evaluateMember(
      member({
        standing: 'non_compliant',
        completion_pct: 50,
        requirements: [
          cell({ requirement_id: 'r1', status: 'in_progress', progress_current: 18, progress_required: 24 }),
          cell({ requirement_id: 'r2', status: 'completed', expiry_date: dateOffset(30) }),
        ],
      }),
      reqs,
      AS_OF
    );
    expect(result.met).toBe(1);
    expect(result.open).toBe(1);
  });

  it('does not count a lapsed certification, however it was reported', () => {
    const result = evaluateMember(
      member({
        requirements: [cell({ status: 'completed', expiry_date: dateOffset(-5) })],
      }),
      reqs,
      AS_OF
    );
    expect(result.met).toBe(0);
    expect(result.open).toBe(1);
  });

  it('leaves a member with an expiring cert off the requirement behind-list', () => {
    const soon = evaluateMember(
      member({ requirements: [cell({ status: 'completed', expiry_date: dateOffset(26) })] }),
      reqs,
      AS_OF
    );
    const [rollup] = rollUpRequirements([soon], [requirement()]);
    expect(rollup?.met).toBe(1);
    expect(rollup?.behind).toEqual([]);
  });
});

describe('labels that must not contradict the row beside them', () => {
  it('names the record behind an in-progress pass/fail cell', () => {
    // The tone is amber "Short" because a matching record exists but is
    // unfinished; saying "Nothing recorded" denied that record.
    const result = evaluateCell(
      cell({ status: 'in_progress' }),
      requirement({ requirement_type: 'skills_evaluation', target: null, target_unit: null }),
      AS_OF
    );
    expect(result.tone).toBe(CellTone.SHORT);
    expect(result.progressLabel).toBe('Started, not yet complete');
  });

  it('dates a completed certification by its completion, not the frequency window', () => {
    // Certification matching is not restricted to the frequency window, so
    // showing the window implied the credential was earned inside it.
    const result = evaluateCell(
      cell({
        status: 'completed',
        completion_date: '2024-03-15',
        window_start: '2026-01-01',
        window_end: '2026-12-31',
      }),
      requirement({ requirement_type: 'certification', target: null, target_unit: null }),
      AS_OF
    );
    expect(result.dateLabel).toBe('Completed Mar 15, 2024');
  });

  it('still shows the window for a countable requirement', () => {
    const result = evaluateCell(
      cell({
        status: 'in_progress',
        progress_current: 6,
        progress_required: 24,
        progress_unit: 'hours',
        window_start: '2026-01-01',
        window_end: '2026-12-31',
      }),
      requirement(),
      AS_OF
    );
    expect(result.dateLabel).toBe('Window Jan 1 – Dec 31, 2026');
  });

  it('does not claim a waiver was leave', () => {
    // fetch_org_waivers merges leave with new_member / administrative / other
    // waivers, and the cell reports only a month count — the source is not
    // knowable here, so the note must not assert one.
    const result = evaluateCell(
      cell({
        status: 'in_progress',
        progress_current: 18,
        progress_required: 20,
        base_required: 24,
        progress_unit: 'hours',
        waived_months: 2,
      }),
      requirement(),
      AS_OF
    );
    expect(result.waiverNote).toBe('Target reduced 24 → 20 hours for 2 waived months');
    expect(result.waiverNote).not.toContain('leave');
  });
});

describe('the evaluation cutoff', () => {
  const reqs = new Map([['r1', requirement()]]);

  it("measures expiry from as_of, not from the viewer's today", () => {
    // When the org excludes the in-progress month the backend evaluates
    // through the previous month-end and reports it as as_of. A certificate
    // that lapsed after that cutoff was still valid when the backend graded
    // the cell, so calling it lapsed here puts an open item on a member the
    // same response reports as compliant.
    const cutoff = '2026-08-31';
    const lapsedAfterCutoff = cell({ status: 'completed', expiry_date: '2026-09-03' });

    expect(toneOf(lapsedAfterCutoff, cutoff)).not.toBe(CellTone.LAPSED);
    // Measured from a later basis, the same cell has genuinely lapsed.
    expect(toneOf(lapsedAfterCutoff, '2026-09-30')).toBe(CellTone.LAPSED);
  });

  it('keeps the member tally consistent with the backend standing', () => {
    const evaluated = evaluateMember(
      member({
        standing: 'compliant',
        completion_pct: 100,
        requirements: [cell({ status: 'completed', expiry_date: '2026-09-03' })],
      }),
      reqs,
      '2026-08-31'
    );
    expect(evaluated.open).toBe(0);
    expect(evaluated.met).toBe(1);
  });

  it('counts remaining days from the cutoff', () => {
    const result = evaluateCell(cell({ status: 'completed', expiry_date: '2026-09-30' }), requirement(), '2026-08-31');
    expect(daysUntilExpiry(result.cell, '2026-08-31')).toBe(30);
    expect(result.progressLabel).toBe('Expires in 30 days');
  });

  it('falls back to today when the server reports no cutoff', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(evaluationBasis({}, 'UTC')).toBe(today);
    expect(evaluationBasis({ as_of: '2026-08-31' }, 'UTC')).toBe('2026-08-31');
  });
});

describe('a requirement nobody is graded against', () => {
  it('reports no percentage rather than 100%', () => {
    // An empty denominator is not success. A probationary-only requirement in
    // a department with no probationary members would otherwise read "100% of
    // 0 members met" in green.
    const [rollup] = rollUpRequirements([], [requirement()]);
    expect(rollup?.total).toBe(0);
    expect(rollup?.pct).toBeNull();
    expect(rollup?.behind).toEqual([]);
  });

  it('still scores a requirement that does apply to somebody', () => {
    const reqs = new Map([['r1', requirement()]]);
    const behind = evaluateMember(member({ requirements: [cell({ status: 'not_started' })] }), reqs, AS_OF);
    const [rollup] = rollUpRequirements([behind], [requirement()]);
    expect(rollup?.total).toBe(1);
    expect(rollup?.pct).toBe(0);
  });
});

describe('isMetTone', () => {
  it('accepts met and due-soon, rejects the rest', () => {
    expect(isMetTone(CellTone.MET)).toBe(true);
    expect(isMetTone(CellTone.SOON)).toBe(true);
    expect(isMetTone(CellTone.SHORT)).toBe(false);
    expect(isMetTone(CellTone.LAPSED)).toBe(false);
    expect(isMetTone(CellTone.MISSING)).toBe(false);
  });
});

describe('rankMembers', () => {
  it('puts the most open items first, then the lowest percentage, then name', () => {
    const reqs = new Map<string, ComplianceMatrixRequirement>();
    const build = (name: string, statuses: string[]) =>
      evaluateMember(
        member({
          user_id: name,
          member_name: name,
          requirements: statuses.map((status, i) => cell({ requirement_id: `r${i}`, status })),
          completion_pct: 0,
        }),
        reqs,
        AS_OF
      );

    const ranked = rankMembers([
      build('Alvarez', ['completed', 'completed']),
      build('Doherty', ['expired', 'not_started']),
      build('Boyle', ['completed', 'expired']),
    ]);
    expect(ranked.map((m) => m.member.member_name)).toEqual(['Doherty', 'Boyle', 'Alvarez']);
  });

  it('is stable for members with identical standing', () => {
    const reqs = new Map<string, ComplianceMatrixRequirement>();
    const build = (name: string) =>
      evaluateMember(
        member({ user_id: name, member_name: name, requirements: [cell({ status: 'expired' })] }),
        reqs,
        AS_OF
      );
    const names = ['Zeller', 'Abbott', 'Mbeki'];
    const first = rankMembers(names.map(build)).map((m) => m.member.member_name);
    const second = rankMembers([...names].reverse().map(build)).map((m) => m.member.member_name);
    expect(first).toEqual(second);
  });
});

describe('rollUpRequirements', () => {
  const reqs = new Map<string, ComplianceMatrixRequirement>([['r1', requirement()]]);

  it('scores a requirement against the members it actually applies to', () => {
    const applies = evaluateMember(
      member({ user_id: 'u1', member_name: 'Boyle', requirements: [cell({ status: 'expired' })] }),
      reqs,
      AS_OF
    );
    // This member's row omits r1 entirely — their membership type exempts them.
    const exempt = evaluateMember(
      member({
        user_id: 'u2',
        member_name: 'Grady',
        requirements: [cell({ requirement_id: 'r9', status: 'completed' })],
      }),
      reqs,
      AS_OF
    );

    const [rollup] = rollUpRequirements([applies, exempt], [requirement()]);
    expect(rollup?.total).toBe(1);
    expect(rollup?.met).toBe(0);
    expect(rollup?.pct).toBe(0);
    expect(rollup?.behind.map((m) => m.member.member_name)).toEqual(['Boyle']);
  });

  it('counts members whose target was waived', () => {
    const waived = evaluateMember(
      member({ requirements: [cell({ status: 'in_progress', waived_months: 2 })] }),
      reqs,
      AS_OF
    );
    const [rollup] = rollUpRequirements([waived], [requirement()]);
    expect(rollup?.waived).toBe(1);
  });
});

describe('requirementStanding', () => {
  const rollup = (over: Partial<RequirementRollup>): RequirementRollup => ({
    requirement: requirement(),
    met: 0,
    total: 0,
    pct: null,
    behind: [],
    waived: 0,
    ...over,
  });

  const behindMembers = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      evaluateMember(member({ user_id: `u${i}`, requirements: [cell({ status: 'not_started' })] }), new Map(), AS_OF)
    );

  it('flags a requirement 9 of 10 members have met', () => {
    // The case that separates the dashboard's predicate from the 85% cutoff
    // this screen used to apply: 90% is comfortably "holding" on a percentage
    // rule, and still leaves one member unaccounted for.
    const nineOfTen = rollup({ met: 9, total: 10, pct: 90, behind: behindMembers(1) });
    expect(requirementStanding(nineOfTen)).toBe(Standing.AT_RISK);
  });

  it('clears a requirement only when nobody is behind', () => {
    expect(requirementStanding(rollup({ met: 10, total: 10, pct: 100 }))).toBe(Standing.COMPLIANT);
  });

  it('does not call a requirement nobody is graded against compliant', () => {
    expect(requirementStanding(rollup({ met: 0, total: 0, pct: null }))).toBe(Standing.AT_RISK);
  });
});

describe('cellFor', () => {
  it('finds a member cell by requirement id', () => {
    const evaluated = evaluateMember(member(), new Map(), AS_OF);
    expect(cellFor(evaluated, 'r1')?.cell.requirement_id).toBe('r1');
    expect(cellFor(evaluated, 'nope')).toBeUndefined();
  });
});

describe('requirementMeta', () => {
  it('states the frequency and the countable target', () => {
    expect(requirementMeta(requirement())).toBe('annual · 24 hours');
  });

  it('states the type when there is no countable target', () => {
    expect(requirementMeta(requirement({ requirement_type: 'certification', target: null, target_unit: null }))).toBe(
      'annual · certification'
    );
  });

  it('is empty for an unknown requirement', () => {
    expect(requirementMeta(undefined)).toBe('');
  });
});
