import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DialogPanel } from '../components/ux/DialogPanel';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Bell,
  Inbox,
  Mail,
  Zap,
  Plus,
  Search,
  ToggleLeft,
  ToggleRight,
  Clock,
  Calendar,
  GraduationCap,
  AlertTriangle,
  Users,
  X,
  AlertCircle,
  CheckCircle,
  Loader2,
  FileText,
  Wrench,
  CheckCheck,
} from 'lucide-react';
import { Breadcrumbs, SkeletonPage } from '../components/ux';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, formatTime } from '../utils/dateFormatting';
import { notificationsService } from '../services/api';
import type { NotificationRuleRecord, NotificationLogRecord, NotificationsSummary } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { useNotificationCountStore } from '../hooks/useNotificationCount';
import { NotificationLogScope } from '../constants/enums';
import NotificationCard from '../components/NotificationCard';

// Maps trigger enum values to display-friendly icons and colors
const TRIGGER_DISPLAY: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  event_reminder: {
    icon: <Calendar className="h-5 w-5" />,
    color: 'text-blue-700 dark:text-blue-400',
    label: 'Event Reminder',
  },
  training_expiry: {
    icon: <GraduationCap className="h-5 w-5" />,
    color: 'text-purple-700 dark:text-purple-400',
    label: 'Training Expiry',
  },
  schedule_change: {
    icon: <Clock className="h-5 w-5" />,
    color: 'text-violet-700 dark:text-violet-400',
    label: 'Schedule Change',
  },
  new_member: {
    icon: <Users className="h-5 w-5" />,
    color: 'text-green-700 dark:text-green-400',
    label: 'Member Added',
  },
  maintenance_due: {
    icon: <AlertTriangle className="h-5 w-5" />,
    color: 'text-orange-700 dark:text-orange-400',
    label: 'Maintenance Due',
  },
  form_submitted: {
    icon: <FileText className="h-5 w-5" />,
    color: 'text-cyan-700 dark:text-cyan-400',
    label: 'Form Submitted',
  },
};

// Dropdown options for the create modal.
//
// Only triggers a sender actually consults are offered. The list used to
// include schedule_change, new_member, maintenance_due and form_submitted,
// none of which had a sender reading the rules table — creating one produced
// a switch that looked live and did nothing. The backend is the authority
// (ENFORCED_TRIGGERS in models/notification.py) and reports `enforced` on
// every rule, so rules already created for those triggers are still listed,
// labelled for what they are.
const TRIGGER_OPTIONS = [
  { label: 'Event Reminder', value: 'event_reminder', effect: 'Sends reminders before scheduled events.' },
  {
    label: 'Training Expiry',
    value: 'training_expiry',
    effect: 'Sends certification expiration alerts, when the training module has them switched on.',
  },
];

// Category mapping from trigger to category
const TRIGGER_CATEGORY_MAP: Record<string, string> = {
  event_reminder: 'events',
  training_expiry: 'training',
  schedule_change: 'scheduling',
  new_member: 'members',
  maintenance_due: 'maintenance',
  form_submitted: 'general',
};

function getTriggerDisplay(trigger: string) {
  return (
    TRIGGER_DISPLAY[trigger] || {
      icon: <Wrench className="h-5 w-5" />,
      color: 'text-theme-text-muted',
      label: trigger,
    }
  );
}

function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

const INBOX_PAGE_SIZE = 20;
// The send log is one row per delivery, so a long-serving member's history
// runs well past a single page. The backend's own default is 100; naming it
// here keeps the request explicit about what was asked for.
const LOG_PAGE_SIZE = 50;

const NotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('notifications.manage');
  const canView = checkPermission('notifications.view');
  // The Email Templates tab is a signpost, not a screen: its only control
  // navigates to /communications/email-templates, which is behind
  // `settings.manage`. Gating the tab on `notifications.view` sent anyone
  // holding view alone to an Access Denied page via a button that promised
  // otherwise, so it is gated on the permission its destination actually
  // requires.
  const canManageTemplates = checkPermission('settings.manage');
  const tz = useTimezone();

  // Shared notification count store
  const myUnreadCount = useNotificationCountStore((s) => s.unreadCount);
  const decrementGlobalUnread = useNotificationCountStore((s) => s.decrement);
  const clearGlobalUnread = useNotificationCountStore((s) => s.clear);

  // Data states
  const [rules, setRules] = useState<NotificationRuleRecord[]>([]);
  const [logs, setLogs] = useState<NotificationLogRecord[]>([]);
  const [summary, setSummary] = useState<NotificationsSummary | null>(null);
  const [myNotifications, setMyNotifications] = useState<NotificationLogRecord[]>([]);
  const [inboxNextCursor, setInboxNextCursor] = useState<string | null>(null);
  const markingReadIds = useRef(new Set<string>());
  // Only the newest send-log request may commit its result. A channel change
  // or a mark-all can leave an earlier fetch in flight, and letting it land
  // put the previous channel's rows under the new pill, or pre-write read
  // state back over rows the server had already marked.
  const logsRequestRef = useRef(0);
  // The channel a fetch should ask for, resolved when the request is made
  // rather than when its caller was rendered.
  const logChannelFilterRef = useRef<'all' | 'email' | 'in_app'>('all');

  // UI states
  const [loading, setLoading] = useState(true);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingMoreLogs, setLoadingMoreLogs] = useState(false);
  // The cursor for the page after the ones loaded, or null at the end of the
  // list. This is what the Load more control answers to: comparing loaded rows
  // against `total` disagrees with the server the moment a notification
  // arrives mid-paging, which is the case the cursor exists to handle.
  //
  // It is also why the button reads "Load more" with no count. `total` counts
  // the whole filtered list, including rows *ahead* of the cursor that a
  // continuation can never return, so `total - loaded` overstates the tail by
  // however many notifications arrived since paging began — and it overstates
  // it precisely during a fan-out, when the member is most likely to be
  // paging. No count the client can compute is correct here; the honest tail
  // length is a second keyset count on the server, which is not worth a query
  // per page for a number on a button.
  const [logsNextCursor, setLogsNextCursor] = useState<string | null>(null);
  // Kept apart from the page-wide `error`, which renders above every tab: the
  // send log is prefetched on mount for a tab the member may never open, and
  // its failure must not caption a working inbox with "Failed to load your
  // send log".
  const [logsError, setLogsError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showRead, setShowRead] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  // All four tabs are addressable, not just the inbox. `?tab=log` used to
  // fall through to the rules tab, so a link to the Send Log — the one tab
  // anyone has cause to send somebody — opened the wrong screen.
  //
  // Derived from the URL rather than mirrored into state _(2026-08-11)_. The
  // first fix read the parameter once, on mount, which left every later URL
  // change ignored — the Back button being the one that matters: click Send Log
  // then Rules, press Back, and the address bar says `?tab=log` while the page
  // still renders Rules. Deriving removes the state that could fall out of step
  // at all.
  //
  // Each tab carries its own gate rather than sharing one: Email Templates
  // answers to `settings.manage`, Rules to `notifications.view`, and the Send
  // Log to nothing beyond being signed in. A tab nobody can open must not be
  // restorable from the URL either — the deep link is the same door as the
  // button.
  //
  // The Send Log is ungated because it is no longer an org-wide view
  // _(2026-09-04)_: `GET /notifications/logs` defaults to `scope=mine`, so
  // the tab shows the caller their own delivery history — email as well as
  // in-app, with delivered/failed status — which is their own data on the
  // same footing as the inbox. The organization-wide view still exists behind
  // `scope=organization` + `notifications.manage`, for auditing deliverability.
  const requestedTab = searchParams.get('tab');
  const tabIsAvailable: Record<'inbox' | 'rules' | 'templates' | 'log', boolean> = {
    inbox: true,
    rules: canView,
    templates: canManageTemplates,
    log: true,
  };
  // The buttons below render off this same map rather than repeating the
  // permission expressions, so the button and the deep link cannot disagree
  // about a tab — which is how the Send Log came to be restorable from the URL
  // for a member before its button was.
  const isTabName = (value: string | null): value is keyof typeof tabIsAvailable =>
    value === 'inbox' || value === 'rules' || value === 'templates' || value === 'log';
  const activeTab: 'inbox' | 'rules' | 'templates' | 'log' =
    isTabName(requestedTab) && tabIsAvailable[requestedTab] ? requestedTab : canView ? 'rules' : 'inbox';
  const [logChannelFilter, setLogChannelFilter] = useState<'all' | 'email' | 'in_app'>('all');

  // Create form states
  const [createName, setCreateName] = useState('');
  const [createTrigger, setCreateTrigger] = useState('event_reminder');
  const [createDescription, setCreateDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Fetch user inbox on mount and when showRead filter changes
  useEffect(() => {
    const fetchInbox = async () => {
      setLoadingInbox(true);
      try {
        const data = await notificationsService.getMyNotifications({
          include_read: showRead,
          limit: INBOX_PAGE_SIZE,
        });
        setMyNotifications(data.logs || []);
        setInboxNextCursor(data.next_cursor ?? null);
      } catch {
        // Inbox is always available to authenticated users
      } finally {
        setLoadingInbox(false);
      }
    };
    void fetchInbox();
  }, [showRead]);

  // Fetch the send log on mount. Scoped to the caller, so it needs no
  // permission — but kept separate from the rules/summary fetch below, which
  // does, so a member's log is not lost to a 403 on a request they never
  // needed to make.
  //
  // The channel filter is a query parameter, not a client-side pass over the
  // loaded prefix. Filtering what happened to be fetched made the panel state
  // "No email notifications sent to you" whenever the newest page held none,
  // however many older ones the member had.
  const loadLogPage = useCallback(async ({ append, cursor }: { append: boolean; cursor?: string }) => {
    // Read from the ref, not a closure. A write handler awaits its POST and
    // only then reloads; closing over the filter meant a channel changed
    // during that POST reloaded the *previous* channel — and, since the
    // reload is newer, that stale answer won.
    const channel = logChannelFilterRef.current;
    const requestId = ++logsRequestRef.current;
    if (append) setLoadingMoreLogs(true);
    else setLoadingLogs(true);
    setLogsError(null);
    try {
      const data = await notificationsService.getLogs({
        scope: NotificationLogScope.MINE,
        ...(channel === 'all' ? {} : { channel }),
        ...(cursor ? { cursor } : {}),
        limit: LOG_PAGE_SIZE,
      });
      if (requestId !== logsRequestRef.current) return;
      const page = data.logs || [];
      // Appended without deduplication: a keyset page starts strictly after
      // the previous page's last row, so it cannot re-serve one. Under the
      // offset paging this replaced, it could.
      setLogs((prev) => (append ? [...prev, ...page] : page));
      setLogsNextCursor(data.next_cursor ?? null);
    } catch (err: unknown) {
      if (requestId !== logsRequestRef.current) return;
      setLogsError(
        getErrorMessage(err, append ? 'Failed to load more of your send log' : 'Failed to load your send log')
      );
      // A failed fetch for a newly selected channel must not leave the
      // previous channel's rows sitting under the new pill, nor its length
      // feeding that channel's pagination.
      if (!append) {
        setLogs([]);
        setLogsNextCursor(null);
      }
    } finally {
      // The newest request clears *both* flags, not just the one it set. A
      // superseded request must not clear anything (its winner is still
      // running), which left a Load more that lost to a channel change
      // stuck behind a spinner it could no longer switch off.
      if (requestId === logsRequestRef.current) {
        setLoadingLogs(false);
        setLoadingMoreLogs(false);
      }
    }
  }, []);

  useEffect(() => {
    logChannelFilterRef.current = logChannelFilter;
    void loadLogPage({ append: false });
  }, [logChannelFilter, loadLogPage]);

  // Fetch admin data on mount (only if user has permission)
  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [rulesRes, summaryRes] = await Promise.all([
          notificationsService.getRules(),
          notificationsService.getSummary(),
        ]);
        setRules(rulesRes.rules);
        setSummary(summaryRes);
      } catch (err: unknown) {
        const message = getErrorMessage(err, 'Failed to load notification data');
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [canView]);

  const toggleRule = async (ruleId: string, currentEnabled: boolean) => {
    setTogglingRuleId(ruleId);
    try {
      const updated = await notificationsService.toggleRule(ruleId, !currentEnabled);
      setRules((prev) => prev.map((r) => (r.id === ruleId ? updated : r)));
      // Update summary counts
      setSummary((prev) => {
        if (!prev) return prev;
        const delta = currentEnabled ? -1 : 1;
        return {
          ...prev,
          active_rules: prev.active_rules + delta,
        };
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to toggle rule');
      setError(message);
    } finally {
      setTogglingRuleId(null);
    }
  };

  const handleCreateRule = async () => {
    if (!createName.trim()) {
      setCreateError('Rule name is required.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const category = TRIGGER_CATEGORY_MAP[createTrigger] || 'general';
      const newRule = await notificationsService.createRule({
        name: createName.trim(),
        trigger: createTrigger,
        ...(createDescription.trim() ? { description: createDescription.trim() } : {}),
        category,
        channel: 'in_app',
      });
      setRules((prev) => [...prev, newRule]);
      // Update summary
      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          total_rules: prev.total_rules + 1,
          active_rules: newRule.enabled ? prev.active_rules + 1 : prev.active_rules,
        };
      });
      // Reset form and close modal
      setCreateName('');
      setCreateTrigger('event_reminder');
      setCreateDescription('');
      setShowCreateModal(false);
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to create rule');
      setCreateError(message);
    } finally {
      setCreating(false);
    }
  };

  const filteredRules = rules.filter(
    (r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Batch management: mark all as read (#76)
  // Clears the caller's own logs across every channel, which is exactly the
  // set the Send Log tab lists. That set includes their in-app notifications,
  // so the inbox and the global unread badge are reconciled here too — leaving
  // them alone showed the same notification read on one tab and unread on the
  // next.
  /**
   * Reconcile the inbox tab after every one of the caller's notifications has
   * been marked read.
   *
   * The inbox is a *filtered* list, so "mark them all read" is not a
   * field update — under `showRead === false` the rows stop belonging to it.
   * Mapping them to `read: true` in place left the unread-only view showing
   * read notifications, and the cursor still pointed into that same filtered
   * set, so the Load more control went on offering rows that were no longer
   * in it.
   *
   * With `showRead` on, the list is unfiltered: the map is right and the
   * cursor still names a row the list contains.
   */
  const reconcileInboxAllRead = () => {
    if (showRead) {
      setMyNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } else {
      setMyNotifications([]);
      setInboxNextCursor(null);
    }
    clearGlobalUnread();
  };

  const handleLoadMoreLogs = async () => {
    if (!logsNextCursor) return;
    await loadLogPage({ append: true, cursor: logsNextCursor });
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsService.markAllLogsRead({ scope: NotificationLogScope.MINE });
      reconcileInboxAllRead();
      // Re-read rather than patching the cached rows. Inferring which of them
      // the write covered meant guessing at a snapshot from the client's
      // request timing, which cannot tell a row the write marked from one
      // created after it — and would have shown that new notification as
      // already read.
      await loadLogPage({ append: false });
    } catch {
      setError('Failed to mark all as read');
    }
  };

  const handleMarkInboxNotificationRead = async (logId: string) => {
    if (markingReadIds.current.has(logId)) return;
    const notification = myNotifications.find((item) => item.id === logId);
    if (!notification || notification.read) return;
    markingReadIds.current.add(logId);
    try {
      await notificationsService.markMyNotificationRead(logId);
      setMyNotifications((prev) => prev.map((n) => (n.id === logId ? { ...n, read: true } : n)));
      decrementGlobalUnread();
    } catch {
      setError('Failed to mark notification as read');
    } finally {
      markingReadIds.current.delete(logId);
    }
  };

  const handleMarkAllInboxRead = async () => {
    try {
      await notificationsService.markAllMyNotificationsRead();
      reconcileInboxAllRead();
      await loadLogPage({ append: false });
    } catch {
      setError('Failed to mark all as read');
    }
  };

  const handleTogglePin = async (logId: string, pinned: boolean) => {
    try {
      await notificationsService.toggleMyNotificationPin(logId, pinned);
      setMyNotifications((prev) => prev.map((n) => (n.id === logId ? { ...n, pinned } : n)));
    } catch {
      setError('Failed to update pin state');
    }
  };

  const handleLoadMore = async () => {
    if (!inboxNextCursor) return;
    setLoadingMore(true);
    try {
      const data = await notificationsService.getMyNotifications({
        include_read: showRead,
        cursor: inboxNextCursor,
        limit: INBOX_PAGE_SIZE,
      });
      // No deduplication needed: a keyset page starts strictly after the last
      // row of the previous one, so it cannot re-serve a row already held.
      setMyNotifications((prev) => [...prev, ...(data.logs || [])]);
      setInboxNextCursor(data.next_cursor ?? null);
    } catch {
      setError('Failed to load more notifications');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleTabChange = (tab: typeof activeTab) => {
    setSearchParams({ tab });
  };

  if (loading && loadingInbox && loadingLogs) {
    return (
      <div className="min-h-screen">
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <Breadcrumbs />
          <SkeletonPage rows={6} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <Breadcrumbs />

        {/* Page Header */}
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center space-x-3">
            <div className="shrink-0 rounded-lg bg-orange-600 p-2">
              <Bell className="h-6 w-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-2xl font-bold">Notifications</h1>
              <p className="text-theme-text-muted text-sm">
                {activeTab === 'inbox'
                  ? 'View and manage your notifications'
                  : activeTab === 'log'
                    ? 'Every notification sent to you, across all channels, with delivery status'
                    : 'Manage automated notification rules and email templates'}
              </p>
            </div>
          </div>
          {canManage && activeTab !== 'inbox' && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center space-x-2 rounded-lg bg-orange-600 px-4 py-2 text-white transition-colors hover:bg-orange-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add Rule</span>
            </button>
          )}
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 flex items-start space-x-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
            <div className="flex-1">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Stats — organization-wide counts, so only on the organization-wide
        tab. The Send Log below is scoped to the caller, and these numbers
        sitting above it read as a tally of it. */}
        {canView && activeTab === 'rules' && (
          <div
            className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3"
            role="region"
            aria-label="Notification statistics"
          >
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Notification Rules</p>
              <p className="text-theme-text-primary mt-1 text-2xl font-bold">{summary?.total_rules ?? rules.length}</p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Active Rules</p>
              <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-400">
                {summary?.active_rules ?? rules.filter((r) => r.enabled).length}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Sent This Month</p>
              <p className="mt-1 text-2xl font-bold text-orange-700 dark:text-orange-400">
                {(summary?.emails_sent_this_month ?? 0) + (summary?.notifications_sent_this_month ?? 0)}
              </p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div
          className="bg-theme-surface-secondary hscroll mb-6 flex max-w-full space-x-1 rounded-lg p-1"
          role="tablist"
          aria-label="Notification views"
        >
          <button
            onClick={() => handleTabChange('inbox')}
            role="tab"
            aria-selected={activeTab === 'inbox'}
            className={`flex items-center space-x-2 rounded-md px-4 py-2 text-sm font-medium transition-colors max-md:min-h-[44px] ${
              activeTab === 'inbox' ? 'bg-orange-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <span>My Notifications</span>
            {myUnreadCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs ${
                  activeTab === 'inbox' ? 'bg-white/20 text-white' : 'bg-red-500 text-white'
                }`}
              >
                {myUnreadCount}
              </span>
            )}
          </button>
          {tabIsAvailable.rules && (
            <button
              onClick={() => handleTabChange('rules')}
              role="tab"
              aria-selected={activeTab === 'rules'}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors max-md:min-h-[44px] ${
                activeTab === 'rules'
                  ? 'bg-orange-600 text-white'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              Notification Rules
            </button>
          )}
          {tabIsAvailable.templates && (
            <button
              onClick={() => handleTabChange('templates')}
              role="tab"
              aria-selected={activeTab === 'templates'}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors max-md:min-h-[44px] ${
                activeTab === 'templates'
                  ? 'bg-orange-600 text-white'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              Email Templates
            </button>
          )}
          {tabIsAvailable.log && (
            <button
              onClick={() => handleTabChange('log')}
              role="tab"
              aria-selected={activeTab === 'log'}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors max-md:min-h-[44px] ${
                activeTab === 'log' ? 'bg-orange-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              Send Log
            </button>
          )}
        </div>

        {activeTab === 'inbox' && (
          <div role="tabpanel">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <p className="text-theme-text-muted text-sm">
                  {myUnreadCount > 0 ? `${myUnreadCount} unread` : 'All caught up'}
                </p>
                <label className="text-theme-text-muted flex cursor-pointer items-center gap-1.5 text-xs select-none max-md:min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={showRead}
                    onChange={(e) => setShowRead(e.target.checked)}
                    className="border-theme-surface-border rounded"
                  />
                  Show read
                </label>
              </div>
              {myUnreadCount > 0 && (
                <button
                  onClick={() => {
                    void handleMarkAllInboxRead();
                  }}
                  className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border hover:bg-theme-surface-hover inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors max-md:min-h-[44px]"
                >
                  <CheckCheck className="h-4 w-4" />
                  Mark all as read
                </button>
              )}
            </div>
            {loadingInbox ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-theme-surface-hover h-16 animate-pulse rounded-lg" />
                ))}
              </div>
            ) : myNotifications.length === 0 ? (
              <div className="card p-12 text-center">
                <Inbox className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
                <h3 className="text-theme-text-primary mb-2 text-xl font-bold">
                  {showRead ? 'No Notifications' : 'No Unread Notifications'}
                </h3>
                <p className="text-theme-text-secondary">
                  {showRead
                    ? "You're all caught up. New notifications will appear here."
                    : 'All notifications have been read.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {[...myNotifications]
                  .sort((a, b) => {
                    if (a.pinned && !b.pinned) return -1;
                    if (!a.pinned && b.pinned) return 1;
                    return 0;
                  })
                  .map((notification) => (
                    <NotificationCard
                      key={notification.id}
                      notification={notification}
                      onMarkRead={handleMarkInboxNotificationRead}
                      onTogglePin={(id, pinned) => {
                        void handleTogglePin(id, pinned);
                      }}
                    />
                  ))}
                {inboxNextCursor !== null && (
                  <div className="pt-2 text-center">
                    <button
                      onClick={() => {
                        void handleLoadMore();
                      }}
                      disabled={loadingMore}
                      className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border hover:bg-theme-surface-hover inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors disabled:opacity-50"
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        'Load more'
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'rules' && (
          <div role="tabpanel">
            {/* Search */}
            <div className="card mb-6 p-4">
              <div className="relative max-w-md">
                <Search
                  className="text-theme-text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform"
                  aria-hidden="true"
                />
                <label htmlFor="notif-search" className="sr-only">
                  Search notification rules
                </label>
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  id="notif-search"
                  type="text"
                  aria-label="Search notification rules..."
                  placeholder="Search notification rules..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="form-input placeholder-theme-text-muted pr-4 pl-10"
                />
              </div>
            </div>

            {/* Rules List */}
            <div className="space-y-3">
              {filteredRules.length === 0 && (
                <div className="card p-12 text-center">
                  <Bell className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
                  <h3 className="text-theme-text-primary mb-2 text-xl font-bold">No Notification Rules</h3>
                  <p className="text-theme-text-secondary mb-6">
                    {searchQuery
                      ? 'No rules match your search query.'
                      : 'Create your first notification rule to start sending automated notifications.'}
                  </p>
                  {canManage && !searchQuery && (
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="inline-flex items-center space-x-2 rounded-lg bg-orange-600 px-4 py-2 text-white transition-colors hover:bg-orange-700"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Create Rule</span>
                    </button>
                  )}
                </div>
              )}
              {filteredRules.map((rule) => {
                const display = getTriggerDisplay(rule.trigger);
                return (
                  <div key={rule.id} className="stat-card">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className={`bg-theme-surface-secondary rounded-lg p-2 ${display.color}`}>
                          {display.icon}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="text-theme-text-primary font-semibold">{rule.name}</h3>
                            <span className="bg-theme-surface-secondary text-theme-text-muted rounded-sm px-2 py-0.5 text-xs">
                              {formatCategory(rule.category)}
                            </span>
                          </div>
                          <p className="text-theme-text-secondary mt-0.5 text-sm">
                            {rule.description || 'No description'}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="flex items-center space-x-1">
                              <Zap className="text-theme-text-muted h-3 w-3" />
                              <span className="text-theme-text-muted text-xs">{display.label}</span>
                            </span>
                            {/* A rule for a trigger nothing reads. Saying so
                              beats the Active badge below implying it works. */}
                            {!rule.enforced && (
                              <span
                                className="rounded-sm bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400"
                                title="No notification is wired to this trigger yet, so this rule has no effect."
                              >
                                Not enforced
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        {rule.enabled ? (
                          <span className="flex items-center space-x-1 text-sm text-green-700 dark:text-green-400">
                            <CheckCircle className="h-4 w-4" />
                            <span>Active</span>
                          </span>
                        ) : (
                          <span className="text-theme-text-muted text-sm">Disabled</span>
                        )}
                        {canManage && (
                          <button
                            onClick={() => {
                              void toggleRule(rule.id, rule.enabled);
                            }}
                            disabled={togglingRuleId === rule.id}
                            className="text-theme-text-muted hover:text-theme-text-primary transition-colors disabled:opacity-50"
                          >
                            {togglingRuleId === rule.id ? (
                              <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
                            ) : rule.enabled ? (
                              <ToggleRight className="h-8 w-8 text-green-700 dark:text-green-400" />
                            ) : (
                              <ToggleLeft className="text-theme-text-muted h-8 w-8" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'templates' && (
          <div className="card p-12 text-center" role="tabpanel">
            <Mail className="text-theme-text-muted mx-auto mb-4 h-16 w-16" aria-hidden="true" />
            <h3 className="text-theme-text-primary mb-2 text-xl font-bold">Email Templates</h3>
            <p className="text-theme-text-secondary mb-6">
              Customize email templates for different notification types. Templates support dynamic placeholders for
              personalization.
            </p>
            <button
              onClick={() => void navigate('/communications/email-templates')}
              className="inline-flex items-center space-x-2 rounded-lg bg-orange-600 px-4 py-2 text-white transition-colors hover:bg-orange-700"
            >
              <Mail className="h-4 w-4" />
              <span>Manage Email Templates</span>
            </button>
          </div>
        )}

        {/* `logs` is server-filtered by channel, so it is the whole set for the
        selected channel rather than a pass over whatever page is loaded. */}
        {activeTab === 'log' && (
          <div role="tabpanel">
            {logsError && (
              <div className="mb-4 flex items-start space-x-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
                <p className="flex-1 text-sm text-red-700 dark:text-red-300">{logsError}</p>
              </div>
            )}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="bg-theme-surface-secondary flex items-center space-x-1 rounded-lg p-1">
                {(
                  [
                    ['all', 'All'],
                    ['email', 'Email'],
                    ['in_app', 'In-App'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setLogChannelFilter(value)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      logChannelFilter === value
                        ? 'bg-orange-600 text-white'
                        : 'text-theme-text-muted hover:text-theme-text-primary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {logs.some((l) => !l.read) && (
                <button
                  onClick={() => {
                    void handleMarkAllRead();
                  }}
                  className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border hover:bg-theme-surface-hover inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors max-md:min-h-[44px]"
                >
                  <CheckCheck className="h-4 w-4" />
                  Mark all as read
                </button>
              )}
            </div>
            {/* The page-level skeleton cannot cover this tab: for a member
                without notifications.view the permission effect sets `loading`
                false synchronously, so the page renders while the log request
                is still in flight and "No Notifications Found" claims an empty
                log before one has been fetched. The inbox tab carries its own
                flag for the same reason. */}
            {loadingLogs ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-theme-surface-hover h-16 animate-pulse rounded-lg" />
                ))}
              </div>
            ) : logs.length === 0 ? (
              <div className="card p-12 text-center">
                <Clock className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
                <h3 className="text-theme-text-primary mb-2 text-xl font-bold">No Notifications Found</h3>
                <p className="text-theme-text-secondary mb-6">
                  {logChannelFilter === 'all'
                    ? 'Your send log will show every notification sent to you, with delivery status and timestamps.'
                    : `No ${logChannelFilter === 'email' ? 'email' : 'in-app'} notifications sent to you.`}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="card overflow-hidden">
                  {/* Table Header — hidden on mobile, where each row stacks
                      into a card and the column headings would be meaningless */}
                  <div className="border-theme-surface-border text-theme-text-muted hidden grid-cols-12 gap-4 border-b px-5 py-3 text-xs font-medium uppercase md:grid">
                    <div className="col-span-4">Subject</div>
                    <div className="col-span-3">Recipient</div>
                    <div className="col-span-2">Channel</div>
                    <div className="col-span-2">Sent At</div>
                    <div className="col-span-1">Status</div>
                  </div>
                  {/* Table Rows */}
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="border-theme-surface-border hover:bg-theme-surface-hover grid grid-cols-1 gap-1 border-b px-5 py-4 transition-colors last:border-b-0 md:grid-cols-12 md:gap-4"
                    >
                      <div className="md:col-span-4">
                        <p className="text-theme-text-primary truncate text-sm">{log.subject || '(No subject)'}</p>
                        {log.rule_name && (
                          <p className="text-theme-text-muted mt-0.5 truncate text-xs">Rule: {log.rule_name}</p>
                        )}
                      </div>
                      <div className="md:col-span-3">
                        <p className="text-theme-text-secondary truncate text-sm">
                          {log.recipient_name || log.recipient_email || 'Unknown'}
                        </p>
                        {log.recipient_name && log.recipient_email && (
                          <p className="text-theme-text-muted mt-0.5 truncate text-xs">{log.recipient_email}</p>
                        )}
                      </div>
                      <div className="md:col-span-2">
                        <span className="bg-theme-surface-secondary text-theme-text-muted inline-flex items-center rounded-sm px-2 py-0.5 text-xs">
                          {log.channel === 'in_app' ? 'In-App' : log.channel === 'email' ? 'Email' : log.channel}
                        </span>
                      </div>
                      <div className="md:col-span-2">
                        <p className="text-theme-text-secondary text-sm">{formatDate(log.sent_at, tz)}</p>
                        <p className="text-theme-text-muted mt-0.5 text-xs">{formatTime(log.sent_at, tz)}</p>
                      </div>
                      <div className="md:col-span-1">
                        {log.delivered ? (
                          <span
                            className="flex items-center space-x-1 text-green-700 dark:text-green-400"
                            title="Delivered"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </span>
                        ) : (
                          <span
                            className="flex items-center space-x-1 text-red-700 dark:text-red-400"
                            title={log.error || 'Not delivered'}
                          >
                            <AlertCircle className="h-4 w-4" />
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!loadingLogs && logsNextCursor !== null && (
              <div className="pt-4 text-center">
                <button
                  onClick={() => {
                    void handleLoadMoreLogs();
                  }}
                  disabled={loadingMoreLogs}
                  className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border hover:bg-theme-surface-hover inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors disabled:opacity-50 max-md:min-h-[44px]"
                >
                  {loadingMoreLogs ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Load more'
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Create Rule Modal */}
        {showCreateModal && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-rule-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowCreateModal(false);
            }}
          >
            <div className="flex min-h-screen items-center justify-center px-4">
              <div className="modal-overlay" onClick={() => setShowCreateModal(false)} aria-hidden="true" />
              <DialogPanel onClose={() => setShowCreateModal(false)} className="relative w-full max-w-lg">
                <div className="px-6 pt-5 pb-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-theme-text-primary text-lg font-medium">Create Notification Rule</h3>
                    <button
                      onClick={() => {
                        setShowCreateModal(false);
                        setCreateError(null);
                      }}
                      className="text-theme-text-muted hover:text-theme-text-primary"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  {createError && (
                    <div className="mb-4 flex items-start space-x-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-400" />
                      <p className="text-sm text-red-700 dark:text-red-300">{createError}</p>
                    </div>
                  )}
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="rule-name" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                        Rule Name <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="rule-name"
                        type="text"
                        value={createName}
                        onChange={(e) => setCreateName(e.target.value)}
                        className="form-input"
                        placeholder="e.g., Monthly Report Reminder"
                        required
                        aria-required="true"
                      />
                    </div>
                    <div>
                      <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Trigger Event</label>
                      <select
                        value={createTrigger}
                        onChange={(e) => setCreateTrigger(e.target.value)}
                        className="form-input"
                      >
                        {TRIGGER_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="rule-description"
                        className="text-theme-text-secondary mb-1 block text-sm font-medium"
                      >
                        Description
                      </label>
                      <textarea
                        id="rule-description"
                        rows={2}
                        value={createDescription}
                        onChange={(e) => setCreateDescription(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div className="card-secondary p-3">
                      <div className="flex items-start space-x-2">
                        <AlertCircle className="text-theme-text-muted mt-0.5 h-4 w-4 shrink-0" />
                        <p className="text-theme-text-muted text-sm">
                          {TRIGGER_OPTIONS.find((opt) => opt.value === createTrigger)?.effect} It stops for the whole
                          department once <strong className="text-theme-text-secondary">every</strong> rule for this
                          trigger is switched off — one left active keeps it running. Individual members control their
                          own email and text settings separately. Filed under{' '}
                          <strong className="text-theme-text-secondary">
                            {formatCategory(TRIGGER_CATEGORY_MAP[createTrigger] || 'general')}
                          </strong>
                          .
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-theme-surface-secondary flex justify-end space-x-3 rounded-b-lg px-6 py-3">
                  <button
                    onClick={() => {
                      setShowCreateModal(false);
                      setCreateError(null);
                    }}
                    className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      void handleCreateRule();
                    }}
                    disabled={creating}
                    className="flex items-center space-x-2 rounded-lg bg-orange-600 px-4 py-2 text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                    <span>Create Rule</span>
                  </button>
                </div>
              </DialogPanel>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default NotificationsPage;
