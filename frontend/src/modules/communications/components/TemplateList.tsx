/**
 * Template List Component
 *
 * Displays all email templates grouped by type with selection.
 */

import React, { useState, useMemo } from 'react';
import {
  Mail,
  Search,
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
  ShoppingBag,
  Receipt,
  CircleDollarSign,
  Hourglass,
  DoorOpen,
  DoorClosed,
  Truck,
  Ban,
  Store,
} from 'lucide-react';
import type { EmailTemplate } from '../types';

/** Maps template_type to a display-friendly icon and label */
const TEMPLATE_TYPE_DISPLAY: Record<string, { icon: React.ElementType; label: string; color: string }> = {
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
  storefront_order_confirmation: { icon: ShoppingBag, label: 'Store — Order Confirmation', color: 'text-blue-500' },
  storefront_new_order_admin: { icon: Store, label: 'Store — New Order Alert', color: 'text-blue-600' },
  storefront_order_update: { icon: Truck, label: 'Store — Order Status Change', color: 'text-teal-500' },
  storefront_order_cancelled: { icon: Ban, label: 'Store — Order Cancelled', color: 'text-red-500' },
  storefront_payment_reminder: { icon: Hourglass, label: 'Store — Payment Reminder', color: 'text-amber-500' },
  storefront_payment_received: { icon: Receipt, label: 'Store — Payment Receipt', color: 'text-green-600' },
  storefront_window_open: { icon: DoorOpen, label: 'Store — Ordering Is Open', color: 'text-green-500' },
  storefront_window_closing: { icon: Hourglass, label: 'Store — Last Call', color: 'text-amber-600' },
  storefront_window_closed: { icon: DoorClosed, label: 'Store — Ordering Has Closed', color: 'text-slate-500' },
  storefront_vendor_order_placed: {
    icon: CircleDollarSign,
    label: 'Store — Order Placed With Vendor',
    color: 'text-purple-500',
  },
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

export const TemplateList: React.FC<TemplateListProps> = ({ templates, selectedId, onSelect }) => {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return templates;
    const q = search.toLowerCase();
    return templates.filter((t) => {
      const display = getTemplateDisplay(t.template_type);
      return (
        display.label.toLowerCase().includes(q) ||
        t.template_type.toLowerCase().includes(q) ||
        (t.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [templates, search]);

  return (
    <div className="space-y-1">
      <h3 className="text-theme-text-muted mb-2 px-3 text-xs font-semibold tracking-wider uppercase">
        Email Templates
      </h3>
      {templates.length > 8 && (
        <div className="relative mb-2 px-3">
          <Search className="text-theme-text-muted absolute top-1/2 left-5 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter templates..."
            className="border-theme-surface-border bg-theme-surface text-theme-text-primary focus:border-theme-focus-ring w-full rounded-md border py-1.5 pr-2 pl-7 text-xs focus:outline-hidden"
          />
        </div>
      )}
      {filtered.map((template) => {
        const display = getTemplateDisplay(template.template_type);
        const Icon = display.icon;
        const isSelected = template.id === selectedId;
        return (
          <button
            key={template.id}
            onClick={() => onSelect(template)}
            className={`flex w-full items-center space-x-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
              isSelected
                ? 'border border-orange-500/30 bg-orange-500/10'
                : 'hover:bg-theme-surface-hover border border-transparent'
            }`}
          >
            <Icon className={`h-5 w-5 shrink-0 ${display.color}`} />
            <div className="min-w-0 flex-1">
              <p
                className={`truncate text-sm font-medium ${
                  isSelected ? 'text-orange-600 dark:text-orange-400' : 'text-theme-text-primary'
                }`}
              >
                {template.name}
              </p>
              <p className="text-theme-text-muted truncate text-xs">{display.label}</p>
            </div>
            {template.is_active ? (
              <span title="Active" className="shrink-0">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </span>
            ) : (
              <span title="Inactive" className="shrink-0">
                <XCircle className="text-theme-text-muted h-4 w-4" />
              </span>
            )}
          </button>
        );
      })}
      {filtered.length === 0 && (
        <p className="text-theme-text-muted py-8 text-center text-sm">
          {search ? 'No matching templates' : 'No templates found'}
        </p>
      )}
    </div>
  );
};
