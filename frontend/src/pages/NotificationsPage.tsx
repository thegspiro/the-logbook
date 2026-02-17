import React, { useState, useEffect } from 'react';
import {
  Bell,
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
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import {
  notificationsService,
} from '../services/api';
import type {
  NotificationRuleRecord,
  NotificationLogRecord,
  NotificationsSummary,
} from '../services/api';

// Maps trigger enum values to display-friendly icons and colors
const TRIGGER_DISPLAY: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  event_reminder: {
    icon: <Calendar className="w-5 h-5" />,
    color: 'text-blue-700',
    label: 'Event Reminder',
  },
  training_expiry: {
    icon: <GraduationCap className="w-5 h-5" />,
    color: 'text-purple-700',
    label: 'Training Expiry',
  },
  schedule_change: {
    icon: <Clock className="w-5 h-5" />,
    color: 'text-violet-700',
    label: 'Schedule Change',
  },
  new_member: {
    icon: <Users className="w-5 h-5" />,
    color: 'text-green-700',
    label: 'Member Added',
  },
  maintenance_due: {
    icon: <AlertTriangle className="w-5 h-5" />,
    color: 'text-orange-700',
    label: 'Maintenance Due',
  },
  form_submitted: {
    icon: <FileText className="w-5 h-5" />,
    color: 'text-cyan-700',
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

const NotificationsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('notifications.manage');

  // Data states
  const [rules, setRules] = useState<NotificationRuleRecord[]>([]);
  const [logs, setLogs] = useState<NotificationLogRecord[]>([]);
  const [summary, setSummary] = useState<NotificationsSummary | null>(null);

  // UI states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'rules' | 'templates' | 'log'>('rules');

  // Create form states
  const [createName, setCreateName] = useState('');
  const [createTrigger, setCreateTrigger] = useState('event_reminder');
  const [createDescription, setCreateDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Fetch all data on mount
  useEffect(() => {
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
        const message = err instanceof Error ? err.message : 'Failed to load notification data';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

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
      const message = err instanceof Error ? err.message : 'Failed to toggle rule';
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
        description: createDescription.trim() || undefined,
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
      const message = err instanceof Error ? err.message : 'Failed to create rule';
      setCreateError(message);
    } finally {
      setCreating(false);
    }
  };

  const filteredRules = rules.filter(r =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="w-10 h-10 text-orange-700 animate-spin" />
          <p className="text-theme-text-secondary text-sm">Loading notifications...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-orange-600 rounded-lg p-2">
              <Bell className="w-6 h-6 text-theme-text-primary" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-2xl font-bold">Email Notifications</h1>
              <p className="text-theme-text-muted text-sm">
                Automated email notifications for events, reminders, and important updates
              </p>
            </div>
          </div>
          {canManage && (
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
            <AlertCircle className="w-5 h-5 text-red-700 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-700 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8" role="region" aria-label="Notification statistics">
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Notification Rules</p>
            <p className="text-theme-text-primary text-2xl font-bold mt-1">{summary?.total_rules ?? rules.length}</p>
          </div>
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Active Rules</p>
            <p className="text-green-700 text-2xl font-bold mt-1">{summary?.active_rules ?? rules.filter(r => r.enabled).length}</p>
          </div>
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Emails Sent (This Month)</p>
            <p className="text-orange-700 text-2xl font-bold mt-1">{summary?.emails_sent_this_month ?? 0}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-theme-surface-secondary rounded-lg p-1 w-fit" role="tablist" aria-label="Notification views">
          <button
            onClick={() => setActiveTab('rules')}
            role="tab"
            aria-selected={activeTab === 'rules'}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'rules' ? 'bg-orange-600 text-white' : 'text-theme-text-muted hover:text-white'
            }`}
          >
            Notification Rules
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            role="tab"
            aria-selected={activeTab === 'templates'}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'templates' ? 'bg-orange-600 text-white' : 'text-theme-text-muted hover:text-white'
            }`}
          >
            Email Templates
          </button>
          <button
            onClick={() => setActiveTab('log')}
            role="tab"
            aria-selected={activeTab === 'log'}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'log' ? 'bg-orange-600 text-white' : 'text-theme-text-muted hover:text-white'
            }`}
          >
            Send Log
          </button>
        </div>

        {activeTab === 'rules' && (
          <div role="tabpanel">
            {/* Search */}
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border mb-6">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted" aria-hidden="true" />
                <label htmlFor="notif-search" className="sr-only">Search notification rules</label>
                <input
                  id="notif-search"
                  type="text"
                  placeholder="Search notification rules..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

            {/* Rules List */}
            <div className="space-y-3">
              {filteredRules.length === 0 && (
                <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
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
                  <div key={rule.id} className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className={`p-2 rounded-lg bg-theme-surface-secondary ${display.color}`}>
                          {display.icon}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="text-theme-text-primary font-semibold">{rule.name}</h3>
                            <span className="px-2 py-0.5 text-xs bg-slate-500/10 text-theme-text-muted rounded">
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
                          <span className="flex items-center space-x-1 text-green-700 text-sm">
                            <CheckCircle className="w-4 h-4" />
                            <span>Active</span>
                          </span>
                        ) : (
                          <span className="text-theme-text-muted text-sm">Disabled</span>
                        )}
                        {canManage && (
                          <button
                            onClick={() => toggleRule(rule.id, rule.enabled)}
                            disabled={togglingRuleId === rule.id}
                            className="text-theme-text-muted hover:text-theme-text-primary transition-colors disabled:opacity-50"
                          >
                            {togglingRuleId === rule.id ? (
                              <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
                            ) : rule.enabled ? (
                              <ToggleRight className="w-8 h-8 text-green-700" />
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
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center" role="tabpanel">
            <Mail className="w-16 h-16 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
            <h3 className="text-theme-text-primary text-xl font-bold mb-2">Email Templates</h3>
            <p className="text-theme-text-secondary mb-6">
              Customize email templates for different notification types. Templates support dynamic placeholders for personalization.
            </p>
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 max-w-md mx-auto">
              <p className="text-orange-700 text-sm">
                Email template editor will be available once the notification service is fully configured.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'log' && (
          <>
            {logs.length === 0 ? (
              <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
                <Clock className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
                <h3 className="text-theme-text-primary text-xl font-bold mb-2">No Notifications Sent</h3>
                <p className="text-theme-text-secondary mb-6">
                  The notification send log will show all sent emails with delivery status and timestamps.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border overflow-hidden">
                  {/* Table Header */}
                  <div className="grid grid-cols-12 gap-4 px-5 py-3 border-b border-theme-surface-border text-xs font-medium text-theme-text-muted uppercase">
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
                      className="grid grid-cols-12 gap-4 px-5 py-4 border-b border-white/5 last:border-b-0 hover:bg-theme-surface-secondary transition-colors"
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
                        <span className="inline-flex items-center px-2 py-0.5 text-xs rounded bg-slate-500/10 text-theme-text-muted">
                          {log.channel === 'in_app' ? 'In-App' : log.channel === 'email' ? 'Email' : log.channel}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <p className="text-theme-text-secondary text-sm">
                          {new Date(log.sent_at).toLocaleDateString()}
                        </p>
                        <p className="text-theme-text-muted text-xs mt-0.5">
                          {new Date(log.sent_at).toLocaleTimeString()}
                        </p>
                      </div>
                      <div className="col-span-1">
                        {log.delivered ? (
                          <span className="flex items-center space-x-1 text-green-700" title="Delivered">
                            <CheckCircle className="w-4 h-4" />
                          </span>
                        ) : (
                          <span className="flex items-center space-x-1 text-red-700" title={log.error || 'Not delivered'}>
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
        )}

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
              <div className="relative bg-theme-surface rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-theme-text-primary">Create Notification Rule</h3>
                    <button onClick={() => { setShowCreateModal(false); setCreateError(null); }} className="text-theme-text-muted hover:text-theme-text-primary">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  {createError && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
                      <p className="text-red-300 text-sm">{createError}</p>
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
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-orange-500"
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
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-orange-500"
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
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                    <div className="bg-theme-input-bg/30 border border-theme-input-border/50 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <AlertCircle className="w-4 h-4 text-theme-text-muted mt-0.5 flex-shrink-0" />
                        <p className="text-theme-text-muted text-sm">
                          Category will be set to <strong className="text-theme-text-secondary">{formatCategory(TRIGGER_CATEGORY_MAP[createTrigger] || 'general')}</strong> based on the selected trigger. Channel defaults to <strong className="text-theme-text-secondary">In-App</strong>.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-theme-input-bg px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => { setShowCreateModal(false); setCreateError(null); }}
                    className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-input-bg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateRule}
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
