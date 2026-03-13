/**
 * Medical Screening Module Types
 */

export const ScreeningType = {
  PHYSICAL_EXAM: 'physical_exam',
  MEDICAL_CLEARANCE: 'medical_clearance',
  DRUG_SCREENING: 'drug_screening',
  VISION_HEARING: 'vision_hearing',
  FITNESS_ASSESSMENT: 'fitness_assessment',
  PSYCHOLOGICAL: 'psychological',
} as const;
export type ScreeningType = (typeof ScreeningType)[keyof typeof ScreeningType];

export const SCREENING_TYPE_LABELS: Record<ScreeningType, string> = {
  physical_exam: 'Physical Exam',
  medical_clearance: 'Medical Clearance',
  drug_screening: 'Drug Screening',
  vision_hearing: 'Vision & Hearing',
  fitness_assessment: 'Fitness Assessment',
  psychological: 'Psychological Evaluation',
};

export const ScreeningStatus = {
  SCHEDULED: 'scheduled',
  COMPLETED: 'completed',
  PASSED: 'passed',
  FAILED: 'failed',
  PENDING_REVIEW: 'pending_review',
  WAIVED: 'waived',
  EXPIRED: 'expired',
} as const;
export type ScreeningStatus = (typeof ScreeningStatus)[keyof typeof ScreeningStatus];

export const SCREENING_STATUS_LABELS: Record<ScreeningStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  passed: 'Passed',
  failed: 'Failed',
  pending_review: 'Pending Review',
  waived: 'Waived',
  expired: 'Expired',
};

export const SCREENING_STATUS_COLORS: Record<ScreeningStatus, string> = {
  scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  passed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  pending_review: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  waived: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  expired: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
};

// --- Screening Requirement ---

export interface ScreeningRequirement {
  id: string;
  organization_id: string;
  name: string;
  screening_type: ScreeningType;
  description?: string | undefined;
  frequency_months?: number | undefined;
  applies_to_roles?: string[] | undefined;
  is_active: boolean;
  grace_period_days: number;
  created_at: string;
  updated_at: string;
}

export interface ScreeningRequirementCreate {
  name: string;
  screening_type: ScreeningType;
  description?: string | undefined;
  frequency_months?: number | undefined;
  applies_to_roles?: string[] | undefined;
  is_active?: boolean | undefined;
  grace_period_days?: number | undefined;
}

export interface ScreeningRequirementUpdate {
  name?: string | undefined;
  screening_type?: ScreeningType | undefined;
  description?: string | undefined;
  frequency_months?: number | undefined;
  applies_to_roles?: string[] | undefined;
  is_active?: boolean | undefined;
  grace_period_days?: number | undefined;
}

// --- Screening Record ---

export interface ScreeningRecord {
  id: string;
  organization_id: string;
  requirement_id?: string | undefined;
  user_id?: string | undefined;
  prospect_id?: string | undefined;
  screening_type: ScreeningType;
  status: ScreeningStatus;
  scheduled_date?: string | undefined;
  completed_date?: string | undefined;
  expiration_date?: string | undefined;
  provider_name?: string | undefined;
  result_summary?: string | undefined;
  result_data?: Record<string, unknown> | undefined;
  reviewed_by?: string | undefined;
  reviewed_at?: string | undefined;
  notes?: string | undefined;
  user_name?: string | undefined;
  prospect_name?: string | undefined;
  reviewer_name?: string | undefined;
  requirement_name?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface ScreeningRecordCreate {
  requirement_id?: string | undefined;
  user_id?: string | undefined;
  prospect_id?: string | undefined;
  screening_type: ScreeningType;
  status?: ScreeningStatus | undefined;
  scheduled_date?: string | undefined;
  completed_date?: string | undefined;
  expiration_date?: string | undefined;
  provider_name?: string | undefined;
  result_summary?: string | undefined;
  result_data?: Record<string, unknown> | undefined;
  notes?: string | undefined;
}

export interface ScreeningRecordUpdate {
  screening_type?: ScreeningType | undefined;
  status?: ScreeningStatus | undefined;
  scheduled_date?: string | undefined;
  completed_date?: string | undefined;
  expiration_date?: string | undefined;
  provider_name?: string | undefined;
  result_summary?: string | undefined;
  result_data?: Record<string, unknown> | undefined;
  notes?: string | undefined;
}

// --- Compliance ---

export interface ComplianceItem {
  requirement_id: string;
  requirement_name: string;
  screening_type: ScreeningType;
  is_compliant: boolean;
  last_screening_date?: string | undefined;
  expiration_date?: string | undefined;
  days_until_expiration?: number | undefined;
  status?: ScreeningStatus | undefined;
}

export interface ComplianceSummary {
  subject_id: string;
  subject_name: string;
  subject_type: 'user' | 'prospect';
  total_requirements: number;
  compliant_count: number;
  non_compliant_count: number;
  expiring_soon_count: number;
  is_fully_compliant: boolean;
  items: ComplianceItem[];
}

export interface ExpiringScreening {
  record_id: string;
  screening_type: ScreeningType;
  requirement_name?: string | undefined;
  user_id?: string | undefined;
  user_name?: string | undefined;
  prospect_id?: string | undefined;
  prospect_name?: string | undefined;
  expiration_date: string;
  days_until_expiration: number;
}
