/**
 * Template List Component
 *
 * Displays all email templates grouped into collapsible categories.
 * The catalogue has grown past three dozen entries, so a flat list forced
 * admins to scroll the whole thing to find one notice.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Mail,
  Search,
  ChevronDown,
  ChevronRight,
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

/**
 * Category definitions, in display order. Each template type belongs to
 * exactly one category; anything not listed here lands in "Other" so a newly
 * added template type is still reachable before this map is updated.
 */
const TEMPLATE_CATEGORIES: { id: string; label: string; types: string[] }[] = [
  {
    id: 'members',
    label: 'Members & Accounts',
    types: [
      'welcome',
      'password_reset',
      'it_password_notification',
      'member_dropped',
      'member_archived',
      'inactivity_warning',
      'duplicate_application',
    ],
  },
  {
    id: 'events',
    label: 'Events & Scheduling',
    types: [
      'event_reminder',
      'event_cancellation',
      'event_request_status',
      'series_end_reminder',
      'post_event_validation',
      'shift_assignment',
      'shift_decline',
      'shift_reminder',
      'post_shift_validation',
    ],
  },
  {
    id: 'training',
    label: 'Training & Certifications',
    types: ['training_approval', 'cert_expiration'],
  },
  {
    id: 'elections',
    label: 'Elections & Voting',
    types: [
      'ballot_notification',
      'ballot_eligibility_summary',
      'election_report',
      'election_rollback',
      'election_deleted',
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory & Property',
    types: ['inventory_change', 'property_return_reminder'],
  },
  {
    id: 'storefront',
    label: 'Department Store',
    types: [
      'storefront_order_confirmation',
      'storefront_new_order_admin',
      'storefront_order_update',
      'storefront_order_cancelled',
      'storefront_payment_reminder',
      'storefront_payment_received',
      'storefront_window_open',
      'storefront_window_closing',
      'storefront_window_closed',
      'storefront_vendor_order_placed',
    ],
  },
];

const OTHER_CATEGORY_ID = 'other';

const CATEGORY_BY_TYPE: Record<string, string> = Object.fromEntries(
  TEMPLATE_CATEGORIES.flatMap((c) => c.types.map((t) => [t, c.id]))
);

function categoryIdFor(templateType: string): string {
  return CATEGORY_BY_TYPE[templateType] ?? OTHER_CATEGORY_ID;
}

interface TemplateListProps {
  templates: EmailTemplate[];
  selectedId: string | null;
  onSelect: (template: EmailTemplate) => void;
}

export const TemplateList: React.FC<TemplateListProps> = ({ templates, selectedId, onSelect }) => {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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

  const groups = useMemo(() => {
    const byCategory = new Map<string, EmailTemplate[]>();
    for (const template of filtered) {
      const id = categoryIdFor(template.template_type);
      const bucket = byCategory.get(id) ?? [];
      bucket.push(template);
      byCategory.set(id, bucket);
    }
    const ordered = TEMPLATE_CATEGORIES.filter((c) => byCategory.has(c.id)).map((c) => ({
      id: c.id,
      label: c.label,
      templates: byCategory.get(c.id) ?? [],
    }));
    const other = byCategory.get(OTHER_CATEGORY_ID);
    if (other) {
      ordered.push({ id: OTHER_CATEGORY_ID, label: 'Other', templates: other });
    }
    return ordered;
  }, [filtered]);

  // Keep the selected template visible: selecting from search, or landing on
  // the page with a template already chosen, must not leave it hidden inside a
  // collapsed category.
  const selectedCategory = useMemo(() => {
    const selected = templates.find((t) => t.id === selectedId);
    return selected ? categoryIdFor(selected.template_type) : null;
  }, [templates, selectedId]);

  useEffect(() => {
    if (!selectedCategory) return;
    setCollapsed((prev) => (prev[selectedCategory] ? { ...prev, [selectedCategory]: false } : prev));
  }, [selectedCategory]);

  const isSearching = search.trim().length > 0;

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

      {groups.map((group) => {
        // An active search expands everything — a hit hidden behind a
        // collapsed header reads as "no results".
        const isOpen = isSearching || !collapsed[group.id];
        return (
          <div key={group.id} className="mb-1">
            <button
              type="button"
              onClick={() => setCollapsed((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
              aria-expanded={isOpen}
              className="text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-xs font-semibold tracking-wide uppercase transition-colors"
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="flex-1 truncate">{group.label}</span>
              <span className="text-theme-text-muted shrink-0 font-normal normal-case">{group.templates.length}</span>
            </button>

            {isOpen &&
              group.templates.map((template) => {
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
          </div>
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
