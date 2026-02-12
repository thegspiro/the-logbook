import React, { useState } from 'react';
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
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

interface NotificationRule {
  id: string;
  name: string;
  description: string;
  trigger: string;
  icon: React.ReactNode;
  color: string;
  enabled: boolean;
  category: string;
}

const DEFAULT_RULES: NotificationRule[] = [
  {
    id: 'event-reminder',
    name: 'Event Reminders',
    description: 'Send reminder emails before scheduled events',
    trigger: '24 hours before event',
    icon: <Calendar className="w-5 h-5" />,
    color: 'text-blue-400',
    enabled: true,
    category: 'Events',
  },
  {
    id: 'training-expiry',
    name: 'Training Expiry Alerts',
    description: 'Notify members when certifications are expiring',
    trigger: '30 days before expiry',
    icon: <GraduationCap className="w-5 h-5" />,
    color: 'text-purple-400',
    enabled: true,
    category: 'Training',
  },
  {
    id: 'shift-change',
    name: 'Schedule Changes',
    description: 'Notify members when shift schedules are updated',
    trigger: 'When schedule changes',
    icon: <Clock className="w-5 h-5" />,
    color: 'text-violet-400',
    enabled: false,
    category: 'Scheduling',
  },
  {
    id: 'new-member',
    name: 'New Member Welcome',
    description: 'Send welcome email to newly added members',
    trigger: 'When member is added',
    icon: <Users className="w-5 h-5" />,
    color: 'text-green-400',
    enabled: true,
    category: 'Members',
  },
  {
    id: 'maintenance-due',
    name: 'Maintenance Reminders',
    description: 'Alert when equipment maintenance is due',
    trigger: '7 days before due date',
    icon: <AlertTriangle className="w-5 h-5" />,
    color: 'text-orange-400',
    enabled: false,
    category: 'Inventory',
  },
];

const NotificationsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('notifications.manage');

  const [rules, setRules] = useState<NotificationRule[]>(DEFAULT_RULES);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'rules' | 'templates' | 'log'>('rules');

  const toggleRule = (ruleId: string) => {
    setRules(prev => prev.map(r =>
      r.id === ruleId ? { ...r, enabled: !r.enabled } : r
    ));
  };

  const filteredRules = rules.filter(r =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const enabledCount = rules.filter(r => r.enabled).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-orange-600 rounded-lg p-2">
              <Bell className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-white text-2xl font-bold">Email Notifications</h1>
              <p className="text-slate-400 text-sm">
                Automated email notifications for events, reminders, and important updates
              </p>
            </div>
          </div>
          {canManage && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Add Rule</span>
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">Notification Rules</p>
            <p className="text-white text-2xl font-bold mt-1">{rules.length}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">Active Rules</p>
            <p className="text-green-400 text-2xl font-bold mt-1">{enabledCount}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">Emails Sent (This Month)</p>
            <p className="text-orange-400 text-2xl font-bold mt-1">0</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-white/5 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('rules')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'rules' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Notification Rules
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'templates' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Email Templates
          </button>
          <button
            onClick={() => setActiveTab('log')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'log' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Send Log
          </button>
        </div>

        {activeTab === 'rules' && (
          <>
            {/* Search */}
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search notification rules..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

            {/* Rules List */}
            <div className="space-y-3">
              {filteredRules.map((rule) => (
                <div key={rule.id} className="bg-white/10 backdrop-blur-sm rounded-lg p-5 border border-white/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className={`p-2 rounded-lg bg-white/5 ${rule.color}`}>
                        {rule.icon}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="text-white font-semibold">{rule.name}</h3>
                          <span className="px-2 py-0.5 text-xs bg-slate-500/10 text-slate-400 rounded">
                            {rule.category}
                          </span>
                        </div>
                        <p className="text-slate-300 text-sm mt-0.5">{rule.description}</p>
                        <div className="flex items-center space-x-1 mt-1">
                          <Zap className="w-3 h-3 text-slate-500" />
                          <span className="text-slate-500 text-xs">{rule.trigger}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      {rule.enabled ? (
                        <span className="flex items-center space-x-1 text-green-400 text-sm">
                          <CheckCircle className="w-4 h-4" />
                          <span>Active</span>
                        </span>
                      ) : (
                        <span className="text-slate-500 text-sm">Disabled</span>
                      )}
                      {canManage && (
                        <button
                          onClick={() => toggleRule(rule.id)}
                          className="text-slate-400 hover:text-white transition-colors"
                        >
                          {rule.enabled ? (
                            <ToggleRight className="w-8 h-8 text-green-400" />
                          ) : (
                            <ToggleLeft className="w-8 h-8 text-slate-500" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {activeTab === 'templates' && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
            <Mail className="w-16 h-16 text-slate-500 mx-auto mb-4" />
            <h3 className="text-white text-xl font-bold mb-2">Email Templates</h3>
            <p className="text-slate-300 mb-6">
              Customize email templates for different notification types. Templates support dynamic placeholders for personalization.
            </p>
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 max-w-md mx-auto">
              <p className="text-orange-300 text-sm">
                Email template editor will be available once the notification service is fully configured.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'log' && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
            <Clock className="w-16 h-16 text-slate-500 mx-auto mb-4" />
            <h3 className="text-white text-xl font-bold mb-2">No Notifications Sent</h3>
            <p className="text-slate-300 mb-6">
              The notification send log will show all sent emails with delivery status and timestamps.
            </p>
          </div>
        )}

        {/* Create Rule Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateModal(false)} />
              <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-lg w-full border border-white/20">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-white">Create Notification Rule</h3>
                    <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Rule Name *</label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                        placeholder="e.g., Monthly Report Reminder"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Trigger Event</label>
                      <select className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500">
                        <option>Event Reminder</option>
                        <option>Training Expiry</option>
                        <option>Schedule Change</option>
                        <option>Member Added</option>
                        <option>Maintenance Due</option>
                        <option>Custom Schedule</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                      <textarea
                        rows={2}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                    <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <AlertCircle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
                        <p className="text-orange-300 text-sm">
                          Custom notification rules will be available once the notification service backend is configured.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled
                    className="px-4 py-2 bg-orange-600/50 text-white/50 rounded-lg cursor-not-allowed"
                  >
                    Create Rule
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
