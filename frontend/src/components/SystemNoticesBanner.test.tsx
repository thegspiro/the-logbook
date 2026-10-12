import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockList = vi.fn();
const mockGetKeyCustody = vi.fn();
const mockConfirmKeyCustody = vi.fn();
vi.mock('../services/systemNoticesService', () => ({
  systemNoticesService: {
    list: (...args: unknown[]) => mockList(...args) as unknown,
    getKeyCustody: (...args: unknown[]) => mockGetKeyCustody(...args) as unknown,
    confirmKeyCustody: (...args: unknown[]) => mockConfirmKeyCustody(...args) as unknown,
  },
}));

import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import { SystemNoticesBanner } from './SystemNoticesBanner';
import { useAuthStore } from '../stores/authStore';
import type { CurrentUser } from '../types/auth';

const scanningOff = {
  key: 'malware_scanning_disabled',
  severity: 'critical' as const,
  title: 'Uploaded files are not being scanned for malware',
  detail: 'Malware scanning is turned off on this server.',
};

const keyUnconfirmed = {
  key: 'encryption_key_custody_unconfirmed',
  severity: 'critical' as const,
  title: 'Confirm the encryption key is stored somewhere safe',
  detail: 'Stored files are encrypted with ENCRYPTION_KEY.',
  action: 'confirm_key_custody' as const,
};

function renderBanner() {
  return render(
    <ConfirmProvider>
      <SystemNoticesBanner />
    </ConfirmProvider>
  );
}

function signInWith(permissions: string[]): void {
  const user: CurrentUser = {
    id: 'u1',
    username: 'chief',
    email: 'chief@example.org',
    organization_id: 'o1',
    timezone: 'America/New_York',
    roles: [],
    positions: [],
    rank: null,
    membership_type: null,
    permissions,
    is_active: true,
    email_verified: true,
    mfa_enabled: false,
    password_expired: false,
    must_change_password: false,
  };
  useAuthStore.setState({ user });
}

describe('SystemNoticesBanner', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockList.mockResolvedValue([scanningOff]);
    mockGetKeyCustody.mockReset();
    mockGetKeyCustody.mockResolvedValue({ key_fingerprint: '0123456789abcdef', confirmed: false });
    mockConfirmKeyCustody.mockReset();
    mockConfirmKeyCustody.mockResolvedValue({ key_fingerprint: '0123456789abcdef', confirmed: true });
  });

  it('shows an administrator that uploads are not being scanned', async () => {
    signInWith(['settings.manage']);
    renderBanner();

    expect(await screen.findByRole('alert')).toHaveTextContent('not being scanned for malware');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('never asks the server on behalf of a member who cannot manage settings', async () => {
    signInWith(['events.view']);
    const { container } = renderBanner();

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mockList).not.toHaveBeenCalled();
  });

  it('renders nothing when there is nothing to report', async () => {
    mockList.mockResolvedValue([]);
    signInWith(['*']);
    const { container } = renderBanner();

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('stays quiet when the notices cannot be fetched', async () => {
    mockList.mockRejectedValue(new Error('offline'));
    signInWith(['settings.manage']);
    const { container } = renderBanner();

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  describe('the encryption key notice', () => {
    beforeEach(() => {
      mockList.mockReset();
      mockList.mockResolvedValueOnce([keyUnconfirmed]).mockResolvedValue([]);
    });

    it('records the confirmation against the fingerprint shown, and clears', async () => {
      const user = userEvent.setup();
      signInWith(['settings.manage']);
      renderBanner();

      await user.click(await screen.findByRole('button', { name: 'Confirm the key is stored safely' }));
      expect(await screen.findByText('0123456789abcdef')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'It is stored separately' }));

      await waitFor(() => expect(mockConfirmKeyCustody).toHaveBeenCalledWith('0123456789abcdef'));
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });

    it('records nothing when the administrator says not yet', async () => {
      const user = userEvent.setup();
      signInWith(['settings.manage']);
      renderBanner();

      await user.click(await screen.findByRole('button', { name: 'Confirm the key is stored safely' }));
      await user.click(await screen.findByRole('button', { name: 'Not yet' }));

      expect(mockConfirmKeyCustody).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('Confirm the encryption key');
    });
  });
});
