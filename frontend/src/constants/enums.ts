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
// Ballot / Vote Types
// ============================================
export const VoteType = {
  APPROVAL: 'approval',
  RANKED_CHOICE: 'ranked_choice',
  OFFICER_ELECTION: 'officer_election',
  MEMBERSHIP_APPROVAL: 'membership_approval',
} as const;
export type VoteType = (typeof VoteType)[keyof typeof VoteType];

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
  ELECTION_VOTE: 'election_vote',
} as const;
export type StageType = (typeof StageType)[keyof typeof StageType];

// ============================================
// Applicant Status
// ============================================
export const ApplicantStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  WITHDRAWN: 'withdrawn',
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
  EMS: 'EMS',
  ems: 'EMS',
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
