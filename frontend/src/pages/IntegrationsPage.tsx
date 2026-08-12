import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
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
  Wallet,
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
    icon: <Calendar className="h-6 w-6" />,
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-500/10',
    features: ['Event sync', 'Two-way sync', 'Auto-create events'],
  },
  outlook: {
    icon: <Calendar className="h-6 w-6" />,
    color: 'text-sky-700 dark:text-sky-400',
    bgColor: 'bg-sky-500/10',
    features: ['Calendar sync', 'Email notifications', 'Contact sync'],
  },
  slack: {
    icon: <MessageSquare className="h-6 w-6" />,
    color: 'text-purple-700 dark:text-purple-400',
    bgColor: 'bg-purple-500/10',
    features: ['Event alerts', 'Training reminders', 'Custom channels'],
  },
  discord: {
    icon: <MessageSquare className="h-6 w-6" />,
    color: 'text-indigo-700 dark:text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    features: ['Webhook notifications', 'Event reminders', 'Duty alerts'],
  },
  'csv-import': {
    icon: <Database className="h-6 w-6" />,
    color: 'text-emerald-700 dark:text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    features: ['Member import', 'Training export', 'Inventory export'],
  },
  ical: {
    icon: <Link className="h-6 w-6" />,
    color: 'text-orange-700 dark:text-orange-400',
    bgColor: 'bg-orange-500/10',
    features: ['Calendar feed URL', 'Auto-updates', 'Filtered feeds'],
  },
  'microsoft-teams': {
    icon: <MessageSquare className="h-6 w-6" />,
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-500/10',
    features: ['Adaptive Cards', 'Channel notifications', 'Event alerts'],
  },
  'nws-weather': {
    icon: <CloudSun className="h-6 w-6" />,
    color: 'text-amber-700 dark:text-amber-400',
    bgColor: 'bg-amber-500/10',
    features: ['Tornado alerts', 'Flood warnings', 'Fire weather'],
  },
  'nfirs-export': {
    icon: <FileText className="h-6 w-6" />,
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-500/10',
    features: ['NFIRS 5.0 format', 'State reporting', 'Incident data'],
  },
  'generic-webhook': {
    icon: <Globe className="h-6 w-6" />,
    color: 'text-cyan-700 dark:text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    features: ['HMAC signatures', 'Custom events', 'Retry logic'],
  },
  'epcr-import': {
    icon: <Clipboard className="h-6 w-6" />,
    color: 'text-rose-700 dark:text-rose-400',
    bgColor: 'bg-rose-500/10',
    features: ['CSV import', 'NEMSIS XML', 'Any vendor'],
  },
  'nemsis-export': {
    icon: <FileText className="h-6 w-6" />,
    color: 'text-rose-700 dark:text-rose-400',
    bgColor: 'bg-rose-500/10',
    features: ['NEMSIS 3.5', 'Response module', 'State EMS reporting'],
  },
  salesforce: {
    icon: <Users className="h-6 w-6" />,
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-500/10',
    features: ['Contact sync', 'Donor management', 'Event push', 'Bidirectional sync'],
  },
  documenso: {
    icon: <FileSignature className="h-6 w-6" />,
    color: 'text-yellow-700 dark:text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    features: ['E-signatures', 'Self-hostable', 'Open source'],
  },
  calcom: {
    icon: <CalendarClock className="h-6 w-6" />,
    color: 'text-slate-700 dark:text-slate-300',
    bgColor: 'bg-slate-500/10',
    features: ['Booking sync', 'Interviews', 'Self-hostable'],
  },
  paypal: {
    icon: <Wallet className="h-6 w-6" />,
    color: 'text-indigo-700 dark:text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    features: ['Store payment matching', 'Auto-settles orders', 'Business account'],
  },
  active911: {
    icon: <Radio className="h-6 w-6" />,
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-500/10',
    features: ['Dispatch alerts', 'Mapping', 'Paging'],
  },
  'google-maps': {
    icon: <MapPin className="h-6 w-6" />,
    color: 'text-green-700 dark:text-green-400',
    bgColor: 'bg-green-500/10',
    features: ['Hydrant mapping', 'Pre-plans', 'Routing'],
  },
  zapier: {
    icon: <Zap className="h-6 w-6" />,
    color: 'text-orange-700 dark:text-orange-400',
    bgColor: 'bg-orange-500/10',
    features: ['5,000+ apps', 'No-code', 'Workflows'],
  },
  whatsapp: {
    icon: <Send className="h-6 w-6" />,
    color: 'text-green-700 dark:text-green-400',
    bgColor: 'bg-green-500/10',
    features: ['Notifications', 'International', 'Group messages'],
  },
  imagetrend: {
    icon: <Stethoscope className="h-6 w-6" />,
    color: 'text-teal-700 dark:text-teal-400',
    bgColor: 'bg-teal-500/10',
    features: ['ePCR sync', 'Run reports', 'API required'],
  },
  'eso-solutions': {
    icon: <Stethoscope className="h-6 w-6" />,
    color: 'text-teal-700 dark:text-teal-400',
    bgColor: 'bg-teal-500/10',
    features: ['ePCR data', 'RMS exchange', 'API required'],
  },
  nremt: {
    icon: <Award className="h-6 w-6" />,
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-500/10',
    features: ['Certification check', 'Status verify', 'Pending API'],
  },
  firstwatch: {
    icon: <Activity className="h-6 w-6" />,
    color: 'text-violet-700 dark:text-violet-400',
    bgColor: 'bg-violet-500/10',
    features: ['Clinical QA', 'Analytics', 'Vendor partnership'],
  },
  'pulse-point': {
    icon: <Heart className="h-6 w-6" />,
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-500/10',
    features: ['CPR alerts', 'AED locations', 'Citizen responder'],
  },
};

const DEFAULT_UI = {
  icon: <Plug className="h-6 w-6" />,
  color: 'text-theme-text-muted',
  bgColor: 'bg-theme-surface-secondary',
  features: [] as string[],
};

// Category icon mapping for filter buttons
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  Calendar: <Calendar className="h-3.5 w-3.5" />,
  Messaging: <MessageSquare className="h-3.5 w-3.5" />,
  Data: <Database className="h-3.5 w-3.5" />,
  Safety: <Shield className="h-3.5 w-3.5" />,
  Reporting: <FileText className="h-3.5 w-3.5" />,
  EMS: <Stethoscope className="h-3.5 w-3.5" />,
  Dispatch: <Radio className="h-3.5 w-3.5" />,
  Automation: <Zap className="h-3.5 w-3.5" />,
  Mapping: <MapPin className="h-3.5 w-3.5" />,
  CRM: <Users className="h-3.5 w-3.5" />,
  Documents: <FileSignature className="h-3.5 w-3.5" />,
  Scheduling: <CalendarClock className="h-3.5 w-3.5" />,
};

type CategoryFilter =
  | 'all'
  | 'Calendar'
  | 'Messaging'
  | 'Data'
  | 'CRM'
  | 'Safety'
  | 'Reporting'
  | 'EMS'
  | 'Dispatch'
  | 'Automation'
  | 'Mapping'
  | 'Documents'
  | 'Scheduling'
  | 'Payments';

const ALL_CATEGORIES: CategoryFilter[] = [
  'all',
  'Calendar',
  'Messaging',
  'Data',
  'CRM',
  'Safety',
  'Reporting',
  'EMS',
  'Dispatch',
  'Automation',
  'Mapping',
  'Documents',
  'Scheduling',
  'Payments',
];

// Integration types that need webhook URL config
const WEBHOOK_TYPES = new Set(['slack', 'discord', 'microsoft-teams']);
// Integration types that need specific config forms
const CONFIG_TYPES = new Set([
  'nws-weather',
  'nfirs-export',
  'nemsis-export',
  'generic-webhook',
  'epcr-import',
  'salesforce',
  'documenso',
  'calcom',
  'paypal',
]);

const inputClass = 'form-input';
const labelClass = 'form-label';

// Public inbound-webhook URL a department pastes into the provider's dashboard
// so its events reach us: Documenso/Cal.com advance a prospect's pipeline stage,
// PayPal settles a store order.
const webhookCallbackUrl = (provider: 'documenso' | 'calcom' | 'paypal', integrationId: string): string =>
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
  const [paypalEnvironment, setPaypalEnvironment] = useState('sandbox');
  const [paypalClientId, setPaypalClientId] = useState('');
  const [paypalClientSecret, setPaypalClientSecret] = useState('');
  const [paypalWebhookId, setPaypalWebhookId] = useState('');
  const [paypalAutoApply, setPaypalAutoApply] = useState(true);

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
      void navigate('/integrations', { replace: true });
    } else if (sfError) {
      toast.error(`Salesforce connection failed: ${sfError.replace(/_/g, ' ')}`);
      void navigate('/integrations', { replace: true });
    }
  }, [location.search, navigate, loadIntegrations]);

  const getUI = (type: string) => INTEGRATION_UI[type] ?? DEFAULT_UI;

  const filteredIntegrations = integrations.filter((i) => {
    const matchesSearch =
      i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (i.description ?? '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || i.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Derive visible categories from actual data
  const visibleCategories = ALL_CATEGORIES.filter(
    (cat) => cat === 'all' || integrations.some((i) => i.category === cat)
  );

  const connectedCount = integrations.filter((i) => i.status === ConnectionStatus.CONNECTED).length;
  const availableCount = integrations.filter((i) => i.status === 'available').length;

  const selectedIntegration = showConnectModal ? integrations.find((i) => i.id === showConnectModal) : null;

  // ``integration`` seeds the non-secret fields from what is already stored.
  // Without it, reopening the form on a live PayPal connection would show the
  // sandbox default and quietly downgrade the environment on save.
  const resetFormState = (integration?: IntegrationConfig) => {
    const stored = integration?.config ?? {};
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
    setPaypalEnvironment(typeof stored['environment'] === 'string' ? stored['environment'] : 'sandbox');
    setPaypalClientId('');
    setPaypalClientSecret('');
    setPaypalWebhookId(typeof stored['webhook_id'] === 'string' ? stored['webhook_id'] : '');
    setPaypalAutoApply(stored['auto_apply_payments'] !== false);
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
      case 'paypal':
        return {
          environment: paypalEnvironment,
          // Blank means "leave unchanged" — the API never echoes a stored
          // secret back, so sending '' would wipe working credentials.
          client_id: paypalClientId.trim() || undefined,
          client_secret: paypalClientSecret.trim() || undefined,
          webhook_id: paypalWebhookId.trim() || undefined,
          auto_apply_payments: paypalAutoApply,
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
    const integration = integrations.find((i) => i.id === integrationId);
    if (!integration) return;

    setConnecting(true);
    try {
      const config = getConfigFromForm(integration.integration_type);
      const updated = await integrationsService.connectIntegration(integrationId, config);
      setIntegrations((prev) => prev.map((i) => (i.id === integrationId ? updated : i)));
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
      setIntegrations((prev) =>
        prev.map((i) => (i.id === integrationId ? { ...i, status: 'available' as const, enabled: false } : i))
      );
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
            <p className="text-theme-text-muted mt-1 text-xs">
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
              <label htmlFor="nws-zone-id" className={labelClass}>
                NWS Zone ID
              </label>
              <input
                id="nws-zone-id"
                type="text"
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value.toUpperCase())}
                placeholder="NYZ072"
                pattern="[A-Z]{2}[CZ]\d{3}"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Find your zone at weather.gov. Format: state code + C/Z + 3 digits (e.g., NYZ072, CAC006).
              </p>
            </div>
          </div>
        );

      case 'nfirs-export':
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="nfirs-state-code" className={labelClass}>
                State Code
              </label>
              <input
                id="nfirs-state-code"
                type="text"
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value.toUpperCase())}
                placeholder="NY"
                maxLength={2}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="nfirs-fdid" className={labelClass}>
                Fire Department ID (FDID)
              </label>
              <input
                id="nfirs-fdid"
                type="text"
                value={fdid}
                onChange={(e) => setFdid(e.target.value)}
                placeholder="12345"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">Your state-assigned FDID for NFIRS reporting.</p>
            </div>
          </div>
        );

      case 'nemsis-export':
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="nemsis-state-code" className={labelClass}>
                State Code
              </label>
              <input
                id="nemsis-state-code"
                type="text"
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value.toUpperCase())}
                placeholder="NY"
                maxLength={2}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="nemsis-agency-id" className={labelClass}>
                State-Assigned Agency ID
              </label>
              <input
                id="nemsis-agency-id"
                type="text"
                value={agencyId}
                onChange={(e) => setAgencyId(e.target.value)}
                placeholder="A12345"
                className={inputClass}
              />
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Exports dispatch/response data only (timestamps, disposition, crew). Clinical data (vitals, medications,
                procedures) requires your ePCR vendor.
              </p>
            </div>
          </div>
        );

      case 'generic-webhook':
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="webhook-url" className={labelClass}>
                Webhook URL
              </label>
              <input
                id="webhook-url"
                type="url"
                value={genericWebhookUrl}
                onChange={(e) => setGenericWebhookUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="webhook-secret" className={labelClass}>
                Secret (optional)
              </label>
              <input
                id="webhook-secret"
                type="password"
                value={genericWebhookSecret}
                onChange={(e) => setGenericWebhookSecret(e.target.value)}
                placeholder="HMAC signing secret"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Used for HMAC-SHA256 signature in X-Webhook-Signature header.
              </p>
            </div>
          </div>
        );

      case 'epcr-import':
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="epcr-import-format" className={labelClass}>
                Import Format
              </label>
              <select
                id="epcr-import-format"
                value={importFormat}
                onChange={(e) => setImportFormat(e.target.value)}
                className={inputClass}
              >
                <option value="csv">CSV (any vendor)</option>
                <option value="nemsis_xml">NEMSIS 3.5 XML</option>
              </select>
              <p className="text-theme-text-muted mt-1 text-xs">
                Works with file exports from ImageTrend, ESO, Zoll, or any ePCR vendor. Upload files after connecting.
              </p>
            </div>
            {integration.contains_phi && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
                <div className="flex items-start space-x-2">
                  <Shield className="mt-0.5 h-4 w-4 shrink-0 text-rose-700 dark:text-rose-400" />
                  <p className="text-xs text-rose-700 dark:text-rose-400">
                    This integration handles protected health information (PHI). Uploaded files are processed and
                    deleted — only dispatch/response data is stored.
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
              <label htmlFor="sf-instance-url" className={labelClass}>
                Salesforce Instance URL
              </label>
              <input
                id="sf-instance-url"
                type="url"
                value={sfInstanceUrl}
                onChange={(e) => setSfInstanceUrl(e.target.value.trim())}
                placeholder="https://yourorg.my.salesforce.com"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Your Salesforce org URL (e.g., https://yourorg.my.salesforce.com).
              </p>
            </div>
            <div>
              <label htmlFor="sf-environment" className={labelClass}>
                Environment
              </label>
              <select
                id="sf-environment"
                value={sfEnvironment}
                onChange={(e) => setSfEnvironment(e.target.value)}
                className={inputClass}
              >
                <option value="production">Production</option>
                <option value="sandbox">Sandbox</option>
              </select>
              <p className="text-theme-text-muted mt-1 text-xs">
                Select Sandbox if connecting to a Salesforce sandbox org for testing.
              </p>
            </div>
            <div>
              <label htmlFor="sf-match-strategy" className={labelClass}>
                Contact Matching
              </label>
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
              <p className="text-theme-text-muted mt-1 text-xs">
                How to reconcile members with Contacts your org may already have. Matching avoids creating duplicate
                Contacts.
              </p>
            </div>

            {/* Recommended path: one-click OAuth */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  void handleSalesforceOAuth(integration.id);
                }}
                disabled={connecting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                <ExternalLink className="h-4 w-4" />
                <span>{connecting ? 'Redirecting…' : 'Connect with Salesforce'}</span>
              </button>
              <p className="text-theme-text-muted mt-1 text-xs">
                Recommended. Redirects you to Salesforce to grant access &mdash; no refresh token to copy. Uses your
                department&apos;s Connected App if configured below, otherwise the platform&apos;s.
              </p>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="bg-theme-surface-border h-px flex-1" />
              <span className="text-theme-text-muted text-xs uppercase">or connect manually</span>
              <div className="bg-theme-surface-border h-px flex-1" />
            </div>

            <div>
              <label htmlFor="sf-client-id" className={labelClass}>
                Connected App Client ID
              </label>
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
              <label htmlFor="sf-client-secret" className={labelClass}>
                Client Secret
              </label>
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
              <label htmlFor="sf-refresh-token" className={labelClass}>
                Refresh Token
              </label>
              <input
                id="sf-refresh-token"
                type="password"
                value={sfRefreshToken}
                onChange={(e) => setSfRefreshToken(e.target.value)}
                placeholder="OAuth refresh token"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Only needed for manual connection. Leave blank if using &quot;Connect with Salesforce&quot; above. Then
                click Connect below.
              </p>
            </div>
            <div>
              <label htmlFor="sf-sync-direction" className={labelClass}>
                Sync Direction
              </label>
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
              <label htmlFor="sf-graceful-fields" className="text-theme-text-secondary text-xs">
                Skip custom fields my Salesforce org hasn&apos;t created yet (recommended while building out your org).
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
              <label htmlFor="sf-auto-sync" className="text-theme-text-secondary text-xs">
                Automatically sync every 30 minutes (per the sync direction above), in addition to the manual sync
                buttons.
              </label>
            </div>
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
              <p className="text-xs text-blue-700 dark:text-blue-400">
                Create a Connected App in Salesforce Setup &rarr; App Manager with the &quot;api&quot; and
                &quot;refresh_token&quot; OAuth scopes, and add this app&apos;s callback URL to it.
              </p>
            </div>
          </div>
        );

      case 'documenso':
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="documenso-token" className={labelClass}>
                API Token
              </label>
              <input
                id="documenso-token"
                type="password"
                value={documensoApiToken}
                onChange={(e) => setDocumensoApiToken(e.target.value)}
                placeholder="api_..."
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Create an API token in Documenso under Settings &rarr; API.
              </p>
            </div>
            <div>
              <label htmlFor="documenso-base-url" className={labelClass}>
                API Base URL (optional)
              </label>
              <input
                id="documenso-base-url"
                type="url"
                value={documensoBaseUrl}
                onChange={(e) => setDocumensoBaseUrl(e.target.value.trim())}
                placeholder="https://app.documenso.com/api/v1"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Leave blank for Documenso Cloud. Self-hosted instances use https://your-host/api/v1.
              </p>
            </div>
            <div>
              <label htmlFor="documenso-webhook-secret" className={labelClass}>
                Webhook Secret (optional)
              </label>
              <input
                id="documenso-webhook-secret"
                type="password"
                value={documensoWebhookSecret}
                onChange={(e) => setDocumensoWebhookSecret(e.target.value)}
                placeholder="Shared secret for inbound webhooks"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Set a secret to auto-advance a prospect&apos;s signing stage when they finish signing. Add this Webhook
                URL in Documenso (send it as the <code>X-Documenso-Secret</code> header):
              </p>
              <code className="bg-theme-surface-secondary text-theme-text-secondary mt-1 block rounded px-2 py-1 text-xs break-all">
                {webhookCallbackUrl('documenso', integration.id)}
              </code>
            </div>
          </div>
        );

      case 'calcom':
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="calcom-key" className={labelClass}>
                API Key
              </label>
              <input
                id="calcom-key"
                type="password"
                value={calcomApiKey}
                onChange={(e) => setCalcomApiKey(e.target.value)}
                placeholder="cal_..."
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Create an API key in Cal.com under Settings &rarr; Developer &rarr; API keys.
              </p>
            </div>
            <div>
              <label htmlFor="calcom-base-url" className={labelClass}>
                API Base URL (optional)
              </label>
              <input
                id="calcom-base-url"
                type="url"
                value={calcomBaseUrl}
                onChange={(e) => setCalcomBaseUrl(e.target.value.trim())}
                placeholder="https://api.cal.com/v1"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Leave blank for Cal.com Cloud. Self-hosted instances use https://your-host/api/v1.
              </p>
            </div>
            <div>
              <label htmlFor="calcom-webhook-secret" className={labelClass}>
                Webhook Secret (optional)
              </label>
              <input
                id="calcom-webhook-secret"
                type="password"
                value={calcomWebhookSecret}
                onChange={(e) => setCalcomWebhookSecret(e.target.value)}
                placeholder="Signing secret for inbound webhooks"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Set a secret to auto-advance a prospect&apos;s interview stage when they book. Add this URL as a Cal.com
                webhook (BOOKING_CREATED) using the same secret:
              </p>
              <code className="bg-theme-surface-secondary text-theme-text-secondary mt-1 block rounded px-2 py-1 text-xs break-all">
                {webhookCallbackUrl('calcom', integration.id)}
              </code>
            </div>
          </div>
        );

      case 'paypal':
        return (
          <div className="space-y-3">
            <div className="alert-info text-xs">
              Logbook never takes a payment. This connection only lets PayPal tell us what your Business account
              received, so store orders whose order number appears in the payment reference settle themselves.
            </div>
            <div>
              <label htmlFor="paypal-env" className={labelClass}>
                Environment
              </label>
              <select
                id="paypal-env"
                value={paypalEnvironment}
                onChange={(e) => setPaypalEnvironment(e.target.value)}
                className={inputClass}
              >
                <option value="sandbox">Sandbox (testing)</option>
                <option value="live">Live</option>
              </select>
              <p className="text-theme-text-muted mt-1 text-xs">
                Sandbox and live credentials are not interchangeable &mdash; use the pair that matches this setting.
              </p>
            </div>
            <div>
              <label htmlFor="paypal-client-id" className={labelClass}>
                Client ID
              </label>
              <input
                id="paypal-client-id"
                type="password"
                value={paypalClientId}
                onChange={(e) => setPaypalClientId(e.target.value)}
                placeholder="From your PayPal REST app"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="paypal-client-secret" className={labelClass}>
                Client Secret
              </label>
              <input
                id="paypal-client-secret"
                type="password"
                value={paypalClientSecret}
                onChange={(e) => setPaypalClientSecret(e.target.value)}
                placeholder="Leave blank to keep the stored secret"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Create a REST app at developer.paypal.com under Apps &amp; Credentials.
              </p>
            </div>
            <div>
              <label htmlFor="paypal-webhook-id" className={labelClass}>
                Webhook ID
              </label>
              <input
                id="paypal-webhook-id"
                type="text"
                value={paypalWebhookId}
                onChange={(e) => setPaypalWebhookId(e.target.value.trim())}
                placeholder="e.g. 8SR123456A789012B"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Add a webhook on the same REST app subscribed to <strong>Payment capture completed</strong>, then paste
                its ID here. Without it, incoming payments cannot be verified and will be rejected. Use this URL:
              </p>
              <code className="bg-theme-surface-secondary text-theme-text-secondary mt-1 block rounded px-2 py-1 text-xs break-all">
                {webhookCallbackUrl('paypal', integration.id)}
              </code>
            </div>
            <label className="text-theme-text-secondary flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={paypalAutoApply}
                onChange={(e) => setPaypalAutoApply(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Settle orders automatically
                <span className="text-theme-text-muted block text-xs">
                  Only when the reference names one order and the amount equals its balance exactly. Anything else waits
                  for review on the store&apos;s Payments tab.
                </span>
              </span>
            </label>
          </div>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-primary h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Page Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="rounded-lg bg-indigo-600 p-2">
              <Plug className="h-6 w-6 text-white" aria-hidden="true" />
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
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3" role="region" aria-label="Integration statistics">
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Available Integrations</p>
            <p className="text-theme-text-primary mt-1 text-2xl font-bold">{integrations.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Connected</p>
            <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-400">{connectedCount}</p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Ready to Connect</p>
            <p className="mt-1 text-2xl font-bold text-indigo-700 dark:text-indigo-400">{availableCount}</p>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="card mb-6 p-4" role="search" aria-label="Search and filter integrations">
          <div className="flex flex-col items-center gap-4 md:flex-row">
            <div className="relative w-full flex-1 md:max-w-md">
              <Search
                className="text-theme-text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform"
                aria-hidden="true"
              />
              <label htmlFor="integrations-search" className="sr-only">
                Search integrations
              </label>
              <input
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                id="integrations-search"
                type="text"
                aria-label="Search integrations..."
                placeholder="Search integrations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input placeholder-theme-text-muted pr-4 pl-10"
              />
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
              {visibleCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  aria-pressed={categoryFilter === cat}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredIntegrations.map((integration) => {
            const ui = getUI(integration.integration_type);
            return (
              <div
                key={integration.id}
                data-testid={`integration-card-${integration.integration_type}`}
                className="stat-card transition-all hover:border-indigo-500/30"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`rounded-lg p-2 ${ui.bgColor} ${ui.color}`}>{ui.icon}</div>
                    <div>
                      <h3 className="text-theme-text-primary font-semibold">{integration.name}</h3>
                      <span className="text-theme-text-muted text-xs">{integration.category}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {integration.status === ConnectionStatus.CONNECTED && (
                      <span className="flex items-center space-x-1 rounded-sm border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">
                        <Wifi className="h-3 w-3" />
                        <span>Connected</span>
                      </span>
                    )}
                    {integration.status === 'coming_soon' && (
                      <span className="bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border rounded-sm border px-2 py-0.5 text-xs">
                        Coming Soon
                      </span>
                    )}
                    {integration.contains_phi && (
                      <span className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs text-rose-700 dark:text-rose-400">
                        PHI
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-theme-text-secondary mb-3 text-sm">{integration.description}</p>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {ui.features.map((feature) => (
                    <span key={feature} className={`rounded-sm px-2 py-0.5 text-xs ${ui.bgColor} ${ui.color}`}>
                      {feature}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {integration.status === ConnectionStatus.CONNECTED && canManage && (
                    <>
                      {integration.integration_type === 'salesforce' && (
                        <button
                          onClick={() => setShowSyncPanel(!showSyncPanel)}
                          className="flex items-center space-x-1 rounded-lg bg-blue-500/10 px-3 py-1.5 text-sm text-blue-700 transition-colors hover:bg-blue-500/20 dark:text-blue-400"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>Sync</span>
                        </button>
                      )}
                      {integration.integration_type === 'calcom' && (
                        <button
                          onClick={() => {
                            void handleToggleBookings();
                          }}
                          className="flex items-center space-x-1 rounded-lg bg-slate-500/10 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-500/20 dark:text-slate-300"
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                          <span>Bookings</span>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          void handleTestConnection(integration.id);
                        }}
                        disabled={testing}
                        className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover flex items-center space-x-1 rounded-lg px-3 py-1.5 text-sm transition-colors"
                      >
                        <Bell className="h-3.5 w-3.5" />
                        <span>Test</span>
                      </button>
                      <button
                        onClick={() => {
                          void handleDisconnect(integration.id);
                        }}
                        className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover flex items-center space-x-1 rounded-lg px-3 py-1.5 text-sm transition-colors"
                      >
                        <Settings className="h-3.5 w-3.5" />
                        <span>Disconnect</span>
                      </button>
                    </>
                  )}
                  {integration.status === 'available' && canManage && (
                    <button
                      onClick={() => {
                        resetFormState(integration);
                        setShowConnectModal(integration.id);
                      }}
                      className="flex items-center space-x-1 rounded-lg bg-indigo-600/20 px-4 py-1.5 text-sm text-indigo-700 transition-colors hover:bg-indigo-600/30"
                    >
                      <Plug className="h-3.5 w-3.5" />
                      <span>Connect</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Cal.com Bookings Panel */}
        {showBookingsPanel &&
          integrations.some((i) => i.integration_type === 'calcom' && i.status === ConnectionStatus.CONNECTED) && (
            <div className="card mt-6 p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="rounded-lg bg-slate-500/10 p-2 text-slate-700 dark:text-slate-300">
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-theme-text-primary font-semibold">Cal.com Bookings</h3>
                    <p className="text-theme-text-muted text-xs">
                      Upcoming bookings from your connected Cal.com account
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowBookingsPanel(false)}
                  className="text-theme-text-muted hover:text-theme-text-primary"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {loadingBookings ? (
                <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
                  <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
                  <span className="sr-only">Loading bookings…</span>
                </div>
              ) : calcomBookings && calcomBookings.length > 0 ? (
                <ul className="divide-theme-surface-border divide-y">
                  {calcomBookings.map((b) => (
                    <li key={b.external_id || `${b.title}-${b.start_time}`} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-theme-text-primary truncate text-sm font-medium">{b.title || 'Booking'}</p>
                          {b.attendee_emails.length > 0 && (
                            <p className="text-theme-text-muted truncate text-xs">{b.attendee_emails.join(', ')}</p>
                          )}
                          {b.location && <p className="text-theme-text-muted truncate text-xs">{b.location}</p>}
                        </div>
                        <div className="shrink-0 text-right">
                          {b.start_time && (
                            <p className="text-theme-text-secondary text-xs">{formatDateTime(b.start_time, tz)}</p>
                          )}
                          {b.status && <span className="text-theme-text-muted text-xs capitalize">{b.status}</span>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="py-8 text-center">
                  <CalendarClock className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
                  <p className="text-theme-text-secondary text-sm">No upcoming bookings</p>
                </div>
              )}
            </div>
          )}

        {/* Salesforce Sync Panel */}
        {showSyncPanel &&
          integrations.some((i) => i.integration_type === 'salesforce' && i.status === ConnectionStatus.CONNECTED) && (
            <div className="card mt-6 p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="rounded-lg bg-blue-500/10 p-2 text-blue-700 dark:text-blue-400">
                    <RefreshCw className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-theme-text-primary font-semibold">Salesforce Sync</h3>
                    <p className="text-theme-text-muted text-xs">Push data to or pull data from Salesforce</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowSyncPanel(false)}
                  className="text-theme-text-muted hover:text-theme-text-primary"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Push section */}
                <div className="space-y-3">
                  <h4 className="text-theme-text-primary flex items-center gap-2 text-sm font-medium">
                    <Upload className="h-4 w-4" />
                    Push to Salesforce
                  </h4>
                  <button
                    onClick={() => {
                      void handleSalesforceSync('members');
                    }}
                    disabled={syncing !== null}
                    className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-sm transition-colors disabled:opacity-50"
                  >
                    <span>Members &rarr; Contacts</span>
                    {syncing === 'members' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Users className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      void handleSalesforceSync('training');
                    }}
                    disabled={syncing !== null}
                    className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-sm transition-colors disabled:opacity-50"
                  >
                    <span>Training Records &rarr; Tasks</span>
                    {syncing === 'training' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Clipboard className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      void handleSalesforceSync('events');
                    }}
                    disabled={syncing !== null}
                    className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-sm transition-colors disabled:opacity-50"
                  >
                    <span>Events &rarr; Salesforce Events</span>
                    {syncing === 'events' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Calendar className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {/* Pull section */}
                <div className="space-y-3">
                  <h4 className="text-theme-text-primary flex items-center gap-2 text-sm font-medium">
                    <Download className="h-4 w-4" />
                    Pull from Salesforce
                  </h4>
                  <button
                    onClick={() => {
                      void handleSalesforceSync('pull-contacts');
                    }}
                    disabled={syncing !== null}
                    className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-sm transition-colors disabled:opacity-50"
                  >
                    <span>Contacts &rarr; Members</span>
                    {syncing === 'pull-contacts' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Users className="h-4 w-4" />
                    )}
                  </button>
                  <div className="mt-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                    <p className="text-xs text-blue-700 dark:text-blue-400">
                      Matches contacts to existing members (by ID, then email) and updates their contact details.
                      Members are never created or deleted. Requires sync direction Pull or Bidirectional. Real-time
                      updates also arrive via the Salesforce webhook.
                    </p>
                  </div>
                </div>
              </div>

              {/* Readiness & dry-run preview */}
              <div className="border-theme-surface-border mt-4 border-t pt-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      void handleCheckReadiness();
                    }}
                    disabled={checkingReadiness}
                    className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
                  >
                    {checkingReadiness ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ListChecks className="h-3.5 w-3.5" />
                    )}
                    <span>Check readiness</span>
                  </button>
                  <button
                    onClick={() => {
                      void handlePreviewMembers();
                    }}
                    disabled={previewing}
                    className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
                  >
                    {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                    <span>Preview member sync</span>
                  </button>
                </div>

                {readiness && (
                  <div className="bg-theme-surface-secondary mb-3 rounded-lg p-3 text-xs">
                    <div className="mb-2 flex items-center gap-2">
                      {readiness.ready ? (
                        <span className="flex items-center gap-1 font-medium text-green-700 dark:text-green-400">
                          <CheckCircle2 className="h-4 w-4" />
                          Ready &mdash; sync will not create duplicates
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                          <AlertCircle className="h-4 w-4" />
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
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-700 dark:text-green-400" />
                              ) : (
                                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
                              )}
                              <div>
                                <span className="text-theme-text-primary font-medium">{name}</span>
                                {obj.error ? (
                                  <span className="text-theme-text-muted"> &mdash; {obj.error}</span>
                                ) : obj.missing_fields.length > 0 ? (
                                  <span className="text-theme-text-muted">
                                    {' '}
                                    &mdash; missing: {obj.missing_fields.join(', ')}
                                  </span>
                                ) : (
                                  <span className="text-theme-text-muted"> &mdash; all fields present</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {!readiness.external_id_fields_ready && (
                          <p className="mt-1 text-amber-700 dark:text-amber-400">
                            Add the missing Logbook_*__c external-ID fields in Salesforce to guarantee duplicate-free
                            sync.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {preview && (
                  <div className="bg-theme-surface-secondary mb-3 rounded-lg p-3 text-xs">
                    <p className="text-theme-text-primary mb-1 font-medium">
                      Member sync preview ({preview.total} member{preview.total === 1 ? '' : 's'})
                    </p>
                    <div className="text-theme-text-secondary flex flex-wrap gap-x-4 gap-y-1">
                      <span>
                        <span className="text-theme-text-primary font-medium">{preview.would_create}</span> new
                      </span>
                      <span>
                        <span className="text-theme-text-primary font-medium">{preview.would_update}</span> updated
                      </span>
                      <span>
                        <span className="text-theme-text-primary font-medium">{preview.would_adopt}</span> matched
                        existing
                      </span>
                      <span>
                        <span className="text-theme-text-primary font-medium">{preview.skipped}</span> skipped
                      </span>
                    </div>
                    <p className="text-theme-text-muted mt-1">
                      Nothing has been written. Use &quot;Members &rarr; Contacts&quot; above to run the sync.
                    </p>
                  </div>
                )}

                <p className="text-theme-text-muted text-xs">
                  Events and training are also pushed automatically when sync direction is set to &quot;Push&quot; or
                  &quot;Both&quot;.
                </p>
              </div>
            </div>
          )}

        {filteredIntegrations.length === 0 && (
          <div className="py-12 text-center">
            <Plug className="text-theme-text-muted mx-auto mb-4 h-12 w-12" />
            <p className="text-theme-text-secondary text-lg">No integrations match your search</p>
            <p className="text-theme-text-muted mt-1 text-sm">Try a different search term or category filter</p>
          </div>
        )}

        {/* Connect Modal */}
        {showConnectModal &&
          selectedIntegration &&
          (() => {
            const ui = getUI(selectedIntegration.integration_type);
            const hasConfigForm =
              WEBHOOK_TYPES.has(selectedIntegration.integration_type) ||
              CONFIG_TYPES.has(selectedIntegration.integration_type);

            return (
              <div className="fixed inset-0 z-50 overflow-y-auto">
                <div className="flex min-h-screen items-center justify-center px-4">
                  <div
                    className="fixed inset-0 bg-black/60"
                    onClick={() => {
                      setShowConnectModal(null);
                      resetFormState();
                    }}
                    aria-hidden="true"
                  />
                  <div className="bg-theme-surface-modal border-theme-surface-border relative w-full max-w-lg rounded-lg border shadow-xl">
                    <div className="px-6 pt-5 pb-4">
                      <div className="mb-4 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className={`rounded-lg p-2 ${ui.bgColor} ${ui.color}`}>{ui.icon}</div>
                          <h3 className="text-theme-text-primary text-lg font-medium">
                            Connect {selectedIntegration.name}
                          </h3>
                        </div>
                        <button
                          onClick={() => {
                            setShowConnectModal(null);
                            resetFormState();
                          }}
                          className="text-theme-text-muted hover:text-theme-text-primary"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>

                      <p className="text-theme-text-secondary mb-4 text-sm">{selectedIntegration.description}</p>

                      {/* Integration-specific config form */}
                      {hasConfigForm && <div className="mb-4">{renderConfigForm(selectedIntegration)}</div>}

                      {/* Features list for non-config integrations */}
                      {!hasConfigForm && (
                        <div className="mb-4 space-y-3">
                          <h4 className="text-theme-text-primary text-sm font-medium">Features included:</h4>
                          {ui.features.map((feature) => (
                            <div key={feature} className="flex items-center space-x-2">
                              <Check className="h-4 w-4 text-green-700 dark:text-green-400" />
                              <span className="text-theme-text-secondary text-sm">{feature}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3">
                        <div className="flex items-start space-x-2">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-indigo-700" />
                          <p className="text-sm text-indigo-700">
                            Clicking Connect will enable this integration for your organization. You can disconnect it
                            at any time.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-theme-input-bg flex justify-end space-x-3 rounded-b-lg px-6 py-3">
                      <button
                        onClick={() => {
                          setShowConnectModal(null);
                          resetFormState();
                        }}
                        className="border-theme-input-border text-theme-text-secondary hover:bg-theme-input-bg rounded-lg border px-4 py-2 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        data-testid="connect-submit"
                        onClick={() => {
                          void handleConnect(selectedIntegration.id);
                        }}
                        disabled={connecting}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
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
