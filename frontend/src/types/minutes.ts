/**
 * Meeting Minutes Type Definitions
 */

export type MeetingType = 'business' | 'special' | 'committee' | 'board' | 'other';
export type MinutesStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type MotionStatus = 'passed' | 'failed' | 'tabled' | 'withdrawn';
export type ActionItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'overdue';
export type ActionItemPriority = 'low' | 'medium' | 'high' | 'urgent';

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
  agenda?: string;
  old_business?: string;
  new_business?: string;
  treasurer_report?: string;
  chief_report?: string;
  committee_reports?: string;
  announcements?: string;
  notes?: string;
  event_id?: string;
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
  called_to_order_at?: string;
  adjourned_at?: string;
  attendees?: AttendeeEntry[];
  quorum_met?: boolean;
  quorum_count?: number;
  agenda?: string;
  old_business?: string;
  new_business?: string;
  treasurer_report?: string;
  chief_report?: string;
  committee_reports?: string;
  announcements?: string;
  notes?: string;
  event_id?: string;
  motions?: MotionCreate[];
  action_items?: ActionItemCreate[];
}

export interface MinutesUpdate {
  title?: string;
  meeting_type?: MeetingType;
  meeting_date?: string;
  location?: string;
  called_by?: string;
  called_to_order_at?: string;
  adjourned_at?: string;
  attendees?: AttendeeEntry[];
  quorum_met?: boolean;
  quorum_count?: number;
  agenda?: string;
  old_business?: string;
  new_business?: string;
  treasurer_report?: string;
  chief_report?: string;
  committee_reports?: string;
  announcements?: string;
  notes?: string;
  event_id?: string;
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
