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
// Training Status
// ============================================
export const TrainingStatus = {
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
} as const;
export type TrainingStatus = (typeof TrainingStatus)[keyof typeof TrainingStatus];

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
