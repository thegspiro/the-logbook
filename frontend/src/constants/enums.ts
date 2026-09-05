/**
 * Centralized Constants & Enums
 *
 * Single source of truth for status values, types, and categories.
 * Use these constants instead of string literals throughout the frontend.
 */

// ============================================
// NFC Tag Targets
// ============================================
/**
 * The destinations an NFC tag is allowed to point at. Every entry has a
 * matching spec in `constants/nfc.ts`; a tag naming anything else is refused
 * rather than followed, so this list is the whole reachable surface.
 */
export const NfcTagTarget = {
  EVENT_CHECK_IN: 'event-check-in',
  ADMIN_HOURS_CLOCK_IN: 'admin-hours-clock-in',
  SHIFT_CHECK_IN: 'shift-check-in',
} as const;
export type NfcTagTarget = (typeof NfcTagTarget)[keyof typeof NfcTagTarget];

// ============================================
// NFC ID Cards (member credentials)
// ============================================
/**
 * Lifecycle of a card issued to a member. Distinct from `NfcTagTarget` above:
 * that names where a *destination* tag points, this is the state of a card
 * that identifies a person.
 *
 * `LOST` is terminal and never returns to `ACTIVE` — whoever picked the card
 * up can still tap it — so a replacement is a new registration.
 */
export const NfcCardStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  LOST: 'lost',
  REVOKED: 'revoked',
} as const;
export type NfcCardStatus = (typeof NfcCardStatus)[keyof typeof NfcCardStatus];

/**
 * How a card was bound to its member.
 *
 * Decides what a replacement looks like: a `SERIAL` card is a printed ID card
 * whose only identifier is the chip's own serial — nothing was written to it,
 * and it cannot be reissued to somebody else. A `WRITTEN` card is a blank tag
 * an officer wrote a generated code onto, which can be rewritten and reused.
 */
export const NfcCredentialType = {
  SERIAL: 'serial',
  WRITTEN: 'written',
} as const;
export type NfcCredentialType = (typeof NfcCredentialType)[keyof typeof NfcCredentialType];

/** What a check-in station is recording attendance against. */
export const NfcCheckInTarget = {
  SHIFT: 'shift',
  EVENT: 'event',
  ADMIN_HOURS: 'admin_hours',
} as const;
export type NfcCheckInTarget = (typeof NfcCheckInTarget)[keyof typeof NfcCheckInTarget];

/** Which way a tap moves the member. `AUTO` lets one tap serve both. */
export const NfcCheckInDirection = {
  AUTO: 'auto',
  IN: 'in',
  OUT: 'out',
} as const;
export type NfcCheckInDirection = (typeof NfcCheckInDirection)[keyof typeof NfcCheckInDirection];

/** Outcome of a tap, as the station screen renders it. */
export const NfcCheckInStatus = {
  CHECKED_IN: 'checked_in',
  CHECKED_OUT: 'checked_out',
  ALREADY_CHECKED_IN: 'already_checked_in',
  ALREADY_CHECKED_OUT: 'already_checked_out',
  UNKNOWN_CARD: 'unknown_card',
  CARD_INACTIVE: 'card_inactive',
  MEMBER_INACTIVE: 'member_inactive',
  REFUSED: 'refused',
} as const;
export type NfcCheckInStatus = (typeof NfcCheckInStatus)[keyof typeof NfcCheckInStatus];

/** Badge classes per card status, matching the status-colour maps below. */
export const NFC_CARD_STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  suspended: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  lost: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  revoked: 'bg-theme-surface-secondary text-theme-text-secondary',
};

// ============================================
// User / Member Status
// ============================================
export const UserStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
  PROBATIONARY: 'probationary',
  LEAVE: 'leave',
  RETIRED: 'retired',
  DROPPED_VOLUNTARY: 'dropped_voluntary',
  DROPPED_INVOLUNTARY: 'dropped_involuntary',
  ARCHIVED: 'archived',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

// ============================================
// Election Status
// ============================================
export const ElectionStatus = {
  DRAFT: 'draft',
  NOMINATIONS: 'nominations',
  OPEN: 'open',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
} as const;
export type ElectionStatus = (typeof ElectionStatus)[keyof typeof ElectionStatus];

// ============================================
// RSVP Status
// ============================================
export const RSVPStatus = {
  GOING: 'going',
  NOT_GOING: 'not_going',
  MAYBE: 'maybe',
  WAITLISTED: 'waitlisted',
} as const;
export type RSVPStatus = (typeof RSVPStatus)[keyof typeof RSVPStatus];

// ============================================
// Event Types
// ============================================
export const EventType = {
  BUSINESS_MEETING: 'business_meeting',
  PUBLIC_EDUCATION: 'public_education',
  TRAINING: 'training',
  SOCIAL: 'social',
  FUNDRAISER: 'fundraiser',
  CEREMONY: 'ceremony',
  RECRUITMENT: 'recruitment',
  OTHER: 'other',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

// ============================================
// Form Status
// ============================================
export const FormStatus = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const;
export type FormStatus = (typeof FormStatus)[keyof typeof FormStatus];

// ============================================
// Field Types
// ============================================
export const FieldType = {
  TEXT: 'text',
  TEXTAREA: 'textarea',
  NUMBER: 'number',
  EMAIL: 'email',
  PHONE: 'phone',
  DATE: 'date',
  TIME: 'time',
  DATETIME: 'datetime',
  SELECT: 'select',
  MULTISELECT: 'multiselect',
  CHECKBOX: 'checkbox',
  RADIO: 'radio',
  FILE: 'file',
  SIGNATURE: 'signature',
  SECTION_HEADER: 'section_header',
  MEMBER_LOOKUP: 'member_lookup',
} as const;
export type FieldType = (typeof FieldType)[keyof typeof FieldType];

// ============================================
// Ballot Item Types (BallotItem.type field)
// ============================================
export const BallotItemType = {
  MEMBERSHIP_APPROVAL: 'membership_approval',
  OFFICER_ELECTION: 'officer_election',
  GENERAL_VOTE: 'general_vote',
} as const;
export type BallotItemType = (typeof BallotItemType)[keyof typeof BallotItemType];

// ============================================
// Ballot / Vote Types (BallotItem.vote_type field)
// ============================================
export const VoteType = {
  APPROVAL: 'approval',
  CANDIDATE_SELECTION: 'candidate_selection',
} as const;
export type VoteType = (typeof VoteType)[keyof typeof VoteType];

// ============================================
// Voting Method (Election.voting_method field)
// ============================================
export const VotingMethod = {
  SIMPLE_MAJORITY: 'simple_majority',
  RANKED_CHOICE: 'ranked_choice',
  APPROVAL: 'approval',
  SUPERMAJORITY: 'supermajority',
} as const;
export type VotingMethod = (typeof VotingMethod)[keyof typeof VotingMethod];

// ============================================
// Victory Condition (Election.victory_condition field)
// ============================================
export const VictoryCondition = {
  MOST_VOTES: 'most_votes',
  MAJORITY: 'majority',
  SUPERMAJORITY: 'supermajority',
  THRESHOLD: 'threshold',
} as const;
export type VictoryCondition = (typeof VictoryCondition)[keyof typeof VictoryCondition];

// ============================================
// Ballot Choice (voter action on a ballot item)
// ============================================
export const BallotChoice = {
  APPROVE: 'approve',
  DENY: 'deny',
  ABSTAIN: 'abstain',
  WRITE_IN: 'write_in',
} as const;
export type BallotChoice = (typeof BallotChoice)[keyof typeof BallotChoice];

// ============================================
// Runoff Type (Election.runoff_type field)
// ============================================
export const RunoffType = {
  TOP_TWO: 'top_two',
  ELIMINATE_LOWEST: 'eliminate_lowest',
} as const;
export type RunoffType = (typeof RunoffType)[keyof typeof RunoffType];

// ============================================
// Quorum Type (Election.quorum_type field)
// ============================================
export const QuorumType = {
  NONE: 'none',
  PERCENTAGE: 'percentage',
  COUNT: 'count',
} as const;
export type QuorumType = (typeof QuorumType)[keyof typeof QuorumType];

// ============================================
// Onboarding / Connection Status
// ============================================
export const ConnectionStatus = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
  CHECKING: 'checking',
} as const;
export type ConnectionStatus = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];

export const FeatureStatus = {
  ENABLED: 'enabled',
  DISABLED: 'disabled',
} as const;
export type FeatureStatus = (typeof FeatureStatus)[keyof typeof FeatureStatus];

// ============================================
// Health Status
// ============================================
export const HealthStatus = {
  HEALTHY: 'healthy',
  UNHEALTHY: 'unhealthy',
  DEGRADED: 'degraded',
} as const;
export type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];

// ============================================
// Membership Type
// ============================================
export const MembershipType = {
  PROSPECTIVE: 'prospective',
  PROBATIONARY: 'probationary',
  ACTIVE: 'active',
  LIFE: 'life',
  RETIRED: 'retired',
  HONORARY: 'honorary',
  ADMINISTRATIVE: 'administrative',
} as const;
export type MembershipType = (typeof MembershipType)[keyof typeof MembershipType];

/**
 * Display labels for the built-in membership types. `membership_type` also
 * holds org-configured tier ids (`senior`, …), so callers fall back to the
 * humanized raw value: `MEMBERSHIP_TYPE_LABELS[t] ?? t.replace(/_/g, ' ')`.
 */
export const MEMBERSHIP_TYPE_LABELS: Record<string, string> = {
  prospective: 'Prospective',
  probationary: 'Probationary',
  active: 'Active',
  life: 'Life',
  retired: 'Retired',
  honorary: 'Honorary',
  administrative: 'Administrative',
};

// ============================================
// Member Class and Status
// ============================================
// The two independent facts `MembershipType` fuses into one value: what kind of
// member somebody is, and where they sit on the membership ladder. Mirrors
// `MemberClass` / `MemberStatus` in backend/app/utils/membership.py, which is
// the authority whenever the pair and the legacy value disagree.
export const MemberClass = {
  OPERATIONAL: 'operational',
  ADMINISTRATIVE: 'administrative',
  SOCIAL: 'social',
} as const;
export type MemberClass = (typeof MemberClass)[keyof typeof MemberClass];

export const MemberStatus = {
  PROSPECTIVE: 'prospective',
  PROBATIONARY: 'probationary',
  REGULAR: 'regular',
  LIFE: 'life',
  RETIRED: 'retired',
  HONORARY: 'honorary',
  JUNIOR: 'junior',
} as const;
export type MemberStatus = (typeof MemberStatus)[keyof typeof MemberStatus];

// ============================================
// Pipeline / Applicant Stage Types
// ============================================
export const StageType = {
  FORM_SUBMISSION: 'form_submission',
  DOCUMENT_UPLOAD: 'document_upload',
  ELECTION_VOTE: 'election_vote',
  MANUAL_APPROVAL: 'manual_approval',
  MEETING: 'meeting',
  STATUS_PAGE_TOGGLE: 'status_page_toggle',
  AUTOMATED_EMAIL: 'automated_email',
  REFERENCE_CHECK: 'reference_check',
  CHECKLIST: 'checklist',
  INTERVIEW_REQUIREMENT: 'interview_requirement',
  MULTI_APPROVAL: 'multi_approval',
  MEDICAL_SCREENING: 'medical_screening',
} as const;
export type StageType = (typeof StageType)[keyof typeof StageType];

// ============================================
// Applicant Status
// ============================================
export const ApplicantStatus = {
  ACTIVE: 'active',
  ON_HOLD: 'on_hold',
  WITHDRAWN: 'withdrawn',
  CONVERTED: 'converted',
  REJECTED: 'rejected',
  INACTIVE: 'inactive',
} as const;
export type ApplicantStatus = (typeof ApplicantStatus)[keyof typeof ApplicantStatus];

// ============================================
// Check-in Window Type
// ============================================
export const CheckInWindowType = {
  FLEXIBLE: 'flexible',
  STRICT: 'strict',
  WINDOW: 'window',
} as const;
export type CheckInWindowType = (typeof CheckInWindowType)[keyof typeof CheckInWindowType];

// ============================================
// Training Submission Status
// ============================================
export const SubmissionStatus = {
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REVISION_REQUESTED: 'revision_requested',
} as const;
export type SubmissionStatus = (typeof SubmissionStatus)[keyof typeof SubmissionStatus];

// ============================================
// Scheduling — Assignment Status
// ============================================
export const AssignmentStatus = {
  ASSIGNED: 'assigned',
  CONFIRMED: 'confirmed',
  DECLINED: 'declined',
  PENDING: 'pending',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
} as const;
export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

// ============================================
// Scheduling — Swap / Time-Off Request Status
// ============================================
export const RequestStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
  CANCELLED: 'cancelled',
} as const;
export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus];

// ============================================
// Scheduling — Position Labels
// ============================================
/**
 * Support code the backend attaches when a driver assignment is refused for a
 * missing EVOC certification (see docs/ERROR_CODES.md). The UI keys its offer
 * to request an exception off this rather than the message text.
 */
export const DRIVER_NOT_QUALIFIED_CODE = 'LB-SCHED-001';

// The qualification a course certifies its holder in. Values must match
// QUALIFICATIONS in backend/app/services/qualification_service.py — a course
// that names a code the backend does not know grants nothing, so a test parses
// this list and asserts the two agree rather than letting it 422 on save.
//
// These are qualifications, not shift seats: which seats a qualification
// clears is the backend's business (a Paramedic clears both the medic seat and
// the EMS one), and duplicating that mapping here is how the two drift.
export const COURSE_QUALIFICATIONS: { value: string; label: string }[] = [
  { value: 'firefighter_i', label: 'Firefighter I' },
  { value: 'firefighter_ii', label: 'Firefighter II' },
  { value: 'driver_operator', label: 'Driver / Operator' },
  { value: 'emt', label: 'EMT' },
  { value: 'aemt', label: 'Advanced EMT' },
  { value: 'paramedic', label: 'Paramedic' },
];

/**
 * The built-in crew seats, keyed by the canonical token the signup API
 * grants against. Keys mirror CANONICAL_POSITIONS in
 * `backend/app/utils/positions.py`, one entry per seat — the `EMS` and `EMT`
 * alias keys that used to sit alongside `ems` made this map three seats where
 * the department has one, and `Object.entries` over it offered "EMT" three
 * times in the assign dropdown, two of them tokens no member can be signed up
 * as.
 *
 * Resolve a stored value through `positionLabel()`
 * (`modules/scheduling/utils/positionLabels.ts`) rather than indexing this map
 * directly: it folds those aliases, so a legacy row still names its seat, and
 * it knows the seats a department defined itself, which are not in here.
 */
export const POSITION_LABELS: Record<string, string> = {
  officer: 'Officer',
  driver: 'Driver/Operator',
  firefighter: 'Firefighter',
  ems: 'EMT',
  paramedic: 'Paramedic',
  captain: 'Captain',
  lieutenant: 'Lieutenant',
  probationary: 'Probationary',
  volunteer: 'Volunteer',
  other: 'Other',
};

// ============================================
// Scheduling — Status Badge Colors
// ============================================
export const ASSIGNMENT_STATUS_COLORS: Record<string, string> = {
  assigned: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  confirmed: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  declined: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  cancelled: 'bg-gray-500/10 text-gray-700 dark:text-gray-300 border-gray-500/20',
  no_show: 'bg-gray-500/10 text-gray-700 dark:text-gray-300 border-gray-500/20',
  // Synthetic status for past shifts derived from attendance records when no
  // ShiftAssignment row exists (e.g. walk-on attendance).
  completed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
};

export const REQUEST_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  approved: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  denied: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  cancelled: 'bg-gray-500/10 text-gray-700 dark:text-gray-300 border-gray-500/20',
};

// ============================================
// Inventory — Item Condition
// ============================================

/** All condition options for admin/edit forms (includes out_of_service and retired). */
export const ITEM_CONDITION_OPTIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'out_of_service', label: 'Out of Service' },
  { value: 'retired', label: 'Retired' },
] as const;

/** Condition options for return workflows (no out_of_service). */
export const RETURN_CONDITION_OPTIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damaged', label: 'Damaged' },
] as const;

// ============================================
// NFPA 1851/1852 Compliance
// ============================================

// ============================================
// IP Exception Approval Status
// ============================================
export const IPExceptionApprovalStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
} as const;
export type IPExceptionApprovalStatus = (typeof IPExceptionApprovalStatus)[keyof typeof IPExceptionApprovalStatus];

export const IP_EXCEPTION_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  approved: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  rejected: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  expired: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20',
  revoked: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
};

// ============================================
// IP Exception Use Case
// ============================================
export const IPExceptionUseCase = {
  TRAVEL: 'travel',
  REMOTE_WORK: 'remote_work',
  VPN: 'vpn',
  PARTNER_ACCESS: 'partner_access',
  OTHER: 'other',
} as const;
export type IPExceptionUseCase = (typeof IPExceptionUseCase)[keyof typeof IPExceptionUseCase];

export const IP_EXCEPTION_USE_CASE_LABELS: Record<string, string> = {
  travel: 'Travel',
  remote_work: 'Remote Work',
  vpn: 'VPN',
  partner_access: 'Partner Access',
  other: 'Other',
};

export const COUNTRY_RISK_LEVEL_COLORS: Record<string, string> = {
  low: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  medium: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
};

// ============================================
// Multi-Class Courses (Syllabus & Cohorts)
// ============================================

/** Lifecycle of one scheduled run of a multi-class course. */
export const CohortStatus = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;
export type CohortStatus = (typeof CohortStatus)[keyof typeof CohortStatus];

/**
 * Display names for `TrainingType`.
 *
 * Two divergent copies of this map used to live in CourseLibraryPicker and
 * ReviewSubmissionsPage — one saying "Skills practice", the other "Skills
 * Practice" — while the course preview card on the Create Training Session
 * wizard rendered the raw value and showed "Type: skills_practice" to the
 * user. One map, here with the other label maps.
 */
export const TRAINING_TYPE_LABELS: Record<string, string> = {
  certification: 'Certification',
  continuing_education: 'Continuing Education',
  skills_practice: 'Skills Practice',
  orientation: 'Orientation',
  refresher: 'Refresher',
  specialty: 'Specialty',
};

export const COHORT_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const COHORT_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20',
  scheduled: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  in_progress: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  completed: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
  cancelled: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
};

/** Status of a single scheduled class within a cohort. */
export const CohortClassStatus = {
  SCHEDULED: 'scheduled',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;
export type CohortClassStatus = (typeof CohortClassStatus)[keyof typeof CohortClassStatus];

export const COHORT_CLASS_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  completed: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  cancelled: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
};

/** Status of a member on a cohort roster. */
export const CohortMemberStatus = {
  ACTIVE: 'active',
  WITHDRAWN: 'withdrawn',
  COMPLETED: 'completed',
} as const;
export type CohortMemberStatus = (typeof CohortMemberStatus)[keyof typeof CohortMemberStatus];

export const COHORT_MEMBER_STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  withdrawn: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20',
  completed: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
};

/**
 * How a computed class date is adjusted when it lands on a day the course
 * does not meet.
 */
export const DateRollPolicy = {
  NONE: 'none',
  NEXT_BUSINESS_DAY: 'next_business_day',
  NEXT_MEETING_DAY: 'next_meeting_day',
} as const;
export type DateRollPolicy = (typeof DateRollPolicy)[keyof typeof DateRollPolicy];

export const DATE_ROLL_POLICY_LABELS: Record<string, string> = {
  none: 'Keep the computed date',
  next_business_day: 'Move weekends to the next weekday',
  next_meeting_day: 'Move to the next meeting day',
};

// ============================================
// Training Requirements
// ============================================
export const REQUIREMENT_TYPE_LABELS: Record<string, string> = {
  hours: 'Training hours',
  shifts: 'Shifts',
  calls: 'Call responses',
  courses: 'Courses',
  skills_evaluation: 'Skills evaluation',
  knowledge_test: 'Knowledge test',
  checklist: 'Checklist',
  certification: 'Certification',
};

/** Order the requirement-type picker offers, commonest first. */
export const REQUIREMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  'hours',
  'shifts',
  'calls',
  'courses',
  'skills_evaluation',
  'knowledge_test',
  'checklist',
  'certification',
].map((value) => ({ value, label: REQUIREMENT_TYPE_LABELS[value] ?? value }));

/** Weekday numbers used by meeting patterns (0 = Monday, matching Python). */
export const MEETING_WEEKDAYS: { value: number; label: string; short: string }[] = [
  { value: 0, label: 'Monday', short: 'Mon' },
  { value: 1, label: 'Tuesday', short: 'Tue' },
  { value: 2, label: 'Wednesday', short: 'Wed' },
  { value: 3, label: 'Thursday', short: 'Thu' },
  { value: 4, label: 'Friday', short: 'Fri' },
  { value: 5, label: 'Saturday', short: 'Sat' },
  { value: 6, label: 'Sunday', short: 'Sun' },
];

// ============================================
// Member Consent (ISO/IEC 27701)
// ============================================

/**
 * One member's standing on a single consent.
 *
 * `declined` and `not_answered` are identical in effect — both mean "do not
 * use" — and are kept apart because only one of them describes a member who
 * can still be asked.
 */
export const ConsentStatus = {
  GRANTED: 'granted',
  DECLINED: 'declined',
  NOT_ANSWERED: 'not_answered',
} as const;
export type ConsentStatus = (typeof ConsentStatus)[keyof typeof ConsentStatus];

export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  granted: 'Agreed',
  declined: 'Declined',
  not_answered: 'Not answered',
};

export const CONSENT_STATUS_COLORS: Record<ConsentStatus, string> = {
  granted: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  declined: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  not_answered: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
};

// ============================================
// Notifications
// ============================================

/**
 * Whose rows a notification send-log request addresses.
 *
 * `mine` is the server default on `GET /notifications/logs` and
 * `POST /notifications/logs/read-all`. A notification log row carries the
 * subject, body and recipient address of what was sent, so the organization
 * view is an explicit request and requires `notifications.manage` — the same
 * gate as the org-wide read-all write beside it.
 */
export const NotificationLogScope = {
  MINE: 'mine',
  ORGANIZATION: 'organization',
} as const;
export type NotificationLogScope = (typeof NotificationLogScope)[keyof typeof NotificationLogScope];

// ============================================
// Training compliance
// ============================================

/**
 * How one member × requirement cell of the compliance matrix reads.
 *
 * Presentational, but shared vocabulary: the tone decides the pill, the bar
 * colour and — via `isMetTone` — whether the cell counts toward a member's
 * met tally, so a second definition elsewhere would let two screens disagree
 * about whether the same certificate is met.
 *
 * `soon` is a certification still valid at the evaluation cutoff but expiring
 * within the renewal window; it counts as met, because it is.
 */
export const CellTone = {
  MET: 'met',
  SHORT: 'short',
  SOON: 'soon',
  LAPSED: 'lapsed',
  MISSING: 'missing',
} as const;
export type CellTone = (typeof CellTone)[keyof typeof CellTone];

/**
 * A member's overall compliance standing.
 *
 * Mirrors the backend's `classify_standing()` values exactly — the matrix
 * reports whatever the server decided rather than re-deriving it, because the
 * thresholds are per-organization and per-compliance-profile. Keep the string
 * values in step with `app/services/training_compliance.py`.
 */
export const Standing = {
  COMPLIANT: 'compliant',
  AT_RISK: 'at_risk',
  NON_COMPLIANT: 'non_compliant',
} as const;
export type Standing = (typeof Standing)[keyof typeof Standing];
