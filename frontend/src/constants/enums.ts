/**
 * Centralized Constants & Enums
 *
 * Single source of truth for status values, types, and categories.
 * Use these constants instead of string literals throughout the frontend.
 */

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
export const POSITION_LABELS: Record<string, string> = {
  officer: 'Officer',
  driver: 'Driver/Operator',
  firefighter: 'Firefighter',
  EMS: 'EMT',
  ems: 'EMT',
  EMT: 'EMT',
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

export const NFPA_INSPECTION_LEVEL_OPTIONS = [
  { value: 'routine', label: 'Routine (Visual)' },
  { value: 'advanced', label: 'Advanced (Liner/Seam/Barrier)' },
  { value: 'independent', label: 'Independent (Third-Party Lab)' },
] as const;

export const NFPA_CONTAMINATION_LEVEL_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'light', label: 'Light' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'heavy', label: 'Heavy' },
  { value: 'gross', label: 'Gross' },
] as const;

export const NFPA_EXPOSURE_TYPE_OPTIONS = [
  { value: 'structure_fire', label: 'Structure Fire' },
  { value: 'vehicle_fire', label: 'Vehicle Fire' },
  { value: 'wildland_fire', label: 'Wildland Fire' },
  { value: 'hazmat', label: 'Hazmat' },
  { value: 'bloodborne_pathogen', label: 'Bloodborne Pathogen' },
  { value: 'chemical', label: 'Chemical' },
  { value: 'smoke', label: 'Smoke' },
  { value: 'other', label: 'Other' },
] as const;

export const NFPA_ENSEMBLE_ROLE_OPTIONS = [
  { value: 'coat', label: 'Coat' },
  { value: 'pants', label: 'Pants' },
  { value: 'helmet', label: 'Helmet' },
  { value: 'gloves', label: 'Gloves' },
  { value: 'boots', label: 'Boots' },
  { value: 'hood', label: 'Hood' },
] as const;

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

// ============================================
// Country Risk Level
// ============================================
export const CountryRiskLevel = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;
export type CountryRiskLevel = (typeof CountryRiskLevel)[keyof typeof CountryRiskLevel];

export const COUNTRY_RISK_LEVEL_COLORS: Record<string, string> = {
  low: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  medium: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
};
