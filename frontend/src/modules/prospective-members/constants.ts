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
import type { StageType } from './types';

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
