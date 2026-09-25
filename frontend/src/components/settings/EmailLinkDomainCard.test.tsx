import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetEmailLinkDomain = vi.fn();
vi.mock('../../services/userServices', () => ({
  organizationService: {
    getEmailLinkDomain: (...args: unknown[]) => mockGetEmailLinkDomain(...args) as unknown,
  },
}));

import EmailLinkDomainCard from './EmailLinkDomainCard';
import type { EmailLinkDomain } from '../../types/user';

const domain = (overrides: Partial<EmailLinkDomain> = {}): EmailLinkDomain => ({
  effective_url: 'https://logbook.yourdept.org',
  configured_url: 'https://logbook.yourdept.org',
  source: 'frontend_url',
  is_loopback: false,
  is_https: true,
  email_enabled: true,
  ...overrides,
});

const originalLocation = window.location;
const viewFrom = (origin: string) => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, origin },
  });
};

describe('EmailLinkDomainCard', () => {
  beforeEach(() => {
    mockGetEmailLinkDomain.mockReset();
    mockGetEmailLinkDomain.mockResolvedValue(domain());
    viewFrom('https://logbook.yourdept.org');
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('shows the address links are built from and that FRONTEND_URL set it', async () => {
    render(<EmailLinkDomainCard />);
    expect(await screen.findByTestId('email-link-domain-url')).toHaveTextContent('https://logbook.yourdept.org');
    expect(screen.getByText(/Set by the/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockGetEmailLinkDomain).toHaveBeenCalledTimes(1);
  });

  it('explains an address picked from ALLOWED_ORIGINS and names what was configured', async () => {
    mockGetEmailLinkDomain.mockResolvedValue(
      domain({ source: 'allowed_origins', configured_url: 'http://localhost:3000' })
    );
    render(<EmailLinkDomainCard />);
    expect(await screen.findByText(/Picked automatically from/)).toBeInTheDocument();
    expect(screen.getByText('http://localhost:3000')).toBeInTheDocument();
  });

  it('warns that a loopback address will not open for recipients', async () => {
    mockGetEmailLinkDomain.mockResolvedValue(
      domain({
        effective_url: 'http://localhost:3000',
        configured_url: 'http://localhost:3000',
        source: 'unresolved_loopback',
        is_loopback: true,
        is_https: false,
      })
    );
    render(<EmailLinkDomainCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/will not open for anyone/);
    // Loopback supersedes the http and mismatch warnings rather than stacking them.
    expect(screen.queryByText(/sent unencrypted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/You are viewing this site at/)).not.toBeInTheDocument();
  });

  it('says the loopback problem applies once email is turned on when it is off', async () => {
    mockGetEmailLinkDomain.mockResolvedValue(
      domain({
        effective_url: 'http://localhost:3000',
        source: 'unresolved_loopback',
        is_loopback: true,
        is_https: false,
        email_enabled: false,
      })
    );
    render(<EmailLinkDomainCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/once email sending is turned on/);
  });

  it('warns about a plain http address', async () => {
    mockGetEmailLinkDomain.mockResolvedValue(domain({ effective_url: 'http://192.0.2.10:3000', is_https: false }));
    viewFrom('http://192.0.2.10:3000');
    render(<EmailLinkDomainCard />);
    expect(await screen.findByText(/sent/)).toHaveTextContent(/unencrypted/);
  });

  it('warns when the admin is browsing from a different address than emails link to', async () => {
    viewFrom('https://intranet.yourdept.org');
    render(<EmailLinkDomainCard />);
    expect(await screen.findByText(/You are viewing this site at/)).toBeInTheDocument();
    expect(screen.getByText('https://intranet.yourdept.org')).toBeInTheDocument();
  });

  it('shows a load failure without breaking the section', async () => {
    mockGetEmailLinkDomain.mockRejectedValue(new Error('Network down'));
    render(<EmailLinkDomainCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    expect(screen.queryByTestId('email-link-domain-url')).not.toBeInTheDocument();
  });

  it('explains how to change the address for each deployment type', async () => {
    render(<EmailLinkDomainCard />);
    await userEvent.click(await screen.findByRole('button', { name: /How to change this address/ }));
    expect(screen.getByText(/Docker Compose \/ Linux:/)).toBeInTheDocument();
    expect(screen.getByText('Public Site Address')).toBeInTheDocument();
    expect(screen.getByText(/AWS or other hosting:/)).toBeInTheDocument();
  });
});
