import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { McpServiceKeyPanel } from './McpServiceKeyPanel';
import type { McpStatus } from '../../services/adminServices';

const mockCheckPermission = vi.fn();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: mockCheckPermission }),
}));

const mockGetMcpStatus = vi.fn();
const mockCreateMcpKey = vi.fn();
const mockRevokeMcpKey = vi.fn();
vi.mock('../../services/api', () => ({
  integrationsService: {
    getMcpStatus: (...args: unknown[]) => mockGetMcpStatus(...args) as unknown,
    createMcpKey: (...args: unknown[]) => mockCreateMcpKey(...args) as unknown,
    revokeMcpKey: (...args: unknown[]) => mockRevokeMcpKey(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));

const activeKey = {
  id: 'key-1',
  name: 'Claude Code',
  key_prefix: 'logbook_mcp_abcdefgh',
  expires_at: '2027-01-01T00:00:00Z',
  last_used_at: null,
  revoked_at: null,
  created_at: '2026-09-03T10:00:00Z',
  created_by: 'admin-1',
  is_active: true,
};

const statusNoKey: McpStatus = {
  enabled: true,
  endpoint_path: '/api/mcp',
  access_mode: 'read_only',
  expose_finance: false,
  expose_medical_screening: false,
  expose_full_schedule: false,
  active_key: null,
};

const statusWithKey: McpStatus = { ...statusNoKey, access_mode: 'read_write', active_key: activeKey };

describe('McpServiceKeyPanel', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
    mockGetMcpStatus.mockReset();
    mockGetMcpStatus.mockResolvedValue(statusNoKey);
    mockCreateMcpKey.mockReset();
    mockRevokeMcpKey.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('shows the endpoint URL and the no-key state', async () => {
    renderWithRouter(<McpServiceKeyPanel onClose={vi.fn()} />);
    expect(await screen.findByText(`${window.location.origin}/api/mcp`)).toBeInTheDocument();
    expect(screen.getByText(/No active key/)).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-issue-key')).toHaveTextContent('Issue key');
  });

  it('issues a key with the chosen expiry and shows the plaintext once', async () => {
    const user = userEvent.setup();
    mockCreateMcpKey.mockResolvedValue({
      key: activeKey,
      plaintext: 'logbook_mcp_abcdefghSECRET',
      revoked: [],
      endpoint_path: '/api/mcp',
    });
    mockGetMcpStatus.mockResolvedValueOnce(statusNoKey).mockResolvedValue(statusWithKey);

    renderWithRouter(<McpServiceKeyPanel onClose={vi.fn()} />);
    await screen.findByTestId('mcp-issue-key');
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Chief laptop');
    await user.selectOptions(screen.getByLabelText('Expires'), 'lifetime');
    await user.click(screen.getByTestId('mcp-issue-key'));

    expect(mockCreateMcpKey).toHaveBeenCalledWith('Chief laptop', null);
    expect(await screen.findByTestId('mcp-issued-key')).toHaveTextContent('logbook_mcp_abcdefghSECRET');
    expect(toastSuccess).toHaveBeenCalled();
    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Read and write')).toBeInTheDocument();

    await user.click(screen.getByText('I have copied it'));
    expect(screen.queryByTestId('mcp-issued-key')).not.toBeInTheDocument();
  });

  it('sends a numeric expiry for a dated option', async () => {
    const user = userEvent.setup();
    mockCreateMcpKey.mockResolvedValue({
      key: activeKey,
      plaintext: 'logbook_mcp_x',
      revoked: [],
      endpoint_path: '/api/mcp',
    });
    renderWithRouter(<McpServiceKeyPanel onClose={vi.fn()} />);
    await screen.findByTestId('mcp-issue-key');
    await user.selectOptions(screen.getByLabelText('Expires'), '30');
    await user.click(screen.getByTestId('mcp-issue-key'));
    expect(mockCreateMcpKey).toHaveBeenCalledWith('Claude', 30);
  });

  it('asks before replacing an existing key and before revoking', async () => {
    const user = userEvent.setup();
    mockGetMcpStatus.mockResolvedValue(statusWithKey);
    mockRevokeMcpKey.mockResolvedValue({ ...activeKey, is_active: false, revoked_at: '2026-09-04T00:00:00Z' });

    renderWithRouter(<McpServiceKeyPanel onClose={vi.fn()} />);
    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-issue-key')).toHaveTextContent('Issue new key');

    await user.click(screen.getByTestId('mcp-issue-key'));
    expect(await screen.findByText('Replace the current service key?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep current key' }));
    expect(mockCreateMcpKey).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Revoke this service key?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke key' }));
    await waitFor(() => expect(mockRevokeMcpKey).toHaveBeenCalledWith('key-1'));
  });

  it('hides issue and revoke controls without the mcp_keys permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    mockGetMcpStatus.mockResolvedValue(statusWithKey);
    renderWithRouter(<McpServiceKeyPanel onClose={vi.fn()} />);
    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-issue-key')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only a member holding/)).toBeInTheDocument();
  });

  it('reports a failed issue without crashing', async () => {
    const user = userEvent.setup();
    mockCreateMcpKey.mockRejectedValueOnce(new Error('nope'));
    renderWithRouter(<McpServiceKeyPanel onClose={vi.fn()} />);
    await screen.findByTestId('mcp-issue-key');
    await user.click(screen.getByTestId('mcp-issue-key'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByTestId('mcp-issued-key')).not.toBeInTheDocument();
  });
});
