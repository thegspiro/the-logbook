import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  Users,
  RefreshCw,
  Upload,
  Download,
  ListChecks,
  Eye,
  ExternalLink,
  CheckCircle2,
  XCircle,
  FileSignature,
  CalendarClock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import {
  integrationsService,
  type IntegrationConfig,
  type SalesforceReadiness,
  type SalesforcePreviewResult,
  type CalcomBooking,
} from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { ConnectionStatus } from '../constants/enums';
import { formatDateTime } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';

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
  'salesforce': {
    icon: <Users className="w-6 h-6" />,
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-500/10',
    features: ['Contact sync', 'Donor management', 'Event push', 'Bidirectional sync'],
  },
  'documenso': {
    icon: <FileSignature className="w-6 h-6" />,
    color: 'text-yellow-700 dark:text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    features: ['E-signatures', 'Self-hostable', 'Open source'],
  },
  'calcom': {
    icon: <CalendarClock className="w-6 h-6" />,
    color: 'text-slate-700 dark:text-slate-300',
    bgColor: 'bg-slate-500/10',
    features: ['Booking sync', 'Interviews', 'Self-hostable'],
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
  'CRM': <Users className="w-3.5 h-3.5" />,
  'Documents': <FileSignature className="w-3.5 h-3.5" />,
  'Scheduling': <CalendarClock className="w-3.5 h-3.5" />,
};

type CategoryFilter = 'all' | 'Calendar' | 'Messaging' | 'Data' | 'CRM' | 'Safety' | 'Reporting' | 'EMS' | 'Dispatch' | 'Automation' | 'Mapping' | 'Documents' | 'Scheduling';

const ALL_CATEGORIES: CategoryFilter[] = ['all', 'Calendar', 'Messaging', 'Data', 'CRM', 'Safety', 'Reporting', 'EMS', 'Dispatch', 'Automation', 'Mapping', 'Documents', 'Scheduling'];

// Integration types that need webhook URL config
const WEBHOOK_TYPES = new Set(['slack', 'discord', 'microsoft-teams']);
// Integration types that need specific config forms
const CONFIG_TYPES = new Set(['nws-weather', 'nfirs-export', 'nemsis-export', 'generic-webhook', 'epcr-import', 'salesforce', 'documenso', 'calcom']);

const inputClass = 'form-input';
const labelClass = 'form-label';

// Public inbound-webhook URL a department pastes into Documenso / Cal.com so
// signing/booking events auto-advance the matching prospect's pipeline stage.
const webhookCallbackUrl = (provider: 'documenso' | 'calcom', integrationId: string): string =>
  `${window.location.origin}/api/public/v1/webhooks/${provider}/${integrationId}`;

const IntegrationsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('integrations.manage');
  const location = useLocation();
  const navigate = useNavigate();
  const tz = useTimezone();

  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [showConnectModal, setShowConnectModal] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [showBookingsPanel, setShowBookingsPanel] = useState(false);
  const [calcomBookings, setCalcomBookings] = useState<CalcomBooking[] | null>(null);
  const [loadingBookings, setLoadingBookings] = useState(false);

  // Salesforce readiness / preview panel state
  const [readiness, setReadiness] = useState<SalesforceReadiness | null>(null);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [preview, setPreview] = useState<SalesforcePreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Config form state
  const [webhookUrl, setWebhookUrl] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [fdid, setFdid] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [genericWebhookUrl, setGenericWebhookUrl] = useState('');
  const [genericWebhookSecret, setGenericWebhookSecret] = useState('');
  const [importFormat, setImportFormat] = useState('csv');
  const [sfInstanceUrl, setSfInstanceUrl] = useState('');
  const [sfClientId, setSfClientId] = useState('');
  const [sfClientSecret, setSfClientSecret] = useState('');
  const [sfRefreshToken, setSfRefreshToken] = useState('');
  const [sfEnvironment, setSfEnvironment] = useState('production');
  const [sfSyncDirection, setSfSyncDirection] = useState('push');
  const [sfMatchStrategy, setSfMatchStrategy] = useState('email');
  const [sfGracefulFields, setSfGracefulFields] = useState(true);
  const [sfAutoSync, setSfAutoSync] = useState(false);
  const [documensoBaseUrl, setDocumensoBaseUrl] = useState('');
  const [documensoApiToken, setDocumensoApiToken] = useState('');
  const [documensoWebhookSecret, setDocumensoWebhookSecret] = useState('');
  const [calcomBaseUrl, setCalcomBaseUrl] = useState('');
  const [calcomApiKey, setCalcomApiKey] = useState('');
  const [calcomWebhookSecret, setCalcomWebhookSecret] = useState('');

  const loadIntegrations = useCallback(async () => {
    try {
      const data = await integrationsService.getIntegrations();
      setIntegrations(data);
    } catch {
      toast.error('Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIntegrations();
  }, [loadIntegrations]);

  // Handle the return leg of the Salesforce OAuth redirect. The backend sends
  // the browser back to /integrations?salesforce=connected (or
  // ?salesforce_error=<code>); surface the outcome, refresh, and strip the param
  // so a page refresh does not re-trigger the toast.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const connected = params.get('salesforce');
    const sfError = params.get('salesforce_error');
    if (connected === 'connected') {
      toast.success('Salesforce connected successfully!');
      setShowConnectModal(null);
      void loadIntegrations();
      navigate('/integrations', { replace: true });
    } else if (sfError) {
      toast.error(`Salesforce connection failed: ${sfError.replace(/_/g, ' ')}`);
      navigate('/integrations', { replace: true });
    }
  }, [location.search, navigate, loadIntegrations]);

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
    setSfInstanceUrl('');
    setSfClientId('');
    setSfClientSecret('');
    setSfRefreshToken('');
    setSfEnvironment('production');
    setSfSyncDirection('push');
    setSfMatchStrategy('email');
    setSfGracefulFields(true);
    setSfAutoSync(false);
    setDocumensoBaseUrl('');
    setDocumensoApiToken('');
    setDocumensoWebhookSecret('');
    setCalcomBaseUrl('');
    setCalcomApiKey('');
    setCalcomWebhookSecret('');
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
      case 'documenso':
        return {
          api_base_url: documensoBaseUrl.trim() || undefined,
          api_token: documensoApiToken.trim() || undefined,
          webhook_secret: documensoWebhookSecret.trim() || undefined,
        };
      case 'calcom':
        return {
          api_base_url: calcomBaseUrl.trim() || undefined,
          api_key: calcomApiKey.trim() || undefined,
          webhook_secret: calcomWebhookSecret.trim() || undefined,
        };
      case 'salesforce':
        return {
          instance_url: sfInstanceUrl,
          client_id: sfClientId || undefined,
          client_secret: sfClientSecret || undefined,
          refresh_token: sfRefreshToken || undefined,
          environment: sfEnvironment,
          sync_direction: sfSyncDirection,
          match_strategy: sfMatchStrategy,
          graceful_fields: sfGracefulFields,
          auto_sync_enabled: sfAutoSync,
        };
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

  const handleToggleBookings = async () => {
    const next = !showBookingsPanel;
    setShowBookingsPanel(next);
    if (next && calcomBookings === null) {
      setLoadingBookings(true);
      try {
        setCalcomBookings(await integrationsService.getCalcomBookings());
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load Cal.com bookings'));
        setCalcomBookings([]);
      } finally {
        setLoadingBookings(false);
      }
    }
  };

  const handleSalesforceSync = async (syncType: 'members' | 'training' | 'events' | 'pull-contacts') => {
    setSyncing(syncType);
    try {
      if (syncType === 'members') {
        const result = await integrationsService.salesforcePushMembers();
        toast.success(result.message);
      } else if (syncType === 'training') {
        const result = await integrationsService.salesforcePushTraining();
        toast.success(result.message);
      } else if (syncType === 'events') {
        const result = await integrationsService.salesforcePushEvents();
        toast.success(result.message);
      } else if (syncType === 'pull-contacts') {
        const result = await integrationsService.salesforcePullContacts();
        if (!result.inbound_enabled) {
          toast.success(
            `Pulled ${result.count} contacts for review. Set sync direction to Pull or Bidirectional to apply them.`
          );
        } else {
          toast.success(
            `Pulled ${result.count} contacts: ${result.updated} member(s) updated, ${result.unmatched} unmatched.`
          );
        }
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Sync failed'));
    } finally {
      setSyncing(null);
    }
  };

  const handleSalesforceOAuth = async (integrationId: string) => {
    if (!sfInstanceUrl.trim()) {
      toast.error('Enter your Salesforce instance URL before connecting');
      return;
    }
    setConnecting(true);
    try {
      // Persist the entered config (instance URL, environment, match strategy,
      // and any Connected App credentials) so the authorize endpoint can read
      // them, then hand off to Salesforce's consent screen. The OAuth callback
      // marks the integration connected and stores the refresh token.
      await integrationsService.updateIntegration(integrationId, getConfigFromForm('salesforce'));
      window.location.href = integrationsService.getSalesforceOAuthUrl();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to start Salesforce connection'));
      setConnecting(false);
    }
  };

  const handleCheckReadiness = async () => {
    setCheckingReadiness(true);
    try {
      const result = await integrationsService.salesforceReadiness();
      setReadiness(result);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Readiness check failed'));
    } finally {
      setCheckingReadiness(false);
    }
  };

  const handlePreviewMembers = async () => {
    setPreviewing(true);
    try {
      const result = await integrationsService.salesforcePreviewMembers();
      setPreview(result);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Preview failed'));
    } finally {
      setPreviewing(false);
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
              <label htmlFor="nws-zone-id" className={labelClass}>NWS Zone ID</label>
              <input
                id="nws-zone-id"
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
              <label htmlFor="nfirs-state-code" className={labelClass}>State Code</label>
              <input id="nfirs-state-code" type="text" value={stateCode} onChange={(e) => setStateCode(e.target.value.toUpperCase())} placeholder="NY" maxLength={2} className={inputClass} />
            </div>
            <div>
              <label htmlFor="nfirs-fdid" className={labelClass}>Fire Department ID (FDID)</label>
              <input id="nfirs-fdid" type="text" value={fdid} onChange={(e) => setFdid(e.target.value)} placeholder="12345" className={inputClass} />
              <p className="text-xs text-theme-text-muted mt-1">Your state-assigned FDID for NFIRS reporting.</p>
            </div>
          </div>
        );

      case 'nemsis-export':
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="nemsis-state-code" className={labelClass}>State Code</label>
              <input id="nemsis-state-code" type="text" value={stateCode} onChange={(e) => setStateCode(e.target.value.toUpperCase())} placeholder="NY" maxLength={2} className={inputClass} />
            </div>
            <div>
              <label htmlFor="nemsis-agency-id" className={labelClass}>State-Assigned Agency ID</label>
              <input id="nemsis-agency-id" type="text" value={agencyId} onChange={(e) => setAgencyId(e.target.value)} placeholder="A12345" className={inputClass} />
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
              <label htmlFor="webhook-url" className={labelClass}>Webhook URL</label>
              <input id="webhook-url" type="url" value={genericWebhookUrl} onChange={(e) => setGenericWebhookUrl(e.target.value)} placeholder="https://example.com/webhook" className={inputClass} />
            </div>
            <div>
              <label htmlFor="webhook-secret" className={labelClass}>Secret (optional)</label>
              <input id="webhook-secret" type="password" value={genericWebhookSecret} onChange={(e) => setGenericWebhookSecret(e.target.value)} placeholder="HMAC signing secret" className={inputClass} />
              <p className="text-xs text-theme-text-muted mt-1">Used for HMAC-SHA256 signature in X-Webhook-Signature header.</p>
            </div>
          </div>
        );

      case 'epcr-import':
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="epcr-import-format" className={labelClass}>Import Format</label>
              <select id="epcr-import-format" value={importFormat} onChange={(e) => setImportFormat(e.target.value)} className={inputClass}>
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

      case 'salesforce':
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="sf-instance-url" className={labelClass}>Salesforce Instance URL</label>
              <input
                id="sf-instance-url"
                type="url"
                value={sfInstanceUrl}
                onChange={(e) => setSfInstanceUrl(e.target.value.trim())}
                placeholder="https://yourorg.my.salesforce.com"
                className={inputClass}
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Your Salesforce org URL (e.g., https://yourorg.my.salesforce.com).
              </p>
            </div>
            <div>
              <label htmlFor="sf-environment" className={labelClass}>Environment</label>
              <select
                id="sf-environment"
                value={sfEnvironment}
                onChange={(e) => setSfEnvironment(e.target.value)}
                className={inputClass}
              >
                <option value="production">Production</option>
                <option value="sandbox">Sandbox</option>
              </select>
              <p className="text-xs text-theme-text-muted mt-1">
                Select Sandbox if connecting to a Salesforce sandbox org for testing.
              </p>
            </div>
            <div>
              <label htmlFor="sf-match-strategy" className={labelClass}>Contact Matching</label>
              <select
                id="sf-match-strategy"
                value={sfMatchStrategy}
                onChange={(e) => setSfMatchStrategy(e.target.value)}
                className={inputClass}
              >
                <option value="email">Match by email (recommended)</option>
                <option value="email_lastname">Match by email + last name (stricter)</option>
                <option value="external_id">Never match &mdash; always create new</option>
              </select>
              <p className="text-xs text-theme-text-muted mt-1">
                How to reconcile members with Contacts your org may already have.
                Matching avoids creating duplicate Contacts.
              </p>
            </div>

            {/* Recommended path: one-click OAuth */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => { void handleSalesforceOAuth(integration.id); }}
                disabled={connecting}
                className="w-full px-4 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <ExternalLink className="w-4 h-4" />
                <span>{connecting ? 'Redirecting…' : 'Connect with Salesforce'}</span>
              </button>
              <p className="text-xs text-theme-text-muted mt-1">
                Recommended. Redirects you to Salesforce to grant access &mdash; no
                refresh token to copy. Uses your department&apos;s Connected App if
                configured below, otherwise the platform&apos;s.
              </p>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-theme-surface-border" />
              <span className="text-xs text-theme-text-muted uppercase">or connect manually</span>
              <div className="flex-1 h-px bg-theme-surface-border" />
            </div>

            <div>
              <label htmlFor="sf-client-id" className={labelClass}>Connected App Client ID</label>
              <input
                id="sf-client-id"
                type="text"
                value={sfClientId}
                onChange={(e) => setSfClientId(e.target.value)}
                placeholder="3MVG9... (optional if using the platform app)"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="sf-client-secret" className={labelClass}>Client Secret</label>
              <input
                id="sf-client-secret"
                type="password"
                value={sfClientSecret}
                onChange={(e) => setSfClientSecret(e.target.value)}
                placeholder="Connected App client secret"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="sf-refresh-token" className={labelClass}>Refresh Token</label>
              <input
                id="sf-refresh-token"
                type="password"
                value={sfRefreshToken}
                onChange={(e) => setSfRefreshToken(e.target.value)}
                placeholder="OAuth refresh token"
                className={inputClass}
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Only needed for manual connection. Leave blank if using
                &quot;Connect with Salesforce&quot; above. Then click Connect below.
              </p>
            </div>
            <div>
              <label htmlFor="sf-sync-direction" className={labelClass}>Sync Direction</label>
              <select
                id="sf-sync-direction"
                value={sfSyncDirection}
                onChange={(e) => setSfSyncDirection(e.target.value)}
                className={inputClass}
              >
                <option value="push">Push (Logbook &rarr; Salesforce)</option>
                <option value="pull">Pull (Salesforce &rarr; Logbook)</option>
                <option value="both">Bidirectional</option>
              </select>
            </div>
            <div className="flex items-start gap-2">
              <input
                id="sf-graceful-fields"
                type="checkbox"
                checked={sfGracefulFields}
                onChange={(e) => setSfGracefulFields(e.target.checked)}
                className="mt-0.5"
              />
              <label htmlFor="sf-graceful-fields" className="text-xs text-theme-text-secondary">
                Skip custom fields my Salesforce org hasn&apos;t created yet
                (recommended while building out your org).
              </label>
            </div>
            <div className="flex items-start gap-2">
              <input
                id="sf-auto-sync"
                type="checkbox"
                checked={sfAutoSync}
                onChange={(e) => setSfAutoSync(e.target.checked)}
                className="mt-0.5"
              />
              <label htmlFor="sf-auto-sync" className="text-xs text-theme-text-secondary">
                Automatically sync every 30 minutes (per the sync direction
                above), in addition to the manual sync buttons.
              </label>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <p className="text-blue-700 dark:text-blue-400 text-xs">
                Create a Connected App in Salesforce Setup &rarr; App Manager with the &quot;api&quot; and &quot;refresh_token&quot; OAuth scopes, and add this app&apos;s callback URL to it.
              </p>
            </div>
          </div>
        );

      case 'documenso':
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="documenso-token" className={labelClass}>API Token</label>
              <input
                id="documenso-token"
                type="password"
                value={documensoApiToken}
                onChange={(e) => setDocumensoApiToken(e.target.value)}
                placeholder="api_..."
                className={inputClass}
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Create an API token in Documenso under Settings &rarr; API.
              </p>
            </div>
            <div>
              <label htmlFor="documenso-base-url" className={labelClass}>API Base URL (optional)</label>
              <input
                id="documenso-base-url"
                type="url"
                value={documensoBaseUrl}
                onChange={(e) => setDocumensoBaseUrl(e.target.value.trim())}
                placeholder="https://app.documenso.com/api/v1"
                className={inputClass}
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Leave blank for Documenso Cloud. Self-hosted instances use https://your-host/api/v1.
              </p>
            </div>
            <div>
              <label htmlFor="documenso-webhook-secret" className={labelClass}>Webhook Secret (optional)</label>
              <input
                id="documenso-webhook-secret"
                type="password"
                value={documensoWebhookSecret}
                onChange={(e) => setDocumensoWebhookSecret(e.target.value)}
                placeholder="Shared secret for inbound webhooks"
                className={inputClass}
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Set a secret to auto-advance a prospect&apos;s signing stage when they finish signing. Add this Webhook URL in Documenso (send it as the <code>X-Documenso-Secret</code> header):
              </p>
              <code className="mt-1 block break-all rounded bg-theme-surface-secondary px-2 py-1 text-xs text-theme-text-secondary">
                {webhookCallbackUrl('documenso', integration.id)}
              </code>
            </div>
          </div>
        );

      case 'calcom':
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="calcom-key" className={labelClass}>API Key</label>
              <input
                id="calcom-key"
                type="password"
                value={calcomApiKey}
                onChange={(e) => setCalcomApiKey(e.target.value)}
                placeholder="cal_..."
                className={inputClass}
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Create an API key in Cal.com under Settings &rarr; Developer &rarr; API keys.
              </p>
            </div>
            <div>
              <label htmlFor="calcom-base-url" className={labelClass}>API Base URL (optional)</label>
              <input
                id="calcom-base-url"
                type="url"
                value={calcomBaseUrl}
                onChange={(e) => setCalcomBaseUrl(e.target.value.trim())}
                placeholder="https://api.cal.com/v1"
                className={inputClass}
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Leave blank for Cal.com Cloud. Self-hosted instances use https://your-host/api/v1.
              </p>
            </div>
            <div>
              <label htmlFor="calcom-webhook-secret" className={labelClass}>Webhook Secret (optional)</label>
              <input
                id="calcom-webhook-secret"
                type="password"
                value={calcomWebhookSecret}
                onChange={(e) => setCalcomWebhookSecret(e.target.value)}
                placeholder="Signing secret for inbound webhooks"
                className={inputClass}
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Set a secret to auto-advance a prospect&apos;s interview stage when they book. Add this URL as a Cal.com webhook (BOOKING_CREATED) using the same secret:
              </p>
              <code className="mt-1 block break-all rounded bg-theme-surface-secondary px-2 py-1 text-xs text-theme-text-secondary">
                {webhookCallbackUrl('calcom', integration.id)}
              </code>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
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
                aria-label="Search integrations..." placeholder="Search integrations..."
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
                      {integration.integration_type === 'salesforce' && (
                        <button
                          onClick={() => setShowSyncPanel(!showSyncPanel)}
                          className="px-3 py-1.5 text-sm bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors flex items-center space-x-1"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Sync</span>
                        </button>
                      )}
                      {integration.integration_type === 'calcom' && (
                        <button
                          onClick={() => { void handleToggleBookings(); }}
                          className="px-3 py-1.5 text-sm bg-slate-500/10 text-slate-700 dark:text-slate-300 hover:bg-slate-500/20 rounded-lg transition-colors flex items-center space-x-1"
                        >
                          <CalendarClock className="w-3.5 h-3.5" />
                          <span>Bookings</span>
                        </button>
                      )}
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

        {/* Cal.com Bookings Panel */}
        {showBookingsPanel && integrations.some(i => i.integration_type === 'calcom' && i.status === ConnectionStatus.CONNECTED) && (
          <div className="card mt-6 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-slate-500/10 text-slate-700 dark:text-slate-300">
                  <CalendarClock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-theme-text-primary font-semibold">Cal.com Bookings</h3>
                  <p className="text-theme-text-muted text-xs">Upcoming bookings from your connected Cal.com account</p>
                </div>
              </div>
              <button onClick={() => setShowBookingsPanel(false)} className="text-theme-text-muted hover:text-theme-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingBookings ? (
              <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
                <Loader2 className="w-6 h-6 text-theme-text-muted animate-spin" />
                <span className="sr-only">Loading bookings…</span>
              </div>
            ) : calcomBookings && calcomBookings.length > 0 ? (
              <ul className="divide-y divide-theme-surface-border">
                {calcomBookings.map((b) => (
                  <li key={b.external_id || `${b.title}-${b.start_time}`} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-theme-text-primary text-sm font-medium truncate">{b.title || 'Booking'}</p>
                        {b.attendee_emails.length > 0 && (
                          <p className="text-theme-text-muted text-xs truncate">{b.attendee_emails.join(', ')}</p>
                        )}
                        {b.location && (
                          <p className="text-theme-text-muted text-xs truncate">{b.location}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        {b.start_time && (
                          <p className="text-theme-text-secondary text-xs">{formatDateTime(b.start_time, tz)}</p>
                        )}
                        {b.status && (
                          <span className="text-theme-text-muted text-xs capitalize">{b.status}</span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-center py-8">
                <CalendarClock className="w-8 h-8 text-theme-text-muted mx-auto mb-2" />
                <p className="text-theme-text-secondary text-sm">No upcoming bookings</p>
              </div>
            )}
          </div>
        )}

        {/* Salesforce Sync Panel */}
        {showSyncPanel && integrations.some(i => i.integration_type === 'salesforce' && i.status === ConnectionStatus.CONNECTED) && (
          <div className="card mt-6 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-400">
                  <RefreshCw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-theme-text-primary font-semibold">Salesforce Sync</h3>
                  <p className="text-theme-text-muted text-xs">Push data to or pull data from Salesforce</p>
                </div>
              </div>
              <button onClick={() => setShowSyncPanel(false)} className="text-theme-text-muted hover:text-theme-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Push section */}
              <div className="space-y-3">
                <h4 className="text-theme-text-primary text-sm font-medium flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  Push to Salesforce
                </h4>
                <button
                  onClick={() => { void handleSalesforceSync('members'); }}
                  disabled={syncing !== null}
                  className="w-full px-4 py-2.5 text-sm bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors flex items-center justify-between disabled:opacity-50"
                >
                  <span>Members &rarr; Contacts</span>
                  {syncing === 'members' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => { void handleSalesforceSync('training'); }}
                  disabled={syncing !== null}
                  className="w-full px-4 py-2.5 text-sm bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors flex items-center justify-between disabled:opacity-50"
                >
                  <span>Training Records &rarr; Tasks</span>
                  {syncing === 'training' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clipboard className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => { void handleSalesforceSync('events'); }}
                  disabled={syncing !== null}
                  className="w-full px-4 py-2.5 text-sm bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors flex items-center justify-between disabled:opacity-50"
                >
                  <span>Events &rarr; Salesforce Events</span>
                  {syncing === 'events' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
                </button>
              </div>

              {/* Pull section */}
              <div className="space-y-3">
                <h4 className="text-theme-text-primary text-sm font-medium flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Pull from Salesforce
                </h4>
                <button
                  onClick={() => { void handleSalesforceSync('pull-contacts'); }}
                  disabled={syncing !== null}
                  className="w-full px-4 py-2.5 text-sm bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors flex items-center justify-between disabled:opacity-50"
                >
                  <span>Contacts &rarr; Members</span>
                  {syncing === 'pull-contacts' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                </button>
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mt-2">
                  <p className="text-blue-700 dark:text-blue-400 text-xs">
                    Matches contacts to existing members (by ID, then email) and updates their contact details. Members are never created or deleted. Requires sync direction Pull or Bidirectional. Real-time updates also arrive via the Salesforce webhook.
                  </p>
                </div>
              </div>
            </div>

            {/* Readiness & dry-run preview */}
            <div className="mt-4 pt-4 border-t border-theme-surface-border">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button
                  onClick={() => { void handleCheckReadiness(); }}
                  disabled={checkingReadiness}
                  className="px-3 py-1.5 text-sm bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {checkingReadiness ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListChecks className="w-3.5 h-3.5" />}
                  <span>Check readiness</span>
                </button>
                <button
                  onClick={() => { void handlePreviewMembers(); }}
                  disabled={previewing}
                  className="px-3 py-1.5 text-sm bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>Preview member sync</span>
                </button>
              </div>

              {readiness && (
                <div className="bg-theme-surface-secondary rounded-lg p-3 mb-3 text-xs">
                  <div className="flex items-center gap-2 mb-2">
                    {readiness.ready ? (
                      <span className="flex items-center gap-1 text-green-700 dark:text-green-400 font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Ready &mdash; sync will not create duplicates
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                        <AlertCircle className="w-4 h-4" />
                        {readiness.connected
                          ? 'Connected, but setup needed for duplicate-free sync'
                          : 'Not connected to Salesforce'}
                      </span>
                    )}
                  </div>
                  {!readiness.connected && readiness.error && (
                    <p className="text-theme-text-muted">{readiness.error}</p>
                  )}
                  {readiness.connected && (
                    <div className="space-y-1">
                      {Object.entries(readiness.objects).map(([name, obj]) => {
                        const ok = obj.missing_fields.length === 0 && !obj.error;
                        return (
                          <div key={name} className="flex items-start gap-2">
                            {ok ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-700 dark:text-green-400 mt-0.5 shrink-0" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
                            )}
                            <div>
                              <span className="text-theme-text-primary font-medium">{name}</span>
                              {obj.error ? (
                                <span className="text-theme-text-muted"> &mdash; {obj.error}</span>
                              ) : obj.missing_fields.length > 0 ? (
                                <span className="text-theme-text-muted"> &mdash; missing: {obj.missing_fields.join(', ')}</span>
                              ) : (
                                <span className="text-theme-text-muted"> &mdash; all fields present</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {!readiness.external_id_fields_ready && (
                        <p className="text-amber-700 dark:text-amber-400 mt-1">
                          Add the missing Logbook_*__c external-ID fields in Salesforce to guarantee duplicate-free sync.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {preview && (
                <div className="bg-theme-surface-secondary rounded-lg p-3 mb-3 text-xs">
                  <p className="text-theme-text-primary font-medium mb-1">
                    Member sync preview ({preview.total} member{preview.total === 1 ? '' : 's'})
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-theme-text-secondary">
                    <span><span className="text-theme-text-primary font-medium">{preview.would_create}</span> new</span>
                    <span><span className="text-theme-text-primary font-medium">{preview.would_update}</span> updated</span>
                    <span><span className="text-theme-text-primary font-medium">{preview.would_adopt}</span> matched existing</span>
                    <span><span className="text-theme-text-primary font-medium">{preview.skipped}</span> skipped</span>
                  </div>
                  <p className="text-theme-text-muted mt-1">
                    Nothing has been written. Use &quot;Members &rarr; Contacts&quot; above to run the sync.
                  </p>
                </div>
              )}

              <p className="text-theme-text-muted text-xs">
                Events and training are also pushed automatically when sync direction is set to &quot;Push&quot; or &quot;Both&quot;.
              </p>
            </div>
          </div>
        )}

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
                <div className="fixed inset-0 bg-black/60" onClick={() => { setShowConnectModal(null); resetFormState(); }} aria-hidden="true" />
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
                      data-testid="connect-submit"
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
