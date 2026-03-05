import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
const mockTestConnection = vi.fn();

vi.mock('../services/api', () => ({
  integrationsService: {
    getIntegrations: (...args: unknown[]) => mockGetIntegrations(...args) as unknown,
    connectIntegration: (...args: unknown[]) => mockConnectIntegration(...args) as unknown,
    disconnectIntegration: (...args: unknown[]) => mockDisconnectIntegration(...args) as unknown,
    testConnection: (...args: unknown[]) => mockTestConnection(...args) as unknown,
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

describe('IntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetIntegrations.mockResolvedValue(mockIntegrations);
    mockCheckPermission.mockReturnValue(true);
  });

  it('renders integration cards after loading', async () => {
    render(<IntegrationsPage />);
    expect(await screen.findByText('Slack')).toBeInTheDocument();
    expect(screen.getByText('NWS Weather Alerts')).toBeInTheDocument();
    expect(screen.getByText('Generic ePCR Import')).toBeInTheDocument();
    expect(screen.getByText('ImageTrend')).toBeInTheDocument();
  });

  it('shows correct stats', async () => {
    render(<IntegrationsPage />);
    await screen.findByText('Slack');
    // 4 total, 1 connected, 2 available
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows category filter buttons including new categories', async () => {
    render(<IntegrationsPage />);
    await screen.findByText('Slack');
    const filterGroup = screen.getByRole('group', { name: 'Filter by category' });
    expect(within(filterGroup).getByText('All')).toBeInTheDocument();
    expect(within(filterGroup).getByText('Messaging')).toBeInTheDocument();
    expect(within(filterGroup).getByText('Safety')).toBeInTheDocument();
    expect(within(filterGroup).getByText('EMS')).toBeInTheDocument();
  });

  it('filters by category', async () => {
    const user = userEvent.setup();
    render(<IntegrationsPage />);
    await screen.findByText('Slack');

    const filterGroup = screen.getByRole('group', { name: 'Filter by category' });
    await user.click(within(filterGroup).getByText('EMS'));
    expect(screen.getByText('Generic ePCR Import')).toBeInTheDocument();
    expect(screen.getByText('ImageTrend')).toBeInTheDocument();
    expect(screen.queryByText('Slack')).not.toBeInTheDocument();
  });

  it('filters by search query', async () => {
    const user = userEvent.setup();
    render(<IntegrationsPage />);
    await screen.findByText('Slack');

    const searchInput = screen.getByPlaceholderText('Search integrations...');
    await user.type(searchInput, 'weather');
    expect(screen.getByText('NWS Weather Alerts')).toBeInTheDocument();
    expect(screen.queryByText('Slack')).not.toBeInTheDocument();
  });

  it('shows PHI badge for EMS integrations', async () => {
    render(<IntegrationsPage />);
    await screen.findByText('Slack');
    expect(screen.getByText('PHI')).toBeInTheDocument();
  });

  it('shows Coming Soon badge', async () => {
    render(<IntegrationsPage />);
    await screen.findByText('Slack');
    expect(screen.getByText('Coming Soon')).toBeInTheDocument();
  });

  it('shows Connected badge on connected integrations', async () => {
    render(<IntegrationsPage />);
    await screen.findByText('Slack');
    // The ePCR import card is connected — find its badge
    const epcrCard = screen.getByText('Generic ePCR Import').closest('.stat-card');
    expect(within(epcrCard!).getByText('Connected')).toBeInTheDocument();
  });

  it('shows connect button for available integrations', async () => {
    render(<IntegrationsPage />);
    await screen.findByText('Slack');
    const connectButtons = screen.getAllByText('Connect');
    expect(connectButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('shows test and disconnect buttons for connected integrations', async () => {
    render(<IntegrationsPage />);
    await screen.findByText('Slack');
    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText('Disconnect')).toBeInTheDocument();
  });

  it('opens connect modal with config form for webhook type', async () => {
    const user = userEvent.setup();
    render(<IntegrationsPage />);
    await screen.findByText('Slack');

    // Find the Slack card's Connect button
    const slackCard = screen.getByText('Slack').closest('.stat-card');
    const connectBtn = within(slackCard!).getByText('Connect');
    await user.click(connectBtn);

    expect(screen.getByText('Connect Slack')).toBeInTheDocument();
    expect(screen.getByText('Webhook URL')).toBeInTheDocument();
  });

  it('hides manage buttons when user lacks permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    render(<IntegrationsPage />);
    await screen.findByText('Slack');

    expect(screen.queryByText('Connect')).not.toBeInTheDocument();
    expect(screen.queryByText('Disconnect')).not.toBeInTheDocument();
    expect(screen.queryByText('Test')).not.toBeInTheDocument();
  });

  it('shows empty state when no integrations match', async () => {
    const user = userEvent.setup();
    render(<IntegrationsPage />);
    await screen.findByText('Slack');

    const searchInput = screen.getByPlaceholderText('Search integrations...');
    await user.type(searchInput, 'nonexistent-integration-xyz');
    expect(screen.getByText('No integrations match your search')).toBeInTheDocument();
  });
});
