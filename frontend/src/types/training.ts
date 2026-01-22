/**
 * Training type definitions
 */

import type { Event, EventCreate } from './event';

export type TrainingType =
  | 'certification'
  | 'continuing_education'
  | 'skills_practice'
  | 'orientation'
  | 'refresher'
  | 'specialty';

export type TrainingStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type RequirementFrequency =
  | 'annual'
  | 'biannual'
  | 'quarterly'
  | 'monthly'
  | 'one_time';

/**
 * Training Session
 *
 * Links a training event with a training course.
 * When created, generates both an Event (for scheduling/RSVP/QR codes)
 * and a TrainingCourse record.
 */
export interface TrainingSession {
  id: string;
  event_id: string;  // Links to Event table
  course_id?: string;  // Links to TrainingCourse if using existing course

  // Training-specific details
  course_name: string;
  course_code?: string;
  training_type: TrainingType;
  credit_hours: number;
  instructor?: string;
  max_participants?: number;

  // Certification details
  certification_number_prefix?: string;  // Will append member ID
  issuing_agency?: string;
  expiration_months?: number;

  // Requirements
  prerequisites?: string[];
  materials_required?: string[];

  // Populated from Event
  event?: Event;

  // Stats
  registered_count?: number;
  checked_in_count?: number;
  completed_count?: number;

  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingSessionCreate {
  // Event details
  title: string;
  description?: string;
  location?: string;
  location_details?: string;
  start_datetime: string;
  end_datetime: string;
  requires_rsvp?: boolean;
  rsvp_deadline?: string;
  max_attendees?: number;
  is_mandatory?: boolean;
  eligible_roles?: string[];

  // Use existing course or create new
  use_existing_course?: boolean;
  course_id?: string;  // If using existing course

  // Training details (for new course)
  course_name?: string;
  course_code?: string;
  training_type: TrainingType;
  credit_hours: number;
  instructor?: string;

  // Certification
  issues_certification?: boolean;
  certification_number_prefix?: string;
  issuing_agency?: string;
  expiration_months?: number;

  // Requirements
  prerequisites?: string[];
  materials_required?: string[];

  // Auto-completion settings
  auto_create_records?: boolean;  // Create TrainingRecords on check-in
  require_completion_confirmation?: boolean;  // Instructor must confirm completion
}

export interface TrainingCourse {
  id: string;
  organization_id: string;
  name: string;
  code?: string;
  description?: string;
  training_type: TrainingType;
  duration_hours?: number;
  credit_hours?: number;
  prerequisites?: string[];
  expiration_months?: number;
  instructor?: string;
  max_participants?: number;
  materials_required?: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingCourseCreate {
  name: string;
  code?: string;
  description?: string;
  training_type: TrainingType;
  duration_hours?: number;
  credit_hours?: number;
  prerequisites?: string[];
  expiration_months?: number;
  instructor?: string;
  max_participants?: number;
  materials_required?: string[];
}

export interface TrainingCourseUpdate {
  name?: string;
  code?: string;
  description?: string;
  training_type?: TrainingType;
  duration_hours?: number;
  credit_hours?: number;
  prerequisites?: string[];
  expiration_months?: number;
  instructor?: string;
  max_participants?: number;
  materials_required?: string[];
  active?: boolean;
}

export interface TrainingRecord {
  id: string;
  organization_id: string;
  user_id: string;
  course_id?: string;
  course_name: string;
  course_code?: string;
  training_type: TrainingType;
  scheduled_date?: string;
  completion_date?: string;
  expiration_date?: string;
  hours_completed: number;
  credit_hours?: number;
  certification_number?: string;
  issuing_agency?: string;
  status: TrainingStatus;
  score?: number;
  passing_score?: number;
  passed?: boolean;
  instructor?: string;
  location?: string;
  notes?: string;
  attachments?: string[];
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingRecordCreate {
  user_id: string;
  course_id?: string;
  course_name: string;
  course_code?: string;
  training_type: TrainingType;
  scheduled_date?: string;
  completion_date?: string;
  expiration_date?: string;
  hours_completed: number;
  credit_hours?: number;
  certification_number?: string;
  issuing_agency?: string;
  status?: TrainingStatus;
  score?: number;
  passing_score?: number;
  passed?: boolean;
  instructor?: string;
  location?: string;
  notes?: string;
  attachments?: string[];
}

export interface TrainingRecordUpdate {
  course_name?: string;
  course_code?: string;
  training_type?: TrainingType;
  scheduled_date?: string;
  completion_date?: string;
  expiration_date?: string;
  hours_completed?: number;
  credit_hours?: number;
  certification_number?: string;
  issuing_agency?: string;
  status?: TrainingStatus;
  score?: number;
  passing_score?: number;
  passed?: boolean;
  instructor?: string;
  location?: string;
  notes?: string;
  attachments?: string[];
}

export interface TrainingRequirement {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  training_type?: TrainingType;
  required_hours?: number;
  required_courses?: string[];
  frequency: RequirementFrequency;
  year?: number;
  applies_to_all: boolean;
  required_roles?: string[];
  start_date?: string;
  due_date?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingRequirementCreate {
  name: string;
  description?: string;
  training_type?: TrainingType;
  required_hours?: number;
  required_courses?: string[];
  frequency: RequirementFrequency;
  year?: number;
  applies_to_all?: boolean;
  required_roles?: string[];
  start_date?: string;
  due_date?: string;
}

export interface TrainingRequirementUpdate {
  name?: string;
  description?: string;
  training_type?: TrainingType;
  required_hours?: number;
  required_courses?: string[];
  frequency?: RequirementFrequency;
  year?: number;
  applies_to_all?: boolean;
  required_roles?: string[];
  start_date?: string;
  due_date?: string;
  active?: boolean;
}

export interface UserTrainingStats {
  user_id: string;
  total_hours: number;
  hours_this_year: number;
  total_certifications: number;
  active_certifications: number;
  expiring_soon: number;
  expired: number;
  completed_courses: number;
}

export interface TrainingHoursSummary {
  training_type: TrainingType;
  total_hours: number;
  record_count: number;
}

export interface TrainingReport {
  user_id?: string;
  start_date: string;
  end_date: string;
  total_hours: number;
  hours_by_type: TrainingHoursSummary[];
  records: TrainingRecord[];
  requirements_met: string[];
  requirements_pending: string[];
}

export interface RequirementProgress {
  requirement_id: string;
  requirement_name: string;
  required_hours?: number;
  completed_hours: number;
  percentage_complete: number;
  is_complete: boolean;
  due_date?: string;
}
