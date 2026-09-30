import React from 'react';
import { Calendar, GraduationCap, Clock, Users, AlertTriangle, FileText, Wrench } from 'lucide-react';

export interface CategoryDisplay {
  icon: React.ReactNode;
  color: string;
  label: string;
}

const CATEGORY_DISPLAY: Record<string, CategoryDisplay> = {
  events: {
    icon: <Calendar className="h-4 w-4" />,
    color: 'text-blue-600 dark:text-blue-400',
    label: 'Event',
  },
  training: {
    icon: <GraduationCap className="h-4 w-4" />,
    color: 'text-purple-600 dark:text-purple-400',
    label: 'Training',
  },
  scheduling: {
    icon: <Clock className="h-4 w-4" />,
    color: 'text-violet-600 dark:text-violet-400',
    label: 'Scheduling',
  },
  members: {
    icon: <Users className="h-4 w-4" />,
    color: 'text-green-600 dark:text-green-400',
    label: 'Members',
  },
  maintenance: {
    icon: <AlertTriangle className="h-4 w-4" />,
    color: 'text-orange-600 dark:text-orange-400',
    label: 'Maintenance',
  },
  general: {
    icon: <FileText className="h-4 w-4" />,
    color: 'text-cyan-600 dark:text-cyan-400',
    label: 'General',
  },
};

// NotificationLog.category is free-form text written by whichever task raised the
// notification, so it carries far more values than CATEGORY_DISPLAY's six groups
// ("event_reminder", "shift_checkout_reminder", "series_end_reminder", …). Map the
// ones we ship onto a group so they get the right icon rather than a wrench.
const CATEGORY_ALIASES: Record<string, string> = {
  event_reminder: 'events',
  event_update: 'events',
  event_validation: 'events',
  attendance_request: 'events',
  attendance_request_update: 'events',
  series_end_reminder: 'events',
  shift_reminder: 'scheduling',
  shift_validation: 'scheduling',
  shift_summary: 'scheduling',
  shift_swap: 'scheduling',
  shift_assignment: 'scheduling',
  shift_confirmation: 'scheduling',
  shift_cancelled: 'scheduling',
  shift_decline: 'scheduling',
  shift_finalized: 'scheduling',
  shift_checkout_reminder: 'scheduling',
  shift_report_followup: 'scheduling',
  time_off: 'scheduling',
  equipment_check: 'maintenance',
  inventory: 'maintenance',
  action_items: 'general',
  minutes: 'general',
  meetings: 'general',
  suggestions: 'general',
  training_submission: 'training',
  training_submission_update: 'training',
};

export function getCategoryDisplay(category: string | undefined): CategoryDisplay {
  if (!category) {
    return { icon: <Wrench className="h-4 w-4" />, color: 'text-theme-text-muted', label: 'Notification' };
  }
  const known = CATEGORY_DISPLAY[category] ?? CATEGORY_DISPLAY[CATEGORY_ALIASES[category] ?? ''];
  if (known) return known;
  return {
    icon: <Wrench className="h-4 w-4" />,
    color: 'text-theme-text-muted',
    // Humanize rather than print the raw token: an unmapped category used to
    // reach the member as "Event_reminder", underscore and all.
    label: category
      .split('_')
      .filter(Boolean)
      .map((word) => (word[0] ?? '').toUpperCase() + word.slice(1))
      .join(' '),
  };
}
