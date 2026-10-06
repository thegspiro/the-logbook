import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import ClaudeAuthorizePage from './ClaudeAuthorizePage';
import type { McpOAuthConsentRequest } from '../services/mcpOAuthService';

const mockGetConsentRequest = vi.fn();
const mockDecide = vi.fn();
vi.mock('../services/mcpOAuthService', () => ({
  mcpConnectionsService: {
    getConsentRequest: (...args: unknown[]) => mockGetConsentRequest(...args) as unknown,
    decideConsentRequest: (...args: unknown[]) => mockDecide(...args) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const assign = vi.fn();
vi.mock('../utils/browserNavigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/browserNavigation')>()),
  leaveApp: (...args: unknown[]) => assign(...args) as unknown,
}));

const request: McpOAuthConsentRequest = {
  id: 'req-1',
  client: {
    name: 'claude.ai',
    client_id: 'lbmcp_abc',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    redirect_host: 'claude.ai',
  },
  department_allows: true,
  scopes: [
    { scope: 'mcp:read', description: 'Read records', required: true, tool_count: 12 },
    { scope: 'mcp:write', description: 'Create drafts', required: false, tool_count: 0 },
    { scope: 'mcp:finance', description: 'Read finance totals', required: false, tool_count: 4 },
  ],
  expires_at: '2026-10-06T12:00:00Z',
};

describe('ClaudeAuthorizePage', () => {
  beforeEach(() => {
    mockGetConsentRequest.mockReset();
    mockGetConsentRequest.mockResolvedValue(structuredClone(request));
    mockDecide.mockReset();
    mockDecide.mockResolvedValue({
      redirect_to: 'https://claude.ai/api/mcp/auth_callback?code=c&state=s',
      approved: true,
    });
    assign.mockReset();
    window.history.pushState({}, '', '/claude/authorize?request=req-1');
  });

  it('shows the client, where it returns to, and what each scope reaches', async () => {
    renderWithRouter(<ClaudeAuthorizePage />);
    expect(await screen.findByText(/is asking to use The Logbook as you/)).toBeInTheDocument();
    // Named twice: as the client, and as the host the member is sent back to.
    expect(screen.getAllByText('claude.ai', { selector: 'strong' })).toHaveLength(2);
    expect(mockGetConsentRequest).toHaveBeenCalledWith('req-1');
    expect(screen.getByText(/12 tools available to you/)).toBeInTheDocument();
    expect(screen.getByText(/Would not reach anything for you/)).toBeInTheDocument();
    const read = screen.getByRole('checkbox', { name: /Read records/ });
    expect(read).toBeChecked();
    expect(read).toBeDisabled();
  });

  it('approves with the scopes left ticked and follows the returned redirect', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ClaudeAuthorizePage />);
    await user.click(await screen.findByRole('checkbox', { name: /Read finance totals/ }));
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=c&state=s'));
    expect(mockDecide).toHaveBeenCalledWith('req-1', true, ['mcp:read', 'mcp:write']);
  });

  it('declines without sending scopes', async () => {
    const user = userEvent.setup();
    mockDecide.mockResolvedValue({
      redirect_to: 'https://claude.ai/api/mcp/auth_callback?error=access_denied',
      approved: false,
    });
    renderWithRouter(<ClaudeAuthorizePage />);
    await user.click(await screen.findByRole('button', { name: /Don.t allow/ }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(mockDecide).toHaveBeenCalledWith('req-1', false, undefined);
  });

  it('refuses to follow a redirect that is not a web address', async () => {
    const user = userEvent.setup();
    mockDecide.mockResolvedValue({ redirect_to: 'javascript:alert(1)', approved: true });
    renderWithRouter(<ClaudeAuthorizePage />);
    await user.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(await screen.findByTestId('claude-consent-error')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('explains a missing request id without calling the API', async () => {
    window.history.pushState({}, '', '/claude/authorize');
    renderWithRouter(<ClaudeAuthorizePage />);
    expect(await screen.findByTestId('claude-consent-error')).toHaveTextContent(/missing its request/);
    expect(mockGetConsentRequest).not.toHaveBeenCalled();
  });

  it('shows the server message when the request cannot be loaded', async () => {
    mockGetConsentRequest.mockReset();
    mockGetConsentRequest.mockRejectedValue(new Error('This authorization request has expired.'));
    renderWithRouter(<ClaudeAuthorizePage />);
    expect(await screen.findByTestId('claude-consent-error')).toHaveTextContent(/expired/);
  });
});
