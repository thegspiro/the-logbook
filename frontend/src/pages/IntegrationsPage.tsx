import React, { useState, useEffect } from 'react';
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
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { integrationsService, type IntegrationConfig } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';

// UI metadata for integration types (icons, colors)
const INTEGRATION_UI: Record<string, { icon: React.ReactNode; color: string; bgColor: string; features: string[] }> = {
  'google-calendar': {
    icon: <Calendar className="w-6 h-6" />,
    color: 'text-blue-700',
    bgColor: 'bg-blue-500/10',
    features: ['Event sync', 'Two-way sync', 'Auto-create events'],
  },
  'outlook': {
    icon: <Calendar className="w-6 h-6" />,
    color: 'text-sky-700',
    bgColor: 'bg-sky-500/10',
    features: ['Calendar sync', 'Email notifications', 'Contact sync'],
  },
  'slack': {
    icon: <MessageSquare className="w-6 h-6" />,
    color: 'text-purple-700',
    bgColor: 'bg-purple-500/10',
    features: ['Event alerts', 'Training reminders', 'Custom channels'],
  },
  'discord': {
    icon: <MessageSquare className="w-6 h-6" />,
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-500/10',
    features: ['Webhook notifications', 'Event reminders', 'Duty alerts'],
  },
  'csv-import': {
    icon: <Database className="w-6 h-6" />,
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-500/10',
    features: ['Member import', 'Training export', 'Inventory export'],
  },
  'ical': {
    icon: <Link className="w-6 h-6" />,
    color: 'text-orange-700',
    bgColor: 'bg-orange-500/10',
    features: ['Calendar feed URL', 'Auto-updates', 'Filtered feeds'],
  },
};

const DEFAULT_UI = {
  icon: <Plug className="w-6 h-6" />,
  color: 'text-theme-text-muted',
  bgColor: 'bg-slate-500/10',
  features: [],
};

type CategoryFilter = 'all' | 'Calendar' | 'Messaging' | 'Data';

const IntegrationsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('integrations.manage');

  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [showConnectModal, setShowConnectModal] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const loadIntegrations = async () => {
      try {
        const data = await integrationsService.getIntegrations();
        setIntegrations(data);
      } catch {
        toast.error('Failed to load integrations');
      } finally {
        setLoading(false);
      }
    };
    loadIntegrations();
  }, []);

  const getUI = (type: string) => INTEGRATION_UI[type] || DEFAULT_UI;

  const filteredIntegrations = integrations.filter(i => {
    const matchesSearch = i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (i.description || '').toLowerCase().includes(searchQuery.toLowerCase());
    const category = (i.config as Record<string, string>)?.category || i.category;
    const matchesCategory = categoryFilter === 'all' || category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const connectedCount = integrations.filter(i => i.status === 'connected').length;
  const availableCount = integrations.filter(i => i.status === 'available').length;

  const selectedIntegration = showConnectModal
    ? integrations.find(i => i.id === showConnectModal)
    : null;

  const handleConnect = async (integrationId: string) => {
    setConnecting(true);
    try {
      const updated = await integrationsService.connectIntegration(integrationId, {});
      setIntegrations(prev => prev.map(i => i.id === integrationId ? updated : i));
      setShowConnectModal(null);
      toast.success('Integration connected successfully!');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to connect integration'));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (integrationId: string) => {
    try {
      await integrationsService.disconnectIntegration(integrationId);
      setIntegrations(prev => prev.map(i =>
        i.id === integrationId ? { ...i, status: 'available' as const, enabled: false } : i
      ));
      toast.success('Integration disconnected');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to disconnect integration'));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-theme-text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 rounded-lg p-2">
              <Plug className="w-6 h-6 text-theme-text-primary" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-2xl font-bold">External Integrations</h1>
              <p className="text-theme-text-muted text-sm">
                Connect with external tools like Google Calendar, Slack, and more
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8" role="region" aria-label="Integration statistics">
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Available Integrations</p>
            <p className="text-theme-text-primary text-2xl font-bold mt-1">{integrations.length}</p>
          </div>
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Connected</p>
            <p className="text-green-700 text-2xl font-bold mt-1">{connectedCount}</p>
          </div>
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Ready to Connect</p>
            <p className="text-indigo-700 text-2xl font-bold mt-1">{availableCount}</p>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border mb-6" role="search" aria-label="Search and filter integrations">
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="relative flex-1 w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted" aria-hidden="true" />
              <label htmlFor="integrations-search" className="sr-only">Search integrations</label>
              <input
                id="integrations-search"
                type="text"
                placeholder="Search integrations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                      : 'bg-theme-surface-secondary text-theme-text-muted hover:text-theme-text-primary'
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
          {filteredIntegrations.map((integration) => {
            const ui = getUI(integration.integration_type);
            const category = (integration.config as Record<string, string>)?.category || integration.category;
            return (
              <div key={integration.id} className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border hover:border-indigo-500/30 transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-lg ${ui.bgColor} ${ui.color}`}>
                      {ui.icon}
                    </div>
                    <div>
                      <h3 className="text-theme-text-primary font-semibold">{integration.name}</h3>
                      <span className="text-theme-text-muted text-xs">{category}</span>
                    </div>
                  </div>
                  {integration.status === 'connected' && (
                    <span className="flex items-center space-x-1 px-2 py-0.5 text-xs bg-green-500/10 text-green-700 border border-green-500/30 rounded">
                      <Wifi className="w-3 h-3" />
                      <span>Connected</span>
                    </span>
                  )}
                  {integration.status === 'coming_soon' && (
                    <span className="px-2 py-0.5 text-xs bg-slate-500/10 text-theme-text-muted border border-slate-500/30 rounded">
                      Coming Soon
                    </span>
                  )}
                </div>
                <p className="text-theme-text-secondary text-sm mb-3">{integration.description}</p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {ui.features.map((feature) => (
                    <span key={feature} className={`px-2 py-0.5 text-xs rounded ${ui.bgColor} ${ui.color}`}>
                      {feature}
                    </span>
                  ))}
                </div>
                <div className="flex justify-end">
                  {integration.status === 'available' && canManage && (
                    <button
                      onClick={() => setShowConnectModal(integration.id)}
                      className="px-4 py-1.5 text-sm bg-indigo-600/20 text-indigo-700 hover:bg-indigo-600/30 rounded-lg transition-colors flex items-center space-x-1"
                    >
                      <Plug className="w-3.5 h-3.5" />
                      <span>Connect</span>
                    </button>
                  )}
                  {integration.status === 'connected' && canManage && (
                    <button
                      onClick={() => handleDisconnect(integration.id)}
                      className="px-4 py-1.5 text-sm bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors flex items-center space-x-1"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      <span>Disconnect</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Connect Modal */}
        {showConnectModal && selectedIntegration && (() => {
          const ui = getUI(selectedIntegration.integration_type);
          return (
            <div className="fixed inset-0 z-50 overflow-y-auto">
              <div className="flex items-center justify-center min-h-screen px-4">
                <div className="fixed inset-0 bg-black/60" onClick={() => setShowConnectModal(null)} />
                <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border">
                  <div className="px-6 pt-5 pb-4">
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center space-x-3">
                        <div className={`p-2 rounded-lg ${ui.bgColor} ${ui.color}`}>
                          {ui.icon}
                        </div>
                        <h3 className="text-lg font-medium text-theme-text-primary">Connect {selectedIntegration.name}</h3>
                      </div>
                      <button onClick={() => setShowConnectModal(null)} className="text-theme-text-muted hover:text-theme-text-primary">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <p className="text-theme-text-secondary text-sm mb-4">{selectedIntegration.description}</p>

                    <div className="space-y-3 mb-4">
                      <h4 className="text-theme-text-primary text-sm font-medium">Features included:</h4>
                      {ui.features.map((feature) => (
                        <div key={feature} className="flex items-center space-x-2">
                          <Check className="w-4 h-4 text-green-700" />
                          <span className="text-theme-text-secondary text-sm">{feature}</span>
                        </div>
                      ))}
                    </div>

                    <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <AlertCircle className="w-4 h-4 text-indigo-700 mt-0.5 flex-shrink-0" />
                        <p className="text-indigo-700 text-sm">
                          Clicking Connect will enable this integration for your organization. You can disconnect it at any time.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-theme-input-bg px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                    <button
                      onClick={() => setShowConnectModal(null)}
                      className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-input-bg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleConnect(selectedIntegration.id)}
                      disabled={connecting}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                      {connecting ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </main>
    </div>
  );
};

export default IntegrationsPage;
