import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import IntegrationsPage from './IntegrationsPage';

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
      <IntegrationsPage />
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

  it('opens connect modal with config form for webhook type', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Slack');

    // Find the Slack card's Connect button
    const slackCard = screen.getByTestId('integration-card-slack');
    const connectBtn = within(slackCard).getByText('Connect');
    await user.click(connectBtn);

    expect(screen.getByText('Connect Slack')).toBeInTheDocument();
    expect(screen.getByText('Webhook URL')).toBeInTheDocument();
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

        await user.type(
          screen.getByLabelText('Salesforce Instance URL'),
          'https://acme.my.salesforce.com'
        );
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
  });
});
