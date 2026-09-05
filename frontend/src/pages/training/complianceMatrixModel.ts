/**
 * Derivation layer for the compliance matrix triage view.
 *
 * The endpoint reports a status per cell and, for countable requirement types,
 * the numbers behind it. Everything the screen shows — the tone of a cell, the
 * sentence describing progress, the queue a coordinator works through — is
 * derived here rather than in the component, so it can be tested without a DOM
 * and so the two axes (by member, by requirement) share one definition of
 * "behind".
 *
 * Every field past `status` on a cell is optional: an older backend omits
 * them, and a certification has no count to report. Nothing here may assume
 * one is present.
 */

import type {
  ComplianceMatrix,
  ComplianceMatrixCell,
  ComplianceMatrixMember,
  ComplianceMatrixRequirement,
} from '@/services/communicationsServices';
import { COMPLIANCE_EXPIRING_SOON_DAYS } from '@/constants/config';
import { calendarDaysFromToday, formatCalendarDate } from '@/utils/dateFormatting';

/** How a single cell reads. Ordered worst-last for the legend. */
export const CellTone = {
  MET: 'met',
  SHORT: 'short',
  SOON: 'soon',
  LAPSED: 'lapsed',
  MISSING: 'missing',
} as const;
export type CellTone = (typeof CellTone)[keyof typeof CellTone];

export const Standing = {
  COMPLIANT: 'compliant',
  AT_RISK: 'at_risk',
  NON_COMPLIANT: 'non_compliant',
} as const;
export type Standing = (typeof Standing)[keyof typeof Standing];

export interface EvaluatedCell {
  cell: ComplianceMatrixCell;
  requirement: ComplianceMatrixRequirement | undefined;
  tone: CellTone;
  /** 0-100, for the progress bar. */
  pct: number;
  /** "18 of 24 hours", "Valid for 88 more days", "Nothing recorded". */
  progressLabel: string;
  /** "Expires Nov 12, 2026", "Window Jan 1 – Dec 31, 2026". */
  dateLabel: string;
  /** Set only when a waiver moved the target. */
  waiverNote: string | null;
}

export interface EvaluatedMember {
  member: ComplianceMatrixMember;
  cells: EvaluatedCell[];
  met: number;
  total: number;
  pct: number;
  /** Cells that are not met — the open items a coordinator has to clear. */
  open: number;
  standing: Standing;
}

export interface RequirementRollup {
  requirement: ComplianceMatrixRequirement;
  met: number;
  total: number;
  pct: number;
  /** Members whose cell for this requirement is not met. */
  behind: EvaluatedMember[];
  waived: number;
}

const MET_STATUSES = new Set(['completed', 'verified']);

/**
 * Does this tone count toward "requirements met"?
 *
 * `soon` does. A certification valid for another 26 days is met *today* — the
 * tone is a renewal warning, not a failure. Counting it as unmet made the
 * member's own tally contradict the standing beside it: the screen showed
 * "Compliant · 1 of 2 met · 1 open item", which reads as a bug in the app
 * rather than a cert coming up for renewal.
 *
 * This also keeps the tally equal to the backend's completed-requirement
 * count, since `soon` is only ever reached from a completed record.
 */
export const isMetTone = (tone: CellTone): boolean => tone === CellTone.MET || tone === CellTone.SOON;

/** A number the UI can print: 18, not 18.0; 7.5 stays 7.5. */
const num = (value: number): string => (Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10));

const unitLabel = (unit: string | null | undefined, count: number): string => {
  if (!unit) return '';
  if (unit === 'hours') return count === 1 ? 'hour' : 'hours';
  return unit;
};

/**
 * Days until a cell's expiry, or null when it has no expiry date.
 *
 * Negative means it has already lapsed. Expiry arrives as a bare YYYY-MM-DD —
 * a calendar date, never shifted into another day by the viewer's timezone.
 */
export const daysUntilExpiry = (cell: ComplianceMatrixCell, timezone?: string): number | null =>
  calendarDaysFromToday(cell.expiry_date, timezone);

export const toneOf = (cell: ComplianceMatrixCell, timezone?: string): CellTone => {
  if (cell.status === 'expired') return CellTone.LAPSED;
  if (MET_STATUSES.has(cell.status)) {
    const days = daysUntilExpiry(cell, timezone);
    if (days !== null && days <= COMPLIANCE_EXPIRING_SOON_DAYS) {
      // Already past its date but still reported met — trust the date.
      return days < 0 ? CellTone.LAPSED : CellTone.SOON;
    }
    return CellTone.MET;
  }
  if (cell.status === 'in_progress') return CellTone.SHORT;
  return CellTone.MISSING;
};

const percentOf = (cell: ComplianceMatrixCell, tone: CellTone): number => {
  const required = cell.progress_required ?? 0;
  const current = cell.progress_current ?? 0;
  if (required > 0) {
    return Math.max(0, Math.min(100, Math.round((current / required) * 100)));
  }
  // Pass/fail requirement types have no count to scale — a certification is
  // held or it is not, and a half-full bar would invent a middle state.
  return tone === CellTone.MET || tone === CellTone.SOON ? 100 : 0;
};

const progressLabelOf = (cell: ComplianceMatrixCell, tone: CellTone, timezone?: string): string => {
  const required = cell.progress_required ?? 0;
  if (required > 0) {
    const current = cell.progress_current ?? 0;
    return `${num(current)} of ${num(required)} ${unitLabel(cell.progress_unit, required)}`;
  }
  const days = daysUntilExpiry(cell, timezone);
  if (tone === CellTone.LAPSED) {
    return days === null ? 'Lapsed' : `Lapsed ${num(Math.abs(days))} days ago`;
  }
  if (days !== null) {
    return days <= COMPLIANCE_EXPIRING_SOON_DAYS ? `Expires in ${num(days)} days` : `Valid for ${num(days)} more days`;
  }
  if (MET_STATUSES.has(cell.status)) return 'On file · no expiry';
  return 'Nothing recorded';
};

const dateLabelOf = (cell: ComplianceMatrixCell, tone: CellTone): string => {
  if (cell.expiry_date) {
    const formatted = formatCalendarDate(cell.expiry_date);
    return tone === CellTone.LAPSED ? `Lapsed ${formatted}` : `Expires ${formatted}`;
  }
  if (cell.window_start && cell.window_end) {
    // Print the year once when both ends share it. "Jan 1, 2026 - Dec 31,
    // 2026" wrapped onto three lines in the row's date column for what is one
    // ordinary calendar year.
    const sameYear = cell.window_start.slice(0, 4) === cell.window_end.slice(0, 4);
    const start = sameYear
      ? formatCalendarDate(cell.window_start, { month: 'short', day: 'numeric' })
      : formatCalendarDate(cell.window_start);
    return `Window ${start} – ${formatCalendarDate(cell.window_end)}`;
  }
  if (cell.completion_date) {
    return `Completed ${formatCalendarDate(cell.completion_date)}`;
  }
  return 'No date on record';
};

/**
 * The sentence explaining a reduced target, or null when no waiver applies.
 *
 * Shown because the alternative is a target that does not match the
 * requirement's stated one and nothing on the screen accounting for it.
 */
const waiverNoteOf = (cell: ComplianceMatrixCell): string | null => {
  const waived = cell.waived_months ?? 0;
  if (waived <= 0) return null;
  const base = cell.base_required;
  const adjusted = cell.progress_required;
  const months = `${waived} waived month${waived === 1 ? '' : 's'}`;
  if (base != null && adjusted != null && base !== adjusted) {
    return `Target reduced ${num(base)} → ${num(adjusted)} ${unitLabel(cell.progress_unit, adjusted)} for ${months} on leave`;
  }
  return `Adjusted for ${months} on leave`;
};

export const evaluateCell = (
  cell: ComplianceMatrixCell,
  requirement: ComplianceMatrixRequirement | undefined,
  timezone?: string
): EvaluatedCell => {
  const tone = toneOf(cell, timezone);
  return {
    cell,
    requirement,
    tone,
    pct: percentOf(cell, tone),
    progressLabel: progressLabelOf(cell, tone, timezone),
    dateLabel: dateLabelOf(cell, tone),
    waiverNote: waiverNoteOf(cell),
  };
};

const standingOf = (member: ComplianceMatrixMember, met: number, total: number): Standing => {
  // The backend classifies against the org's configured thresholds, so prefer
  // its answer; the fallback is only for a server that predates the field.
  if (member.standing) return member.standing;
  if (total === 0 || met >= total) return Standing.COMPLIANT;
  return member.completion_pct >= 75 ? Standing.AT_RISK : Standing.NON_COMPLIANT;
};

export const evaluateMember = (
  member: ComplianceMatrixMember,
  requirementsById: Map<string, ComplianceMatrixRequirement>,
  timezone?: string
): EvaluatedMember => {
  const cells = (member.requirements ?? []).map((cell) =>
    evaluateCell(cell, requirementsById.get(cell.requirement_id), timezone)
  );
  const met = cells.filter((c) => isMetTone(c.tone)).length;
  const total = cells.length;
  return {
    member,
    cells,
    met,
    total,
    pct: total === 0 ? 100 : Math.round((met / total) * 100),
    open: total - met,
    standing: standingOf(member, met, total),
  };
};

export const evaluateMatrix = (matrix: ComplianceMatrix, timezone?: string): EvaluatedMember[] => {
  const byId = new Map((matrix.requirements ?? []).map((r) => [r.id, r]));
  return (matrix.members ?? []).map((m) => evaluateMember(m, byId, timezone));
};

/**
 * Worst first: most open items, then lowest percentage, then by name.
 *
 * The tie-breakers matter — without them the queue reorders between renders
 * for members with identical standing, and a coordinator loses their place
 * halfway through working it.
 */
export const rankMembers = (members: EvaluatedMember[]): EvaluatedMember[] =>
  [...members].sort(
    (a, b) => b.open - a.open || a.pct - b.pct || a.member.member_name.localeCompare(b.member.member_name)
  );

export const rollUpRequirements = (
  members: EvaluatedMember[],
  requirements: ComplianceMatrixRequirement[]
): RequirementRollup[] =>
  requirements.map((requirement) => {
    // A requirement that does not apply to a member is absent from their row
    // entirely, so the denominator is who it was actually asked of.
    const applicable = members
      .map((m) => ({ member: m, cell: m.cells.find((c) => c.cell.requirement_id === requirement.id) }))
      .filter((entry): entry is { member: EvaluatedMember; cell: EvaluatedCell } => !!entry.cell);
    const met = applicable.filter((e) => isMetTone(e.cell.tone)).length;
    const total = applicable.length;
    return {
      requirement,
      met,
      total,
      pct: total === 0 ? 100 : Math.round((met / total) * 100),
      behind: applicable.filter((e) => !isMetTone(e.cell.tone)).map((e) => e.member),
      waived: applicable.filter((e) => (e.cell.cell.waived_months ?? 0) > 0).length,
    };
  });

export const cellFor = (member: EvaluatedMember, requirementId: string): EvaluatedCell | undefined =>
  member.cells.find((c) => c.cell.requirement_id === requirementId);

/** Frequency + target, e.g. "Annual · 24 hours" or "Biannual · certification". */
export const requirementMeta = (requirement: ComplianceMatrixRequirement | undefined): string => {
  if (!requirement) return '';
  const parts: string[] = [];
  if (requirement.frequency) {
    parts.push(requirement.frequency.replace(/_/g, ' '));
  }
  if (requirement.target && requirement.target_unit) {
    parts.push(`${num(requirement.target)} ${unitLabel(requirement.target_unit, requirement.target)}`);
  } else if (requirement.requirement_type) {
    parts.push(requirement.requirement_type.replace(/_/g, ' '));
  }
  return parts.join(' · ');
};
