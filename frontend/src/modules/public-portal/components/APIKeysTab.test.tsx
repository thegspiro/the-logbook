/**
 * API Keys tab — the rate limit a key is created with, and the one it shows.
 *
 * The create form sent its number as `rate_limit`. The backend's create schema
 * names the field `rate_limit_override` and ignores keys it does not declare,
 * so the request succeeded and every key ran at the organization default no
 * matter what was typed. The list then printed `rate_limit ||
 * effective_rate_limit` — neither of which the endpoint served — as "/hour"
 * with no number, so nothing on the screen could reveal the first bug either.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicPortalAPIKey } from '../types';

const mockListAPIKeys = vi.fn();
const mockCreateAPIKey = vi.fn();
const mockRevokeAPIKey = vi.fn();

vi.mock('../services/publicPortalApi', () => ({
  listAPIKeys: (...a: unknown[]) => mockListAPIKeys(...a) as unknown,
  createAPIKey: (...a: unknown[]) => mockCreateAPIKey(...a) as unknown,
  revokeAPIKey: (...a: unknown[]) => mockRevokeAPIKey(...a) as unknown,
}));

vi.mock('react-hot-toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Import the component AFTER the mocks are in place.
import { APIKeysTab } from './APIKeysTab';

const apiKey = (overrides: Partial<PublicPortalAPIKey> & { id: string; name: string }): PublicPortalAPIKey => ({
  organization_id: 'org-1',
  key_prefix: `logbook_${overrides.id}`,
  rate_limit_override: null,
  effective_rate_limit: 1000,
  expires_at: null,
  last_used_at: null,
  is_active: true,
  created_by: null,
  created_at: '2026-10-01T00:00:00Z',
  is_expired: false,
  ...overrides,
});

const KEYS: PublicPortalAPIKey[] = [
  apiKey({ id: 'default', name: 'Website', rate_limit_override: null, effective_rate_limit: 250 }),
  apiKey({ id: 'custom', name: 'Kiosk', rate_limit_override: 40, effective_rate_limit: 40 }),
];

const renderTab = async () => {
  render(<APIKeysTab />);
  await screen.findByRole('table', { name: 'API keys list' });
};

const tableRowFor = (name: string): HTMLElement =>
  within(screen.getByRole('table', { name: 'API keys list' })).getByRole('row', { name: new RegExp(`^${name} `) });

const openCreateDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Create API Key' }));
  return screen.getByRole('dialog');
};

describe('APIKeysTab', () => {
  // The block states what it depends on rather than inheriting a neighbour's
  // implementation (CLAUDE.md #28).
  beforeEach(() => {
    mockListAPIKeys.mockReset();
    mockCreateAPIKey.mockReset();
    mockRevokeAPIKey.mockReset();
    mockListAPIKeys.mockResolvedValue(KEYS);
    mockCreateAPIKey.mockResolvedValue({ ...apiKey({ id: 'new', name: 'New' }), api_key: 'logbook_secret' });
  });

  describe('the listed rate limit', () => {
    it('shows the organization default for a key that has no override', async () => {
      await renderTab();

      expect(within(tableRowFor('Website')).getByText('250/hour')).toBeInTheDocument();
    });

    it('shows the override for a key that has one', async () => {
      await renderTab();

      expect(within(tableRowFor('Kiosk')).getByText('40/hour')).toBeInTheDocument();
    });

    it('never renders a bare "/hour" on the phone cards either', async () => {
      await renderTab();

      expect(screen.queryByText(/^\/hour$/)).not.toBeInTheDocument();
      expect(screen.getAllByText('250/hour')).toHaveLength(2);
      expect(screen.getAllByText('40/hour')).toHaveLength(2);
    });
  });

  describe('creating a key', () => {
    it('sends the typed limit as rate_limit_override', async () => {
      const user = userEvent.setup();
      await renderTab();

      const dialog = await openCreateDialog(user);
      await user.type(within(dialog).getByLabelText(/Key Name/), 'Station sign');
      await user.type(within(dialog).getByLabelText('Rate Limit (requests/hour)'), '120');
      await user.click(within(dialog).getByRole('button', { name: 'Create API Key' }));

      expect(mockCreateAPIKey).toHaveBeenCalledTimes(1);
      expect(mockCreateAPIKey).toHaveBeenCalledWith({
        name: 'Station sign',
        rate_limit_override: 120,
        expires_at: undefined,
      });
      // The name the backend drops must not be on the wire at all.
      const payload = JSON.parse(JSON.stringify(mockCreateAPIKey.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(payload).toStrictEqual({ name: 'Station sign', rate_limit_override: 120 });
    });

    it('omits the override when the field is left blank, so the key takes the default', async () => {
      const user = userEvent.setup();
      await renderTab();

      const dialog = await openCreateDialog(user);
      await user.type(within(dialog).getByLabelText(/Key Name/), 'Website two');
      await user.click(within(dialog).getByRole('button', { name: 'Create API Key' }));

      expect(mockCreateAPIKey).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(JSON.stringify(mockCreateAPIKey.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(payload).toStrictEqual({ name: 'Website two' });
    });
  });
});
