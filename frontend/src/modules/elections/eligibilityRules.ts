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
} from '../../types/election';
import { AttendanceRuleMode, MeetingKind, MemberVoterType, WaitingPeriodMode } from '../../constants/enums';
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

/**
 * One sentence per election-wide rule in force, or an empty list when none
 * is. Worded the way the backend reports a failure, so the screen that sets a
 * rule and the roster that applies it read alike.
 */
export const describeEligibilityRules = (rules: ElectionEligibilityRules | null | undefined): string[] => {
  if (!rules) return [];
  const lines: string[] = [];
  const att = rules.attendance;
  const meetings = meetingTypesPhrase(att.meeting_types);
  if (att.mode === AttendanceRuleMode.COUNT && att.min_meetings && att.of_last_meetings) {
    lines.push(`Attended at least ${att.min_meetings} of their last ${att.of_last_meetings} ${meetings}`);
  } else if (att.mode === AttendanceRuleMode.PERCENT && att.min_pct && att.period_months) {
    lines.push(`Attended at least ${att.min_pct}% of ${meetings} in the last ${att.period_months} months`);
  }
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
};

/**
 * The defaults an election held at `kind` copies — the backend's
 * `_defaults_for_kind`: the annual meeting's own set when the department has
 * one, else the regular set.
 */
export const defaultsForKind = (settings: ElectionSettings, kind: MeetingKind): EligibilityDefaults =>
  (kind === MeetingKind.ANNUAL ? settings.annual_eligibility : null) ?? settings.eligibility ?? DEFAULT_ELIGIBILITY;
