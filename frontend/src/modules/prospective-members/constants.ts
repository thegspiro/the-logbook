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
