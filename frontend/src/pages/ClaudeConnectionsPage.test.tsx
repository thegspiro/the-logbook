import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import ClaudeConnectionsPage from './ClaudeConnectionsPage';

const mockList = vi.fn();
const mockRevoke = vi.fn();
vi.mock('../services/mcpOAuthService', () => ({
  mcpConnectionsService: {
    listMyConnections: (...args: unknown[]) => mockList(...args) as unknown,
    revokeMyConnection: (...args: unknown[]) => mockRevoke(...args) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const connection = {
  id: 'g1',
  client_name: 'claude.ai',
  client_id: 'lbmcp_abc',
  scopes: ['mcp:read'],
  created_at: '2026-10-02T00:00:00Z',
  last_used_at: null,
  expires_at: '2026-12-31T00:00:00Z',
};

describe('ClaudeConnectionsPage', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockList.mockResolvedValue([connection]);
    mockRevoke.mockReset();
    mockRevoke.mockResolvedValue(undefined);
  });

  it('lists the member’s own connections', async () => {
    renderWithRouter(<ClaudeConnectionsPage />);
    expect(await screen.findByTestId('claude-connections')).toHaveTextContent('claude.ai');
  });

  it('shows an empty state with no connections', async () => {
    mockList.mockResolvedValue([]);
    renderWithRouter(<ClaudeConnectionsPage />);
    expect(await screen.findByText('No connections')).toBeInTheDocument();
  });

  it('disconnects after confirming and reloads', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ClaudeConnectionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith('g1'));
    expect(mockList).toHaveBeenCalledTimes(2);
  });
});
