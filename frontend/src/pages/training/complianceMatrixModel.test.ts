import { describe, it, expect } from 'vitest';
import {
  CellTone,
  Standing,
  cellFor,
  daysUntilExpiry,
  evaluateCell,
  evaluateMember,
  rankMembers,
  requirementMeta,
  rollUpRequirements,
  toneOf,
} from './complianceMatrixModel';
import type {
  ComplianceMatrixCell,
  ComplianceMatrixMember,
  ComplianceMatrixRequirement,
} from '@/services/communicationsServices';

const TZ = 'UTC';

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
    expect(toneOf(cell({ status: 'completed' }), TZ)).toBe(CellTone.MET);
  });

  it('treats a verified record the same as a completed one', () => {
    expect(toneOf(cell({ status: 'verified' }), TZ)).toBe(CellTone.MET);
  });

  it('flags a certification expiring inside the renewal window as due soon', () => {
    expect(toneOf(cell({ status: 'completed', expiry_date: dateOffset(30) }), TZ)).toBe(CellTone.SOON);
  });

  it('leaves a certification outside the renewal window as met', () => {
    expect(toneOf(cell({ status: 'completed', expiry_date: dateOffset(200) }), TZ)).toBe(CellTone.MET);
  });

  it('trusts the date over the status when a "completed" cert is already past it', () => {
    // The backend can report completed with a stale expiry; a member holding a
    // lapsed card is not met, whatever the row says.
    expect(toneOf(cell({ status: 'completed', expiry_date: dateOffset(-5) }), TZ)).toBe(CellTone.LAPSED);
  });

  it('maps expired, in_progress and not_started', () => {
    expect(toneOf(cell({ status: 'expired' }), TZ)).toBe(CellTone.LAPSED);
    expect(toneOf(cell({ status: 'in_progress' }), TZ)).toBe(CellTone.SHORT);
    expect(toneOf(cell({ status: 'not_started' }), TZ)).toBe(CellTone.MISSING);
  });
});

describe('daysUntilExpiry', () => {
  it('is null when there is no expiry date', () => {
    expect(daysUntilExpiry(cell(), TZ)).toBeNull();
  });

  it('is negative once the date has passed', () => {
    expect(daysUntilExpiry(cell({ expiry_date: dateOffset(-10) }), TZ)).toBe(-10);
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
      TZ
    );
    expect(result.progressLabel).toBe('18 of 24 hours');
    expect(result.pct).toBe(75);
    expect(result.tone).toBe(CellTone.SHORT);
  });

  it('does not invent a partial bar for a pass/fail requirement', () => {
    const met = evaluateCell(cell({ status: 'completed' }), requirement({ target: null }), TZ);
    const missing = evaluateCell(cell({ status: 'not_started' }), requirement({ target: null }), TZ);
    expect(met.pct).toBe(100);
    expect(missing.pct).toBe(0);
  });

  it('describes a certification by its remaining life', () => {
    const soon = evaluateCell(cell({ expiry_date: dateOffset(30) }), requirement(), TZ);
    const healthy = evaluateCell(cell({ expiry_date: dateOffset(300) }), requirement(), TZ);
    expect(soon.progressLabel).toBe('Expires in 30 days');
    expect(healthy.progressLabel).toBe('Valid for 300 more days');
  });

  it('says how long ago a lapsed certification expired', () => {
    const result = evaluateCell(cell({ status: 'expired', expiry_date: dateOffset(-41) }), requirement(), TZ);
    expect(result.progressLabel).toBe('Lapsed 41 days ago');
  });

  it('falls back to "Nothing recorded" when there is neither a count nor a date', () => {
    const result = evaluateCell(cell({ status: 'not_started' }), requirement({ target: null }), TZ);
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
      TZ
    );
    expect(result.waiverNote).toBe('Target reduced 24 → 20 hours for 2 waived months on leave');
  });

  it('adds no waiver note when no months were waived', () => {
    expect(evaluateCell(cell(), requirement(), TZ).waiverNote).toBeNull();
  });

  it('labels the row with the date that decides it', () => {
    const expiring = evaluateCell(cell({ expiry_date: '2026-11-12' }), requirement(), TZ);
    const windowed = evaluateCell(
      cell({ status: 'not_started', window_start: '2026-01-01', window_end: '2026-12-31' }),
      requirement(),
      TZ
    );
    expect(expiring.dateLabel).toBe('Expires Nov 12, 2026');
    expect(windowed.dateLabel).toBe('Window Jan 1, 2026 – Dec 31, 2026');
  });

  it('survives a payload with none of the added fields', () => {
    // An older backend sends only the original four keys.
    const result = evaluateCell(
      { requirement_id: 'r1', requirement_name: 'Old', status: 'not_started' },
      undefined,
      TZ
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
      TZ
    );
    expect(result.met).toBe(1);
    expect(result.total).toBe(3);
    expect(result.open).toBe(2);
    expect(result.pct).toBe(33);
  });

  it("prefers the backend's standing, which knows the org thresholds", () => {
    const result = evaluateMember(member({ standing: 'at_risk' }), reqs, TZ);
    expect(result.standing).toBe(Standing.AT_RISK);
  });

  it('falls back to a derived standing when the server omits it', () => {
    const behind = evaluateMember(
      member({
        requirements: [cell({ status: 'not_started' })],
        completion_pct: 0,
      }),
      reqs,
      TZ
    );
    expect(behind.standing).toBe(Standing.NON_COMPLIANT);

    const clear = evaluateMember(member({ requirements: [cell()] }), reqs, TZ);
    expect(clear.standing).toBe(Standing.COMPLIANT);
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
        TZ
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
        TZ
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
      TZ
    );
    // This member's row omits r1 entirely — their membership type exempts them.
    const exempt = evaluateMember(
      member({
        user_id: 'u2',
        member_name: 'Grady',
        requirements: [cell({ requirement_id: 'r9', status: 'completed' })],
      }),
      reqs,
      TZ
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
      TZ
    );
    const [rollup] = rollUpRequirements([waived], [requirement()]);
    expect(rollup?.waived).toBe(1);
  });
});

describe('cellFor', () => {
  it('finds a member cell by requirement id', () => {
    const evaluated = evaluateMember(member(), new Map(), TZ);
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
