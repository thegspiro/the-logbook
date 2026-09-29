import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicPortalConfig } from '../types';

const mockUpdateConfig = vi.fn();

const config: PublicPortalConfig = {
  id: 'cfg-1',
  organization_id: 'org-1',
  enabled: true,
  allowed_origins: ['https://dept.example.org'],
  default_rate_limit: 1000,
  cache_ttl_seconds: 600,
  settings: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

vi.mock('../hooks/usePublicPortal', () => ({
  usePortalConfig: () => ({
    config,
    loading: false,
    updateConfig: (...a: unknown[]) => mockUpdateConfig(...a) as unknown,
  }),
}));

import { ConfigurationTab } from './ConfigurationTab';

describe('ConfigurationTab', () => {
  beforeEach(() => {
    mockUpdateConfig.mockReset();
    mockUpdateConfig.mockResolvedValue(config);
  });

  // allowed_origins and cache_ttl_seconds are stored but nothing reads them,
  // so controls for them would only claim an effect they do not have
  // (pitfall #19).
  it('offers no allowed-origins or cache controls', () => {
    render(<ConfigurationTab />);

    expect(screen.getByLabelText('Default Rate Limit (requests per hour)')).toBeInTheDocument();
    expect(screen.queryByText(/Allowed Origins/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Allowed origin URL')).not.toBeInTheDocument();
    expect(screen.queryByText('Caching')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cache TTL (seconds)')).not.toBeInTheDocument();
  });

  // The update endpoint only writes the fields it is sent, so leaving them
  // out is what keeps the stored values intact.
  it('saves only the rate limit, leaving the stored origins and cache TTL alone', async () => {
    const user = userEvent.setup();
    render(<ConfigurationTab />);

    await user.click(screen.getByRole('button', { name: /Save Configuration/ }));

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
    expect(mockUpdateConfig).toHaveBeenCalledWith({ default_rate_limit: 1000 });
  });
});
