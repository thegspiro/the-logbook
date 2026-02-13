/**
 * Meeting Minutes Type Definitions
 */

export type MeetingType = 'business' | 'special' | 'committee' | 'board' | 'other';
export type MinutesStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type MotionStatus = 'passed' | 'failed' | 'tabled' | 'withdrawn';
export type ActionItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'overdue';
export type ActionItemPriority = 'low' | 'medium' | 'high' | 'urgent';

// ── Section Types ──

export interface SectionEntry {
  order: number;
  key: string;
  title: string;
  content: string;
}

export interface TemplateSectionEntry {
  order: number;
  key: string;
  title: string;
  default_content: string;
  required: boolean;
}

// ── Header / Footer Config ──

export interface HeaderConfig {
  org_name?: string;
  logo_url?: string;
  subtitle?: string;
  show_date?: boolean;
  show_meeting_type?: boolean;
}

export interface FooterConfig {
  left_text?: string;
  center_text?: string;
  right_text?: string;
  show_page_numbers?: boolean;
  confidentiality_notice?: string;
}

// ── Template Types ──

export interface MinutesTemplate {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  meeting_type: MeetingType;
  is_default: boolean;
  sections: TemplateSectionEntry[];
  header_config?: HeaderConfig;
  footer_config?: FooterConfig;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateListItem {
  id: string;
  name: string;
  meeting_type: MeetingType;
  is_default: boolean;
  section_count: number;
  created_at: string;
}

export interface TemplateCreate {
  name: string;
  description?: string;
  meeting_type: MeetingType;
  is_default?: boolean;
  sections: TemplateSectionEntry[];
  header_config?: HeaderConfig;
  footer_config?: FooterConfig;
}

export interface TemplateUpdate {
  name?: string;
  description?: string;
  meeting_type?: MeetingType;
  is_default?: boolean;
  sections?: TemplateSectionEntry[];
  header_config?: HeaderConfig;
  footer_config?: FooterConfig;
}

// ── Existing types (unchanged) ──

export interface AttendeeEntry {
  user_id?: string;
  name: string;
  role?: string;
  present: boolean;
}

export interface Motion {
  id: string;
  minutes_id: string;
  order: number;
  motion_text: string;
  moved_by?: string;
  seconded_by?: string;
  discussion_notes?: string;
  status: MotionStatus;
  votes_for?: number;
  votes_against?: number;
  votes_abstain?: number;
  created_at: string;
  updated_at: string;
}

export interface ActionItem {
  id: string;
  minutes_id: string;
  description: string;
  assignee_id?: string;
  assignee_name?: string;
  due_date?: string;
  priority: ActionItemPriority;
  status: ActionItemStatus;
  completed_at?: string;
  completion_notes?: string;
  created_at: string;
  updated_at: string;
}

export interface MeetingMinutes {
  id: string;
  organization_id: string;
  title: string;
  meeting_type: MeetingType;
  meeting_date: string;
  location?: string;
  called_by?: string;
  called_to_order_at?: string;
  adjourned_at?: string;
  attendees?: AttendeeEntry[];
  quorum_met?: boolean;
  quorum_count?: number;
  event_id?: string;
  template_id?: string;
  sections: SectionEntry[];
  header_config?: HeaderConfig;
  footer_config?: FooterConfig;
  published_document_id?: string;
  status: MinutesStatus;
  submitted_at?: string;
  submitted_by?: string;
  approved_at?: string;
  approved_by?: string;
  rejected_at?: string;
  rejected_by?: string;
  rejection_reason?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  motions: Motion[];
  action_items: ActionItem[];
}

export interface MinutesListItem {
  id: string;
  title: string;
  meeting_type: MeetingType;
  meeting_date: string;
  status: MinutesStatus;
  location?: string;
  called_by?: string;
  template_id?: string;
  motions_count: number;
  action_items_count: number;
  open_action_items: number;
  created_at: string;
}

export interface MinutesCreate {
  title: string;
  meeting_type: MeetingType;
  meeting_date: string;
  location?: string;
  called_by?: string;
  event_id?: string;
  template_id?: string;
  sections?: SectionEntry[];
  header_config?: HeaderConfig;
  footer_config?: FooterConfig;
  motions?: MotionCreate[];
  action_items?: ActionItemCreate[];
}

export interface MinutesUpdate {
  title?: string;
  meeting_type?: MeetingType;
  meeting_date?: string;
  location?: string;
  called_by?: string;
  event_id?: string;
  sections?: SectionEntry[];
  header_config?: HeaderConfig;
  footer_config?: FooterConfig;
}

export interface MotionCreate {
  motion_text: string;
  moved_by?: string;
  seconded_by?: string;
  discussion_notes?: string;
  status?: MotionStatus;
  votes_for?: number;
  votes_against?: number;
  votes_abstain?: number;
  order?: number;
}

export interface MotionUpdate {
  motion_text?: string;
  moved_by?: string;
  seconded_by?: string;
  discussion_notes?: string;
  status?: MotionStatus;
  votes_for?: number;
  votes_against?: number;
  votes_abstain?: number;
  order?: number;
}

export interface ActionItemCreate {
  description: string;
  assignee_id?: string;
  assignee_name?: string;
  due_date?: string;
  priority?: ActionItemPriority;
}

export interface ActionItemUpdate {
  description?: string;
  assignee_id?: string;
  assignee_name?: string;
  due_date?: string;
  priority?: ActionItemPriority;
  status?: ActionItemStatus;
  completion_notes?: string;
}

export interface MinutesStats {
  total: number;
  this_month: number;
  open_action_items: number;
  pending_approval: number;
}

export interface MinutesSearchResult {
  id: string;
  title: string;
  meeting_type: MeetingType;
  meeting_date: string;
  status: MinutesStatus;
  snippet: string;
  match_field: string;
}
