import {
  FileText,
  Upload,
  Vote,
  CheckCircle,
  CalendarCheck,
  Globe,
  Mail,
  UserCheck,
  ClipboardList,
  MessageSquare,
  Users,
  Stethoscope,
} from 'lucide-react';
import type { StageType, ApplicantStatus } from './types';

export const STAGE_TYPE_ICONS: Record<StageType, React.ElementType> = {
  form_submission: FileText,
  document_upload: Upload,
  election_vote: Vote,
  manual_approval: CheckCircle,
  meeting: CalendarCheck,
  status_page_toggle: Globe,
  automated_email: Mail,
  reference_check: UserCheck,
  checklist: ClipboardList,
  interview_requirement: MessageSquare,
  multi_approval: Users,
  medical_screening: Stethoscope,
};

/**
 * Base Tailwind hue per stage type. Consumers compose full class strings
 * from this to avoid slight divergence across components.
 */
export const STAGE_TYPE_HUE: Record<StageType, string> = {
  form_submission: 'blue',
  document_upload: 'amber',
  election_vote: 'purple',
  manual_approval: 'emerald',
  meeting: 'teal',
  status_page_toggle: 'sky',
  automated_email: 'rose',
  reference_check: 'orange',
  checklist: 'cyan',
  interview_requirement: 'indigo',
  multi_approval: 'lime',
  medical_screening: 'pink',
};

/** Badge style: text + bg for stage type labels/pills. */
export const STAGE_TYPE_COLORS: Record<StageType, string> = {
  form_submission: 'text-blue-700 dark:text-blue-400 bg-blue-500/10',
  document_upload: 'text-amber-700 dark:text-amber-400 bg-amber-500/10',
  election_vote: 'text-purple-700 dark:text-purple-400 bg-purple-500/10',
  manual_approval: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10',
  meeting: 'text-teal-700 dark:text-teal-400 bg-teal-500/10',
  status_page_toggle: 'text-sky-700 dark:text-sky-400 bg-sky-500/10',
  automated_email: 'text-rose-700 dark:text-rose-400 bg-rose-500/10',
  reference_check: 'text-orange-700 dark:text-orange-400 bg-orange-500/10',
  checklist: 'text-cyan-700 dark:text-cyan-400 bg-cyan-500/10',
  interview_requirement: 'text-indigo-700 dark:text-indigo-400 bg-indigo-500/10',
  multi_approval: 'text-lime-700 dark:text-lime-400 bg-lime-500/10',
  medical_screening: 'text-pink-700 dark:text-pink-400 bg-pink-500/10',
};

/** Border-only accent color for kanban column headers. */
export const STAGE_HEADER_COLORS: Record<StageType, string> = {
  form_submission: 'border-blue-500',
  document_upload: 'border-amber-500',
  election_vote: 'border-purple-500',
  manual_approval: 'border-emerald-500',
  meeting: 'border-teal-500',
  status_page_toggle: 'border-sky-500',
  automated_email: 'border-rose-500',
  reference_check: 'border-orange-500',
  checklist: 'border-cyan-500',
  interview_requirement: 'border-indigo-500',
  multi_approval: 'border-lime-500',
  medical_screening: 'border-pink-500',
};

/** Stage type human-readable labels. */
export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  form_submission: 'Form Submission',
  document_upload: 'Document Upload',
  election_vote: 'Election / Vote',
  manual_approval: 'Manual Approval',
  meeting: 'Meeting',
  status_page_toggle: 'Enable Status Page',
  automated_email: 'Automated Email',
  reference_check: 'Reference Check',
  checklist: 'Checklist',
  interview_requirement: 'Interview Requirement',
  multi_approval: 'Multi-Signer Approval',
  medical_screening: 'Medical Screening',
};

export const APPLICANT_STATUS_COLORS: Record<ApplicantStatus, string> = {
  active: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
  on_hold: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
  withdrawn: 'bg-theme-surface-hover text-theme-text-muted',
  converted: 'bg-blue-500/20 text-blue-700 dark:text-blue-400',
  rejected: 'bg-red-500/20 text-red-700 dark:text-red-400',
  inactive: 'bg-theme-surface-hover text-theme-text-muted',
};

export const APPLICANT_STATUS_LABELS: Record<ApplicantStatus, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  withdrawn: 'Withdrawn',
  converted: 'Converted',
  rejected: 'Rejected',
  inactive: 'Inactive',
};
