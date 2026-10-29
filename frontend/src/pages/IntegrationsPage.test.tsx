import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import IntegrationsPage from './IntegrationsPage';
import toast from 'react-hot-toast';
import { ConfirmProvider } from '../contexts/ConfirmContext';

// Mock the auth store
const mockCheckPermission = vi.fn().mockReturnValue(true);
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: mockCheckPermission,
  }),
}));

// Mock the integrations service
const mockGetIntegrations = vi.fn();
const mockConnectIntegration = vi.fn();
const mockDisconnectIntegration = vi.fn();
const mockUpdateIntegration = vi.fn();
const mockTestConnection = vi.fn();
const mockSalesforceReadiness = vi.fn();
const mockSalesforcePreviewMembers = vi.fn();
const mockGetSalesforceOAuthUrl = vi.fn().mockReturnValue('/api/v1/integrations/salesforce/oauth/authorize');
const mockGetCalcomBookings = vi.fn();
const mockGetMcpStatus = vi.fn();
const mockCreateMcpKey = vi.fn();
const mockRevokeMcpKey = vi.fn();
const mockLinkExistingGoogleMembers = vi.fn();
const mockGetGoogleWorkspaceAttention = vi.fn().mockResolvedValue([]);
const mockGetIcalFeed = vi.fn();
const mockRotateIcalFeed = vi.fn();
const mockStartGoogleCalendarConnect = vi.fn();
const mockStartOutlookCalendarConnect = vi.fn();

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('../services/api', () => ({
  integrationsService: {
    getIntegrations: (...args: unknown[]) => mockGetIntegrations(...args) as unknown,
    connectIntegration: (...args: unknown[]) => mockConnectIntegration(...args) as unknown,
    disconnectIntegration: (...args: unknown[]) => mockDisconnectIntegration(...args) as unknown,
    updateIntegration: (...args: unknown[]) => mockUpdateIntegration(...args) as unknown,
    testConnection: (...args: unknown[]) => mockTestConnection(...args) as unknown,
    salesforceReadiness: (...args: unknown[]) => mockSalesforceReadiness(...args) as unknown,
    salesforcePreviewMembers: (...args: unknown[]) => mockSalesforcePreviewMembers(...args) as unknown,
    getSalesforceOAuthUrl: (...args: unknown[]) => mockGetSalesforceOAuthUrl(...args) as unknown,
    getCalcomBookings: (...args: unknown[]) => mockGetCalcomBookings(...args) as unknown,
    getMcpStatus: (...args: unknown[]) => mockGetMcpStatus(...args) as unknown,
    createMcpKey: (...args: unknown[]) => mockCreateMcpKey(...args) as unknown,
    revokeMcpKey: (...args: unknown[]) => mockRevokeMcpKey(...args) as unknown,
    linkExistingGoogleMembers: (...args: unknown[]) => mockLinkExistingGoogleMembers(...args) as unknown,
    getGoogleWorkspaceAttention: (...args: unknown[]) => mockGetGoogleWorkspaceAttention(...args) as unknown,
    getIcalFeed: (...args: unknown[]) => mockGetIcalFeed(...args) as unknown,
    rotateIcalFeed: (...args: unknown[]) => mockRotateIcalFeed(...args) as unknown,
    startGoogleCalendarConnect: (...args: unknown[]) => mockStartGoogleCalendarConnect(...args) as unknown,
    startOutlookCalendarConnect: (...args: unknown[]) => mockStartOutlookCalendarConnect(...args) as unknown,
  },
}));

vi.mock('../utils/errorHandling', () => ({
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <ConfirmProvider>
        <IntegrationsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

const mockIntegrations = [
  {
    id: 'int-1',
    organization_id: 'org-1',
    integration_type: 'slack',
    name: 'Slack',
    description: 'Send notifications to Slack',
    category: 'Messaging',
    status: 'available' as const,
    config: {},
    enabled: false,
    contains_phi: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'int-2',
    organization_id: 'org-1',
    integration_type: 'nws-weather',
    name: 'NWS Weather Alerts',
    description: 'Weather alerts for your station',
    category: 'Safety',
    status: 'available' as const,
    config: {},
    enabled: false,
    contains_phi: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'int-3',
    organization_id: 'org-1',
    integration_type: 'epcr-import',
    name: 'Generic ePCR Import',
    description: 'Import ePCR data via CSV or XML',
    category: 'EMS',
    status: 'connected' as const,
    config: {},
    enabled: true,
    contains_phi: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'int-4',
    organization_id: 'org-1',
    integration_type: 'imagetrend',
    name: 'ImageTrend',
    description: 'ImageTrend ePCR sync',
    category: 'EMS',
    status: 'coming_soon' as const,
    config: {},
    enabled: false,
    contains_phi: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const salesforceAvailable = {
  id: 'sf-1',
  organization_id: 'org-1',
  integration_type: 'salesforce',
  name: 'Salesforce',
  description: 'Sync contacts, donors, and events with Salesforce CRM',
  category: 'CRM',
  status: 'available' as const,
  config: {},
  enabled: false,
  contains_phi: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const salesforceConnected = { ...salesforceAvailable, status: 'connected' as const, enabled: true };

describe('IntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetIntegrations.mockResolvedValue(mockIntegrations);
    mockCheckPermission.mockReturnValue(true);
  });

  it('renders integration cards after loading', async () => {
    renderPage();
    expect(await screen.findByText('Slack')).toBeInTheDocument();
    expect(screen.getByText('NWS Weather Alerts')).toBeInTheDocument();
    expect(screen.getByText('Generic ePCR Import')).toBeInTheDocument();
    expect(screen.getByText('ImageTrend')).toBeInTheDocument();
  });

  it('shows correct stats', async () => {
    renderPage();
    await screen.findByText('Slack');
    // 4 total, 1 connected, 2 available
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('labels the totals with wording that covers activations as well as connections', async () => {
    renderPage();
    await screen.findByText('Slack');
    // An activated feature is stored as `connected` like any other entry and
    // counted here, so this tile must not call the total a connection.
    const stats = screen.getByRole('region', { name: 'Integration statistics' });
    expect(within(stats).getByText('Active')).toBeInTheDocument();
    expect(within(stats).queryByText('Connected')).not.toBeInTheDocument();
    expect(within(stats).queryByText('Ready to Connect')).not.toBeInTheDocument();
  });

  it('shows category filter buttons including new categories', async () => {
    renderPage();
    await screen.findByText('Slack');
    const filterGroup = screen.getByRole('group', { name: 'Filter by category' });
    expect(within(filterGroup).getByText('All')).toBeInTheDocument();
    expect(within(filterGroup).getByText('Messaging')).toBeInTheDocument();
    expect(within(filterGroup).getByText('Safety')).toBeInTheDocument();
    expect(within(filterGroup).getByText('EMS')).toBeInTheDocument();
  });

  it('filters by category', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Slack');

    const filterGroup = screen.getByRole('group', { name: 'Filter by category' });
    await user.click(within(filterGroup).getByText('EMS'));
    expect(screen.getByText('Generic ePCR Import')).toBeInTheDocument();
    expect(screen.getByText('ImageTrend')).toBeInTheDocument();
    expect(screen.queryByText('Slack')).not.toBeInTheDocument();
  });

  it('filters by search query', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Slack');

    const searchInput = screen.getByPlaceholderText('Search integrations...');
    await user.type(searchInput, 'weather');
    expect(screen.getByText('NWS Weather Alerts')).toBeInTheDocument();
    expect(screen.queryByText('Slack')).not.toBeInTheDocument();
  });

  it('shows PHI badge for EMS integrations', async () => {
    renderPage();
    await screen.findByText('Slack');
    expect(screen.getByText('PHI')).toBeInTheDocument();
  });

  it('shows Coming Soon badge', async () => {
    renderPage();
    await screen.findByText('Slack');
    expect(screen.getByText('Coming Soon')).toBeInTheDocument();
  });

  it('shows Connected badge on connected integrations', async () => {
    renderPage();
    await screen.findByText('Slack');
    // The ePCR import card is connected — find its badge
    const epcrCard = screen.getByTestId('integration-card-epcr-import');
    expect(within(epcrCard).getByText('Connected')).toBeInTheDocument();
  });

  it('shows connect button for available integrations', async () => {
    renderPage();
    await screen.findByText('Slack');
    const connectButtons = screen.getAllByText('Connect');
    expect(connectButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('shows test and disconnect buttons for connected integrations', async () => {
    renderPage();
    await screen.findByText('Slack');
    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText('Disconnect')).toBeInTheDocument();
  });

  // W73: Disconnect acted on one tap, and the card's buttons read only
  // "Connect" / "Disconnect" whichever integration they belonged to.
  it('names each card button after its integration', async () => {
    renderPage();
    await screen.findByText('Slack');

    expect(screen.getByRole('button', { name: 'Connect Slack' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect Generic ePCR Import' })).toBeInTheDocument();
  });

  it('asks before disconnecting, and keeps the connection when told to', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Slack');

    await user.click(screen.getByRole('button', { name: 'Disconnect Generic ePCR Import' }));
    expect(await screen.findByText(/stops working for the department/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep it connected' }));

    expect(mockDisconnectIntegration).not.toHaveBeenCalled();
  });

  it('disconnects once confirmed', async () => {
    const user = userEvent.setup();
    mockDisconnectIntegration.mockResolvedValue({});
    renderPage();
    await screen.findByText('Slack');

    await user.click(screen.getByRole('button', { name: 'Disconnect Generic ePCR Import' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect Generic ePCR Import?' });
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(mockDisconnectIntegration).toHaveBeenCalledWith('int-3'));
  });

  it('opens connect modal with config form for webhook type', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Slack');

    // Find the Slack card's Connect button
    const slackCard = screen.getByTestId('integration-card-slack');
    const connectBtn = within(slackCard).getByText('Connect');
    await user.click(connectBtn);

    expect(screen.getByText('Connect Slack')).toBeInTheDocument();
    // Tied to its field since W73.
    expect(screen.getByLabelText('Webhook URL')).toHaveAttribute('type', 'url');
  });

  it('connects a Generic Webhook with the events it should be sent', async () => {
    const user = userEvent.setup();
    const webhook = {
      ...(mockIntegrations[0] ?? {}),
      id: 'wh-1',
      integration_type: 'generic-webhook',
      name: 'Generic Webhooks',
      category: 'Automation',
    };
    mockGetIntegrations.mockResolvedValue([webhook]);
    mockConnectIntegration.mockResolvedValue({ ...webhook, status: 'connected', enabled: true });

    renderPage();
    await screen.findByText('Generic Webhooks');
    await user.click(within(screen.getByTestId('integration-card-generic-webhook')).getByText('Connect'));
    await user.type(screen.getByLabelText('Webhook URL'), 'https://hooks.example.org/in');
    await user.click(screen.getByRole('checkbox', { name: /A shift is created/ }));
    await user.click(screen.getByRole('checkbox', { name: /A training record is added/ }));
    await user.click(screen.getByTestId('connect-submit'));

    expect(mockConnectIntegration).toHaveBeenCalledWith('wh-1', {
      url: 'https://hooks.example.org/in',
      secret: '',
      event_types: ['shift.created', 'training.recorded'],
    });
  });

  it('connects NWS Weather Alerts with the channels the department chose', async () => {
    const user = userEvent.setup();
    mockConnectIntegration.mockResolvedValue({ ...mockIntegrations[1], status: 'connected', enabled: true });

    renderPage();
    await screen.findByText('NWS Weather Alerts');
    await user.click(within(screen.getByTestId('integration-card-nws-weather')).getByText('Connect'));
    await user.type(screen.getByLabelText('NWS Zone ID'), 'vaz054');
    await user.click(screen.getByRole('checkbox', { name: /Bell notice when an alert is issued/ }));
    await user.click(screen.getByRole('checkbox', { name: /Email when an alert is issued/ }));
    await user.click(screen.getByTestId('connect-submit'));

    expect(mockConnectIntegration).toHaveBeenCalledWith('int-2', {
      zone_id: 'VAZ054',
      notify_banner: true,
      notify_bell: false,
      notify_email: true,
    });
  });

  it('hides manage buttons when user lacks permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderPage();
    await screen.findByText('Slack');

    expect(screen.queryByText('Connect')).not.toBeInTheDocument();
    expect(screen.queryByText('Disconnect')).not.toBeInTheDocument();
    expect(screen.queryByText('Test')).not.toBeInTheDocument();
  });

  it('shows empty state when no integrations match', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Slack');

    const searchInput = screen.getByPlaceholderText('Search integrations...');
    await user.type(searchInput, 'nonexistent-integration-xyz');
    expect(screen.getByText('No integrations match your search')).toBeInTheDocument();
  });

  describe('Salesforce', () => {
    it('connect modal offers OAuth connect and contact-matching options', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([salesforceAvailable]);
      renderPage();
      await screen.findByText('Salesforce');

      const card = screen.getByTestId('integration-card-salesforce');
      await user.click(within(card).getByText('Connect'));

      expect(screen.getByText('Connect Salesforce')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Connect with Salesforce/i })).toBeInTheDocument();
      expect(screen.getByLabelText('Contact Matching')).toBeInTheDocument();
    });

    it('OAuth button persists config then hands off to Salesforce', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([salesforceAvailable]);
      mockUpdateIntegration.mockResolvedValue(salesforceConnected);
      // Stub navigation so assigning window.location.href does not throw in jsdom.
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: { ...originalLocation, href: '' },
      });

      try {
        renderPage();
        await screen.findByText('Salesforce');
        const card = screen.getByTestId('integration-card-salesforce');
        await user.click(within(card).getByText('Connect'));

        await user.type(screen.getByLabelText('Salesforce Instance URL'), 'https://acme.my.salesforce.com');
        await user.click(screen.getByRole('button', { name: /Connect with Salesforce/i }));

        expect(mockUpdateIntegration).toHaveBeenCalledWith(
          'sf-1',
          expect.objectContaining({
            instance_url: 'https://acme.my.salesforce.com',
            match_strategy: 'email',
            graceful_fields: true,
          })
        );
        // The browser was handed off to the Salesforce authorize endpoint.
        expect(window.location.href).toBe('/api/v1/integrations/salesforce/oauth/authorize');
      } finally {
        Object.defineProperty(window, 'location', {
          configurable: true,
          writable: true,
          value: originalLocation,
        });
      }
    });

    it('readiness check renders missing external-ID fields', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([salesforceConnected]);
      mockSalesforceReadiness.mockResolvedValue({
        connected: true,
        ready: false,
        external_id_fields_ready: false,
        objects: {
          Contact: { accessible: true, missing_fields: ['Logbook_Member_ID__c'], error: null },
          Event: { accessible: true, missing_fields: [], error: null },
          Task: { accessible: true, missing_fields: [], error: null },
        },
      });

      renderPage();
      await screen.findByText('Salesforce');
      await user.click(screen.getByText('Sync'));
      await user.click(screen.getByText('Check readiness'));

      expect(await screen.findByText(/setup needed for duplicate-free sync/i)).toBeInTheDocument();
      expect(screen.getByText(/Logbook_Member_ID__c/)).toBeInTheDocument();
    });

    it('preview shows create vs matched counts without writing', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([salesforceConnected]);
      mockSalesforcePreviewMembers.mockResolvedValue({
        success: true,
        total: 3,
        would_create: 1,
        would_update: 0,
        would_adopt: 1,
        skipped: 1,
      });

      renderPage();
      await screen.findByText('Salesforce');
      await user.click(screen.getByText('Sync'));
      await user.click(screen.getByText('Preview member sync'));

      expect(await screen.findByText(/Member sync preview \(3 members\)/i)).toBeInTheDocument();
      expect(screen.getByText('matched existing')).toBeInTheDocument();
    });

    // INT-11: the backend switches to client credentials on an explicit ""
    // refresh token; a blank form field is omitted and so could never send it.
    describe('Switch to Client Credentials', () => {
      beforeEach(() => {
        mockUpdateIntegration.mockReset();
        mockUpdateIntegration.mockResolvedValue(salesforceConnected);
        mockGetIntegrations.mockReset();
        mockGetIntegrations.mockResolvedValue([salesforceConnected]);
      });

      it('sends only an explicit empty refresh token once confirmed', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByText('Salesforce');
        await user.click(screen.getByText('Sync'));
        await user.click(screen.getByRole('button', { name: 'Switch to Client Credentials' }));

        expect(await screen.findByText('Switch Salesforce to client credentials?')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Switch to client credentials' }));

        await waitFor(() => {
          expect(mockUpdateIntegration).toHaveBeenCalledWith('sf-1', { refresh_token: '' });
        });
        expect(mockUpdateIntegration).toHaveBeenCalledTimes(1);
      });

      it('changes nothing when the officer keeps the current connection', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByText('Salesforce');
        await user.click(screen.getByText('Sync'));
        await user.click(screen.getByRole('button', { name: 'Switch to Client Credentials' }));
        await user.click(await screen.findByRole('button', { name: 'Keep the current connection' }));

        await waitFor(() => {
          expect(screen.queryByText('Switch Salesforce to client credentials?')).not.toBeInTheDocument();
        });
        expect(mockUpdateIntegration).not.toHaveBeenCalled();
      });
    });
  });

  describe('Documenso and Cal.com', () => {
    const documensoAvailable = {
      id: 'doc-1',
      organization_id: 'org-1',
      integration_type: 'documenso',
      name: 'Documenso',
      description: 'Send documents for electronic signature',
      category: 'Documents',
      status: 'available' as const,
      config: {},
      enabled: false,
      contains_phi: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const calcomAvailable = {
      ...documensoAvailable,
      id: 'cal-1',
      integration_type: 'calcom',
      name: 'Cal.com',
      description: 'Pull scheduled bookings from Cal.com',
      category: 'Scheduling',
    };

    it('connects Documenso with the entered API token', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([documensoAvailable]);
      mockConnectIntegration.mockResolvedValue({ ...documensoAvailable, status: 'connected', enabled: true });

      renderPage();
      await screen.findByText('Documenso');
      const card = screen.getByTestId('integration-card-documenso');
      await user.click(within(card).getByText('Connect'));

      await user.type(screen.getByLabelText('API Token'), 'api_secret123');
      await user.click(screen.getByTestId('connect-submit'));

      expect(mockConnectIntegration).toHaveBeenCalledWith('doc-1', {
        api_base_url: undefined,
        api_token: 'api_secret123',
        webhook_secret: undefined,
      });
    });

    it('connects Cal.com with the entered API key and optional base URL', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([calcomAvailable]);
      mockConnectIntegration.mockResolvedValue({ ...calcomAvailable, status: 'connected', enabled: true });

      renderPage();
      await screen.findByText('Cal.com');
      const card = screen.getByTestId('integration-card-calcom');
      await user.click(within(card).getByText('Connect'));

      await user.type(screen.getByLabelText('API Key'), 'cal_key456');
      await user.type(screen.getByLabelText('API Base URL (optional)'), 'https://cal.example.com/api/v1');
      await user.click(screen.getByTestId('connect-submit'));

      expect(mockConnectIntegration).toHaveBeenCalledWith('cal-1', {
        api_base_url: 'https://cal.example.com/api/v1',
        api_key: 'cal_key456',
        webhook_secret: undefined,
      });
    });

    it('loads and lists Cal.com bookings when the Bookings panel opens', async () => {
      const user = userEvent.setup();
      const calcomConnected = { ...calcomAvailable, status: 'connected' as const, enabled: true };
      mockGetIntegrations.mockResolvedValue([calcomConnected]);
      mockGetCalcomBookings.mockResolvedValue([
        {
          external_id: 'bk-1',
          title: 'Interview: J. Doe',
          description: '',
          location: 'Station 1',
          start_time: '2026-05-01T14:00:00Z',
          end_time: '2026-05-01T14:30:00Z',
          status: 'accepted',
          attendee_emails: ['jane@example.com'],
        },
      ]);

      renderPage();
      await screen.findByText('Cal.com');
      await user.click(screen.getByText('Bookings'));

      expect(await screen.findByText('Interview: J. Doe')).toBeInTheDocument();
      expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    });

    it('shows an empty state when there are no Cal.com bookings', async () => {
      const user = userEvent.setup();
      const calcomConnected = { ...calcomAvailable, status: 'connected' as const, enabled: true };
      mockGetIntegrations.mockResolvedValue([calcomConnected]);
      mockGetCalcomBookings.mockResolvedValue([]);

      renderPage();
      await screen.findByText('Cal.com');
      await user.click(screen.getByText('Bookings'));

      expect(await screen.findByText('No upcoming bookings')).toBeInTheDocument();
    });
  });

  describe('NFC ID Cards (activation, not connection)', () => {
    const nfcAvailable = {
      id: 'nfc-1',
      organization_id: 'org-1',
      integration_type: 'nfc-id-cards',
      name: 'NFC ID Cards',
      description: 'Issue member ID cards carrying an NFC tag',
      category: 'Access Control',
      status: 'available' as const,
      config: {},
      enabled: false,
      contains_phi: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const nfcActive = { ...nfcAvailable, status: 'connected' as const, enabled: true };

    it('offers Activate rather than Connect on an inactive card', async () => {
      mockGetIntegrations.mockResolvedValue([nfcAvailable]);

      renderPage();
      await screen.findByText('NFC ID Cards');
      const card = screen.getByTestId('integration-card-nfc-id-cards');

      expect(within(card).getByText('Activate')).toBeInTheDocument();
      expect(within(card).queryByText('Connect')).not.toBeInTheDocument();
    });

    it('titles the dialog Activate and labels its submit button to match', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([nfcAvailable]);
      mockConnectIntegration.mockResolvedValue(nfcActive);

      renderPage();
      await screen.findByText('NFC ID Cards');
      await user.click(within(screen.getByTestId('integration-card-nfc-id-cards')).getByText('Activate'));

      // Announced as a dialog, named by its heading: it had neither, so a
      // screen reader read the page behind as live (workflow review W14).
      expect(screen.getByRole('dialog', { name: 'Activate NFC ID Cards' })).toBeInTheDocument();
      expect(screen.getByTestId('connect-submit')).toHaveTextContent('Activate');

      await user.click(screen.getByTestId('connect-submit'));
      expect(mockConnectIntegration).toHaveBeenCalledWith('nfc-1', {});
    });

    it('reads Active and Deactivate once it is on, with no Test button', async () => {
      mockGetIntegrations.mockResolvedValue([nfcActive]);

      renderPage();
      await screen.findByText('NFC ID Cards');
      const card = screen.getByTestId('integration-card-nfc-id-cards');

      expect(within(card).getByText('Active')).toBeInTheDocument();
      expect(within(card).getByText('Deactivate')).toBeInTheDocument();
      // The backend has no connection test for a feature switch — offering one
      // only ever produced an error toast.
      expect(within(card).queryByText('Test')).not.toBeInTheDocument();
      expect(within(card).queryByText('Connected')).not.toBeInTheDocument();
    });
  });

  describe('Calendar cards', () => {
    const calendarRow = (
      integration_type: string,
      name: string,
      status: 'available' | 'connected' | 'coming_soon'
    ) => ({
      id: `${integration_type}-1`,
      organization_id: 'org-1',
      integration_type,
      name,
      description: `${name} description`,
      category: 'Calendar',
      status,
      config: {},
      enabled: status === 'connected',
      contains_phi: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    const firstPath = '/api/public/v1/calendar/org/first-token.ics';
    const secondPath = '/api/public/v1/calendar/org/second-token.ics';

    beforeEach(() => {
      mockGetIcalFeed.mockReset();
      mockGetIcalFeed.mockResolvedValue({ token: 'first-token', feed_path: firstPath });
      mockRotateIcalFeed.mockReset();
      mockRotateIcalFeed.mockResolvedValue({ token: 'second-token', feed_path: secondPath });
    });

    it('describes Google and Outlook as one-way publishing, not two-way or contact sync', async () => {
      mockGetIntegrations.mockResolvedValue([
        calendarRow('google-calendar', 'Google Calendar', 'coming_soon'),
        calendarRow('outlook', 'Microsoft Outlook', 'coming_soon'),
      ]);

      renderPage();
      await screen.findByText('Google Calendar');
      for (const type of ['google-calendar', 'outlook']) {
        const card = screen.getByTestId(`integration-card-${type}`);
        expect(within(card).getByText('One-way publishing')).toBeInTheDocument();
        expect(within(card).getByText('Coming Soon')).toBeInTheDocument();
        expect(within(card).queryByText('Connect')).not.toBeInTheDocument();
        expect(within(card).queryByText(/two-way/i)).not.toBeInTheDocument();
        expect(within(card).queryByText(/contact sync/i)).not.toBeInTheDocument();
        expect(within(card).queryByText(/email notifications/i)).not.toBeInTheDocument();
      }
    });

    it('shows the department feed URL with a copy button on a connected iCalendar card', async () => {
      mockGetIntegrations.mockResolvedValue([calendarRow('ical', 'iCalendar (ICS)', 'connected')]);

      renderPage();
      const card = await screen.findByTestId('integration-card-ical');
      const input = await within(card).findByLabelText('Department events feed URL');
      expect(input).toHaveValue(`${window.location.origin}${firstPath}`);
      expect(within(card).getByRole('button', { name: 'Copy feed link' })).toBeInTheDocument();
      expect(within(card).getByText('Department events feed')).toBeInTheDocument();
      expect(mockGetIcalFeed).toHaveBeenCalledWith('ical-1');
    });

    it('resets the feed link only after confirmation', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([calendarRow('ical', 'iCalendar (ICS)', 'connected')]);

      renderPage();
      const card = await screen.findByTestId('integration-card-ical');
      await within(card).findByLabelText('Department events feed URL');

      await user.click(within(card).getByRole('button', { name: 'Reset link' }));
      await user.click(await screen.findByRole('button', { name: 'Keep current link' }));
      expect(mockRotateIcalFeed).not.toHaveBeenCalled();

      await user.click(within(card).getByRole('button', { name: 'Reset link' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Reset link' }));

      await waitFor(() => {
        expect(within(card).getByLabelText('Department events feed URL')).toHaveValue(
          `${window.location.origin}${secondPath}`
        );
      });
      expect(mockRotateIcalFeed).toHaveBeenCalledWith('ical-1');
    });

    describe('Disconnecting the iCalendar feed', () => {
      beforeEach(() => {
        mockDisconnectIntegration.mockReset();
        mockDisconnectIntegration.mockResolvedValue(undefined);
      });

      it('warns that subscribers lose the link for good, not that settings are kept', async () => {
        const user = userEvent.setup();
        mockGetIntegrations.mockResolvedValue([calendarRow('ical', 'iCalendar (ICS)', 'connected')]);

        renderPage();
        const card = await screen.findByTestId('integration-card-ical');
        await user.click(within(card).getByRole('button', { name: 'Disconnect iCalendar (ICS)' }));

        const dialog = await screen.findByRole('dialog', { name: 'Disconnect iCalendar (ICS)?' });
        expect(dialog).toHaveTextContent('every calendar subscribed to it stops updating');
        expect(dialog).toHaveTextContent('Reconnecting does not bring the link back: it issues a new one');
        expect(dialog).not.toHaveTextContent('saved settings are kept');

        await user.click(within(dialog).getByRole('button', { name: 'Keep it connected' }));
        expect(mockDisconnectIntegration).not.toHaveBeenCalled();
      });

      it('keeps the generic wording for other integrations', async () => {
        const user = userEvent.setup();
        mockGetIntegrations.mockResolvedValue(mockIntegrations);

        renderPage();
        await screen.findByText('Slack');
        await user.click(screen.getByRole('button', { name: 'Disconnect Generic ePCR Import' }));

        const dialog = await screen.findByRole('dialog', { name: 'Disconnect Generic ePCR Import?' });
        expect(dialog).toHaveTextContent(
          'Generic ePCR Import stops working for the department until it is connected again. Its saved settings are kept.'
        );
        expect(dialog).not.toHaveTextContent('feed link');
      });
    });

    it('does not fetch the feed link while the iCalendar card is not connected', async () => {
      mockGetIntegrations.mockResolvedValue([calendarRow('ical', 'iCalendar (ICS)', 'available')]);

      renderPage();
      const card = await screen.findByTestId('integration-card-ical');
      expect(within(card).queryByLabelText('Department events feed URL')).not.toBeInTheDocument();
      expect(mockGetIcalFeed).not.toHaveBeenCalled();
    });
  });

  describe('Google Calendar connect', () => {
    const gcal = (overrides: Record<string, unknown> = {}) => ({
      id: 'gcal-1',
      organization_id: 'org-1',
      integration_type: 'google-calendar',
      name: 'Google Calendar',
      description: 'Publish department events one way',
      category: 'Calendar',
      status: 'available' as const,
      config: {},
      enabled: false,
      contains_phi: false,
      last_sync_at: null,
      last_error: null,
      last_error_at: null,
      consecutive_error_count: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    });
    const connected = gcal({
      status: 'connected' as const,
      enabled: true,
      config: {
        account_email: 'calendar@dept.org',
        calendar_name: 'Falls Station Events',
        calendar_id: 'cal-1',
        sync_descriptions: false,
      },
      last_sync_at: '2026-10-15T14:00:00Z',
    });

    beforeEach(() => {
      mockStartGoogleCalendarConnect.mockReset();
      mockStartGoogleCalendarConnect.mockResolvedValue('https://accounts.google.com/o/oauth2/v2/auth?state=s');
      mockUpdateIntegration.mockReset();
      mockDisconnectIntegration.mockReset();
      mockDisconnectIntegration.mockResolvedValue(undefined);
    });

    it('offers Connect with Google instead of the connect form, and hands off to Google', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([gcal()]);
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: { ...originalLocation, href: '' },
      });
      try {
        renderPage();
        const card = await screen.findByTestId('integration-card-google-calendar');
        expect(within(card).queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
        await user.click(within(card).getByRole('button', { name: /Connect with Google/ }));
        await waitFor(() => {
          expect(window.location.href).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=s');
        });
        expect(mockStartGoogleCalendarConnect).toHaveBeenCalled();
        expect(mockConnectIntegration).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(window, 'location', {
          configurable: true,
          writable: true,
          value: originalLocation,
        });
      }
    });

    it('shows the account, the calendar and when events were last published', async () => {
      mockGetIntegrations.mockResolvedValue([connected]);
      renderPage();
      const card = await screen.findByTestId('integration-card-google-calendar');
      expect(within(card).getByText('calendar@dept.org')).toBeInTheDocument();
      expect(within(card).getByText('Falls Station Events')).toBeInTheDocument();
      expect(within(card).getByText(/October 15, 2026/)).toBeInTheDocument();
      expect(within(card).getByRole('switch', { name: 'Sync event descriptions' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
      // One Disconnect, from the panel, not a second generic one.
      expect(within(card).getAllByRole('button', { name: 'Disconnect' })).toHaveLength(1);
    });

    it('shows the last error and how many runs in a row failed', async () => {
      mockGetIntegrations.mockResolvedValue([
        {
          ...connected,
          last_error: 'Google Calendar is rate limiting requests',
          last_error_at: '2026-10-15T15:00:00Z',
          consecutive_error_count: 3,
        },
      ]);
      renderPage();
      const card = await screen.findByTestId('integration-card-google-calendar');
      expect(within(card).getByText(/rate limiting requests/)).toBeInTheDocument();
      expect(within(card).getByText(/3 failed runs in a row/)).toBeInTheDocument();
    });

    it('says Reconnect required when the grant stopped working', async () => {
      mockGetIntegrations.mockResolvedValue([
        gcal({
          status: 'error' as const,
          config: { account_email: 'calendar@dept.org', calendar_name: 'Falls Station Events' },
          last_error: 'Reconnect required: the calendar provider no longer accepts the stored authorization.',
          consecutive_error_count: 1,
        }),
      ]);
      renderPage();
      const card = await screen.findByTestId('integration-card-google-calendar');
      expect(within(card).getByRole('alert')).toHaveTextContent('Reconnect required');
      expect(within(card).getByRole('button', { name: /Reconnect with Google/ })).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    });

    it('turns description publishing on through a settings update', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([connected]);
      mockUpdateIntegration.mockResolvedValue({
        ...connected,
        config: { ...connected.config, sync_descriptions: true },
      });
      renderPage();
      const card = await screen.findByTestId('integration-card-google-calendar');
      await user.click(within(card).getByRole('switch', { name: 'Sync event descriptions' }));
      await waitFor(() => {
        expect(within(card).getByRole('switch', { name: 'Sync event descriptions' })).toHaveAttribute(
          'aria-checked',
          'true'
        );
      });
      expect(mockUpdateIntegration).toHaveBeenCalledWith('gcal-1', { sync_descriptions: true });
    });

    it('disconnects only after confirmation', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([connected]);
      renderPage();
      const card = await screen.findByTestId('integration-card-google-calendar');

      await user.click(within(card).getByRole('button', { name: 'Disconnect' }));
      await user.click(await screen.findByRole('button', { name: 'Stay connected' }));
      expect(mockDisconnectIntegration).not.toHaveBeenCalled();

      mockGetIntegrations.mockResolvedValue([gcal()]);
      await user.click(within(card).getByRole('button', { name: 'Disconnect' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
      expect(mockDisconnectIntegration).toHaveBeenCalledWith('gcal-1');
      expect(await screen.findByRole('button', { name: /Connect with Google/ })).toBeInTheDocument();
    });

    it('reports the outcome of the return from Google', async () => {
      mockGetIntegrations.mockResolvedValue([connected]);
      const { unmount } = render(
        <MemoryRouter initialEntries={['/integrations?google_calendar=connected']}>
          <ConfirmProvider>
            <IntegrationsPage />
          </ConfirmProvider>
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Google Calendar connected'));
      });
      unmount();

      render(
        <MemoryRouter initialEntries={['/integrations?google_calendar_error=calendar_create_failed']}>
          <ConfirmProvider>
            <IntegrationsPage />
          </ConfirmProvider>
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('could not be created'));
      });
    });
  });

  describe('Outlook connect', () => {
    const outlook = (overrides: Record<string, unknown> = {}) => ({
      id: 'outlook-1',
      organization_id: 'org-1',
      integration_type: 'outlook',
      name: 'Microsoft Outlook',
      description: 'Publish department events one way',
      category: 'Calendar',
      status: 'available' as const,
      config: {},
      enabled: false,
      contains_phi: false,
      last_sync_at: null,
      last_error: null,
      last_error_at: null,
      consecutive_error_count: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    });
    const connected = outlook({
      status: 'connected' as const,
      enabled: true,
      config: {
        account_email: 'calendar@dept.org',
        calendar_name: 'Falls Station Events',
        calendar_id: 'AAMk=',
        sync_descriptions: false,
      },
      last_sync_at: '2026-10-15T14:00:00Z',
    });

    beforeEach(() => {
      mockStartOutlookCalendarConnect.mockReset();
      mockStartOutlookCalendarConnect.mockResolvedValue(
        'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?state=s'
      );
      mockStartGoogleCalendarConnect.mockReset();
      mockUpdateIntegration.mockReset();
      mockDisconnectIntegration.mockReset();
      mockDisconnectIntegration.mockResolvedValue(undefined);
    });

    it('offers Connect with Microsoft instead of the connect form, and hands off to Microsoft', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([outlook()]);
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: { ...originalLocation, href: '' },
      });
      try {
        renderPage();
        const card = await screen.findByTestId('integration-card-outlook');
        expect(within(card).queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
        await user.click(within(card).getByRole('button', { name: /Connect with Microsoft/ }));
        await waitFor(() => {
          expect(window.location.href).toBe(
            'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?state=s'
          );
        });
        expect(mockStartOutlookCalendarConnect).toHaveBeenCalled();
        expect(mockStartGoogleCalendarConnect).not.toHaveBeenCalled();
        expect(mockConnectIntegration).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(window, 'location', {
          configurable: true,
          writable: true,
          value: originalLocation,
        });
      }
    });

    it('shows the account, the calendar, the description switch and one Disconnect', async () => {
      mockGetIntegrations.mockResolvedValue([connected]);
      renderPage();
      const card = await screen.findByTestId('integration-card-outlook');
      expect(within(card).getByText('calendar@dept.org')).toBeInTheDocument();
      expect(within(card).getByText('Falls Station Events')).toBeInTheDocument();
      expect(within(card).getByText(/October 15, 2026/)).toBeInTheDocument();
      expect(within(card).getByRole('switch', { name: 'Sync event descriptions' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
      expect(within(card).getAllByRole('button', { name: 'Disconnect' })).toHaveLength(1);
    });

    it('says Reconnect required and offers Reconnect with Microsoft', async () => {
      mockGetIntegrations.mockResolvedValue([
        outlook({
          status: 'error' as const,
          config: { account_email: 'calendar@dept.org', calendar_name: 'Falls Station Events' },
          last_error: 'Reconnect required: the calendar provider no longer accepts the stored authorization.',
          consecutive_error_count: 1,
        }),
      ]);
      renderPage();
      const card = await screen.findByTestId('integration-card-outlook');
      expect(within(card).getByRole('alert')).toHaveTextContent('Reconnect required');
      expect(within(card).getByRole('button', { name: /Reconnect with Microsoft/ })).toBeInTheDocument();
    });

    it('turns description publishing on through a settings update', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([connected]);
      mockUpdateIntegration.mockResolvedValue({
        ...connected,
        config: { ...connected.config, sync_descriptions: true },
      });
      renderPage();
      const card = await screen.findByTestId('integration-card-outlook');
      await user.click(within(card).getByRole('switch', { name: 'Sync event descriptions' }));
      await waitFor(() => {
        expect(within(card).getByRole('switch', { name: 'Sync event descriptions' })).toHaveAttribute(
          'aria-checked',
          'true'
        );
      });
      expect(mockUpdateIntegration).toHaveBeenCalledWith('outlook-1', { sync_descriptions: true });
    });

    it('disconnects only after a confirmation that says the access is not handed back', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([connected]);
      renderPage();
      const card = await screen.findByTestId('integration-card-outlook');

      await user.click(within(card).getByRole('button', { name: 'Disconnect' }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('Disconnect Microsoft Outlook?');
      expect(dialog).toHaveTextContent('My Apps');
      await user.click(within(dialog).getByRole('button', { name: 'Stay connected' }));
      expect(mockDisconnectIntegration).not.toHaveBeenCalled();

      mockGetIntegrations.mockResolvedValue([outlook()]);
      await user.click(within(card).getByRole('button', { name: 'Disconnect' }));
      const again = await screen.findByRole('dialog');
      await user.click(within(again).getByRole('button', { name: 'Disconnect' }));
      expect(mockDisconnectIntegration).toHaveBeenCalledWith('outlook-1');
      expect(await screen.findByRole('button', { name: /Connect with Microsoft/ })).toBeInTheDocument();
    });

    it('reports the outcome of the return from Microsoft', async () => {
      mockGetIntegrations.mockResolvedValue([connected]);
      const { unmount } = render(
        <MemoryRouter initialEntries={['/integrations?outlook_calendar=connected']}>
          <ConfirmProvider>
            <IntegrationsPage />
          </ConfirmProvider>
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Microsoft Outlook connected'));
      });
      unmount();

      render(
        <MemoryRouter initialEntries={['/integrations?outlook_calendar_error=access_denied']}>
          <ConfirmProvider>
            <IntegrationsPage />
          </ConfirmProvider>
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Microsoft Outlook was not connected. Microsoft sign-in was cancelled.'
        );
      });
    });
  });

  describe('Claude (MCP)', () => {
    const mcpAvailable = {
      id: 'mcp-1',
      organization_id: 'org-1',
      integration_type: 'claude-mcp',
      name: 'Claude (MCP)',
      description: 'Let Claude answer questions about the department',
      category: 'AI Assistants',
      status: 'available' as const,
      config: {},
      enabled: false,
      contains_phi: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const mcpConnected = {
      ...mcpAvailable,
      status: 'connected' as const,
      enabled: true,
      config: {
        access_mode: 'read_write',
        expose_finance: true,
        expose_medical_screening: false,
        expose_full_schedule: false,
        expose_medical_supplies: false,
      },
    };

    beforeEach(() => {
      mockGetMcpStatus.mockReset();
      mockGetMcpStatus.mockResolvedValue({
        enabled: true,
        endpoint_path: '/api/mcp',
        access_mode: 'read_write',
        expose_finance: true,
        expose_medical_screening: false,
        expose_full_schedule: false,
        expose_medical_supplies: false,
        active_key: null,
      });
    });

    it('connects with the defaults: read-only and nothing extra shared', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([mcpAvailable]);
      mockConnectIntegration.mockResolvedValue(mcpConnected);

      renderPage();
      await screen.findByText('Claude (MCP)');
      const card = screen.getByTestId('integration-card-claude-mcp');
      await user.click(within(card).getByText('Connect'));
      expect(screen.getByLabelText('Access')).toHaveValue('read_only');
      await user.click(screen.getByTestId('connect-submit'));

      expect(mockConnectIntegration).toHaveBeenCalledWith('mcp-1', {
        access_mode: 'read_only',
        expose_finance: false,
        expose_medical_screening: false,
        expose_full_schedule: false,
        expose_medical_supplies: false,
        oauth_enabled: false,
      });
    });

    it('sends the chosen access mode and switches', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([mcpAvailable]);
      mockConnectIntegration.mockResolvedValue(mcpConnected);

      renderPage();
      await screen.findByText('Claude (MCP)');
      await user.click(within(screen.getByTestId('integration-card-claude-mcp')).getByText('Connect'));
      await user.selectOptions(screen.getByLabelText('Access'), 'read_write');
      await user.click(screen.getByLabelText(/Share finance totals/));
      await user.click(screen.getByTestId('connect-submit'));

      expect(mockConnectIntegration).toHaveBeenCalledWith('mcp-1', {
        access_mode: 'read_write',
        expose_finance: true,
        expose_medical_screening: false,
        expose_full_schedule: false,
        expose_medical_supplies: false,
        oauth_enabled: false,
      });
    });

    it('sends the member sign-in switch when it is turned on', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([mcpAvailable]);
      mockConnectIntegration.mockResolvedValue(mcpConnected);

      renderPage();
      await screen.findByText('Claude (MCP)');
      await user.click(within(screen.getByTestId('integration-card-claude-mcp')).getByText('Connect'));
      await user.click(screen.getByLabelText(/Let members connect with their own account/));
      await user.click(screen.getByTestId('connect-submit'));

      expect(mockConnectIntegration).toHaveBeenCalledWith('mcp-1', {
        access_mode: 'read_only',
        expose_finance: false,
        expose_medical_screening: false,
        expose_full_schedule: false,
        expose_medical_supplies: false,
        oauth_enabled: true,
      });
    });

    it('sends the medical supply switch when it is turned on', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([mcpAvailable]);
      mockConnectIntegration.mockResolvedValue(mcpConnected);

      renderPage();
      await screen.findByText('Claude (MCP)');
      await user.click(within(screen.getByTestId('integration-card-claude-mcp')).getByText('Connect'));
      expect(screen.getByLabelText(/Share medical supply inventory/)).not.toBeChecked();
      await user.click(screen.getByLabelText(/Share medical supply inventory/));
      await user.click(screen.getByTestId('connect-submit'));

      expect(mockConnectIntegration).toHaveBeenCalledWith('mcp-1', {
        access_mode: 'read_only',
        expose_finance: false,
        expose_medical_screening: false,
        expose_full_schedule: false,
        expose_medical_supplies: true,
        oauth_enabled: false,
      });
    });

    it('shows the stored medical supply switch in the settings form', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([
        { ...mcpConnected, config: { ...mcpConnected.config, expose_medical_supplies: true } },
      ]);

      renderPage();
      await screen.findByText('Claude (MCP)');
      await user.click(screen.getByRole('button', { name: 'Claude (MCP) settings' }));
      expect(screen.getByLabelText(/Share medical supply inventory/)).toBeChecked();
    });

    it('shows the service key button to a delegated key manager without integrations.manage', async () => {
      mockCheckPermission.mockImplementation((perm: string) => perm === 'integrations.mcp_keys');

      renderPage();
      const card = await screen.findByTestId('integration-card-claude-mcp-delegated');
      expect(mockGetIntegrations).not.toHaveBeenCalled();
      expect(within(card).getByText('Service key')).toBeInTheDocument();
      expect(within(card).queryByText('Disconnect')).not.toBeInTheDocument();
    });

    it('reaches the service key panel when the integrations list is forbidden', async () => {
      const user = userEvent.setup();
      mockCheckPermission.mockImplementation((perm: string) => perm === 'integrations.mcp_keys');
      mockGetIntegrations.mockRejectedValue(new Error('403'));

      renderPage();
      const card = await screen.findByTestId('integration-card-claude-mcp-delegated');
      expect(mockGetIntegrations).not.toHaveBeenCalled();
      expect(screen.queryByText('No integrations match your search')).not.toBeInTheDocument();
      await user.click(within(card).getByText('Service key'));
      expect(await screen.findByTestId('mcp-key-panel')).toBeInTheDocument();
    });

    it('offers a retry when the delegated status request fails', async () => {
      const user = userEvent.setup();
      mockCheckPermission.mockImplementation((perm: string) => perm === 'integrations.mcp_keys');
      mockGetMcpStatus.mockRejectedValueOnce(new Error('offline'));

      renderPage();
      const alert = await screen.findByTestId('mcp-delegated-error');
      expect(mockGetIntegrations).not.toHaveBeenCalled();
      expect(screen.queryByText('No integrations match your search')).not.toBeInTheDocument();
      expect(screen.queryByTestId('integration-card-claude-mcp-delegated')).not.toBeInTheDocument();

      await user.click(within(alert).getByText('Try again'));
      expect(await screen.findByTestId('integration-card-claude-mcp-delegated')).toBeInTheDocument();
      expect(screen.queryByTestId('mcp-delegated-error')).not.toBeInTheDocument();
      expect(mockGetMcpStatus).toHaveBeenCalledTimes(2);
    });

    it('shows no delegated card when the integration is not connected', async () => {
      mockCheckPermission.mockImplementation((perm: string) => perm === 'integrations.mcp_keys');
      mockGetIntegrations.mockRejectedValue(new Error('403'));
      mockGetMcpStatus.mockResolvedValue({
        enabled: false,
        endpoint_path: '/api/mcp',
        access_mode: 'read_only',
        expose_finance: false,
        expose_medical_screening: false,
        expose_full_schedule: false,
        expose_medical_supplies: false,
        active_key: null,
      });

      renderPage();
      await screen.findByText('No integrations match your search');
      expect(screen.queryByTestId('integration-card-claude-mcp-delegated')).not.toBeInTheDocument();
    });

    it('holds the Service key toggle while the panel is issuing a key', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([mcpConnected]);
      let finish: (value: unknown) => void = () => undefined;
      mockCreateMcpKey.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        })
      );

      renderPage();
      await screen.findByText('Claude (MCP)');
      const card = screen.getByTestId('integration-card-claude-mcp');
      const toggle = within(card).getByRole('button', { name: /Service key/ });
      await user.click(toggle);
      await screen.findByTestId('mcp-issue-key');
      await user.click(screen.getByTestId('mcp-issue-key'));

      // Closing the panel now would unmount the only place the one-time
      // plaintext can be rendered; so would disconnecting the integration.
      expect(toggle).toBeDisabled();
      await user.click(toggle);
      expect(screen.getByTestId('mcp-key-panel')).toBeInTheDocument();
      const disconnect = within(card).getByRole('button', { name: /Disconnect/ });
      expect(disconnect).toBeDisabled();
      await user.click(disconnect);
      expect(mockDisconnectIntegration).not.toHaveBeenCalled();

      finish({
        key: {
          id: 'key-1',
          name: 'Claude',
          key_prefix: 'logbook_mcp_abcdefgh',
          expires_at: null,
          last_used_at: null,
          revoked_at: null,
          created_at: '2026-09-03T10:00:00Z',
          created_by: 'admin-1',
          is_active: true,
        },
        plaintext: 'logbook_mcp_abcdefgh_secret',
        revoked: [],
        endpoint_path: '/api/mcp',
      });
      await screen.findByTestId('mcp-issued-key');
      // The panel reloads its status after issuing; the hold lifts when that
      // request settles, not when the plaintext appears.
      await waitFor(() => expect(toggle).toBeEnabled());
      expect(within(card).getByRole('button', { name: /Disconnect/ })).toBeEnabled();
    });

    it('edits a connected integration in place, without reconnecting', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([mcpConnected]);
      mockUpdateIntegration.mockResolvedValue({
        ...mcpConnected,
        config: { ...mcpConnected.config, oauth_enabled: true },
      });

      renderPage();
      await screen.findByText('Claude (MCP)');
      const card = screen.getByTestId('integration-card-claude-mcp');
      await user.click(within(card).getByRole('button', { name: 'Claude (MCP) settings' }));

      // Seeded from what is stored, not the connect defaults.
      expect(screen.getByRole('heading', { name: 'Claude (MCP) settings' })).toBeInTheDocument();
      expect(screen.getByLabelText('Access')).toHaveValue('read_write');
      expect(screen.getByLabelText(/Share finance totals/)).toBeChecked();
      expect(screen.getByLabelText(/Let members connect with their own account/)).not.toBeChecked();

      await user.click(screen.getByLabelText(/Let members connect with their own account/));
      await user.click(screen.getByTestId('settings-submit'));

      expect(mockUpdateIntegration).toHaveBeenCalledWith('mcp-1', {
        access_mode: 'read_write',
        expose_finance: true,
        expose_medical_screening: false,
        expose_full_schedule: false,
        expose_medical_supplies: false,
        oauth_enabled: true,
      });
      expect(mockConnectIntegration).not.toHaveBeenCalled();
      expect(mockDisconnectIntegration).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Claude (MCP) settings' })).not.toBeInTheDocument()
      );
    });

    it('keeps the form open when saving the settings fails', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([mcpConnected]);
      mockUpdateIntegration.mockRejectedValue(new Error('audit unavailable'));

      renderPage();
      await screen.findByText('Claude (MCP)');
      await user.click(
        within(screen.getByTestId('integration-card-claude-mcp')).getByRole('button', {
          name: 'Claude (MCP) settings',
        })
      );
      await user.click(screen.getByTestId('settings-submit'));

      await waitFor(() => expect(mockUpdateIntegration).toHaveBeenCalled());
      expect(screen.getByRole('heading', { name: 'Claude (MCP) settings' })).toBeInTheDocument();
      expect(screen.getByTestId('settings-submit')).toBeEnabled();
    });

    it('offers no settings button on an integration that is not connected', async () => {
      mockGetIntegrations.mockResolvedValue([mcpAvailable]);

      renderPage();
      await screen.findByText('Claude (MCP)');
      const card = screen.getByTestId('integration-card-claude-mcp');
      expect(within(card).queryByRole('button', { name: 'Claude (MCP) settings' })).not.toBeInTheDocument();
    });

    it('returns to the connect form after the settings form is closed', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([mcpConnected, { ...mcpAvailable, id: 'mcp-2', name: 'Claude (MCP) 2' }]);

      renderPage();
      await screen.findByText('Claude (MCP)');
      await user.click(screen.getByRole('button', { name: 'Claude (MCP) settings' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      // Named after its integration since W73.
      await user.click(screen.getByRole('button', { name: 'Connect Claude (MCP) 2' }));

      expect(screen.getByRole('heading', { name: 'Connect Claude (MCP) 2' })).toBeInTheDocument();
      expect(screen.getByTestId('connect-submit')).toBeInTheDocument();
    });

    it('opens the service key panel from a connected card', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([mcpConnected]);

      renderPage();
      await screen.findByText('Claude (MCP)');
      const card = screen.getByTestId('integration-card-claude-mcp');
      await user.click(within(card).getByText('Service key'));
      expect(await screen.findByTestId('mcp-key-panel')).toBeInTheDocument();
      expect(mockGetMcpStatus).toHaveBeenCalled();
      const filters = screen.getByRole('group', { name: 'Filter by category' });
      expect(within(filters).getByText('AI Assistants')).toBeInTheDocument();
    });
  });

  describe('Microsoft 365', () => {
    const tenant = '11111111-2222-3333-4444-555555555555';
    const client = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const microsoftAvailable = {
      id: 'ms-1',
      organization_id: 'org-1',
      integration_type: 'microsoft-365',
      name: 'Microsoft 365',
      description: 'Create a Microsoft 365 account for each new member',
      category: 'Access Control',
      status: 'available' as const,
      config: {},
      enabled: false,
      contains_phi: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const microsoftConnected = {
      ...microsoftAvailable,
      status: 'connected' as const,
      enabled: true,
      config: {
        tenant_id: tenant,
        client_id: client,
        domain: 'firedept.org',
        usage_location: 'CA',
        license_sku_id: '',
        groups: ['members@firedept.org'],
      },
    };

    beforeEach(() => {
      mockCheckPermission.mockReset();
      mockCheckPermission.mockReturnValue(true);
      mockGetIntegrations.mockReset();
      mockGetIntegrations.mockResolvedValue([microsoftAvailable]);
      mockConnectIntegration.mockReset();
      mockConnectIntegration.mockResolvedValue(microsoftConnected);
      mockUpdateIntegration.mockReset();
      mockUpdateIntegration.mockResolvedValue(microsoftConnected);
    });

    it('connects with the app registration, usage location, license and groups', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Microsoft 365');
      const card = screen.getByTestId('integration-card-microsoft-365');
      await user.click(within(card).getByText('Connect'));

      expect(screen.getByLabelText('Usage location')).toHaveValue('US');
      await user.type(screen.getByLabelText('Directory (tenant) ID'), tenant);
      await user.type(screen.getByLabelText('Application (client) ID'), client);
      await user.type(screen.getByLabelText('Client secret value'), ' s3cret ');
      await user.type(screen.getByLabelText('Domain'), 'firedept.org');
      await user.type(screen.getByLabelText('License SKU ID (optional)'), 'c42b9cae-ea4f-4ab7-9717-81576235ccac');
      await user.type(
        screen.getByLabelText('Add new members to these groups (optional)'),
        'members@firedept.org{enter}99999999-8888-7777-6666-555555555555'
      );
      await user.click(screen.getByTestId('connect-submit'));

      expect(mockConnectIntegration).toHaveBeenCalledWith('ms-1', {
        tenant_id: tenant,
        client_id: client,
        client_secret: 's3cret',
        domain: 'firedept.org',
        usage_location: 'US',
        license_sku_id: 'c42b9cae-ea4f-4ab7-9717-81576235ccac',
        client_secret_expires_on: '',
        groups: ['members@firedept.org', '99999999-8888-7777-6666-555555555555'],
        suspend_on_retirement: false,
      });
    });

    it('keeps the stored secret when settings are saved without a new one', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([microsoftConnected]);
      renderPage();
      await screen.findByText('Microsoft 365');
      await user.click(screen.getByRole('button', { name: 'Microsoft 365 settings' }));

      expect(screen.getByLabelText('Usage location')).toHaveValue('CA');
      await user.click(screen.getByTestId('settings-submit'));

      expect(mockUpdateIntegration).toHaveBeenCalledWith('ms-1', {
        tenant_id: tenant,
        client_id: client,
        client_secret: undefined,
        domain: 'firedept.org',
        usage_location: 'CA',
        license_sku_id: '',
        client_secret_expires_on: '',
        groups: ['members@firedept.org'],
        suspend_on_retirement: false,
      });
    });

    it('records the client secret expiry date and sends a cleared one as blank', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([
        { ...microsoftConnected, config: { ...microsoftConnected.config, client_secret_expires_on: '2027-06-30' } },
      ]);
      renderPage();
      await screen.findByText('Microsoft 365');
      await user.click(screen.getByRole('button', { name: 'Microsoft 365 settings' }));

      const field = screen.getByLabelText('Client secret expires on (optional)');
      expect(field).toHaveValue('2027-06-30');
      await user.clear(field);
      await user.click(screen.getByTestId('settings-submit'));

      expect(mockUpdateIntegration).toHaveBeenCalledWith(
        'ms-1',
        expect.objectContaining({ client_secret_expires_on: '' })
      );
    });

    it('shows a stored retirement choice as ticked', async () => {
      mockGetIntegrations.mockResolvedValue([
        { ...microsoftConnected, config: { ...microsoftConnected.config, suspend_on_retirement: true } },
      ]);
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Microsoft 365');
      await user.click(screen.getByRole('button', { name: 'Microsoft 365 settings' }));

      expect(screen.getByRole('checkbox', { name: /Block sign-in when a member retires/ })).toBeChecked();
    });

    it('warns on the card when the client secret is about to expire', async () => {
      mockGetIntegrations.mockResolvedValue([
        { ...microsoftConnected, credential_days_left: 5, credential_expiring: true },
      ]);
      renderPage();
      await screen.findByText('Microsoft 365');
      const card = screen.getByTestId('integration-card-microsoft-365');

      expect(within(card).getByText('Client secret expires in 5 days')).toBeInTheDocument();
    });

    it('says so on the card once the client secret has expired', async () => {
      mockGetIntegrations.mockResolvedValue([
        { ...microsoftConnected, credential_days_left: -2, credential_expiring: true },
      ]);
      renderPage();
      await screen.findByText('Microsoft 365');
      const card = screen.getByTestId('integration-card-microsoft-365');

      expect(within(card).getByText('Client secret expired')).toBeInTheDocument();
    });

    it('says nothing about the secret while it is not close to expiring', async () => {
      mockGetIntegrations.mockResolvedValue([
        { ...microsoftConnected, credential_days_left: 90, credential_expiring: false },
      ]);
      renderPage();
      await screen.findByText('Microsoft 365');
      const card = screen.getByTestId('integration-card-microsoft-365');

      expect(within(card).queryByText(/Client secret expire/)).not.toBeInTheDocument();
    });

    it('leaves connecting to an organization administrator', async () => {
      mockCheckPermission.mockImplementation((permission: string) => permission !== 'admin.access');
      renderPage();
      await screen.findByText('Microsoft 365');
      const card = screen.getByTestId('integration-card-microsoft-365');

      expect(within(card).queryByText('Connect')).not.toBeInTheDocument();
      expect(within(card).getByText('An organization administrator connects this')).toBeInTheDocument();
    });

    it('offers linking existing members once connected', async () => {
      mockGetIntegrations.mockResolvedValue([microsoftConnected]);
      renderPage();
      await screen.findByText('Microsoft 365');
      const card = screen.getByTestId('integration-card-microsoft-365');

      expect(within(card).getByText('Link existing members')).toBeInTheDocument();
    });
  });

  describe('Google Workspace', () => {
    const workspaceAvailable = {
      id: 'gws-1',
      organization_id: 'org-1',
      integration_type: 'google-workspace',
      name: 'Google Workspace',
      description: 'Create a Google Workspace account for each new member',
      category: 'Access Control',
      status: 'available' as const,
      config: {},
      enabled: false,
      contains_phi: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const workspaceConnected = {
      ...workspaceAvailable,
      status: 'connected' as const,
      enabled: true,
      config: {
        admin_email: 'admin@firedept.org',
        domain: 'firedept.org',
        org_unit_path: '/Members',
        group_emails: ['members@firedept.org'],
      },
    };

    beforeEach(() => {
      mockCheckPermission.mockReset();
      mockCheckPermission.mockReturnValue(true);
      mockGetIntegrations.mockReset();
      mockGetIntegrations.mockResolvedValue([workspaceAvailable]);
      mockConnectIntegration.mockReset();
      mockConnectIntegration.mockResolvedValue(workspaceConnected);
      mockUpdateIntegration.mockReset();
      mockUpdateIntegration.mockResolvedValue(workspaceConnected);
    });

    it('connects with the uploaded key, domain, org unit and groups', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Google Workspace');
      const card = screen.getByTestId('integration-card-google-workspace');
      await user.click(within(card).getByText('Connect'));

      const key = new File(['{"type":"service_account"}'], 'key.json', { type: 'application/json' });
      await user.upload(screen.getByLabelText('Service account key (JSON)'), key);
      await screen.findByText(/Loaded key\.json/);
      await user.type(screen.getByLabelText('Admin to act as'), 'admin@firedept.org');
      await user.type(screen.getByLabelText('Domain'), 'firedept.org');
      await user.clear(screen.getByLabelText('Organizational unit'));
      await user.type(screen.getByLabelText('Organizational unit'), '/Members');
      await user.type(
        screen.getByLabelText('Add new members to these groups (optional)'),
        'members@firedept.org{enter}all@firedept.org'
      );
      await user.click(screen.getByTestId('connect-submit'));

      expect(mockConnectIntegration).toHaveBeenCalledWith('gws-1', {
        service_account_key: '{"type":"service_account"}',
        admin_email: 'admin@firedept.org',
        domain: 'firedept.org',
        org_unit_path: '/Members',
        group_emails: ['members@firedept.org', 'all@firedept.org'],
        suspend_on_retirement: false,
      });
    });

    it('keeps the stored key when settings are saved without a new file', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([workspaceConnected]);
      renderPage();
      await screen.findByText('Google Workspace');
      await user.click(screen.getByRole('button', { name: 'Google Workspace settings' }));

      expect(screen.getByLabelText('Domain')).toHaveValue('firedept.org');
      await user.click(screen.getByTestId('settings-submit'));

      expect(mockUpdateIntegration).toHaveBeenCalledWith('gws-1', {
        service_account_key: undefined,
        admin_email: 'admin@firedept.org',
        domain: 'firedept.org',
        org_unit_path: '/Members',
        group_emails: ['members@firedept.org'],
        suspend_on_retirement: false,
      });
    });

    it('turns on suspending the account when a member retires', async () => {
      const user = userEvent.setup();
      mockGetIntegrations.mockResolvedValue([workspaceConnected]);
      renderPage();
      await screen.findByText('Google Workspace');
      await user.click(screen.getByRole('button', { name: 'Google Workspace settings' }));

      const box = screen.getByRole('checkbox', { name: /Suspend the account when a member retires/ });
      expect(box).not.toBeChecked();
      await user.click(box);
      await user.click(screen.getByTestId('settings-submit'));

      expect(mockUpdateIntegration).toHaveBeenCalledWith(
        'gws-1',
        expect.objectContaining({ suspend_on_retirement: true })
      );
    });

    it('leaves connecting to an organization administrator', async () => {
      mockCheckPermission.mockImplementation((permission: string) => permission !== 'admin.access');
      renderPage();
      await screen.findByText('Google Workspace');
      const card = screen.getByTestId('integration-card-google-workspace');

      expect(within(card).queryByText('Connect')).not.toBeInTheDocument();
      expect(within(card).getByText('An organization administrator connects this')).toBeInTheDocument();
    });

    it('offers a non-administrator no way to change or disconnect it', async () => {
      mockCheckPermission.mockImplementation((permission: string) => permission !== 'admin.access');
      mockGetIntegrations.mockResolvedValue([workspaceConnected]);
      renderPage();
      await screen.findByText('Google Workspace');
      const card = screen.getByTestId('integration-card-google-workspace');

      expect(within(card).queryByText('Disconnect')).not.toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: 'Google Workspace settings' })).not.toBeInTheDocument();
      expect(within(card).getByText('Test')).toBeInTheDocument();
      expect(within(card).queryByText('Link existing members')).not.toBeInTheDocument();
    });

    describe('Accounts needing attention', () => {
      const items = [
        {
          user_id: 'u-gone',
          member_name: 'Gone Member',
          primary_email: 'gone@firedept.org',
          issue: 'not_suspended',
          label: 'Left, but the account is not suspended',
          detail: 'Google Workspace is busy or unavailable.',
          since: '2026-10-14T08:00:00Z',
          overdue: true,
        },
        {
          user_id: 'u-new',
          member_name: 'New Member',
          primary_email: 'new@firedept.org',
          issue: 'setup_unfinished',
          label: 'Account setup unfinished',
          detail: null,
          since: null,
          overdue: false,
        },
      ];

      beforeEach(() => {
        vi.mocked(toast.error).mockClear();
        mockGetGoogleWorkspaceAttention.mockReset();
        mockGetGoogleWorkspaceAttention.mockResolvedValue(items);
      });

      it('lists each account with its reason and a link to the member', async () => {
        const user = userEvent.setup();
        mockGetIntegrations.mockResolvedValue([workspaceConnected]);
        renderPage();
        const card = await screen.findByTestId('integration-card-google-workspace');
        await user.click(await within(card).findByRole('button', { name: '2 need attention' }));

        const list = screen.getByRole('list', { name: 'Google Workspace accounts needing attention' });
        const [gone, fresh] = within(list).getAllByRole('listitem');
        expect(within(list).getByRole('link', { name: 'Gone Member' })).toHaveAttribute('href', '/members/u-gone');
        expect(gone).toHaveTextContent('Left, but the account is not suspended');
        expect(gone).toHaveTextContent('Google Workspace is busy or unavailable.');
        expect(gone).toHaveTextContent('Over a day');
        expect(fresh).toHaveTextContent('Account setup unfinished');
        expect(fresh).not.toHaveTextContent('Over a day');
      });

      it('shows nothing when every account is in order', async () => {
        mockGetGoogleWorkspaceAttention.mockResolvedValue([]);
        mockGetIntegrations.mockResolvedValue([workspaceConnected]);
        renderPage();
        await screen.findByText('Google Workspace');
        await waitFor(() => expect(mockGetGoogleWorkspaceAttention).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('button', { name: /need attention/ })).not.toBeInTheDocument();
      });

      it('does not ask before the integration is connected', async () => {
        renderPage();
        await screen.findByText('Google Workspace');
        expect(mockGetGoogleWorkspaceAttention).not.toHaveBeenCalled();
      });

      it('reports a list that could not be loaded', async () => {
        mockGetGoogleWorkspaceAttention.mockRejectedValue(new Error('boom'));
        mockGetIntegrations.mockResolvedValue([workspaceConnected]);
        renderPage();
        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith('Could not load Google Workspace accounts needing attention')
        );
      });
    });

    describe('Link existing members', () => {
      const counts = {
        already_linked: 2,
        unfinished: 1,
        departed: 1,
        not_in_google: 3,
        off_domain: 0,
        account_in_use: 1,
      };

      beforeEach(() => {
        mockGetIntegrations.mockResolvedValue([workspaceConnected]);
        vi.mocked(toast.success).mockClear();
        vi.mocked(toast.error).mockClear();
        mockLinkExistingGoogleMembers.mockReset();
        mockLinkExistingGoogleMembers.mockImplementation((expected?: number) =>
          Promise.resolve({ applied: expected !== undefined, linked: 4, ...counts })
        );
      });

      it('previews, confirms, then links', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByText('Google Workspace');
        const card = screen.getByTestId('integration-card-google-workspace');
        await user.click(within(card).getByText('Link existing members'));

        expect(await screen.findByText('Link 4 existing members to Google?')).toBeInTheDocument();
        expect(
          screen.getByText(
            /Skipped: 2 already linked, 1 whose account setup is unfinished \(retry from their profile\), 3 with no account at their address, 1 who have already left, 1 whose account is still recorded for another member\./
          )
        ).toBeInTheDocument();
        expect(mockLinkExistingGoogleMembers).toHaveBeenCalledTimes(1);
        expect(mockLinkExistingGoogleMembers).toHaveBeenCalledWith();

        await user.click(screen.getByRole('button', { name: 'Link accounts' }));

        await waitFor(() => expect(mockLinkExistingGoogleMembers).toHaveBeenCalledWith(4));
        expect(toast.success).toHaveBeenCalledWith('Linked 4 members to Google Workspace');
      });

      it('links nothing when the officer declines', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByText('Google Workspace');
        await user.click(screen.getByText('Link existing members'));
        await user.click(await screen.findByRole('button', { name: 'Not now' }));

        expect(mockLinkExistingGoogleMembers).toHaveBeenCalledTimes(1);
        expect(mockLinkExistingGoogleMembers).toHaveBeenCalledWith();
      });

      it('asks nothing when there is no one to link', async () => {
        const user = userEvent.setup();
        mockLinkExistingGoogleMembers.mockResolvedValue({ applied: false, linked: 0, ...counts });
        renderPage();
        await screen.findByText('Google Workspace');
        await user.click(screen.getByText('Link existing members'));

        await waitFor(() =>
          expect(toast.success).toHaveBeenCalledWith(
            'No members to link. Skipped: 2 already linked, 1 whose account setup is unfinished (retry from their profile), 3 with no account at their address, 1 who have already left, 1 whose account is still recorded for another member.'
          )
        );
        expect(screen.queryByRole('button', { name: 'Link accounts' })).not.toBeInTheDocument();
        expect(mockLinkExistingGoogleMembers).toHaveBeenCalledTimes(1);
      });

      it('reports a failure', async () => {
        const user = userEvent.setup();
        mockLinkExistingGoogleMembers.mockRejectedValue(new Error('boom'));
        renderPage();
        await screen.findByText('Google Workspace');
        await user.click(screen.getByText('Link existing members'));

        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith('Could not link existing members to Google Workspace')
        );
      });
    });
  });
});
