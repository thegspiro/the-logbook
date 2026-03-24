import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  ChevronRight,
} from 'lucide-react';
import { Breadcrumbs, SkeletonPage } from '../components/ux';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, formatTime } from '../utils/dateFormatting';
import { formatRelativeTime } from '../hooks/useRelativeTime';
import {
  notificationsService,
} from '../services/api';
import type {
  NotificationRuleRecord,
  NotificationLogRecord,
  NotificationsSummary,
} from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { useNotificationCountStore } from '../hooks/useNotificationCount';

// Maps trigger enum values to display-friendly icons and colors
const TRIGGER_DISPLAY: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  event_reminder: {
    icon: <Calendar className="w-5 h-5" />,
    color: 'text-blue-700 dark:text-blue-400',
    label: 'Event Reminder',
  },
  training_expiry: {
    icon: <GraduationCap className="w-5 h-5" />,
    color: 'text-purple-700 dark:text-purple-400',
    label: 'Training Expiry',
  },
  schedule_change: {
    icon: <Clock className="w-5 h-5" />,
    color: 'text-violet-700 dark:text-violet-400',
    label: 'Schedule Change',
  },
  new_member: {
    icon: <Users className="w-5 h-5" />,
    color: 'text-green-700 dark:text-green-400',
    label: 'Member Added',
  },
  maintenance_due: {
    icon: <AlertTriangle className="w-5 h-5" />,
    color: 'text-orange-700 dark:text-orange-400',
    label: 'Maintenance Due',
  },
  form_submitted: {
    icon: <FileText className="w-5 h-5" />,
    color: 'text-cyan-700 dark:text-cyan-400',
    label: 'Form Submitted',
  },
};

// Dropdown options for the create modal
const TRIGGER_OPTIONS = [
  { label: 'Event Reminder', value: 'event_reminder' },
  { label: 'Training Expiry', value: 'training_expiry' },
  { label: 'Schedule Change', value: 'schedule_change' },
  { label: 'Member Added', value: 'new_member' },
  { label: 'Maintenance Due', value: 'maintenance_due' },
  { label: 'Form Submitted', value: 'form_submitted' },
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
  return TRIGGER_DISPLAY[trigger] || {
    icon: <Wrench className="w-5 h-5" />,
    color: 'text-theme-text-muted',
    label: trigger,
  };
}

function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

const INBOX_PAGE_SIZE = 20;

const NotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('notifications.manage');
  const canView = checkPermission('notifications.view');
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
  const [inboxTotal, setInboxTotal] = useState(0);

  // UI states
  const [loading, setLoading] = useState(true);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showRead, setShowRead] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const initialTab = searchParams.get('tab') === 'inbox' ? 'inbox' as const : (canView ? 'rules' as const : 'inbox' as const);
  const [activeTab, setActiveTab] = useState<'inbox' | 'rules' | 'templates' | 'log'>(initialTab);
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
        setInboxTotal(data.total);
      } catch {
        // Inbox is always available to authenticated users
      } finally {
        setLoadingInbox(false);
      }
    };
    void fetchInbox();
  }, [showRead]);

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
        const [rulesRes, summaryRes, logsRes] = await Promise.all([
          notificationsService.getRules(),
          notificationsService.getSummary(),
          notificationsService.getLogs(),
        ]);
        setRules(rulesRes.rules);
        setSummary(summaryRes);
        setLogs(logsRes.logs);
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
      setRules(prev => prev.map(r => r.id === ruleId ? updated : r));
      // Update summary counts
      setSummary(prev => {
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
      setRules(prev => [...prev, newRule]);
      // Update summary
      setSummary(prev => {
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

  const filteredRules = rules.filter(r =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Batch management: mark all as read (#76)
  const handleMarkAllRead = async () => {
    try {
      await notificationsService.markAllLogsRead();
      setLogs((prev) => prev.map((l) => ({ ...l, read: true })));
    } catch {
      setError('Failed to mark all as read');
    }
  };

  const handleMarkInboxNotificationRead = async (logId: string) => {
    try {
      await notificationsService.markMyNotificationRead(logId);
      setMyNotifications((prev) =>
        prev.map((n) => (n.id === logId ? { ...n, read: true } : n)),
      );
      decrementGlobalUnread();
    } catch {
      setError('Failed to mark notification as read');
    }
  };

  const handleMarkAllInboxRead = async () => {
    try {
      await notificationsService.markAllMyNotificationsRead();
      setMyNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      clearGlobalUnread();
    } catch {
      setError('Failed to mark all as read');
    }
  };

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await notificationsService.getMyNotifications({
        include_read: showRead,
        skip: myNotifications.length,
        limit: INBOX_PAGE_SIZE,
      });
      setMyNotifications((prev) => [...prev, ...(data.logs || [])]);
      setInboxTotal(data.total);
    } catch {
      setError('Failed to load more notifications');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    if (tab === 'inbox') {
      setSearchParams({ tab: 'inbox' });
    } else {
      searchParams.delete('tab');
      setSearchParams(searchParams);
    }
  };

  if (loading && loadingInbox) {
    return (
      <div className="min-h-screen">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <Breadcrumbs />
          <SkeletonPage rows={6} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Breadcrumbs />

        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-orange-600 rounded-lg p-2">
              <Bell className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-2xl font-bold">Notifications</h1>
              <p className="text-theme-text-muted text-sm">
                {activeTab === 'inbox'
                  ? 'View and manage your notifications'
                  : 'Manage automated notification rules and review send history across all channels'}
              </p>
            </div>
          </div>
          {canManage && activeTab !== 'inbox' && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Add Rule</span>
            </button>
          )}
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-red-700 dark:text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Stats - only show for admin tabs */}
        {canView && activeTab !== 'inbox' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8" role="region" aria-label="Notification statistics">
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Notification Rules</p>
              <p className="text-theme-text-primary text-2xl font-bold mt-1">{summary?.total_rules ?? rules.length}</p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Active Rules</p>
              <p className="text-green-700 dark:text-green-400 text-2xl font-bold mt-1">{summary?.active_rules ?? rules.filter(r => r.enabled).length}</p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Sent This Month</p>
              <p className="text-orange-700 dark:text-orange-400 text-2xl font-bold mt-1">{(summary?.emails_sent_this_month ?? 0) + (summary?.notifications_sent_this_month ?? 0)}</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-theme-surface-secondary rounded-lg p-1 w-fit" role="tablist" aria-label="Notification views">
          <button
            onClick={() => handleTabChange('inbox')}
            role="tab"
            aria-selected={activeTab === 'inbox'}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-2 ${
              activeTab === 'inbox' ? 'bg-orange-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <span>My Notifications</span>
            {myUnreadCount > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                activeTab === 'inbox' ? 'bg-white/20 text-white' : 'bg-red-500 text-white'
              }`}>
                {myUnreadCount}
              </span>
            )}
          </button>
          {canView && (
            <button
              onClick={() => handleTabChange('rules')}
              role="tab"
              aria-selected={activeTab === 'rules'}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'rules' ? 'bg-orange-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              Notification Rules
            </button>
          )}
          {canView && (
            <button
              onClick={() => handleTabChange('templates')}
              role="tab"
              aria-selected={activeTab === 'templates'}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'templates' ? 'bg-orange-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              Email Templates
            </button>
          )}
          {canView && (
            <button
              onClick={() => handleTabChange('log')}
              role="tab"
              aria-selected={activeTab === 'log'}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'log' ? 'bg-orange-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              Send Log
            </button>
          )}
        </div>

        {activeTab === 'inbox' && (
          <div role="tabpanel">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <p className="text-theme-text-muted text-sm">
                  {myUnreadCount > 0 ? `${myUnreadCount} unread` : 'All caught up'}
                </p>
                <label className="flex items-center gap-1.5 text-xs text-theme-text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showRead}
                    onChange={(e) => setShowRead(e.target.checked)}
                    className="rounded border-theme-surface-border"
                  />
                  Show read
                </label>
              </div>
              {myUnreadCount > 0 && (
                <button
                  onClick={() => { void handleMarkAllInboxRead(); }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
                >
                  <CheckCheck className="w-4 h-4" />
                  Mark all as read
                </button>
              )}
            </div>
            {loadingInbox ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 bg-theme-surface-hover animate-pulse rounded-lg"
                  />
                ))}
              </div>
            ) : myNotifications.length === 0 ? (
              <div className="card p-12 text-center">
                <Inbox className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
                <h3 className="text-theme-text-primary text-xl font-bold mb-2">
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
                {myNotifications.map((notification) => (
                  <button
                    key={notification.id}
                    onClick={() => {
                      if (!notification.read) void handleMarkInboxNotificationRead(notification.id);
                      if (notification.action_url && notification.action_url.startsWith('/'))
                        navigate(notification.action_url);
                    }}
                    className={`w-full text-left p-4 rounded-lg transition-colors card ${
                      notification.read
                        ? 'opacity-60'
                        : 'border-l-4 border-l-blue-500'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${notification.read ? 'text-theme-text-muted' : 'font-semibold text-theme-text-primary'}`}>
                          {notification.subject || 'Notification'}
                        </p>
                        <p className="text-xs text-theme-text-muted mt-1 whitespace-pre-line">
                          {notification.message || ''}
                        </p>
                        {notification.category && (
                          <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-sm bg-theme-surface-secondary text-theme-text-muted">
                            {formatCategory(notification.category)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center shrink-0 gap-2">
                        <span className="text-xs text-theme-text-muted whitespace-nowrap">
                          {formatRelativeTime(notification.sent_at)}
                        </span>
                        {!notification.read ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleMarkInboxNotificationRead(notification.id);
                            }}
                            className="p-1.5 rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
                            title="Mark as read"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        ) : notification.action_url ? (
                          <ChevronRight className="w-4 h-4 text-theme-text-muted" />
                        ) : null}
                      </div>
                    </div>
                  </button>
                ))}
                {myNotifications.length < inboxTotal && (
                  <div className="pt-2 text-center">
                    <button
                      onClick={() => { void handleLoadMore(); }}
                      disabled={loadingMore}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors disabled:opacity-50"
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        `Load more (${inboxTotal - myNotifications.length} remaining)`
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
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted" aria-hidden="true" />
                <label htmlFor="notif-search" className="sr-only">Search notification rules</label>
                <input
                  id="notif-search"
                  type="text"
                  aria-label="Search notification rules..." placeholder="Search notification rules..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="form-input pl-10 placeholder-theme-text-muted pr-4"
                />
              </div>
            </div>

            {/* Rules List */}
            <div className="space-y-3">
              {filteredRules.length === 0 && (
                <div className="card p-12 text-center">
                  <Bell className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
                  <h3 className="text-theme-text-primary text-xl font-bold mb-2">No Notification Rules</h3>
                  <p className="text-theme-text-secondary mb-6">
                    {searchQuery
                      ? 'No rules match your search query.'
                      : 'Create your first notification rule to start sending automated notifications.'}
                  </p>
                  {canManage && !searchQuery && (
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="inline-flex items-center space-x-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
                    >
                      <Plus className="w-4 h-4" />
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
                        <div className={`p-2 rounded-lg bg-theme-surface-secondary ${display.color}`}>
                          {display.icon}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="text-theme-text-primary font-semibold">{rule.name}</h3>
                            <span className="px-2 py-0.5 text-xs bg-theme-surface-secondary text-theme-text-muted rounded-sm">
                              {formatCategory(rule.category)}
                            </span>
                          </div>
                          <p className="text-theme-text-secondary text-sm mt-0.5">{rule.description || 'No description'}</p>
                          <div className="flex items-center space-x-1 mt-1">
                            <Zap className="w-3 h-3 text-theme-text-muted" />
                            <span className="text-theme-text-muted text-xs">{display.label}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        {rule.enabled ? (
                          <span className="flex items-center space-x-1 text-green-700 dark:text-green-400 text-sm">
                            <CheckCircle className="w-4 h-4" />
                            <span>Active</span>
                          </span>
                        ) : (
                          <span className="text-theme-text-muted text-sm">Disabled</span>
                        )}
                        {canManage && (
                          <button
                            onClick={() => { void toggleRule(rule.id, rule.enabled); }}
                            disabled={togglingRuleId === rule.id}
                            className="text-theme-text-muted hover:text-theme-text-primary transition-colors disabled:opacity-50"
                          >
                            {togglingRuleId === rule.id ? (
                              <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
                            ) : rule.enabled ? (
                              <ToggleRight className="w-8 h-8 text-green-700 dark:text-green-400" />
                            ) : (
                              <ToggleLeft className="w-8 h-8 text-theme-text-muted" />
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
            <Mail className="w-16 h-16 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
            <h3 className="text-theme-text-primary text-xl font-bold mb-2">Email Templates</h3>
            <p className="text-theme-text-secondary mb-6">
              Customize email templates for different notification types. Templates support dynamic placeholders for personalization.
            </p>
            <button
              onClick={() => navigate('/communications/email-templates')}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
            >
              <Mail className="w-4 h-4" />
              <span>Manage Email Templates</span>
            </button>
          </div>
        )}

        {activeTab === 'log' && (() => {
          const filteredLogs = logChannelFilter === 'all'
            ? logs
            : logs.filter((l) => l.channel === logChannelFilter);
          return (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-1 bg-theme-surface-secondary rounded-lg p-1">
                {([['all', 'All'], ['email', 'Email'], ['in_app', 'In-App']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setLogChannelFilter(value)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      logChannelFilter === value
                        ? 'bg-orange-600 text-white'
                        : 'text-theme-text-muted hover:text-theme-text-primary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {filteredLogs.some((l) => !l.read) && (
                <button
                  onClick={() => { void handleMarkAllRead(); }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
                >
                  <CheckCheck className="w-4 h-4" />
                  Mark all as read
                </button>
              )}
            </div>
            {filteredLogs.length === 0 ? (
              <div className="card p-12 text-center">
                <Clock className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
                <h3 className="text-theme-text-primary text-xl font-bold mb-2">No Notifications Found</h3>
                <p className="text-theme-text-secondary mb-6">
                  {logChannelFilter === 'all'
                    ? 'The send log will show all sent notifications with delivery status and timestamps.'
                    : `No ${logChannelFilter === 'email' ? 'email' : 'in-app'} notifications found.`}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="card overflow-hidden">
                  {/* Table Header */}
                  <div className="grid grid-cols-12 gap-4 px-5 py-3 border-b border-theme-surface-border text-xs font-medium text-theme-text-muted uppercase">
                    <div className="col-span-4">Subject</div>
                    <div className="col-span-3">Recipient</div>
                    <div className="col-span-2">Channel</div>
                    <div className="col-span-2">Sent At</div>
                    <div className="col-span-1">Status</div>
                  </div>
                  {/* Table Rows */}
                  {filteredLogs.map((log) => (
                    <div
                      key={log.id}
                      className="grid grid-cols-12 gap-4 px-5 py-4 border-b border-theme-surface-border last:border-b-0 hover:bg-theme-surface-hover transition-colors"
                    >
                      <div className="col-span-4">
                        <p className="text-theme-text-primary text-sm truncate">{log.subject || '(No subject)'}</p>
                        {log.rule_name && (
                          <p className="text-theme-text-muted text-xs mt-0.5 truncate">Rule: {log.rule_name}</p>
                        )}
                      </div>
                      <div className="col-span-3">
                        <p className="text-theme-text-secondary text-sm truncate">
                          {log.recipient_name || log.recipient_email || 'Unknown'}
                        </p>
                        {log.recipient_name && log.recipient_email && (
                          <p className="text-theme-text-muted text-xs mt-0.5 truncate">{log.recipient_email}</p>
                        )}
                      </div>
                      <div className="col-span-2">
                        <span className="inline-flex items-center px-2 py-0.5 text-xs rounded-sm bg-theme-surface-secondary text-theme-text-muted">
                          {log.channel === 'in_app' ? 'In-App' : log.channel === 'email' ? 'Email' : log.channel}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <p className="text-theme-text-secondary text-sm">
                          {formatDate(log.sent_at, tz)}
                        </p>
                        <p className="text-theme-text-muted text-xs mt-0.5">
                          {formatTime(log.sent_at, tz)}
                        </p>
                      </div>
                      <div className="col-span-1">
                        {log.delivered ? (
                          <span className="flex items-center space-x-1 text-green-700 dark:text-green-400" title="Delivered">
                            <CheckCircle className="w-4 h-4" />
                          </span>
                        ) : (
                          <span className="flex items-center space-x-1 text-red-700 dark:text-red-400" title={log.error || 'Not delivered'}>
                            <AlertCircle className="w-4 h-4" />
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
          );
        })()}

        {/* Create Rule Modal */}
        {showCreateModal && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-rule-title"
            onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateModal(false); }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateModal(false)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-theme-text-primary">Create Notification Rule</h3>
                    <button onClick={() => { setShowCreateModal(false); setCreateError(null); }} className="text-theme-text-muted hover:text-theme-text-primary">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  {createError && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 text-red-700 dark:text-red-400 mt-0.5 shrink-0" />
                      <p className="text-red-700 dark:text-red-300 text-sm">{createError}</p>
                    </div>
                  )}
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="rule-name" className="block text-sm font-medium text-theme-text-secondary mb-1">Rule Name <span aria-hidden="true">*</span></label>
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
                      <label className="block text-sm font-medium text-theme-text-secondary mb-1">Trigger Event</label>
                      <select
                        value={createTrigger}
                        onChange={(e) => setCreateTrigger(e.target.value)}
                        className="form-input"
                      >
                        {TRIGGER_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="rule-description" className="block text-sm font-medium text-theme-text-secondary mb-1">Description</label>
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
                        <AlertCircle className="w-4 h-4 text-theme-text-muted mt-0.5 shrink-0" />
                        <p className="text-theme-text-muted text-sm">
                          Category will be set to <strong className="text-theme-text-secondary">{formatCategory(TRIGGER_CATEGORY_MAP[createTrigger] || 'general')}</strong> based on the selected trigger. Channel defaults to <strong className="text-theme-text-secondary">In-App</strong>.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-theme-surface-secondary px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => { setShowCreateModal(false); setCreateError(null); }}
                    className="px-4 py-2 border border-theme-surface-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { void handleCreateRule(); }}
                    disabled={creating}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>Create Rule</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default NotificationsPage;
