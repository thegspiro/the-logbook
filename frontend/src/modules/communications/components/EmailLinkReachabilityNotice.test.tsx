import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

const mockGetEmailLinkDomain = vi.fn();

vi.mock('../../../services/api', () => ({
  organizationService: {
    getEmailLinkDomain: (...args: unknown[]) => mockGetEmailLinkDomain(...args) as unknown,
  },
}));

// Imported after the mock so the component binds to it.
import { EmailLinkReachabilityNotice } from './EmailLinkReachabilityNotice';
import { renderWithRouter } from '../../../test/utils';
import type { EmailLinkDomain } from '../../../types/user';

const domain = (overrides: Partial<EmailLinkDomain> = {}): EmailLinkDomain => ({
  effective_url: 'https://logbook.yourdept.org',
  configured_url: 'https://logbook.yourdept.org',
  deployment_url: 'https://logbook.yourdept.org',
  override_url: null,
  source: 'frontend_url',
  is_loopback: false,
  is_private_network: false,
  is_https: true,
  email_enabled: true,
  allowed_hosts: [],
  ...overrides,
});

describe('EmailLinkReachabilityNotice', () => {
  beforeEach(() => {
    mockGetEmailLinkDomain.mockReset();
    mockGetEmailLinkDomain.mockResolvedValue(domain());
  });

  it('shows nothing when emails link to a public address', async () => {
    const { container } = renderWithRouter(<EmailLinkReachabilityNotice />);
    await waitFor(() => expect(mockGetEmailLinkDomain).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('warns when emails link to a station-only address, and links to the setting', async () => {
    mockGetEmailLinkDomain.mockResolvedValue(
      domain({ effective_url: 'http://tower.local:3000', is_private_network: true, is_https: false })
    );
    renderWithRouter(<EmailLinkReachabilityNotice />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('http://tower.local:3000');
    expect(alert).toHaveTextContent(/only works on your station.s network/);
    expect(screen.getByRole('link', { name: /change the email link address/i })).toHaveAttribute(
      'href',
      '/settings?tab=email'
    );
  });

  it('warns when emails link to the server itself', async () => {
    mockGetEmailLinkDomain.mockResolvedValue(
      domain({ effective_url: 'http://localhost:3000', is_loopback: true, is_https: false })
    );
    renderWithRouter(<EmailLinkReachabilityNotice />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/only works on the server itself/);
  });

  it('stays silent when the address cannot be read', async () => {
    mockGetEmailLinkDomain.mockRejectedValue(new Error('forbidden'));
    const { container } = renderWithRouter(<EmailLinkReachabilityNotice />);
    await waitFor(() => expect(mockGetEmailLinkDomain).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });
});
