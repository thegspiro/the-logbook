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

  it('builds the endpoint URL from an absolute API base', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/api/v1');
    try {
      renderWithRouter(<McpServiceKeyPanel onClose={vi.fn()} />);
      expect(await screen.findByText('https://api.example.test/api/mcp')).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
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

  it('keeps issuing closed when the status cannot be loaded', async () => {
    const user = userEvent.setup();
    mockGetMcpStatus.mockReset();
    mockGetMcpStatus.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(statusWithKey);

    renderWithRouter(<McpServiceKeyPanel onClose={vi.fn()} />);
    await screen.findByTestId('mcp-status-error');
    expect(screen.queryByTestId('mcp-issue-key')).not.toBeInTheDocument();
    expect(screen.queryByText(/No active key/)).not.toBeInTheDocument();

    await user.click(screen.getByText('Try again'));
    await screen.findByTestId('mcp-issue-key');
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-status-error')).not.toBeInTheDocument();
  });

  it('does not let the panel close while a key is being issued', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    let finish: (value: unknown) => void = () => undefined;
    mockCreateMcpKey.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );

    renderWithRouter(<McpServiceKeyPanel onClose={onClose} />);
    await screen.findByTestId('mcp-issue-key');
    await user.click(screen.getByTestId('mcp-issue-key'));

    const close = screen.getByLabelText('Close');
    expect(close).toBeDisabled();
    await user.click(close);
    expect(onClose).not.toHaveBeenCalled();

    finish({ key: activeKey, plaintext: 'logbook_mcp_abcdefgh_secret', revoked: [] });
    await screen.findByTestId('mcp-issued-key');
    expect(screen.getByLabelText('Close')).toBeEnabled();
  });

  it('holds Revoke while a replacement key is being issued', async () => {
    const user = userEvent.setup();
    mockGetMcpStatus.mockResolvedValue(statusWithKey);
    let finish: (value: unknown) => void = () => undefined;
    mockCreateMcpKey.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );

    renderWithRouter(<McpServiceKeyPanel onClose={vi.fn()} />);
    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
    await user.click(screen.getByTestId('mcp-issue-key'));
    await screen.findByText('Replace the current service key?');
    const confirmButton = screen
      .getAllByRole('button', { name: 'Issue new key' })
      .find((button) => button.getAttribute('data-testid') !== 'mcp-issue-key');
    expect(confirmButton).toBeDefined();
    await user.click(confirmButton as HTMLElement);

    expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled();
    expect(screen.getByTestId('mcp-issue-key')).toBeDisabled();

    finish({ key: activeKey, plaintext: 'logbook_mcp_abcdefgh_secret', revoked: [activeKey] });
    await screen.findByTestId('mcp-issued-key');
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled();
  });

  it('reports its busy state to the parent while a key is being issued', async () => {
    const user = userEvent.setup();
    const onBusyChange = vi.fn();
    let finish: (value: unknown) => void = () => undefined;
    mockCreateMcpKey.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );

    renderWithRouter(<McpServiceKeyPanel onClose={vi.fn()} onBusyChange={onBusyChange} />);
    await screen.findByTestId('mcp-issue-key');
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByTestId('mcp-issue-key'));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);

    finish({ key: activeKey, plaintext: 'logbook_mcp_abcdefgh_secret', revoked: [] });
    await screen.findByTestId('mcp-issued-key');
    // The plaintext renders before the status refresh settles; busy clears
    // only once that refresh has finished.
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  });

  it('shows the new key when the status refresh after issuing fails', async () => {
    const user = userEvent.setup();
    const newKey = { ...activeKey, id: 'key-2', name: 'Chief laptop', key_prefix: 'logbook_mcp_zzzzzzzz' };
    mockCreateMcpKey.mockResolvedValue({
      key: newKey,
      plaintext: 'logbook_mcp_zzzzzzzzSECRET',
      revoked: [activeKey],
      endpoint_path: '/api/mcp',
    });
    mockGetMcpStatus.mockResolvedValueOnce(statusWithKey).mockRejectedValue(new Error('offline'));
    mockRevokeMcpKey.mockResolvedValue({ ...newKey, is_active: false, revoked_at: '2026-09-04T00:00:00Z' });

    renderWithRouter(<McpServiceKeyPanel onClose={vi.fn()} />);
    await screen.findByText('Claude Code');
    await user.click(screen.getByTestId('mcp-issue-key'));
    expect(await screen.findByText('Replace the current service key?')).toBeInTheDocument();
    // The panel's own button carries the same label as the dialog's confirm.
    const issueButtons = screen.getAllByRole('button', { name: 'Issue new key' });
    expect(issueButtons).toHaveLength(2);
    await user.click(issueButtons[1] as HTMLElement);

    expect(await screen.findByTestId('mcp-issued-key')).toHaveTextContent('logbook_mcp_zzzzzzzzSECRET');
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(await screen.findByText('Chief laptop')).toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).not.toBeInTheDocument();

    await user.click(screen.getByText('Revoke'));
    await user.click(await screen.findByRole('button', { name: 'Revoke key' }));
    await waitFor(() => expect(mockRevokeMcpKey).toHaveBeenCalledWith('key-2'));
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
