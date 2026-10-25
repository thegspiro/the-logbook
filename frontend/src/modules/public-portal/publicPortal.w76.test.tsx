/**
 * Workflow review W76: the public portal admin, as the administrator.
 *
 * - Every Data Control switch re-read the list behind a spinner, which
 *   reopened every section and moved the rows under the pointer; the next tap
 *   landed on another field.
 * - Two switches both read "Enable description"; the section headers did not
 *   say whether they were open.
 * - Every key's button read "Revoke"; every access-log row's read "Details",
 *   the filters' labels were not tied to them, and a refused request's reason
 *   ("Revoked API key") was shown only when the row was flagged.
 * - "Disable Portal" cut every key off with no question asked, and the
 *   section buttons did not say which one was showing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import type { PublicPortalAccessLog, PublicPortalAPIKey, PublicPortalDataWhitelist } from './types';

const api = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  listAPIKeys: vi.fn(),
  getAccessLogs: vi.fn(),
  getWhitelist: vi.fn(),
  updateWhitelistEntry: vi.fn(),
}));

vi.mock('./services/publicPortalApi', () => ({
  getConfig: (...a: unknown[]) => api.getConfig(...a) as unknown,
  updateConfig: (...a: unknown[]) => api.updateConfig(...a) as unknown,
  listAPIKeys: (...a: unknown[]) => api.listAPIKeys(...a) as unknown,
  getAccessLogs: (...a: unknown[]) => api.getAccessLogs(...a) as unknown,
  getWhitelist: (...a: unknown[]) => api.getWhitelist(...a) as unknown,
  updateWhitelistEntry: (...a: unknown[]) => api.updateWhitelistEntry(...a) as unknown,
}));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import { DataWhitelistTab } from './components/DataWhitelistTab';
import { APIKeysTab } from './components/APIKeysTab';
import { AccessLogsTab } from './components/AccessLogsTab';
import PublicPortalAdmin from './pages/PublicPortalAdmin';

const field = (category: string, field_name: string): PublicPortalDataWhitelist => ({
  id: `${category}.${field_name}`,
  organization_id: 'org-1',
  data_category: category,
  category,
  field_name,
  is_enabled: false,
  is_sensitive: false,
  description: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

const KEY: PublicPortalAPIKey = {
  id: 'k1',
  organization_id: 'org-1',
  name: 'Department website',
  key_prefix: 'logbook_abc',
  rate_limit_override: null,
  effective_rate_limit: 1000,
  expires_at: null,
  last_used_at: null,
  is_active: true,
  created_by: null,
  created_at: '2026-10-21T16:50:00Z',
  is_expired: false,
};

const REFUSAL: PublicPortalAccessLog = {
  id: 'l1',
  organization_id: 'org-1',
  api_key_id: 'k1',
  ip_address: '203.0.113.9',
  endpoint: '/api/public/v1/organization/info',
  method: 'GET',
  status_code: 401,
  response_time_ms: null,
  user_agent: 'curl/8',
  referer: null,
  timestamp: '2026-10-21T16:54:00Z',
  flagged_suspicious: false,
  flag_reason: 'Revoked API key',
};

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.getConfig.mockResolvedValue({ id: 'c1', organization_id: 'org-1', enabled: true, default_rate_limit: 1000 });
  api.updateConfig.mockResolvedValue({ id: 'c1', organization_id: 'org-1', enabled: false, default_rate_limit: 1000 });
  api.listAPIKeys.mockResolvedValue([KEY]);
  api.getAccessLogs.mockResolvedValue([REFUSAL]);
  api.getWhitelist.mockResolvedValue([field('events', 'description'), field('organization', 'description')]);
  api.updateWhitelistEntry.mockResolvedValue({});
});

describe('Data Control (W76)', () => {
  it('names each switch with its category and says whether a section is open', async () => {
    render(<DataWhitelistTab />);

    expect(await screen.findByRole('checkbox', { name: 'Enable Events description' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Enable Organization description' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Events/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the list and its sections in place while a switch saves', async () => {
    const user = userEvent.setup();
    render(<DataWhitelistTab />);
    await user.click(await screen.findByRole('button', { name: /^Events/ }));
    expect(screen.queryByRole('checkbox', { name: 'Enable Events description' })).not.toBeInTheDocument();

    let resolveRead: (value: PublicPortalDataWhitelist[]) => void = () => undefined;
    api.getWhitelist.mockReturnValueOnce(
      new Promise<PublicPortalDataWhitelist[]>((resolve) => {
        resolveRead = resolve;
      })
    );
    const target = screen.getByRole('checkbox', { name: 'Enable Organization description' });
    await user.click(target);

    // While the re-read is outstanding the list stays, the switch is held,
    // and the section the admin closed stays closed.
    await waitFor(() => expect(api.updateWhitelistEntry).toHaveBeenCalledWith('organization.description', true));
    expect(screen.getByRole('checkbox', { name: 'Enable Organization description' })).toBeDisabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    resolveRead([field('events', 'description'), { ...field('organization', 'description'), is_enabled: true }]);
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Enable Organization description' })).toBeChecked()
    );
    expect(screen.getByRole('checkbox', { name: 'Enable Organization description' })).toBeEnabled();
    expect(screen.queryByRole('checkbox', { name: 'Enable Events description' })).not.toBeInTheDocument();
  });
});

describe('API keys and access logs (W76)', () => {
  it("names a key's revoke button after the key", async () => {
    render(<APIKeysTab />);
    const table = await screen.findByRole('table', { name: 'API keys list' });
    expect(within(table).getByRole('button', { name: 'Revoke Department website' })).toBeInTheDocument();
  });

  it("ties the filters' labels and shows why a request was refused", async () => {
    const user = userEvent.setup();
    render(<AccessLogsTab />);

    expect(await screen.findByLabelText('Status Code')).toBeInTheDocument();
    expect(screen.getByLabelText('IP Address')).toBeInTheDocument();
    const details = screen.getByRole('button', {
      name: /^Show details of GET \/api\/public\/v1\/organization\/info at /,
    });
    await user.click(details);

    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Reason:')).toBeInTheDocument();
    expect(screen.getByText('Revoked API key')).toBeInTheDocument();
  });
});

describe('Portal switch (W76)', () => {
  const renderPage = () =>
    render(
      <ConfirmProvider>
        <PublicPortalAdmin />
      </ConfirmProvider>
    );

  it('asks before disabling and leaves the portal on when kept', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('button', { name: 'Configuration' })).toHaveAttribute('aria-current', 'true');
    await user.click(screen.getByRole('button', { name: 'Disable Portal' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep it running' }));

    expect(api.updateConfig).not.toHaveBeenCalled();
  });

  it('disables once confirmed', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Disable Portal' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disable portal' }));

    await waitFor(() => expect(api.updateConfig).toHaveBeenCalledWith({ enabled: false }));
  });
});
