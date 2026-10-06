import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { McpOAuthPanel } from './McpOAuthPanel';
import type { McpOAuthClient, McpOAuthConnection, McpOAuthStatus } from '../../services/mcpOAuthService';

const mockCheckPermission = vi.fn();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: mockCheckPermission }),
}));

const mockStatus = vi.fn();
const mockClients = vi.fn();
const mockGrants = vi.fn();
const mockRegister = vi.fn();
const mockRevokeClient = vi.fn();
const mockRevokeGrant = vi.fn();
vi.mock('../../services/mcpOAuthService', () => ({
  mcpOAuthAdminService: {
    getStatus: (...args: unknown[]) => mockStatus(...args) as unknown,
    listClients: (...args: unknown[]) => mockClients(...args) as unknown,
    listGrants: (...args: unknown[]) => mockGrants(...args) as unknown,
    registerClient: (...args: unknown[]) => mockRegister(...args) as unknown,
    revokeClient: (...args: unknown[]) => mockRevokeClient(...args) as unknown,
    revokeGrant: (...args: unknown[]) => mockRevokeGrant(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const status: McpOAuthStatus = {
  server_enabled: true,
  department_enabled: true,
  issuer: 'https://logbook.test/api/oauth',
  resource: 'https://logbook.test/api/mcp',
  authorization_endpoint: 'https://logbook.test/api/oauth/authorize',
  token_endpoint: 'https://logbook.test/api/oauth/token',
  scopes: [],
};

const client: McpOAuthClient = {
  id: 'c1',
  client_id: 'lbmcp_abc',
  name: 'claude.ai',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  confidential: true,
  created_at: '2026-10-01T00:00:00Z',
  created_by: 'admin',
  revoked_at: null,
  is_active: true,
};

const grant: McpOAuthConnection = {
  id: 'g1',
  client_name: 'claude.ai',
  client_id: 'lbmcp_abc',
  scopes: ['mcp:read'],
  created_at: '2026-10-02T00:00:00Z',
  last_used_at: null,
  expires_at: '2026-12-31T00:00:00Z',
  member_name: 'Pat Doe',
};

describe('McpOAuthPanel', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
    mockStatus.mockReset();
    mockStatus.mockResolvedValue({ ...status });
    mockClients.mockReset();
    mockClients.mockResolvedValue([client]);
    mockGrants.mockReset();
    mockGrants.mockResolvedValue([grant]);
    mockRegister.mockReset();
    mockRevokeClient.mockReset();
    mockRevokeGrant.mockReset();
  });

  it('lists registered clients and member connections', async () => {
    renderWithRouter(<McpOAuthPanel />);
    expect(await screen.findByTestId('mcp-oauth-clients')).toHaveTextContent('lbmcp_abc');
    expect(screen.getByTestId('mcp-oauth-grants')).toHaveTextContent('Pat Doe');
    expect(screen.getByText('https://logbook.test/api/oauth')).toBeInTheDocument();
  });

  it('says so when the server has member sign-in off', async () => {
    mockStatus.mockResolvedValue({ ...status, server_enabled: false, issuer: null });
    renderWithRouter(<McpOAuthPanel />);
    expect(await screen.findByTestId('mcp-oauth-server-off')).toHaveTextContent('MCP_OAUTH_ENABLED');
  });

  it('shows a confidential client secret once after registering', async () => {
    const user = userEvent.setup();
    mockRegister.mockResolvedValue({
      client: { ...client, id: 'c2', client_id: 'lbmcp_new' },
      client_secret: 'lbmcs_secret',
    });
    renderWithRouter(<McpOAuthPanel />);
    await user.click(await screen.findByTestId('mcp-oauth-register'));
    expect(await screen.findByTestId('mcp-oauth-created')).toHaveTextContent('lbmcs_secret');
    expect(mockRegister).toHaveBeenCalledWith('claude.ai', ['https://claude.ai/api/mcp/auth_callback'], true);
  });

  it('hides the controls without the key permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderWithRouter(<McpOAuthPanel />);
    await screen.findByTestId('mcp-oauth-clients');
    expect(screen.queryByTestId('mcp-oauth-register')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('ends a member connection after confirming', async () => {
    const user = userEvent.setup();
    mockRevokeGrant.mockResolvedValue(undefined);
    renderWithRouter(<McpOAuthPanel />);
    await user.click(await screen.findByRole('button', { name: 'End' }));
    await user.click(await screen.findByRole('button', { name: 'End connection' }));
    await waitFor(() => expect(mockRevokeGrant).toHaveBeenCalledWith('g1'));
  });
});
