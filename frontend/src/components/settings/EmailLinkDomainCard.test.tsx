import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetEmailLinkDomain = vi.fn();
const mockSetEmailLinkDomain = vi.fn();
const mockClearEmailLinkDomain = vi.fn();
vi.mock('../../services/userServices', () => ({
  organizationService: {
    getEmailLinkDomain: (...args: unknown[]) => mockGetEmailLinkDomain(...args) as unknown,
    setEmailLinkDomain: (...args: unknown[]) => mockSetEmailLinkDomain(...args) as unknown,
    clearEmailLinkDomain: (...args: unknown[]) => mockClearEmailLinkDomain(...args) as unknown,
  },
}));

const mockCheckPermission = vi.fn();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p: string) => mockCheckPermission(p) as boolean }),
}));

import EmailLinkDomainCard from './EmailLinkDomainCard';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import type { EmailLinkDomain } from '../../types/user';

const domain = (overrides: Partial<EmailLinkDomain> = {}): EmailLinkDomain => ({
  effective_url: 'https://logbook.yourdept.org',
  configured_url: 'https://logbook.yourdept.org',
  deployment_url: 'https://logbook.yourdept.org',
  override_url: null,
  source: 'frontend_url',
  is_loopback: false,
  is_https: true,
  email_enabled: true,
  allowed_hosts: ['logbook.yourdept.org', 'intranet.yourdept.org'],
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
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(false);
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
    await userEvent.click(await screen.findByRole('button', { name: /Changing it on the server instead/ }));
    expect(screen.getByText(/Docker Compose \/ Linux:/)).toBeInTheDocument();
    expect(screen.getByText('Public Site Address')).toBeInTheDocument();
    expect(screen.getByText(/AWS or other hosting:/)).toBeInTheDocument();
  });

  it('is read-only without the System Owner permission', async () => {
    render(<EmailLinkDomainCard />);
    await screen.findByTestId('email-link-domain-url');
    expect(mockCheckPermission).toHaveBeenCalledWith('system.manage_link_domain');
    expect(screen.queryByLabelText('Change address')).not.toBeInTheDocument();
  });

  it('describes an override and what the server would otherwise use', async () => {
    mockGetEmailLinkDomain.mockResolvedValue(
      domain({
        source: 'override',
        effective_url: 'https://intranet.yourdept.org',
        override_url: 'https://intranet.yourdept.org',
      })
    );
    render(<EmailLinkDomainCard />);
    const source = await screen.findByText(/Set on this screen by an IT administrator/);
    expect(source).toHaveTextContent('Without it, links would use https://logbook.yourdept.org');
  });
});

describe('EmailLinkDomainCard editing', () => {
  const renderEditable = () =>
    render(
      <ConfirmProvider>
        <EmailLinkDomainCard />
      </ConfirmProvider>
    );

  beforeEach(() => {
    mockGetEmailLinkDomain.mockReset();
    mockGetEmailLinkDomain.mockResolvedValue(domain());
    mockSetEmailLinkDomain.mockReset();
    mockSetEmailLinkDomain.mockResolvedValue(
      domain({
        source: 'override',
        effective_url: 'https://intranet.yourdept.org',
        override_url: 'https://intranet.yourdept.org',
      })
    );
    mockClearEmailLinkDomain.mockReset();
    mockClearEmailLinkDomain.mockResolvedValue(domain({ source: 'allowed_origins' }));
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
    viewFrom('https://intranet.yourdept.org');
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('lists the hosts an override may use', async () => {
    renderEditable();
    expect(await screen.findByLabelText('Change address')).toHaveValue('https://logbook.yourdept.org');
    expect(screen.getByText('logbook.yourdept.org, intranet.yourdept.org')).toBeInTheDocument();
  });

  it('saves the address after the change is confirmed', async () => {
    const user = userEvent.setup();
    renderEditable();
    const input = await screen.findByLabelText('Change address');
    await user.clear(input);
    await user.type(input, 'https://intranet.yourdept.org');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Change address' }));

    expect(mockSetEmailLinkDomain).toHaveBeenCalledWith('https://intranet.yourdept.org');
    expect(await screen.findByTestId('email-link-domain-url')).toHaveTextContent('https://intranet.yourdept.org');
  });

  it('does not save when the change is cancelled', async () => {
    const user = userEvent.setup();
    renderEditable();
    await screen.findByLabelText('Change address');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Keep current address' }));
    expect(mockSetEmailLinkDomain).not.toHaveBeenCalled();
  });

  it('fills in the address the admin is browsing from', async () => {
    const user = userEvent.setup();
    renderEditable();
    await user.click(await screen.findByRole('button', { name: /Use the address I'm on now/ }));
    expect(screen.getByLabelText('Change address')).toHaveValue('https://intranet.yourdept.org');
  });

  it("shows the server's reason when it refuses an address", async () => {
    mockSetEmailLinkDomain.mockRejectedValue(new Error('evil.example.com is not an address this server accepts'));
    const user = userEvent.setup();
    renderEditable();
    const input = await screen.findByLabelText('Change address');
    await user.clear(input);
    await user.type(input, 'https://evil.example.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Change address' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not an address this server accepts');
  });

  it('offers going back to the server setting only while an override is saved', async () => {
    renderEditable();
    await screen.findByLabelText('Change address');
    expect(screen.queryByRole('button', { name: 'Go back to the server setting' })).not.toBeInTheDocument();
  });

  it('clears the override after confirmation', async () => {
    mockGetEmailLinkDomain.mockResolvedValue(
      domain({
        source: 'override',
        effective_url: 'https://intranet.yourdept.org',
        override_url: 'https://intranet.yourdept.org',
      })
    );
    const user = userEvent.setup();
    renderEditable();
    await user.click(await screen.findByRole('button', { name: 'Go back to the server setting' }));
    await user.click(await screen.findByRole('button', { name: 'Use server setting' }));
    expect(mockClearEmailLinkDomain).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('email-link-domain-url')).toHaveTextContent('https://logbook.yourdept.org');
  });
});
