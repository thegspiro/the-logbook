/**
 * Template List Component
 *
 * Displays all email templates grouped by type with selection.
 */

import React from 'react';
import {
  Mail,
  UserPlus,
  KeyRound,
  CalendarX,
  CalendarClock,
  GraduationCap,
  Vote,
  UserMinus,
  Package,
  FileText,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  ClipboardCheck,
  Clock,
  Undo2,
  AlertTriangle,
  RotateCcw,
  Trash2,
  Archive,
  CalendarCheck,
  Lock,
  BarChart3,
  ListChecks,
  Copy,
  CalendarRange,
  UserX,
  Bell,
} from 'lucide-react';
import type { EmailTemplate } from '../types';

/** Maps template_type to a display-friendly icon and label */
const TEMPLATE_TYPE_DISPLAY: Record<
  string,
  { icon: React.ElementType; label: string; color: string }
> = {
  welcome: { icon: UserPlus, label: 'Welcome Email', color: 'text-green-500' },
  password_reset: { icon: KeyRound, label: 'Password Reset', color: 'text-blue-500' },
  event_cancellation: { icon: CalendarX, label: 'Event Cancellation', color: 'text-red-500' },
  event_reminder: { icon: CalendarClock, label: 'Event Reminder', color: 'text-blue-700 dark:text-blue-400' },
  training_approval: { icon: GraduationCap, label: 'Training Approval', color: 'text-purple-500' },
  ballot_notification: { icon: Vote, label: 'Ballot Notification', color: 'text-indigo-500' },
  member_dropped: { icon: UserMinus, label: 'Member Dropped', color: 'text-red-600' },
  inventory_change: { icon: Package, label: 'Inventory Change', color: 'text-amber-500' },
  cert_expiration: { icon: ShieldAlert, label: 'Cert Expiration Alert', color: 'text-orange-500' },
  post_event_validation: { icon: ClipboardCheck, label: 'Post-Event Validation', color: 'text-teal-500' },
  post_shift_validation: { icon: Clock, label: 'Post-Shift Validation', color: 'text-violet-500' },
  property_return_reminder: { icon: Undo2, label: 'Property Return Reminder', color: 'text-rose-500' },
  inactivity_warning: { icon: AlertTriangle, label: 'Inactivity Warning', color: 'text-yellow-500' },
  election_rollback: { icon: RotateCcw, label: 'Election Rollback', color: 'text-orange-600' },
  election_deleted: { icon: Trash2, label: 'Election Deleted', color: 'text-red-500' },
  member_archived: { icon: Archive, label: 'Member Archived', color: 'text-theme-text-muted' },
  event_request_status: { icon: CalendarCheck, label: 'Event Request Status', color: 'text-cyan-500' },
  it_password_notification: { icon: Lock, label: 'IT Password Reset', color: 'text-blue-600' },
  election_report: { icon: BarChart3, label: 'Election Report', color: 'text-emerald-600' },
  ballot_eligibility_summary: { icon: ListChecks, label: 'Ballot Eligibility Summary', color: 'text-amber-600' },
  duplicate_application: { icon: Copy, label: 'Duplicate Application', color: 'text-slate-500' },
  series_end_reminder: { icon: CalendarRange, label: 'Series End Reminder', color: 'text-purple-400' },
  shift_assignment: { icon: CalendarCheck, label: 'Shift Assignment', color: 'text-green-600' },
  shift_decline: { icon: UserX, label: 'Shift Decline', color: 'text-red-400' },
  shift_reminder: { icon: Bell, label: 'Shift Reminder', color: 'text-sky-500' },
  custom: { icon: FileText, label: 'Custom', color: 'text-theme-text-muted' },
};

function getTemplateDisplay(type: string) {
  return (
    TEMPLATE_TYPE_DISPLAY[type] || {
      icon: Mail,
      label: type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      color: 'text-theme-text-muted',
    }
  );
}

interface TemplateListProps {
  templates: EmailTemplate[];
  selectedId: string | null;
  onSelect: (template: EmailTemplate) => void;
}

export const TemplateList: React.FC<TemplateListProps> = ({
  templates,
  selectedId,
  onSelect,
}) => {
  return (
    <div className="space-y-1">
      <h3 className="text-theme-text-muted text-xs font-semibold uppercase tracking-wider px-3 mb-2">
        Email Templates
      </h3>
      {templates.map((template) => {
        const display = getTemplateDisplay(template.template_type);
        const Icon = display.icon;
        const isSelected = template.id === selectedId;
        return (
          <button
            key={template.id}
            onClick={() => onSelect(template)}
            className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
              isSelected
                ? 'bg-orange-500/10 border border-orange-500/30'
                : 'hover:bg-theme-surface-hover border border-transparent'
            }`}
          >
            <Icon className={`w-5 h-5 shrink-0 ${display.color}`} />
            <div className="flex-1 min-w-0">
              <p
                className={`text-sm font-medium truncate ${
                  isSelected ? 'text-orange-600 dark:text-orange-400' : 'text-theme-text-primary'
                }`}
              >
                {template.name}
              </p>
              <p className="text-xs text-theme-text-muted truncate">{display.label}</p>
            </div>
            {template.is_active ? (
              <span title="Active" className="shrink-0">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              </span>
            ) : (
              <span title="Inactive" className="shrink-0">
                <XCircle className="w-4 h-4 text-theme-text-muted" />
              </span>
            )}
          </button>
        );
      })}
      {templates.length === 0 && (
        <p className="text-theme-text-muted text-sm text-center py-8">
          No templates found
        </p>
      )}
    </div>
  );
};
