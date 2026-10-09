/**
 * Display helpers shared by the shift history import review screens.
 *
 * The analysis refers to people and units by reference — a user id, a
 * `new:<key>` for a member the commit will create, an apparatus id, or a unit
 * key for an outside unit the commit will add — and these turn a reference
 * into the name the reviewer recognises.
 */

import type {
  HistoryImportAnalysis,
  HistoryImportAttendance,
  HistoryImportMember,
} from '../../../../modules/scheduling/types/historyImport';
import { UnitTargetKind } from '../../../../modules/scheduling/types/historyImport';

export const NEW_MEMBER_PREFIX = 'new:';

export const memberLabel = (analysis: HistoryImportAnalysis, ref: string): string => {
  if (ref.startsWith(NEW_MEMBER_PREFIX)) {
    const key = ref.slice(NEW_MEMBER_PREFIX.length);
    const source = analysis.members.find((m) => m.key === key);
    return `${source?.display_name || key} (new, inactive)`;
  }
  return analysis.options.members.find((m) => m.id === ref)?.name ?? 'Unknown member';
};

export const unitLabel = (analysis: HistoryImportAnalysis, kind: string, ref: string): string => {
  if (kind === UnitTargetKind.NEW_EXTERNAL) {
    const source = analysis.units.find((u) => u.key === ref);
    return source ? `${source.new_unit_name} (${source.new_agency_name}, new)` : ref;
  }
  const option = analysis.options.units.find((u) => u.id === ref);
  if (!option) return 'Unknown unit';
  return option.agency_name ? `${option.name} (${option.agency_name})` : option.name;
};

export const attendanceUnitLabel = (analysis: HistoryImportAnalysis, att: HistoryImportAttendance): string =>
  unitLabel(analysis, att.unit_kind, att.unit_ref);

/** Minutes as hours, to the quarter hour where that is exact: 1530 → "25.5 h". */
export const hoursLabel = (minutes: number): string => {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(2).replace(/0$/, '')} h`;
};

export const memberSourceLabel = (member: HistoryImportMember): string => {
  const parts = [member.display_name];
  if (member.membership_number) parts.push(`#${member.membership_number}`);
  if (member.email) parts.push(member.email);
  if (member.username) parts.push(`@${member.username}`);
  return parts.filter(Boolean).join(' · ') || member.key;
};

/** Settled resolutions need nothing more from the reviewer. */
export const isSettled = (status: string): boolean => ['matched', 'mapped', 'create'].includes(status);

export const RESOLUTION_LABELS: Record<string, string> = {
  matched: 'Matched',
  mapped: 'Mapped',
  create: 'Will be created',
  conflict: 'Conflict',
  ambiguous: 'More than one match',
  unmatched: 'No match',
};
