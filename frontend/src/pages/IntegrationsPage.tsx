import React, { useState } from 'react';
import {
  Plug,
  Calendar,
  MessageSquare,
  Database,
  Search,
  Check,
  X,
  AlertCircle,
  Settings,
  Wifi,
  Link,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

interface Integration {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  status: 'available' | 'connected' | 'coming_soon';
  features: string[];
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Sync department events with Google Calendar for easy access on any device.',
    category: 'Calendar',
    icon: <Calendar className="w-6 h-6" aria-hidden="true" />,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    status: 'available',
    features: ['Event sync', 'Two-way sync', 'Auto-create events'],
  },
  {
    id: 'outlook',
    name: 'Microsoft Outlook',
    description: 'Connect with Outlook for calendar and email integration.',
    category: 'Calendar',
    icon: <Calendar className="w-6 h-6" aria-hidden="true" />,
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/10',
    status: 'available',
    features: ['Calendar sync', 'Email notifications', 'Contact sync'],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send automated notifications to Slack channels for real-time updates.',
    category: 'Messaging',
    icon: <MessageSquare className="w-6 h-6" aria-hidden="true" />,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    status: 'available',
    features: ['Event alerts', 'Training reminders', 'Custom channels'],
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Post updates to Discord servers for volunteer department communication.',
    category: 'Messaging',
    icon: <MessageSquare className="w-6 h-6" aria-hidden="true" />,
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    status: 'coming_soon',
    features: ['Webhook notifications', 'Event reminders', 'Duty alerts'],
  },
  {
    id: 'csv-import',
    name: 'CSV Import/Export',
    description: 'Import and export data in CSV format for reporting and migration.',
    category: 'Data',
    icon: <Database className="w-6 h-6" aria-hidden="true" />,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    status: 'available',
    features: ['Member import', 'Training export', 'Inventory export'],
  },
  {
    id: 'ical',
    name: 'iCalendar (ICS)',
    description: 'Subscribe to department events via standard iCal feed.',
    category: 'Calendar',
    icon: <Link className="w-6 h-6" aria-hidden="true" />,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    status: 'coming_soon',
    features: ['Calendar feed URL', 'Auto-updates', 'Filtered feeds'],
  },
];

type CategoryFilter = 'all' | 'Calendar' | 'Messaging' | 'Data';

const IntegrationsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('integrations.manage');

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [showConnectModal, setShowConnectModal] = useState<string | null>(null);

  const filteredIntegrations = INTEGRATIONS.filter(i => {
    const matchesSearch = i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || i.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const connectedCount = INTEGRATIONS.filter(i => i.status === 'connected').length;
  const availableCount = INTEGRATIONS.filter(i => i.status === 'available').length;

  const selectedIntegration = showConnectModal
    ? INTEGRATIONS.find(i => i.id === showConnectModal)
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 rounded-lg p-2">
              <Plug className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-white text-2xl font-bold">External Integrations</h1>
              <p className="text-slate-400 text-sm">
                Connect with external tools like Google Calendar, Slack, and more
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8" role="region" aria-label="Integration statistics">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">Available Integrations</p>
            <p className="text-white text-2xl font-bold mt-1">{INTEGRATIONS.length}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">Connected</p>
            <p className="text-green-400 text-2xl font-bold mt-1">{connectedCount}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">Ready to Connect</p>
            <p className="text-indigo-400 text-2xl font-bold mt-1">{availableCount}</p>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6" role="search" aria-label="Search and filter integrations">
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="relative flex-1 w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" aria-hidden="true" />
              <label htmlFor="integrations-search" className="sr-only">Search integrations</label>
              <input
                id="integrations-search"
                type="text"
                placeholder="Search integrations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex space-x-2" role="group" aria-label="Filter by category">
              {(['all', 'Calendar', 'Messaging', 'Data'] as CategoryFilter[]).map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  aria-pressed={categoryFilter === cat}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    categoryFilter === cat
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  {cat === 'all' ? 'All' : cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Integration Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredIntegrations.map((integration) => (
            <div key={integration.id} className="bg-white/10 backdrop-blur-sm rounded-lg p-5 border border-white/20 hover:border-indigo-500/30 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${integration.bgColor} ${integration.color}`}>
                    {integration.icon}
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">{integration.name}</h3>
                    <span className="text-slate-500 text-xs">{integration.category}</span>
                  </div>
                </div>
                {integration.status === 'connected' && (
                  <span className="flex items-center space-x-1 px-2 py-0.5 text-xs bg-green-500/10 text-green-400 border border-green-500/30 rounded">
                    <Wifi className="w-3 h-3" aria-hidden="true" />
                    <span>Connected</span>
                  </span>
                )}
                {integration.status === 'coming_soon' && (
                  <span className="px-2 py-0.5 text-xs bg-slate-500/10 text-slate-400 border border-slate-500/30 rounded">
                    Coming Soon
                  </span>
                )}
              </div>
              <p className="text-slate-300 text-sm mb-3">{integration.description}</p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {integration.features.map((feature) => (
                  <span key={feature} className={`px-2 py-0.5 text-xs rounded ${integration.bgColor} ${integration.color}`}>
                    {feature}
                  </span>
                ))}
              </div>
              <div className="flex justify-end">
                {integration.status === 'available' && canManage && (
                  <button
                    onClick={() => setShowConnectModal(integration.id)}
                    className="px-4 py-1.5 text-sm bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 rounded-lg transition-colors flex items-center space-x-1"
                  >
                    <Plug className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Connect</span>
                  </button>
                )}
                {integration.status === 'connected' && canManage && (
                  <button
                    className="px-4 py-1.5 text-sm bg-white/5 text-slate-300 hover:bg-white/10 rounded-lg transition-colors flex items-center space-x-1"
                    aria-label={`Configure ${integration.name}`}
                  >
                    <Settings className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Configure</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Connect Modal */}
        {showConnectModal && selectedIntegration && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-integration-title"
            onKeyDown={(e) => { if (e.key === 'Escape') setShowConnectModal(null); }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowConnectModal(null)} aria-hidden="true" />
              <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-lg w-full border border-white/20">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center space-x-3">
                      <div className={`p-2 rounded-lg ${selectedIntegration.bgColor} ${selectedIntegration.color}`}>
                        {selectedIntegration.icon}
                      </div>
                      <h3 id="connect-integration-title" className="text-lg font-medium text-white">Connect {selectedIntegration.name}</h3>
                    </div>
                    <button onClick={() => setShowConnectModal(null)} className="text-slate-400 hover:text-white" aria-label="Close dialog">
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>

                  <p className="text-slate-300 text-sm mb-4">{selectedIntegration.description}</p>

                  <div className="space-y-3 mb-4">
                    <h4 className="text-white text-sm font-medium">Features included:</h4>
                    {selectedIntegration.features.map((feature) => (
                      <div key={feature} className="flex items-center space-x-2">
                        <Check className="w-4 h-4 text-green-400" aria-hidden="true" />
                        <span className="text-slate-300 text-sm">{feature}</span>
                      </div>
                    ))}
                  </div>

                  <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-3">
                    <div className="flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
                      <p className="text-indigo-300 text-sm">
                        Integration connections will be available once the integration service backend is configured. OAuth setup and API key management coming soon.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => setShowConnectModal(null)}
                    className="px-4 py-2 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled
                    className="px-4 py-2 bg-indigo-600/50 text-white/50 rounded-lg cursor-not-allowed"
                  >
                    Connect
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

export default IntegrationsPage;
