import React, { useState, useEffect, useCallback } from 'react';
import { DialogPanel } from '../components/ux/DialogPanel';
import { McpServiceKeyPanel } from '../components/integrations/McpServiceKeyPanel';
import { McpOAuthPanel } from '../components/integrations/McpOAuthPanel';
import { IcalFeedPanel } from '../components/integrations/IcalFeedPanel';
import { CalendarPublishPanel } from '../components/integrations/CalendarPublishPanel';
import {
  CALENDAR_PROVIDERS,
  calendarConnectError,
  calendarProviderFor,
} from '../components/integrations/calendarProviders';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
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
  CreditCard,
  KeyRound,
  Bot,
  Mail,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import {
  integrationsService,
  type IntegrationConfig,
  type SalesforceReadiness,
  type SalesforcePreviewResult,
  type CalcomBooking,
  type GoogleWorkspaceLinkResult,
  type GoogleWorkspaceAttentionItem,
} from '../services/api';
import type { McpStatus } from '../services/adminServices';
import { getErrorMessage } from '../utils/errorHandling';
import { ConnectionStatus, EventType } from '../constants/enums';
import { getEventTypeLabel } from '../utils/eventHelpers';
import { formatDateTime } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { useConfirm } from '../contexts/ConfirmContext';

/** The events a Generic Webhook can be sent (backend WEBHOOK_EVENT_TYPES). */
const WEBHOOK_EVENT_OPTIONS = [
  { value: 'event.created', label: 'An event is created' },
  { value: 'shift.created', label: 'A shift is created' },
  { value: 'training.recorded', label: 'A training record is added' },
] as const;

/** Event types the department feed can be limited to (backend EventType). */
const ICAL_EVENT_TYPE_OPTIONS: readonly EventType[] = Object.values(EventType);

// UI metadata for integration types (icons, colors)
const INTEGRATION_UI: Record<string, { icon: React.ReactNode; color: string; bgColor: string; features: string[] }> = {
  'google-calendar': {
    icon: <Calendar className="h-6 w-6" />,
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-500/10',
    features: ['One-way publishing', 'Dedicated department calendar', 'Members subscribe'],
  },
  outlook: {
    icon: <Calendar className="h-6 w-6" />,
    color: 'text-sky-700 dark:text-sky-400',
    bgColor: 'bg-sky-500/10',
    features: ['One-way publishing', 'Dedicated department calendar', 'Members subscribe'],
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
    features: ['Department events feed', 'Works in any calendar app', 'Resettable link'],
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
  'nfc-id-cards': {
    icon: <CreditCard className="h-6 w-6" />,
    color: 'text-teal-700 dark:text-teal-400',
    bgColor: 'bg-teal-500/10',
    features: ['Tap to check in', 'Officer-issued cards', 'Shifts, meetings & admin hours'],
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
  'google-workspace': {
    icon: <Mail className="h-6 w-6" />,
    color: 'text-emerald-700 dark:text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    features: ['Account per new member', 'Org unit & groups', 'Administrator only'],
  },
  'microsoft-365': {
    icon: <Users className="h-6 w-6" />,
    color: 'text-sky-700 dark:text-sky-400',
    bgColor: 'bg-sky-500/10',
    features: ['Account per new member', 'License & groups', 'Administrator only'],
  },
  'claude-mcp': {
    icon: <Bot className="h-6 w-6" />,
    color: 'text-orange-700 dark:text-orange-400',
    bgColor: 'bg-orange-500/10',
    features: ['Read-only by default', 'No personal information', 'One service key per department'],
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
  'Access Control': <KeyRound className="h-3.5 w-3.5" />,
  'AI Assistants': <Bot className="h-3.5 w-3.5" />,
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
  | 'Payments'
  | 'Access Control'
  | 'AI Assistants';

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
  'Access Control',
  'AI Assistants',
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
  'ical',
  'salesforce',
  'documenso',
  'calcom',
  'paypal',
  'claude-mcp',
  'google-workspace',
  'microsoft-365',
]);

// Connected by a provider sign-in rather than a form: the card body
// (CalendarPublishPanel) carries its own Connect and Disconnect buttons.
const OAUTH_PANEL_TYPES = new Set(CALENDAR_PROVIDERS.map((p) => p.integrationType));

// The directories that give converted members an account. Either one's
// credential can create accounts anywhere in the department's domain, so the
// backend requires admin.access on top of integrations.manage to connect,
// change or disconnect it; and only one is connected at a time.
const DIRECTORY_VENDORS: Record<string, string> = {
  'google-workspace': 'Google',
  'microsoft-365': 'Microsoft',
};
const ADMIN_ONLY_TYPES = new Set(Object.keys(DIRECTORY_VENDORS));
const isDirectory = (integrationType: string): boolean => integrationType in DIRECTORY_VENDORS;

/**
 * Entries that are features of The Logbook itself rather than links to an
 * outside service.
 *
 * There is no account to connect and no round trip to test: the card is an
 * organization-level switch, so it reads Activate/Deactivate. NFC ID Cards is
 * one — turning it on is what lets an officer issue a card and a station read
 * it — and `test_integration_connection` on the backend has no case for it, so
 * offering Test here only ever produced an error toast.
 */
const ACTIVATION_TYPES = new Set(['nfc-id-cards']);

const isActivation = (integrationType: string): boolean => ACTIVATION_TYPES.has(integrationType);

const inputClass = 'form-input';
const labelClass = 'form-label';

// Public inbound-webhook URL a department pastes into the provider's dashboard
// so its events reach us: Documenso/Cal.com advance a prospect's pipeline stage,
// PayPal settles a store order.
const webhookCallbackUrl = (provider: 'documenso' | 'calcom' | 'paypal', integrationId: string): string =>
  `${window.location.origin}/api/public/v1/webhooks/${provider}/${integrationId}`;

// The members a link run leaves alone, and why, in one sentence each.
const describeGoogleLinkSkips = (result: GoogleWorkspaceLinkResult): string => {
  const parts = [
    result.already_linked > 0 && `${result.already_linked} already linked`,
    result.unfinished > 0 && `${result.unfinished} whose account setup is unfinished (retry from their profile)`,
    result.not_in_google > 0 && `${result.not_in_google} with no account at their address`,
    result.off_domain > 0 && `${result.off_domain} with an email outside the domain`,
    result.departed > 0 && `${result.departed} who have already left`,
    result.account_in_use > 0 && `${result.account_in_use} whose account is still recorded for another member`,
  ].filter((part): part is string => typeof part === 'string');
  return parts.length > 0 ? `Skipped: ${parts.join(', ')}.` : '';
};

const IntegrationsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('integrations.manage');
  // A delegated key manager holds the key permission alongside the screen's
  // own gate, not necessarily integrations.manage; the key panel is theirs too.
  const canIssueKeys = checkPermission('integrations.mcp_keys');
  const isOrgAdmin = checkPermission('admin.access');
  const canChange = (integrationType: string): boolean =>
    canManage && (!ADMIN_ONLY_TYPES.has(integrationType) || isOrgAdmin);
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
  const [switchingSfAuth, setSwitchingSfAuth] = useState(false);
  const { confirm } = useConfirm();

  // Config form state
  const [webhookUrl, setWebhookUrl] = useState('');
  const [zoneId, setZoneId] = useState('');
  // How members hear about a weather alert; the department chooses.
  const [weatherBanner, setWeatherBanner] = useState(true);
  const [weatherBell, setWeatherBell] = useState(true);
  const [weatherEmail, setWeatherEmail] = useState(false);
  const [stateCode, setStateCode] = useState('');
  const [fdid, setFdid] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [genericWebhookUrl, setGenericWebhookUrl] = useState('');
  const [genericWebhookSecret, setGenericWebhookSecret] = useState('');
  /** Events the Generic Webhook is sent; none ticked means all of them. */
  const [webhookEventTypes, setWebhookEventTypes] = useState<string[]>([]);
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
  const [mcpAccessMode, setMcpAccessMode] = useState<'read_only' | 'read_write'>('read_only');
  const [mcpExposeFinance, setMcpExposeFinance] = useState(false);
  const [mcpExposeMedical, setMcpExposeMedical] = useState(false);
  const [mcpExposeFullSchedule, setMcpExposeFullSchedule] = useState(false);
  const [mcpExposeMedicalSupplies, setMcpExposeMedicalSupplies] = useState(false);
  const [mcpOauthEnabled, setMcpOauthEnabled] = useState(false);
  const [icalEventTypes, setIcalEventTypes] = useState<string[]>([]);
  const [icalIncludeShifts, setIcalIncludeShifts] = useState(false);
  const [gwsServiceAccountKey, setGwsServiceAccountKey] = useState('');
  const [gwsKeyFileName, setGwsKeyFileName] = useState('');
  const [gwsAdminEmail, setGwsAdminEmail] = useState('');
  const [gwsDomain, setGwsDomain] = useState('');
  const [gwsOrgUnitPath, setGwsOrgUnitPath] = useState('/');
  const [gwsGroups, setGwsGroups] = useState('');
  const [msTenantId, setMsTenantId] = useState('');
  const [msClientId, setMsClientId] = useState('');
  const [msClientSecret, setMsClientSecret] = useState('');
  const [msDomain, setMsDomain] = useState('');
  const [msUsageLocation, setMsUsageLocation] = useState('US');
  const [msLicenseSkuId, setMsLicenseSkuId] = useState('');
  const [msGroups, setMsGroups] = useState('');
  const [msSecretExpiresOn, setMsSecretExpiresOn] = useState('');
  // Shared by Google Workspace and Microsoft 365: only one form is open at once.
  const [suspendOnRetirement, setSuspendOnRetirement] = useState(false);
  // The connect form doubles as the settings form for a connected Claude
  // (MCP) integration. Reconnecting is not an option there: disconnect
  // revokes the service key and ends every member connection.
  const [editingSettings, setEditingSettings] = useState(false);
  // Bumped after a settings save so the member sign-in panel re-reads its
  // status without remounting, which would drop a client secret it is
  // still showing.
  const [mcpConfigVersion, setMcpConfigVersion] = useState(0);
  const [showMcpPanel, setShowMcpPanel] = useState(false);
  // While the panel is issuing or revoking a key its response carries the
  // one-time plaintext; closing it then would lose the only copy.
  const [mcpPanelBusy, setMcpPanelBusy] = useState(false);
  // A newly registered OAuth client's secret is shown once, so that panel
  // holds the same controls the key panel does while its request runs.
  const [mcpOAuthBusy, setMcpOAuthBusy] = useState(false);
  const mcpBusy = mcpPanelBusy || mcpOAuthBusy;
  const toggleMcpPanel = () => {
    if (mcpBusy) return;
    setShowMcpPanel((open) => !open);
  };
  // A delegated key manager cannot list integrations (that needs
  // integrations.manage), so the Claude (MCP) card never renders for them.
  // The status endpoint accepts their permission; it decides whether the
  // service key card is shown instead.
  const [delegatedMcp, setDelegatedMcp] = useState<McpStatus | null>(null);
  // Set when that status request fails. Without it a transient failure
  // leaves the page on the generic empty state with no way back to the key
  // panel short of a full reload.
  const [delegatedMcpError, setDelegatedMcpError] = useState<string | null>(null);
  const [delegatedMcpAttempt, setDelegatedMcpAttempt] = useState(0);

  const loadIntegrations = useCallback(async () => {
    // Listing integrations needs integrations.manage; a delegated key
    // manager (key permission without it) would only ever get a 403 and an
    // error toast, so they are not sent to it — the status endpoint decides
    // what they see instead.
    if (!canManage && canIssueKeys) {
      setLoading(false);
      return;
    }
    try {
      const data = await integrationsService.getIntegrations();
      setIntegrations(data);
    } catch {
      toast.error('Could not load integrations. Refresh the page to try again.');
    } finally {
      setLoading(false);
    }
  }, [canManage, canIssueKeys]);

  useEffect(() => {
    if (canManage || !canIssueKeys) return;
    let cancelled = false;
    void integrationsService
      .getMcpStatus()
      .then((status) => {
        if (cancelled) return;
        setDelegatedMcp(status);
        setDelegatedMcpError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDelegatedMcp(null);
        setDelegatedMcpError(getErrorMessage(err, 'Failed to load the Claude (MCP) status'));
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, canIssueKeys, delegatedMcpAttempt]);

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
      toast.success('Salesforce connected');
      setShowConnectModal(null);
      void loadIntegrations();
      void navigate('/integrations', { replace: true });
    } else if (sfError) {
      toast.error(`Salesforce connection failed: ${sfError.replace(/_/g, ' ')}`);
      void navigate('/integrations', { replace: true });
    }
  }, [location.search, navigate, loadIntegrations]);

  // The same return leg for the calendar cards: ?google_calendar=connected,
  // ?outlook_calendar_error=<code> and so on. The list loads on mount, so it
  // already shows the new connection.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    for (const provider of CALENDAR_PROVIDERS) {
      const errorCode = params.get(`${provider.queryKey}_error`);
      if (params.get(provider.queryKey) === 'connected') {
        toast.success(`${provider.name} connected. Events will appear in the new calendar within a few minutes.`);
      } else if (errorCode) {
        toast.error(`${provider.name} was not connected. ${calendarConnectError(provider, errorCode)}`);
      } else {
        continue;
      }
      void navigate('/integrations', { replace: true });
      return;
    }
  }, [location.search, navigate]);

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
  const showDelegatedMcpCard =
    delegatedMcp?.enabled === true && !integrations.some((i) => i.integration_type === 'claude-mcp');

  // ``integration`` seeds the non-secret fields from what is already stored.
  // Without it, reopening the form on a live PayPal connection would show the
  // sandbox default and quietly downgrade the environment on save.
  const resetFormState = (integration?: IntegrationConfig) => {
    const stored = integration?.config ?? {};
    setWebhookUrl('');
    // Seeded from what is stored: a blank zone would fail its pattern on save.
    setZoneId(typeof stored['zone_id'] === 'string' ? stored['zone_id'] : '');
    setWeatherBanner(stored['notify_banner'] !== false);
    setWeatherBell(stored['notify_bell'] !== false);
    setWeatherEmail(stored['notify_email'] === true);
    setStateCode('');
    setFdid('');
    setAgencyId('');
    setGenericWebhookUrl('');
    setGenericWebhookSecret('');
    setWebhookEventTypes(
      Array.isArray(stored['event_types'])
        ? stored['event_types'].filter((e): e is string => typeof e === 'string')
        : []
    );
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
    // Every switch on this add-on defaults to off; reopening the form on a
    // live connection must show what is stored, not the defaults.
    setMcpAccessMode(stored['access_mode'] === 'read_write' ? 'read_write' : 'read_only');
    setMcpExposeFinance(stored['expose_finance'] === true);
    setMcpExposeMedical(stored['expose_medical_screening'] === true);
    setMcpExposeFullSchedule(stored['expose_full_schedule'] === true);
    setMcpExposeMedicalSupplies(stored['expose_medical_supplies'] === true);
    setMcpOauthEnabled(stored['oauth_enabled'] === true);
    setIcalEventTypes(
      Array.isArray(stored['included_event_types'])
        ? stored['included_event_types'].filter((t): t is string => typeof t === 'string')
        : []
    );
    setIcalIncludeShifts(stored['include_shifts'] === true);
    // The key is never echoed back; a blank one on save means "keep it".
    setGwsServiceAccountKey('');
    setGwsKeyFileName('');
    setGwsAdminEmail(typeof stored['admin_email'] === 'string' ? stored['admin_email'] : '');
    setGwsDomain(typeof stored['domain'] === 'string' ? stored['domain'] : '');
    setGwsOrgUnitPath(typeof stored['org_unit_path'] === 'string' ? stored['org_unit_path'] : '/');
    setGwsGroups(
      Array.isArray(stored['group_emails'])
        ? stored['group_emails'].filter((g): g is string => typeof g === 'string').join('\n')
        : ''
    );
    // The client secret is never echoed back either.
    setMsTenantId(typeof stored['tenant_id'] === 'string' ? stored['tenant_id'] : '');
    setMsClientId(typeof stored['client_id'] === 'string' ? stored['client_id'] : '');
    setMsClientSecret('');
    setMsDomain(typeof stored['domain'] === 'string' ? stored['domain'] : '');
    setMsUsageLocation(typeof stored['usage_location'] === 'string' ? stored['usage_location'] : 'US');
    setMsLicenseSkuId(typeof stored['license_sku_id'] === 'string' ? stored['license_sku_id'] : '');
    setMsSecretExpiresOn(
      typeof stored['client_secret_expires_on'] === 'string' ? stored['client_secret_expires_on'] : ''
    );
    setSuspendOnRetirement(stored['suspend_on_retirement'] === true);
    setMsGroups(
      Array.isArray(stored['groups'])
        ? stored['groups'].filter((g): g is string => typeof g === 'string').join('\n')
        : ''
    );
    setEditingSettings(false);
  };

  const getConfigFromForm = (integrationType: string): Record<string, unknown> => {
    if (WEBHOOK_TYPES.has(integrationType)) {
      return { webhook_url: webhookUrl };
    }
    switch (integrationType) {
      case 'nws-weather':
        return {
          zone_id: zoneId,
          notify_banner: weatherBanner,
          notify_bell: weatherBell,
          notify_email: weatherEmail,
        };
      case 'nfirs-export':
        return { state_code: stateCode, state_fdid: fdid };
      case 'nemsis-export':
        return { state_code: stateCode, agency_id: agencyId };
      case 'generic-webhook':
        return { url: genericWebhookUrl, secret: genericWebhookSecret, event_types: webhookEventTypes };
      case 'epcr-import':
        return { import_format: importFormat };
      case 'ical':
        // Both sent on every save: an empty list is "every event type", and
        // omitting it would keep the previous selection.
        return { included_event_types: icalEventTypes, include_shifts: icalIncludeShifts };
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
      case 'google-workspace':
        return {
          service_account_key: gwsServiceAccountKey || undefined,
          admin_email: gwsAdminEmail.trim(),
          domain: gwsDomain.trim(),
          org_unit_path: gwsOrgUnitPath.trim() || '/',
          group_emails: gwsGroups
            .split(/[\s,]+/)
            .map((g) => g.trim())
            .filter(Boolean),
          suspend_on_retirement: suspendOnRetirement,
        };
      case 'microsoft-365':
        return {
          tenant_id: msTenantId.trim(),
          client_id: msClientId.trim(),
          // Blank means "keep the stored secret" on a settings save.
          client_secret: msClientSecret.trim() || undefined,
          domain: msDomain.trim(),
          usage_location: msUsageLocation.trim().toUpperCase() || 'US',
          // Sent even when blank: clearing it switches to group-based licensing.
          license_sku_id: msLicenseSkuId.trim(),
          // Sent even when blank, so clearing the date stops the warnings.
          client_secret_expires_on: msSecretExpiresOn,
          groups: msGroups
            .split(/[\s,]+/)
            .map((g) => g.trim())
            .filter(Boolean),
          suspend_on_retirement: suspendOnRetirement,
        };
      case 'claude-mcp':
        return {
          access_mode: mcpAccessMode,
          expose_finance: mcpExposeFinance,
          expose_medical_screening: mcpExposeMedical,
          expose_full_schedule: mcpExposeFullSchedule,
          expose_medical_supplies: mcpExposeMedicalSupplies,
          oauth_enabled: mcpOauthEnabled,
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
      toast.success(
        isActivation(integration.integration_type) ? `${integration.name} activated` : `${integration.name} connected`
      );
    } catch (err: unknown) {
      toast.error(
        getErrorMessage(
          err,
          isActivation(integration.integration_type)
            ? `Failed to activate ${integration.name}`
            : 'Failed to connect integration'
        )
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleSaveSettings = async (integrationId: string) => {
    const integration = integrations.find((i) => i.id === integrationId);
    if (!integration) return;

    setConnecting(true);
    try {
      const updated = await integrationsService.updateIntegration(
        integrationId,
        getConfigFromForm(integration.integration_type)
      );
      setIntegrations((prev) => prev.map((i) => (i.id === integrationId ? updated : i)));
      setShowConnectModal(null);
      resetFormState();
      setMcpConfigVersion((v) => v + 1);
      toast.success(`${integration.name} settings saved`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the settings'));
    } finally {
      setConnecting(false);
    }
  };

  // The Disconnect button is replaced by Connect, so focus fell to <body>.
  // Focus moves once the replacement has rendered: a timer fired before the
  // status update committed and found nothing to focus.
  const [pendingConnectFocus, setPendingConnectFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingConnectFocus) return;
    const connect = document.querySelector<HTMLButtonElement>(
      `[data-integration-connect="${CSS.escape(pendingConnectFocus)}"]`
    );
    if (!connect) return;
    connect.focus();
    setPendingConnectFocus(null);
  }, [pendingConnectFocus, integrations]);

  const handleDisconnect = async (integrationId: string) => {
    const integration = integrations.find((i) => i.id === integrationId);
    if (mcpBusy && integration?.integration_type === 'claude-mcp') return;
    const activation = integration ? isActivation(integration.integration_type) : false;
    const name = integration?.name ?? 'this integration';
    // W73: this acted on one tap. For Claude (MCP) it revokes every service key
    // and ends every member's connection, and reconnecting restores neither.
    const isMcp = integration?.integration_type === 'claude-mcp';
    // Disconnecting iCal deletes the feed token, so the published link is gone
    // for good and connecting again issues a different one.
    const isIcal = integration?.integration_type === 'ical';
    const disconnectMessage = isMcp
      ? 'Every service key is revoked and every member who connected with their own account is signed out. Reconnecting does not bring them back: keys must be issued again and members must reconnect.'
      : isIcal
        ? 'The department feed link stops working at once, and every calendar subscribed to it stops updating. Reconnecting does not bring the link back: it issues a new one, which has to be shared with members again.'
        : `${name} stops working for the department until it is ${activation ? 'activated' : 'connected'} again. Its saved settings are kept.`;
    const confirmed = await confirm({
      title: `${activation ? 'Deactivate' : 'Disconnect'} ${name}?`,
      message: disconnectMessage,
      confirmLabel: activation ? 'Deactivate' : 'Disconnect',
      cancelLabel: activation ? 'Keep it active' : 'Keep it connected',
      variant: isMcp || isIcal ? 'danger' : 'warning',
    });
    if (!confirmed) return;
    try {
      await integrationsService.disconnectIntegration(integrationId);
      setIntegrations((prev) =>
        prev.map((i) => (i.id === integrationId ? { ...i, status: 'available' as const, enabled: false } : i))
      );
      toast.success(`${integration?.name ?? 'Integration'} ${activation ? 'deactivated' : 'disconnected'}`);
      setPendingConnectFocus(integrationId);
    } catch (err: unknown) {
      toast.error(
        getErrorMessage(err, activation ? 'Failed to deactivate integration' : 'Failed to disconnect integration')
      );
    }
  };

  // The backend treats an explicit "" refresh_token on a Salesforce update as
  // "switch to the client-credentials flow" and discards the stored refresh
  // and access tokens. The config form cannot send it — a blank field is
  // omitted, which means "leave unchanged" for every secret on this page — so
  // the switch is its own control and touches nothing else (INT-11).
  const handleSwitchSalesforceToClientCredentials = async () => {
    const salesforce = integrations.find(
      (i) => i.integration_type === 'salesforce' && i.status === ConnectionStatus.CONNECTED
    );
    if (!salesforce) return;
    const confirmed = await confirm({
      title: 'Switch Salesforce to client credentials?',
      message:
        "Salesforce will stop signing in as the person who connected it. The saved refresh token is discarded and the next sync signs in with your Connected App's own client ID and secret, using Salesforce's client-credentials flow. That flow must be enabled on the Connected App, with a Run As user, or syncs will fail until it is.",
      confirmLabel: 'Switch to client credentials',
      cancelLabel: 'Keep the current connection',
      variant: 'warning',
    });
    if (!confirmed) return;
    setSwitchingSfAuth(true);
    try {
      await integrationsService.updateIntegration(salesforce.id, { refresh_token: '' });
      setReadiness(null);
      setPreview(null);
      toast.success('Salesforce now uses client credentials');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not switch Salesforce to client credentials'));
    } finally {
      setSwitchingSfAuth(false);
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

  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [googleAttention, setGoogleAttention] = useState<GoogleWorkspaceAttentionItem[]>([]);
  const [showGoogleAttention, setShowGoogleAttention] = useState(false);
  // At most one directory is connected; its name words the list and the link.
  const connectedDirectory = integrations.find(
    (i) => isDirectory(i.integration_type) && i.status === ConnectionStatus.CONNECTED
  );
  const googleWorkspaceConnected = connectedDirectory !== undefined;
  const directoryName = connectedDirectory?.name ?? 'Google Workspace';
  const directoryVendor = DIRECTORY_VENDORS[connectedDirectory?.integration_type ?? ''] ?? 'Google';

  useEffect(() => {
    if (!canManage || !googleWorkspaceConnected) {
      setGoogleAttention([]);
      return;
    }
    let cancelled = false;
    integrationsService
      .getGoogleWorkspaceAttention()
      .then((items) => {
        if (!cancelled) setGoogleAttention(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(getErrorMessage(err, `Could not load ${directoryName} accounts needing attention`));
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, googleWorkspaceConnected, directoryName]);

  const handleLinkExistingGoogle = async () => {
    setLinkingGoogle(true);
    try {
      const preview = await integrationsService.linkExistingGoogleMembers();
      if (preview.linked === 0) {
        toast.success(`No members to link. ${describeGoogleLinkSkips(preview)}`);
        return;
      }
      const confirmed = await confirm({
        title: `Link ${preview.linked} existing ${preview.linked === 1 ? 'member' : 'members'} to ${directoryVendor}?`,
        message: `Each one's Logbook email is already an account in ${directoryName}. Once linked, The Logbook suspends that account when the member leaves and lifts its own suspension if they return; it changes nothing else about the account. ${describeGoogleLinkSkips(preview)}`,
        confirmLabel: 'Link accounts',
        cancelLabel: 'Not now',
        variant: 'warning',
      });
      if (!confirmed) return;
      const result = await integrationsService.linkExistingGoogleMembers(preview.linked);
      toast.success(`Linked ${result.linked} ${result.linked === 1 ? 'member' : 'members'} to ${directoryName}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, `Could not link existing members to ${directoryName}`));
    } finally {
      setLinkingGoogle(false);
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
            `Pulled ${result.count} contacts but did not apply them. Set sync direction to Pull or Bidirectional to update members.`
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
            <label htmlFor="messaging-webhook-url" className={labelClass}>
              Webhook URL
            </label>
            <input
              id="messaging-webhook-url"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder={
                itype === 'discord'
                  ? 'https://discord.com/api/webhooks/...'
                  : itype === 'microsoft-teams'
                    ? 'https://yourorg.webhook.office.com/...'
                    : 'https://hooks.slack.com/services/...'
              }
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
            <fieldset>
              <legend className={labelClass}>Tell members about severe weather</legend>
              <p className="text-theme-text-muted text-xs">
                The zone is checked every 15 minutes. Only Severe and Extreme alerts count, such as tornado, severe
                thunderstorm and flash flood warnings.
              </p>
              <div className="mt-2 space-y-1">
                {[
                  {
                    label: 'Dashboard banner while the alert is active',
                    checked: weatherBanner,
                    set: setWeatherBanner,
                  },
                  { label: 'Bell notice when an alert is issued', checked: weatherBell, set: setWeatherBell },
                  {
                    label: 'Email when an alert is issued (members can turn these emails off)',
                    checked: weatherEmail,
                    set: setWeatherEmail,
                  },
                ].map((option) => (
                  <label key={option.label} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={option.checked}
                      onChange={(e) => option.set(e.target.checked)}
                    />
                    <span className="text-theme-text-primary">{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
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
                If set, each request is signed with HMAC-SHA256 in the X-Webhook-Signature header.
              </p>
            </div>
            <fieldset>
              <legend className={labelClass}>Send these events</legend>
              <div className="mt-1 space-y-1">
                {WEBHOOK_EVENT_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={webhookEventTypes.includes(option.value)}
                      onChange={(e) =>
                        setWebhookEventTypes((current) =>
                          e.target.checked
                            ? [...current, option.value]
                            : current.filter((value) => value !== option.value)
                        )
                      }
                    />
                    <span className="text-theme-text-primary">{option.label}</span>
                    <code className="text-theme-text-muted text-xs">{option.value}</code>
                  </label>
                ))}
              </div>
              <p className="text-theme-text-muted mt-1 text-xs">
                Leave all unticked to send every event. Each request carries the event name in its event_type field and
                the X-Webhook-Event header.
              </p>
            </fieldset>
          </div>
        );

      case 'ical':
        return (
          <div className="space-y-3">
            <fieldset>
              <legend className={labelClass}>Event types in the feed</legend>
              <div className="mt-1 space-y-1">
                {ICAL_EVENT_TYPE_OPTIONS.map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={icalEventTypes.includes(value)}
                      onChange={(e) =>
                        setIcalEventTypes((current) =>
                          e.target.checked ? [...current, value] : current.filter((t) => t !== value)
                        )
                      }
                    />
                    <span className="text-theme-text-primary">{getEventTypeLabel(value)}</span>
                  </label>
                ))}
              </div>
              <p className="text-theme-text-muted mt-1 text-xs">
                Leave all unticked to publish every type. Drafts and cancelled events are never published.
              </p>
            </fieldset>
            <label className="text-theme-text-primary flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={icalIncludeShifts}
                onChange={(e) => setIcalIncludeShifts(e.target.checked)}
                className="form-checkbox mt-0.5"
              />
              <span>
                Include duty shifts
                <span className="text-theme-text-muted block text-xs">
                  Adds each scheduled shift&apos;s times and platoon. Who is assigned and shift notes are never
                  published.
                </span>
              </span>
            </label>
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
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-800 px-4 py-2.5 text-sm text-white transition-colors hover:bg-red-900 disabled:opacity-50"
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
                Only for a manual connection: paste the token, then click Connect below. Leave blank if you use
                &quot;Connect with Salesforce&quot; above.
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
                Sync automatically every 30 minutes in the direction set above. The manual sync buttons still work.
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

      case 'google-workspace':
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="gws-key" className={labelClass}>
                Service account key (JSON)
              </label>
              <input
                id="gws-key"
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void file
                    .text()
                    .then((text) => {
                      setGwsServiceAccountKey(text);
                      setGwsKeyFileName(file.name);
                    })
                    .catch(() => toast.error('The key file could not be read'));
                }}
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                {gwsKeyFileName
                  ? `Loaded ${gwsKeyFileName}. It is stored encrypted and never shown again.`
                  : editingSettings
                    ? 'A key is stored. Choose a file only to replace it.'
                    : 'Create a service account in Google Cloud, enable the Admin SDK API, and download a JSON key.'}
              </p>
            </div>
            <div>
              <label htmlFor="gws-admin" className={labelClass}>
                Admin to act as
              </label>
              <input
                id="gws-admin"
                type="email"
                value={gwsAdminEmail}
                onChange={(e) => setGwsAdminEmail(e.target.value)}
                placeholder="admin@firedept.org"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                A Workspace admin allowed to create users and manage groups.
              </p>
            </div>
            <div>
              <label htmlFor="gws-domain" className={labelClass}>
                Domain
              </label>
              <input
                id="gws-domain"
                type="text"
                value={gwsDomain}
                onChange={(e) => setGwsDomain(e.target.value)}
                placeholder="firedept.org"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Must match the department email domain in Organization Settings. Accounts are created at those
                addresses.
              </p>
            </div>
            <div>
              <label htmlFor="gws-ou" className={labelClass}>
                Organizational unit
              </label>
              <input
                id="gws-ou"
                type="text"
                value={gwsOrgUnitPath}
                onChange={(e) => setGwsOrgUnitPath(e.target.value)}
                placeholder="/Members"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="gws-groups" className={labelClass}>
                Add new members to these groups (optional)
              </label>
              <textarea
                id="gws-groups"
                rows={3}
                value={gwsGroups}
                onChange={(e) => setGwsGroups(e.target.value)}
                placeholder={'members@firedept.org\nannouncements@firedept.org'}
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">One address per line, up to 20.</p>
            </div>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5"
                checked={suspendOnRetirement}
                onChange={(e) => setSuspendOnRetirement(e.target.checked)}
              />
              <span>
                <span className="text-theme-text-primary text-sm">Suspend the account when a member retires</span>
                <span className="text-theme-text-muted block text-xs">
                  Off by default: retired members keep their account. When on, retiring suspends the account as a drop
                  does, and returning to active lifts it. It applies to members who retire while it is on; members
                  already retired are not changed when you turn it on or off.
                </span>
              </span>
            </label>
            <p className="text-theme-text-muted text-xs">
              In the Google Admin console, open Security &rarr; API controls &rarr; Domain-wide delegation and authorize
              the service account&apos;s client ID for <code>https://www.googleapis.com/auth/admin.directory.user</code>{' '}
              and <code>https://www.googleapis.com/auth/admin.directory.group.member</code>. Also authorize the
              read-only <code>https://www.googleapis.com/auth/admin.directory.orgunit.readonly</code> so{' '}
              <strong>Test</strong> can confirm the organizational unit exists; only Test uses it. Each account created
              uses a Workspace license.
            </p>
          </div>
        );

      case 'microsoft-365':
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="ms-tenant" className={labelClass}>
                Directory (tenant) ID
              </label>
              <input
                id="ms-tenant"
                type="text"
                value={msTenantId}
                onChange={(e) => setMsTenantId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="ms-client" className={labelClass}>
                Application (client) ID
              </label>
              <input
                id="ms-client"
                type="text"
                value={msClientId}
                onChange={(e) => setMsClientId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="ms-secret" className={labelClass}>
                Client secret value
              </label>
              <input
                id="ms-secret"
                type="password"
                autoComplete="off"
                value={msClientSecret}
                onChange={(e) => setMsClientSecret(e.target.value)}
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                {editingSettings
                  ? 'A secret is stored. Enter one only to replace it, for example before it expires.'
                  : 'The secret value (not its ID) from the app registration. It is stored encrypted and never shown again.'}
              </p>
            </div>
            <div>
              <label htmlFor="ms-secret-expires" className={labelClass}>
                Client secret expires on (optional)
              </label>
              <input
                id="ms-secret-expires"
                type="date"
                value={msSecretExpiresOn}
                onChange={(e) => setMsSecretExpiresOn(e.target.value)}
                className="form-input w-48"
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                The &quot;Expires&quot; date Entra ID shows beside the secret. Administrators are emailed 30 days and 7
                days before it, and on the day; an expired secret stops every account change. Update it whenever you
                replace the secret.
              </p>
            </div>
            <div>
              <label htmlFor="ms-domain" className={labelClass}>
                Domain
              </label>
              <input
                id="ms-domain"
                type="text"
                value={msDomain}
                onChange={(e) => setMsDomain(e.target.value)}
                placeholder="firedept.org"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Must match the department email domain in Organization Settings, and be a verified domain in Microsoft
                365. Accounts are created at those addresses.
              </p>
            </div>
            <div>
              <label htmlFor="ms-location" className={labelClass}>
                Usage location
              </label>
              <input
                id="ms-location"
                type="text"
                maxLength={2}
                value={msUsageLocation}
                onChange={(e) => setMsUsageLocation(e.target.value)}
                placeholder="US"
                className="form-input w-24"
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                The two-letter country every new account gets. Microsoft will not license an account without one.
              </p>
            </div>
            <div>
              <label htmlFor="ms-sku" className={labelClass}>
                License SKU ID (optional)
              </label>
              <input
                id="ms-sku"
                type="text"
                value={msLicenseSkuId}
                onChange={(e) => setMsLicenseSkuId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                The license each new account is given; without one it has no mailbox. Leave empty if a group below
                licenses its members (group-based licensing). <strong>Test</strong> shows how many are left.
              </p>
            </div>
            <div>
              <label htmlFor="ms-groups" className={labelClass}>
                Add new members to these groups (optional)
              </label>
              <textarea
                id="ms-groups"
                rows={3}
                value={msGroups}
                onChange={(e) => setMsGroups(e.target.value)}
                placeholder={'members@firedept.org\n00000000-0000-0000-0000-000000000000'}
                className={inputClass}
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                One per line, up to 20: a Microsoft 365 group&apos;s address, or a security group&apos;s object ID.
                Distribution lists, mail-enabled security groups and dynamic groups cannot be used; Test rejects them.
              </p>
            </div>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5"
                checked={suspendOnRetirement}
                onChange={(e) => setSuspendOnRetirement(e.target.checked)}
              />
              <span>
                <span className="text-theme-text-primary text-sm">Block sign-in when a member retires</span>
                <span className="text-theme-text-muted block text-xs">
                  Off by default: retired members keep their account. When on, retiring blocks the account as a drop
                  does, and returning to active lifts it. It applies to members who retire while it is on; members
                  already retired are not changed when you turn it on or off.
                </span>
              </span>
            </label>
            <p className="text-theme-text-muted text-xs">
              In Entra ID, register an application, add a client secret, and grant it these Microsoft Graph application
              permissions with admin consent: <code>User.ReadWrite.All</code>,{' '}
              <code>User-PasswordProfile.ReadWrite.All</code>, <code>User.RevokeSessions.All</code>,{' '}
              <code>GroupMember.ReadWrite.All</code> and, with a license, <code>LicenseAssignment.ReadWrite.All</code>.
              Then assign the application the <strong>User Administrator</strong> role. Each licensed account uses a
              Microsoft 365 license.
            </p>
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
                Set a secret to auto-advance a prospect&apos;s interview stage once their meeting has finished. Add this
                URL as a Cal.com webhook (MEETING_ENDED) using the same secret:
              </p>
              <code className="bg-theme-surface-secondary text-theme-text-secondary mt-1 block rounded px-2 py-1 text-xs break-all">
                {webhookCallbackUrl('calcom', integration.id)}
              </code>
            </div>
          </div>
        );

      case 'claude-mcp':
        return (
          <div className="space-y-3">
            <div className="alert-info text-xs">
              Member records never carry personal information through this connection &mdash; phone numbers, email
              addresses, home addresses, dates of birth, emergency contacts and medical results are stripped whatever is
              chosen below, and free text is scrubbed of phone numbers and email addresses. Other personal details
              someone typed into a published document or note are not detectable and will pass through, so keep them out
              of published content. After connecting, an IT administrator issues the service key from the card.
            </div>
            <div>
              <label htmlFor="mcp-access-mode" className={labelClass}>
                Access
              </label>
              <select
                id="mcp-access-mode"
                value={mcpAccessMode}
                onChange={(e) => setMcpAccessMode(e.target.value === 'read_write' ? 'read_write' : 'read_only')}
                className={inputClass}
              >
                <option value="read_only">Read-only</option>
                <option value="read_write">Read and write</option>
              </select>
              <p className="text-theme-text-muted mt-1 text-xs">
                Read and write lets Claude create draft events, meeting action items and pending reorder requests for a
                person to review. It never publishes, approves or sends anything.
              </p>
            </div>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5"
                checked={mcpExposeFinance}
                onChange={(e) => setMcpExposeFinance(e.target.checked)}
              />
              <span>
                <span className="text-theme-text-primary text-sm">Share finance totals</span>
                <span className="text-theme-text-muted block text-xs">
                  Fiscal years, budget lines and the treasurer&apos;s report in published minutes. Off by default.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5"
                checked={mcpExposeMedical}
                onChange={(e) => setMcpExposeMedical(e.target.checked)}
              />
              <span>
                <span className="text-theme-text-primary text-sm">Share medical screening status</span>
                <span className="text-theme-text-muted block text-xs">
                  Whether a member is current on each screening and when it lapses &mdash; never a result, provider or
                  note. Off by default because it can indicate protected health information.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5"
                checked={mcpExposeFullSchedule}
                onChange={(e) => setMcpExposeFullSchedule(e.target.checked)}
              />
              <span>
                <span className="text-theme-text-primary text-sm">Share the full duty schedule</span>
                <span className="text-theme-text-muted block text-xs">
                  Every shift and its assignments, as a scheduling manager sees them. Off by default: Claude then sees
                  only shifts open to all members, which is what any eligible member can see.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5"
                checked={mcpExposeMedicalSupplies}
                onChange={(e) => setMcpExposeMedicalSupplies(e.target.checked)}
              />
              <span>
                <span className="text-theme-text-primary text-sm">Share medical supply inventory</span>
                <span className="text-theme-text-muted block text-xs">
                  Medical stock counts, items below their reorder point and lots that are expiring or expired.
                  Read-only: Claude cannot request a reorder of a medical item. A member&apos;s own connection also
                  needs medical inventory access. Off by default.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5"
                checked={mcpOauthEnabled}
                onChange={(e) => setMcpOauthEnabled(e.target.checked)}
              />
              <span>
                <span className="text-theme-text-primary text-sm">Let members connect with their own account</span>
                <span className="text-theme-text-muted block text-xs">
                  Members sign in and approve a client such as the claude.ai connector themselves. A member&apos;s
                  connection reaches only what that member can see in The Logbook, within the switches above. Needs the
                  server&apos;s OAuth setting (MCP_OAUTH_ENABLED) and at least one client registered from the card. Off
                  by default.
                </span>
              </span>
            </label>
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
                className="form-checkbox mt-0.5"
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
      <div data-page-main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
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
            {/* One tile counts both kinds, so it needs a word that covers both:
                the API stores an activated feature as `connected` like any
                other entry, and labelling the total "Connected" reported NFC
                ID Cards as a connection the card itself no longer claims. */}
            <p className="text-theme-text-muted text-xs font-medium uppercase">Active</p>
            <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-400">{connectedCount}</p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Ready to Set Up</p>
            <p className="mt-1 text-2xl font-bold text-indigo-700 dark:text-indigo-400">{availableCount}</p>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="card mb-6 p-4" role="search" aria-label="Search and filter integrations">
          <div className="flex flex-col items-center gap-4 md:flex-row">
            {/* A floor on the search box: the category pills are a wrapping row
                whose max-content width is the whole set, so without one the
                pills kept their single line and squeezed the search to ~80px
                on a 1024px tablet. With it, the pills wrap instead. */}
            <div className="relative w-full flex-1 md:max-w-md md:min-w-64">
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
                aria-label="Search integrations"
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
                  className={`touch-target-phone flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
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
        <div className="card-grid gap-4">
          {showDelegatedMcpCard && (
            <div className="card p-6" data-testid="integration-card-claude-mcp-delegated">
              <div className="mb-4 flex items-start space-x-3">
                <div className="rounded-lg bg-orange-500/10 p-2 text-orange-800 dark:text-orange-400">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-theme-text-primary font-semibold">Claude (MCP)</h3>
                  <p className="text-theme-text-muted text-sm">
                    Connected. You can issue or revoke the department&apos;s service key.
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={toggleMcpPanel}
                  disabled={mcpBusy}
                  title={mcpBusy ? 'Wait for the current key request to finish' : undefined}
                  className="touch:min-h-11 flex items-center space-x-1 rounded-lg bg-orange-500/10 px-3 py-1.5 text-sm text-orange-800 transition-colors hover:bg-orange-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-orange-400"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>Service key</span>
                </button>
              </div>
            </div>
          )}
          {filteredIntegrations.map((integration) => {
            const ui = getUI(integration.integration_type);
            const activation = isActivation(integration.integration_type);
            const calendarProvider = calendarProviderFor(integration.integration_type);
            return (
              <div
                key={integration.id}
                data-testid={`integration-card-${integration.integration_type}`}
                className="stat-card transition-all hover:border-indigo-500/30"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center space-x-3">
                    <div className={`rounded-lg p-2 ${ui.bgColor} ${ui.color}`}>{ui.icon}</div>
                    <div>
                      <h3 className="text-theme-text-primary font-semibold">{integration.name}</h3>
                      <span className="text-theme-text-muted text-xs">{integration.category}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {integration.status === ConnectionStatus.CONNECTED && (
                      <span className="flex items-center space-x-1 rounded-sm border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs text-green-800 dark:text-green-400">
                        {activation ? <Check className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
                        <span>{activation ? 'Active' : 'Connected'}</span>
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
                {integration.integration_type === 'ical' &&
                  integration.status === ConnectionStatus.CONNECTED &&
                  canManage && <IcalFeedPanel integrationId={integration.id} />}
                {calendarProvider && integration.status !== 'coming_soon' && canManage && (
                  <CalendarPublishPanel
                    provider={calendarProvider}
                    integration={integration}
                    onUpdated={(updated) =>
                      setIntegrations((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
                    }
                    onDisconnected={() => {
                      void loadIntegrations();
                    }}
                  />
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  {integration.status !== 'coming_soon' && canManage && (
                    <RouterLink
                      to={`/integrations/${integration.id}`}
                      aria-label={`${integration.name} health and run history`}
                      className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover touch:min-h-11 flex items-center space-x-1 rounded-lg px-3 py-1.5 text-sm transition-colors"
                    >
                      <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Details</span>
                    </RouterLink>
                  )}
                  {integration.status === ConnectionStatus.CONNECTED &&
                    integration.integration_type === 'claude-mcp' &&
                    (canManage || canIssueKeys) && (
                      <button
                        onClick={toggleMcpPanel}
                        disabled={mcpBusy}
                        title={mcpBusy ? 'Wait for the current key request to finish' : undefined}
                        className="touch:min-h-11 flex items-center space-x-1 rounded-lg bg-orange-500/10 px-3 py-1.5 text-sm text-orange-800 transition-colors hover:bg-orange-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-orange-400"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        <span>Service key</span>
                      </button>
                    )}
                  {integration.status === ConnectionStatus.CONNECTED && canManage && (
                    <>
                      {(integration.integration_type === 'claude-mcp' ||
                        integration.integration_type === 'ical' ||
                        (isDirectory(integration.integration_type) && canChange(integration.integration_type))) && (
                        <button
                          onClick={() => {
                            resetFormState(integration);
                            setEditingSettings(true);
                            setShowConnectModal(integration.id);
                          }}
                          aria-label={`${integration.name} settings`}
                          className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover touch:min-h-11 flex items-center space-x-1 rounded-lg px-3 py-1.5 text-sm transition-colors"
                        >
                          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Settings</span>
                        </button>
                      )}
                      {integration.credential_expiring === true &&
                        typeof integration.credential_days_left === 'number' && (
                          <span className="flex items-center space-x-1 rounded-lg bg-amber-500/10 px-3 py-1.5 text-sm text-amber-800 dark:text-amber-300">
                            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>
                              {integration.credential_days_left <= 0
                                ? 'Client secret expired'
                                : `Client secret expires in ${integration.credential_days_left} day${
                                    integration.credential_days_left === 1 ? '' : 's'
                                  }`}
                            </span>
                          </span>
                        )}
                      {isDirectory(integration.integration_type) && googleAttention.length > 0 && (
                        <button
                          onClick={() => setShowGoogleAttention(!showGoogleAttention)}
                          aria-expanded={showGoogleAttention}
                          className="touch:min-h-11 flex items-center space-x-1 rounded-lg bg-amber-500/10 px-3 py-1.5 text-sm text-amber-800 transition-colors hover:bg-amber-500/20 dark:text-amber-300"
                        >
                          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{googleAttention.length} need attention</span>
                        </button>
                      )}
                      {isDirectory(integration.integration_type) && canChange(integration.integration_type) && (
                        <button
                          onClick={() => {
                            void handleLinkExistingGoogle();
                          }}
                          disabled={linkingGoogle}
                          className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover touch:min-h-11 flex items-center space-x-1 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {linkingGoogle ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Link className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          <span>Link existing members</span>
                        </button>
                      )}
                      {integration.integration_type === 'salesforce' && (
                        <button
                          onClick={() => setShowSyncPanel(!showSyncPanel)}
                          className="touch:min-h-11 flex items-center space-x-1 rounded-lg bg-blue-500/10 px-3 py-1.5 text-sm text-blue-700 transition-colors hover:bg-blue-500/20 dark:text-blue-400"
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
                          className="touch:min-h-11 flex items-center space-x-1 rounded-lg bg-slate-500/10 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-500/20 dark:text-slate-300"
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                          <span>Bookings</span>
                        </button>
                      )}
                      {!activation && (
                        <button
                          onClick={() => {
                            void handleTestConnection(integration.id);
                          }}
                          aria-label={`Test ${integration.name}`}
                          disabled={testing}
                          className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover touch:min-h-11 flex items-center space-x-1 rounded-lg px-3 py-1.5 text-sm transition-colors"
                        >
                          <Bell className="h-3.5 w-3.5" />
                          <span>Test</span>
                        </button>
                      )}
                      {canChange(integration.integration_type) &&
                        !OAUTH_PANEL_TYPES.has(integration.integration_type) && (
                          <button
                            onClick={() => {
                              void handleDisconnect(integration.id);
                            }}
                            // Disconnecting the Claude integration unmounts the key
                            // panel; mid-issue that would lose the one-time plaintext.
                            disabled={mcpBusy && integration.integration_type === 'claude-mcp'}
                            aria-label={`${activation ? 'Deactivate' : 'Disconnect'} ${integration.name}`}
                            title={
                              mcpBusy && integration.integration_type === 'claude-mcp'
                                ? 'Wait for the current key request to finish'
                                : undefined
                            }
                            className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover touch:min-h-11 flex items-center space-x-1 rounded-lg px-3 py-1.5 text-sm transition-colors"
                          >
                            <Settings className="h-3.5 w-3.5" />
                            <span>{activation ? 'Deactivate' : 'Disconnect'}</span>
                          </button>
                        )}
                    </>
                  )}
                  {integration.status === 'available' && canManage && !canChange(integration.integration_type) && (
                    <span className="text-theme-text-muted text-xs">An organization administrator connects this</span>
                  )}
                  {integration.status === 'available' &&
                    canChange(integration.integration_type) &&
                    !OAUTH_PANEL_TYPES.has(integration.integration_type) && (
                      <button
                        type="button"
                        data-integration-connect={integration.id}
                        aria-label={`${activation ? 'Activate' : 'Connect'} ${integration.name}`}
                        onClick={() => {
                          resetFormState(integration);
                          setShowConnectModal(integration.id);
                        }}
                        className="touch:min-h-11 flex items-center space-x-1 rounded-lg bg-indigo-600/20 px-4 py-1.5 text-sm text-indigo-700 transition-colors hover:bg-indigo-600/30"
                      >
                        {activation ? <Check className="h-3.5 w-3.5" /> : <Plug className="h-3.5 w-3.5" />}
                        <span>{activation ? 'Activate' : 'Connect'}</span>
                      </button>
                    )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Claude (MCP) service key panel */}
        {showMcpPanel &&
          (showDelegatedMcpCard ||
            integrations.some(
              (i) => i.integration_type === 'claude-mcp' && i.status === ConnectionStatus.CONNECTED
            )) && (
            <>
              <McpServiceKeyPanel onClose={() => setShowMcpPanel(false)} onBusyChange={setMcpPanelBusy} />
              <McpOAuthPanel onBusyChange={setMcpOAuthBusy} configVersion={mcpConfigVersion} />
            </>
          )}

        {/* Directory accounts needing attention */}
        {showGoogleAttention && googleWorkspaceConnected && googleAttention.length > 0 && (
          <div className="card mt-6 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="rounded-lg bg-amber-500/10 p-2 text-amber-800 dark:text-amber-300">
                  <AlertCircle className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-theme-text-primary font-semibold">{directoryName} accounts needing attention</h3>
                  <p className="text-theme-text-muted text-xs">
                    Open a member to see the reason and retry. Anything waiting over a day is also emailed to
                    administrators each morning.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowGoogleAttention(false)}
                className="text-theme-text-muted hover:text-theme-text-primary"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ul
              className="divide-theme-surface-border divide-y"
              aria-label={`${directoryName} accounts needing attention`}
            >
              {googleAttention.map((item) => (
                <li key={item.user_id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <RouterLink
                        to={`/members/${item.user_id}`}
                        className="text-theme-text-primary text-sm font-medium underline"
                      >
                        {item.member_name}
                      </RouterLink>
                      <p className="text-theme-text-secondary text-xs">
                        {item.label} · {item.primary_email}
                      </p>
                      {item.detail && <p className="text-theme-text-muted text-xs">{item.detail}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      {item.overdue && (
                        <span className="badge bg-amber-500/10 text-amber-800 dark:text-amber-300">Over a day</span>
                      )}
                      {item.since && (
                        <p className="text-theme-text-muted text-xs">Since {formatDateTime(item.since, tz)}</p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

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
                  aria-label="Close"
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
                  aria-label="Close"
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
                      Members are never created or deleted. Changes apply only when sync direction is Pull or
                      Bidirectional. Real-time updates also arrive via the Salesforce webhook.
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
                  With automatic sync on, members, training and events are also pushed every 30 minutes when sync
                  direction is &quot;Push&quot; or &quot;Bidirectional&quot;.
                </p>
              </div>

              {/* How Salesforce signs in */}
              <div className="border-theme-surface-border mt-4 border-t pt-4">
                <h4 className="text-theme-text-primary mb-1 text-sm font-medium">Sign-in method</h4>
                <p className="text-theme-text-muted mb-3 text-xs">
                  Connected with &quot;Connect with Salesforce&quot; or a pasted refresh token, the integration signs in
                  as the person who connected it. Switch to client credentials to sign in as your Connected App instead,
                  so syncing does not depend on one person&apos;s account.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void handleSwitchSalesforceToClientCredentials();
                  }}
                  disabled={switchingSfAuth}
                  className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover touch:min-h-11 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
                >
                  {switchingSfAuth ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="h-3.5 w-3.5" />
                  )}
                  <span>Switch to Client Credentials</span>
                </button>
              </div>
            </div>
          )}

        {delegatedMcpError && !showDelegatedMcpCard && (
          <div className="alert-danger mt-6 flex items-start gap-2" role="alert" data-testid="mcp-delegated-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                The Claude (MCP) status could not be loaded, so the service key cannot be managed right now.
              </p>
              <button
                type="button"
                onClick={() => setDelegatedMcpAttempt((n) => n + 1)}
                className="mt-2 text-xs underline"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {filteredIntegrations.length === 0 && !showDelegatedMcpCard && !delegatedMcpError && (
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
            const activation = isActivation(selectedIntegration.integration_type);
            const hasConfigForm =
              WEBHOOK_TYPES.has(selectedIntegration.integration_type) ||
              CONFIG_TYPES.has(selectedIntegration.integration_type);

            return (
              <div className="fixed inset-0 z-50 overflow-y-auto">
                <div className="flex min-h-screen items-center justify-center px-4">
                  <div className="modal-overlay" aria-hidden="true" />
                  <DialogPanel
                    onClose={() => {
                      setShowConnectModal(null);
                      resetFormState();
                    }}
                    className="relative w-full max-w-lg"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="integration-connect-title"
                  >
                    <div className="px-6 pt-5 pb-4">
                      <div className="mb-4 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className={`rounded-lg p-2 ${ui.bgColor} ${ui.color}`}>{ui.icon}</div>
                          <h3 id="integration-connect-title" className="text-theme-text-primary text-lg font-medium">
                            {editingSettings
                              ? `${selectedIntegration.name} settings`
                              : `${activation ? 'Activate' : 'Connect'} ${selectedIntegration.name}`}
                          </h3>
                        </div>
                        <button
                          data-dialog-close
                          onClick={() => {
                            setShowConnectModal(null);
                            resetFormState();
                          }}
                          className="text-theme-text-muted hover:text-theme-text-primary"
                          aria-label="Close"
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
                          <h4 className="text-theme-text-primary text-sm font-medium">
                            {activation ? 'What this turns on:' : 'Features included:'}
                          </h4>
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
                            {editingSettings
                              ? isDirectory(selectedIntegration.integration_type)
                                ? 'Saved settings apply to the next member converted. Accounts already created are not changed.'
                                : selectedIntegration.integration_type === 'ical'
                                  ? 'Saved settings apply the next time a subscribed calendar refreshes. The feed link does not change.'
                                  : "Saved settings apply to the next request a client makes. The service key and members' connections are kept."
                              : activation
                                ? 'Activating turns this feature on for your organization. You can deactivate it at any time.'
                                : 'Connecting turns this integration on for your organization. You can disconnect it at any time.'}
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
                        data-testid={editingSettings ? 'settings-submit' : 'connect-submit'}
                        onClick={() => {
                          if (editingSettings) {
                            void handleSaveSettings(selectedIntegration.id);
                          } else {
                            void handleConnect(selectedIntegration.id);
                          }
                        }}
                        disabled={connecting}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {editingSettings
                          ? connecting
                            ? 'Saving...'
                            : 'Save settings'
                          : activation
                            ? connecting
                              ? 'Activating...'
                              : 'Activate'
                            : connecting
                              ? 'Connecting...'
                              : 'Connect'}
                      </button>
                    </div>
                  </DialogPanel>
                </div>
              </div>
            );
          })()}
      </div>
    </div>
  );
};

export default IntegrationsPage;
