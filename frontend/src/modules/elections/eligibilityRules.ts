/**
 * Voter-eligibility vocabulary and wording shared by the ballot builder, the
 * election settings and the election screens, so each describes a rule the
 * same way.
 */
import type {
  AttendanceRule,
  EligibilityDefaults,
  ElectionEligibilityRules,
  ElectionSettings,
  TypeRule,
  VoterRow,
} from '../../types/election';
import {
  AttendanceRuleMode,
  MeetingKind,
  MemberVoterType,
  WaitCountedFrom,
  WaitingPeriodMode,
} from '../../constants/enums';
import { MEETING_TYPE_OPTIONS } from '../minutes/utils/meetingTypes';

// `administrative` and `social` are the member's **class** alone — what kind
// of member they are — answered for every standing. `regular`, `life` and
// `probationary` are the member's **status** alone. `operational` is neither:
// it is a legacy category preserved for its pre-split meaning
// (membership_type == "active"), so it requires class == operational AND
// status == regular — it does NOT include probationary, life or retired
// members, even though those are all operational-class. Use `regular` (which
// includes life) or a specific status option to reach a wider operational
// slice.
//
// The labels have to say which is which, and get `operational`'s narrower
// meaning right — a label implying it spans every status would have an
// administrator omit probationary/life members from a ballot they intended
// to include.
//
// See ElectionService._user_has_role_type() for the authoritative mapping and
// app/utils/membership.py for the vocabulary.
export const VOTER_TYPE_OPTIONS = [
  { value: 'all', label: 'All Members' },
  { value: 'regular', label: 'Regular Members (status)' },
  { value: 'life', label: 'Life Members (status)' },
  { value: 'regular,life', label: 'Regular + Life Members (status)' },
  { value: 'probationary', label: 'Probationary Members (status)' },
  {
    value: 'operational',
    label: 'Operational Members (Regular status only)',
  },
  { value: 'administrative', label: 'Administrative Members — any status' },
  { value: 'social', label: 'Social / Associate Members — any status' },
];

/** Mirrors the backend bounds on `AttendanceRule` / `ElectionEligibilityRules`. */
export const ELIGIBILITY_BOUNDS = {
  min_meetings: { min: 1, max: 60, integer: true },
  of_last_meetings: { min: 1, max: 60, integer: true },
  min_pct: { min: 1, max: 100, integer: false },
  period_months: { min: 1, max: 60, integer: true },
  waiting_months: { min: 1, max: 600, integer: true },
} as const;

/**
 * A box's text as a number within `field`'s bounds, or null while it is not
 * one — so a half-typed "12" is held in its box rather than saved as "1".
 */
export const parseBounded = (field: keyof typeof ELIGIBILITY_BOUNDS, raw: string): number | null => {
  const bounds = ELIGIBILITY_BOUNDS[field];
  const pattern = bounds.integer ? /^\d+$/ : /^\d+(\.\d+)?$/;
  if (!pattern.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= bounds.min && value <= bounds.max ? value : null;
};

/** The member types a waiting period is set for, in the order the table lists them. */
export const MEMBER_VOTER_TYPES: { value: MemberVoterType; label: string; decidedBy: 'class' | 'status' }[] = [
  { value: MemberVoterType.REGULAR, label: 'Regular', decidedBy: 'status' },
  { value: MemberVoterType.LIFE, label: 'Life', decidedBy: 'status' },
  { value: MemberVoterType.PROBATIONARY, label: 'Probationary', decidedBy: 'status' },
  { value: MemberVoterType.JUNIOR, label: 'Junior', decidedBy: 'status' },
  { value: MemberVoterType.RETIRED, label: 'Retired', decidedBy: 'status' },
  { value: MemberVoterType.HONORARY, label: 'Honorary', decidedBy: 'status' },
  { value: MemberVoterType.ADMINISTRATIVE, label: 'Administrative', decidedBy: 'class' },
  { value: MemberVoterType.SOCIAL, label: 'Social', decidedBy: 'class' },
];

/** Starting values offered when a secretary switches the attendance rule on. */
export const ATTENDANCE_RULE_STARTERS: Record<'count' | 'percent', Partial<AttendanceRule>> = {
  count: { min_meetings: 6, of_last_meetings: 12 },
  percent: { min_pct: 50, period_months: 12 },
};

export const EMPTY_ELIGIBILITY_RULES: ElectionEligibilityRules = {
  attendance: { mode: AttendanceRuleMode.NONE },
  waiting_periods: {},
};

/** What the backend applies when the department has saved nothing. */
export const DEFAULT_ELIGIBILITY: EligibilityDefaults = {
  rules: EMPTY_ELIGIBILITY_RULES,
  default_require_attendance: true,
  default_voter_types: ['all'],
  position_voter_types: {},
};

const meetingTypesPhrase = (types: string[] | null | undefined): string => {
  if (!types || types.length === 0) return 'meetings';
  const labels = types.map((t) => MEETING_TYPE_OPTIONS.find((o) => o.value === t)?.label.toLowerCase() ?? t);
  return labels.length === 1 ? `${labels[0] ?? ''}s` : `meetings (${labels.join(', ')})`;
};

/** One attendance rule as a phrase ("attended at least 6 of their last 12 business meetings"), or null. */
export const describeAttendanceRule = (att: AttendanceRule): string | null => {
  const meetings = meetingTypesPhrase(att.meeting_types);
  if (att.mode === AttendanceRuleMode.COUNT && att.min_meetings && att.of_last_meetings) {
    return `attended at least ${att.min_meetings} of their last ${att.of_last_meetings} ${meetings}`;
  }
  if (att.mode === AttendanceRuleMode.PERCENT && att.min_pct && att.period_months) {
    return `attended at least ${att.min_pct}% of ${meetings} in the last ${att.period_months} months`;
  }
  return null;
};

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * How a version 2 row is named when the screen has no `voter_rows` from
 * Election Settings to read: the built-in types by their names, a department
 * tier by its id.
 */
const BUILTIN_ROW_LABELS: Record<string, string> = {
  regular: 'Regular',
  life: 'Life',
  probationary: 'Probationary',
  retired: 'Retired',
  honorary: 'Honorary',
  junior: 'Junior',
  prospective: 'Prospective',
  administrative: 'Administrative',
  social: 'Social',
};
const CLASS_ROW_KEYS = new Set(['administrative', 'social']);

/**
 * The rows to show for `rules`: the department's rows when the screen has
 * them, plus any row the rules hold that they do not name (a tier since
 * removed); else the rows the rules themselves hold.
 */
export const rowsForRules = (rules: ElectionEligibilityRules, voterRows?: VoterRow[] | null): VoterRow[] => {
  const rows: VoterRow[] = [...(voterRows ?? [])];
  const known = new Set(rows.map((row) => row.key));
  for (const key of Object.keys(rules.types ?? {})) {
    if (known.has(key)) continue;
    rows.push({
      key,
      label: BUILTIN_ROW_LABELS[key] ?? capitalize(key.replace(/[-_]/g, ' ')),
      decided_by: CLASS_ROW_KEYS.has(key) ? 'class' : 'status',
    });
  }
  return rows;
};

/** One row's rules as a sentence, or null when the row sets none. */
export const describeTypeRule = (label: string, rule: TypeRule): string | null => {
  if (!rule.may_vote) return `${label} members may not vote`;
  const parts: string[] = [];
  if (rule.wait) {
    const since =
      rule.wait.counted_from === WaitCountedFrom.JOINED ? 'joining the department' : `becoming ${label.toLowerCase()}`;
    parts.push(`wait ${rule.wait.months} months after ${since}`);
  }
  for (const att of rule.attendance) {
    const phrase = describeAttendanceRule(att);
    if (phrase) parts.push(`must have ${phrase}`);
  }
  if (parts.length === 0) return null;
  return `${label} members ${parts.join(', and ')}`;
};

/**
 * One sentence per rule in force, or an empty list when none is. Worded the
 * way the backend reports a failure, so the screen that sets a rule and the
 * roster that applies it read alike.
 */
export const describeEligibilityRules = (
  rules: ElectionEligibilityRules | null | undefined,
  voterRows?: VoterRow[] | null
): string[] => {
  if (!rules) return [];
  if (rules.version === 2) {
    return rowsForRules(rules, voterRows).flatMap((row) => {
      const rule = rules.types?.[row.key];
      const line = rule ? describeTypeRule(row.label, rule) : null;
      return line ? [line] : [];
    });
  }
  const lines: string[] = [];
  const attendance = describeAttendanceRule(rules.attendance);
  if (attendance) lines.push(capitalize(attendance));
  for (const type of MEMBER_VOTER_TYPES) {
    const period = rules.waiting_periods?.[type.value];
    if (period?.mode === WaitingPeriodMode.NEVER) {
      lines.push(`${type.label} members may not vote`);
    } else if (period?.mode === WaitingPeriodMode.MONTHS && period.months) {
      lines.push(`${type.label} members may vote ${period.months} months after becoming ${type.label.toLowerCase()}`);
    }
  }
  return lines;
};

export const MEETING_KIND_LABELS: Record<MeetingKind, string> = {
  [MeetingKind.REGULAR]: 'Regular business meeting',
  [MeetingKind.ANNUAL]: 'Annual meeting',
  [MeetingKind.BYLAWS]: 'Bylaws amendment',
  [MeetingKind.SPECIAL]: 'Special meeting',
};

/** The kinds in the order the screens list them. */
export const MEETING_KINDS: MeetingKind[] = [
  MeetingKind.REGULAR,
  MeetingKind.ANNUAL,
  MeetingKind.BYLAWS,
  MeetingKind.SPECIAL,
];

/** A kind that may carry its own defaults: every kind but the regular meeting. */
export type OwnDefaultsKind = Exclude<MeetingKind, 'regular'>;

/** The kinds that may carry their own defaults, and where the settings keep them. */
export const OWN_DEFAULTS_FIELD = {
  [MeetingKind.ANNUAL]: 'annual_eligibility',
  [MeetingKind.BYLAWS]: 'bylaws_eligibility',
  [MeetingKind.SPECIAL]: 'special_eligibility',
} as const satisfies Record<OwnDefaultsKind, keyof ElectionSettings>;

/**
 * The defaults an election of `kind` copies — the backend's
 * `_defaults_for_kind`: that kind's own set when the department has one,
 * else the regular set.
 */
export const defaultsForKind = (settings: ElectionSettings, kind: MeetingKind): EligibilityDefaults =>
  (kind === MeetingKind.REGULAR ? null : settings[OWN_DEFAULTS_FIELD[kind]]) ??
  settings.eligibility ??
  DEFAULT_ELIGIBILITY;
