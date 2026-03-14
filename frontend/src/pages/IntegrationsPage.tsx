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
  CloudSun,
  FileText,
  Bell,
  Globe,
  MapPin,
  Zap,
  Radio,
  Heart,
  Shield,
  Stethoscope,
  Clipboard,
  Award,
  Activity,
  Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { integrationsService, type IntegrationConfig } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { ConnectionStatus } from '../constants/enums';

// UI metadata for integration types (icons, colors)
const INTEGRATION_UI: Record<string, { icon: React.ReactNode; color: string; bgColor: string; features: string[] }> = {
  'google-calendar': {
    icon: <Calendar className="w-6 h-6" />,
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-500/10',
    features: ['Event sync', 'Two-way sync', 'Auto-create events'],
  },
  'outlook': {
    icon: <Calendar className="w-6 h-6" />,
    color: 'text-sky-700 dark:text-sky-400',
    bgColor: 'bg-sky-500/10',
    features: ['Calendar sync', 'Email notifications', 'Contact sync'],
  },
  'slack': {
    icon: <MessageSquare className="w-6 h-6" />,
    color: 'text-purple-700 dark:text-purple-400',
    bgColor: 'bg-purple-500/10',
    features: ['Event alerts', 'Training reminders', 'Custom channels'],
  },
  'discord': {
    icon: <MessageSquare className="w-6 h-6" />,
    color: 'text-indigo-700 dark:text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    features: ['Webhook notifications', 'Event reminders', 'Duty alerts'],
  },
  'csv-import': {
    icon: <Database className="w-6 h-6" />,
    color: 'text-emerald-700 dark:text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    features: ['Member import', 'Training export', 'Inventory export'],
  },
  'ical': {
    icon: <Link className="w-6 h-6" />,
    color: 'text-orange-700 dark:text-orange-400',
    bgColor: 'bg-orange-500/10',
    features: ['Calendar feed URL', 'Auto-updates', 'Filtered feeds'],
  },
  'microsoft-teams': {
    icon: <MessageSquare className="w-6 h-6" />,
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-500/10',
    features: ['Adaptive Cards', 'Channel notifications', 'Event alerts'],
  },
  'nws-weather': {
    icon: <CloudSun className="w-6 h-6" />,
    color: 'text-amber-700 dark:text-amber-400',
    bgColor: 'bg-amber-500/10',
    features: ['Tornado alerts', 'Flood warnings', 'Fire weather'],
  },
  'nfirs-export': {
    icon: <FileText className="w-6 h-6" />,
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-500/10',
    features: ['NFIRS 5.0 format', 'State reporting', 'Incident data'],
  },
  'generic-webhook': {
    icon: <Globe className="w-6 h-6" />,
    color: 'text-cyan-700 dark:text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    features: ['HMAC signatures', 'Custom events', 'Retry logic'],
  },
  'epcr-import': {
    icon: <Clipboard className="w-6 h-6" />,
    color: 'text-rose-700 dark:text-rose-400',
    bgColor: 'bg-rose-500/10',
    features: ['CSV import', 'NEMSIS XML', 'Any vendor'],
  },
  'nemsis-export': {
    icon: <FileText className="w-6 h-6" />,
    color: 'text-rose-700 dark:text-rose-400',
    bgColor: 'bg-rose-500/10',
    features: ['NEMSIS 3.5', 'Response module', 'State EMS reporting'],
  },
  'active911': {
    icon: <Radio className="w-6 h-6" />,
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-500/10',
    features: ['Dispatch alerts', 'Mapping', 'Paging'],
  },
  'google-maps': {
    icon: <MapPin className="w-6 h-6" />,
    color: 'text-green-700 dark:text-green-400',
    bgColor: 'bg-green-500/10',
    features: ['Hydrant mapping', 'Pre-plans', 'Routing'],
  },
  'zapier': {
    icon: <Zap className="w-6 h-6" />,
    color: 'text-orange-700 dark:text-orange-400',
    bgColor: 'bg-orange-500/10',
    features: ['5,000+ apps', 'No-code', 'Workflows'],
  },
  'whatsapp': {
    icon: <Send className="w-6 h-6" />,
    color: 'text-green-700 dark:text-green-400',
    bgColor: 'bg-green-500/10',
    features: ['Notifications', 'International', 'Group messages'],
  },
  'imagetrend': {
    icon: <Stethoscope className="w-6 h-6" />,
    color: 'text-teal-700 dark:text-teal-400',
    bgColor: 'bg-teal-500/10',
    features: ['ePCR sync', 'Run reports', 'API required'],
  },
  'eso-solutions': {
    icon: <Stethoscope className="w-6 h-6" />,
    color: 'text-teal-700 dark:text-teal-400',
    bgColor: 'bg-teal-500/10',
    features: ['ePCR data', 'RMS exchange', 'API required'],
  },
  'nremt': {
    icon: <Award className="w-6 h-6" />,
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-500/10',
    features: ['Certification check', 'Status verify', 'Pending API'],
  },
  'firstwatch': {
    icon: <Activity className="w-6 h-6" />,
    color: 'text-violet-700 dark:text-violet-400',
    bgColor: 'bg-violet-500/10',
    features: ['Clinical QA', 'Analytics', 'Vendor partnership'],
  },
  'pulse-point': {
    icon: <Heart className="w-6 h-6" />,
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-500/10',
    features: ['CPR alerts', 'AED locations', 'Citizen responder'],
  },
};

const DEFAULT_UI = {
  icon: <Plug className="w-6 h-6" />,
  color: 'text-theme-text-muted',
  bgColor: 'bg-theme-surface-secondary',
  features: [] as string[],
};

// Category icon mapping for filter buttons
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'Calendar': <Calendar className="w-3.5 h-3.5" />,
  'Messaging': <MessageSquare className="w-3.5 h-3.5" />,
  'Data': <Database className="w-3.5 h-3.5" />,
  'Safety': <Shield className="w-3.5 h-3.5" />,
  'Reporting': <FileText className="w-3.5 h-3.5" />,
  'EMS': <Stethoscope className="w-3.5 h-3.5" />,
  'Dispatch': <Radio className="w-3.5 h-3.5" />,
  'Automation': <Zap className="w-3.5 h-3.5" />,
  'Mapping': <MapPin className="w-3.5 h-3.5" />,
};

type CategoryFilter = 'all' | 'Calendar' | 'Messaging' | 'Data' | 'Safety' | 'Reporting' | 'EMS' | 'Dispatch' | 'Automation' | 'Mapping';

const ALL_CATEGORIES: CategoryFilter[] = ['all', 'Calendar', 'Messaging', 'Data', 'Safety', 'Reporting', 'EMS', 'Dispatch', 'Automation', 'Mapping'];

// Integration types that need webhook URL config
const WEBHOOK_TYPES = new Set(['slack', 'discord', 'microsoft-teams']);
// Integration types that need specific config forms
const CONFIG_TYPES = new Set(['nws-weather', 'nfirs-export', 'nemsis-export', 'generic-webhook', 'epcr-import']);

const inputClass = 'form-input';
const labelClass = 'form-label';

const IntegrationsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('integrations.manage');

  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [showConnectModal, setShowConnectModal] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);

  // Config form state
  const [webhookUrl, setWebhookUrl] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [fdid, setFdid] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [genericWebhookUrl, setGenericWebhookUrl] = useState('');
  const [genericWebhookSecret, setGenericWebhookSecret] = useState('');
  const [importFormat, setImportFormat] = useState('csv');

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
    void loadIntegrations();
  }, []);

  const getUI = (type: string) => INTEGRATION_UI[type] ?? DEFAULT_UI;

  const filteredIntegrations = integrations.filter(i => {
    const matchesSearch = i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (i.description ?? '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || i.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Derive visible categories from actual data
  const visibleCategories = ALL_CATEGORIES.filter(cat =>
    cat === 'all' || integrations.some(i => i.category === cat)
  );

  const connectedCount = integrations.filter(i => i.status === ConnectionStatus.CONNECTED).length;
  const availableCount = integrations.filter(i => i.status === 'available').length;

  const selectedIntegration = showConnectModal
    ? integrations.find(i => i.id === showConnectModal)
    : null;

  const resetFormState = () => {
    setWebhookUrl('');
    setZoneId('');
    setStateCode('');
    setFdid('');
    setAgencyId('');
    setGenericWebhookUrl('');
    setGenericWebhookSecret('');
    setImportFormat('csv');
  };

  const getConfigFromForm = (integrationType: string): Record<string, unknown> => {
    if (WEBHOOK_TYPES.has(integrationType)) {
      return { webhook_url: webhookUrl };
    }
    switch (integrationType) {
      case 'nws-weather':
        return { zone_id: zoneId };
      case 'nfirs-export':
        return { state_code: stateCode, state_fdid: fdid };
      case 'nemsis-export':
        return { state_code: stateCode, agency_id: agencyId };
      case 'generic-webhook':
        return { url: genericWebhookUrl, secret: genericWebhookSecret };
      case 'epcr-import':
        return { import_format: importFormat };
      default:
        return {};
    }
  };

  const handleConnect = async (integrationId: string) => {
    const integration = integrations.find(i => i.id === integrationId);
    if (!integration) return;

    setConnecting(true);
    try {
      const config = getConfigFromForm(integration.integration_type);
      const updated = await integrationsService.connectIntegration(integrationId, config);
      setIntegrations(prev => prev.map(i => i.id === integrationId ? updated : i));
      setShowConnectModal(null);
      resetFormState();
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

  const handleTestConnection = async (integrationId: string) => {
    setTesting(true);
    try {
      const result = await integrationsService.testConnection(integrationId);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Connection test failed'));
    } finally {
      setTesting(false);
    }
  };

  const renderConfigForm = (integration: IntegrationConfig) => {
    const itype = integration.integration_type;

    if (WEBHOOK_TYPES.has(itype)) {
      return (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Webhook URL</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className={inputClass}
            />
            <p className="text-xs text-theme-text-muted mt-1">
              {itype === 'slack' && 'Create an incoming webhook in your Slack workspace settings.'}
              {itype === 'discord' && 'Create a webhook in your Discord channel settings.'}
              {itype === 'microsoft-teams' && 'Create an incoming webhook in your Teams channel.'}
            </p>
          </div>
        </div>
      );
    }

    switch (itype) {
      case 'nws-weather':
        return (
          <div className="space-y-3">
            <div>
              <label className={labelClass}>NWS Zone ID</label>
              <input
                type="text"
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value.toUpperCase())}
                placeholder="NYZ072"
                pattern="[A-Z]{2}[CZ]\d{3}"
                className={inputClass}
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Find your zone at weather.gov. Format: state code + C/Z + 3 digits (e.g., NYZ072, CAC006).
              </p>
            </div>
          </div>
        );

      case 'nfirs-export':
        return (
          <div className="space-y-3">
            <div>
              <label className={labelClass}>State Code</label>
              <input type="text" value={stateCode} onChange={(e) => setStateCode(e.target.value.toUpperCase())} placeholder="NY" maxLength={2} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Fire Department ID (FDID)</label>
              <input type="text" value={fdid} onChange={(e) => setFdid(e.target.value)} placeholder="12345" className={inputClass} />
              <p className="text-xs text-theme-text-muted mt-1">Your state-assigned FDID for NFIRS reporting.</p>
            </div>
          </div>
        );

      case 'nemsis-export':
        return (
          <div className="space-y-3">
            <div>
              <label className={labelClass}>State Code</label>
              <input type="text" value={stateCode} onChange={(e) => setStateCode(e.target.value.toUpperCase())} placeholder="NY" maxLength={2} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>State-Assigned Agency ID</label>
              <input type="text" value={agencyId} onChange={(e) => setAgencyId(e.target.value)} placeholder="A12345" className={inputClass} />
            </div>
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <p className="text-amber-700 dark:text-amber-400 text-xs">
                Exports dispatch/response data only (timestamps, disposition, crew). Clinical data (vitals, medications, procedures) requires your ePCR vendor.
              </p>
            </div>
          </div>
        );

      case 'generic-webhook':
        return (
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Webhook URL</label>
              <input type="url" value={genericWebhookUrl} onChange={(e) => setGenericWebhookUrl(e.target.value)} placeholder="https://example.com/webhook" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Secret (optional)</label>
              <input type="password" value={genericWebhookSecret} onChange={(e) => setGenericWebhookSecret(e.target.value)} placeholder="HMAC signing secret" className={inputClass} />
              <p className="text-xs text-theme-text-muted mt-1">Used for HMAC-SHA256 signature in X-Webhook-Signature header.</p>
            </div>
          </div>
        );

      case 'epcr-import':
        return (
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Import Format</label>
              <select value={importFormat} onChange={(e) => setImportFormat(e.target.value)} className={inputClass}>
                <option value="csv">CSV (any vendor)</option>
                <option value="nemsis_xml">NEMSIS 3.5 XML</option>
              </select>
              <p className="text-xs text-theme-text-muted mt-1">
                Works with file exports from ImageTrend, ESO, Zoll, or any ePCR vendor. Upload files after connecting.
              </p>
            </div>
            {integration.contains_phi && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">
                <div className="flex items-start space-x-2">
                  <Shield className="w-4 h-4 text-rose-700 dark:text-rose-400 mt-0.5 shrink-0" />
                  <p className="text-rose-700 dark:text-rose-400 text-xs">
                    This integration handles protected health information (PHI). Uploaded files are processed and deleted — only dispatch/response data is stored.
                  </p>
                </div>
              </div>
            )}
          </div>
        );

      default:
        return null;
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
              <Plug className="w-6 h-6 text-white" aria-hidden="true" />
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
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Available Integrations</p>
            <p className="text-theme-text-primary text-2xl font-bold mt-1">{integrations.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Connected</p>
            <p className="text-green-700 dark:text-green-400 text-2xl font-bold mt-1">{connectedCount}</p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Ready to Connect</p>
            <p className="text-indigo-700 dark:text-indigo-400 text-2xl font-bold mt-1">{availableCount}</p>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="card mb-6 p-4" role="search" aria-label="Search and filter integrations">
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
                className="form-input pl-10 placeholder-theme-text-muted pr-4"
              />
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
              {visibleCategories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  aria-pressed={categoryFilter === cat}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${
                    categoryFilter === cat
                      ? 'bg-indigo-600 text-white'
                      : 'bg-theme-surface-secondary text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  {cat !== 'all' && CATEGORY_ICONS[cat]}
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
            return (
              <div key={integration.id} data-testid={`integration-card-${integration.integration_type}`} className="stat-card hover:border-indigo-500/30 transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-lg ${ui.bgColor} ${ui.color}`}>
                      {ui.icon}
                    </div>
                    <div>
                      <h3 className="text-theme-text-primary font-semibold">{integration.name}</h3>
                      <span className="text-theme-text-muted text-xs">{integration.category}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {integration.status === ConnectionStatus.CONNECTED && (
                      <span className="flex items-center space-x-1 px-2 py-0.5 text-xs bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/30 rounded-sm">
                        <Wifi className="w-3 h-3" />
                        <span>Connected</span>
                      </span>
                    )}
                    {integration.status === 'coming_soon' && (
                      <span className="px-2 py-0.5 text-xs bg-theme-surface-secondary text-theme-text-muted border border-theme-surface-border rounded-sm">
                        Coming Soon
                      </span>
                    )}
                    {integration.contains_phi && (
                      <span className="px-2 py-0.5 text-xs bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30 rounded-sm">
                        PHI
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-theme-text-secondary text-sm mb-3">{integration.description}</p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {ui.features.map((feature) => (
                    <span key={feature} className={`px-2 py-0.5 text-xs rounded-sm ${ui.bgColor} ${ui.color}`}>
                      {feature}
                    </span>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  {integration.status === ConnectionStatus.CONNECTED && canManage && (
                    <>
                      <button
                        onClick={() => { void handleTestConnection(integration.id); }}
                        disabled={testing}
                        className="px-3 py-1.5 text-sm bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors flex items-center space-x-1"
                      >
                        <Bell className="w-3.5 h-3.5" />
                        <span>Test</span>
                      </button>
                      <button
                        onClick={() => { void handleDisconnect(integration.id); }}
                        className="px-3 py-1.5 text-sm bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors flex items-center space-x-1"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        <span>Disconnect</span>
                      </button>
                    </>
                  )}
                  {integration.status === 'available' && canManage && (
                    <button
                      onClick={() => { resetFormState(); setShowConnectModal(integration.id); }}
                      className="px-4 py-1.5 text-sm bg-indigo-600/20 text-indigo-700 hover:bg-indigo-600/30 rounded-lg transition-colors flex items-center space-x-1"
                    >
                      <Plug className="w-3.5 h-3.5" />
                      <span>Connect</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {filteredIntegrations.length === 0 && (
          <div className="text-center py-12">
            <Plug className="w-12 h-12 text-theme-text-muted mx-auto mb-4" />
            <p className="text-theme-text-secondary text-lg">No integrations match your search</p>
            <p className="text-theme-text-muted text-sm mt-1">Try a different search term or category filter</p>
          </div>
        )}

        {/* Connect Modal */}
        {showConnectModal && selectedIntegration && (() => {
          const ui = getUI(selectedIntegration.integration_type);
          const hasConfigForm = WEBHOOK_TYPES.has(selectedIntegration.integration_type) || CONFIG_TYPES.has(selectedIntegration.integration_type);

          return (
            <div className="fixed inset-0 z-50 overflow-y-auto">
              <div className="flex items-center justify-center min-h-screen px-4">
                <div className="fixed inset-0 bg-black/60" onClick={() => { setShowConnectModal(null); resetFormState(); }} />
                <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border">
                  <div className="px-6 pt-5 pb-4">
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center space-x-3">
                        <div className={`p-2 rounded-lg ${ui.bgColor} ${ui.color}`}>
                          {ui.icon}
                        </div>
                        <h3 className="text-lg font-medium text-theme-text-primary">Connect {selectedIntegration.name}</h3>
                      </div>
                      <button onClick={() => { setShowConnectModal(null); resetFormState(); }} className="text-theme-text-muted hover:text-theme-text-primary">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <p className="text-theme-text-secondary text-sm mb-4">{selectedIntegration.description}</p>

                    {/* Integration-specific config form */}
                    {hasConfigForm && (
                      <div className="mb-4">
                        {renderConfigForm(selectedIntegration)}
                      </div>
                    )}

                    {/* Features list for non-config integrations */}
                    {!hasConfigForm && (
                      <div className="space-y-3 mb-4">
                        <h4 className="text-theme-text-primary text-sm font-medium">Features included:</h4>
                        {ui.features.map((feature) => (
                          <div key={feature} className="flex items-center space-x-2">
                            <Check className="w-4 h-4 text-green-700 dark:text-green-400" />
                            <span className="text-theme-text-secondary text-sm">{feature}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <AlertCircle className="w-4 h-4 text-indigo-700 mt-0.5 shrink-0" />
                        <p className="text-indigo-700 text-sm">
                          Clicking Connect will enable this integration for your organization. You can disconnect it at any time.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-theme-input-bg px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                    <button
                      onClick={() => { setShowConnectModal(null); resetFormState(); }}
                      className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-input-bg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { void handleConnect(selectedIntegration.id); }}
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
