import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicPortalConfig } from '../types';

const mockUpdateConfig = vi.fn();
// Partial: a malformed response is one of the cases under test.
let mockConfig: Partial<PublicPortalConfig> | null = null;

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
    config: mockConfig,
    loading: false,
    updateConfig: (...a: unknown[]) => mockUpdateConfig(...a) as unknown,
  }),
}));

import { ConfigurationTab } from './ConfigurationTab';

describe('ConfigurationTab', () => {
  beforeEach(() => {
    mockUpdateConfig.mockReset();
    mockUpdateConfig.mockResolvedValue(config);
    mockConfig = config;
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

  it('saves a rate limit the officer typed, as a number', async () => {
    const user = userEvent.setup();
    render(<ConfigurationTab />);

    const field = screen.getByLabelText('Default Rate Limit (requests per hour)');
    await user.clear(field);
    await user.type(field, '2500');
    await user.click(screen.getByRole('button', { name: /Save Configuration/ }));

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledWith({ default_rate_limit: 2500 }));
  });

  // A cleared box used to parse to NaN, which React reported as the input
  // leaving controlled mode, and Save sent it on to a 422.
  it('refuses to save an empty or out-of-range limit, and says why', async () => {
    const user = userEvent.setup();
    render(<ConfigurationTab />);

    const field = screen.getByLabelText('Default Rate Limit (requests per hour)');
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: /Save Configuration/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 100,000.');
    expect(field).toHaveAttribute('aria-invalid', 'true');

    await user.type(field, '200000');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Save Configuration/ }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  // The mobile presentation pass answers with a permissive catch-all, and a
  // config with no default_rate_limit set the field to undefined: React's
  // "changing a controlled input to be uncontrolled" warning.
  it('stays a controlled input when the config arrives without a rate limit', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { default_rate_limit: _dropped, ...withoutRateLimit } = config;
    mockConfig = withoutRateLimit;
    try {
      render(<ConfigurationTab />);

      expect(screen.getByLabelText('Default Rate Limit (requests per hour)')).toHaveValue(1000);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
