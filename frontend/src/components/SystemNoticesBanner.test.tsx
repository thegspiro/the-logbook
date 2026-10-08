import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockList = vi.fn();
vi.mock('../services/systemNoticesService', () => ({
  systemNoticesService: { list: (...args: unknown[]) => mockList(...args) as unknown },
}));

import { SystemNoticesBanner } from './SystemNoticesBanner';
import { useAuthStore } from '../stores/authStore';
import type { CurrentUser } from '../types/auth';

const scanningOff = {
  key: 'malware_scanning_disabled',
  severity: 'critical' as const,
  title: 'Uploaded files are not being scanned for malware',
  detail: 'Malware scanning is turned off on this server.',
};

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
  });

  it('shows an administrator that uploads are not being scanned', async () => {
    signInWith(['settings.manage']);
    render(<SystemNoticesBanner />);

    expect(await screen.findByRole('alert')).toHaveTextContent('not being scanned for malware');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('never asks the server on behalf of a member who cannot manage settings', async () => {
    signInWith(['events.view']);
    const { container } = render(<SystemNoticesBanner />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mockList).not.toHaveBeenCalled();
  });

  it('renders nothing when there is nothing to report', async () => {
    mockList.mockResolvedValue([]);
    signInWith(['*']);
    const { container } = render(<SystemNoticesBanner />);

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('stays quiet when the notices cannot be fetched', async () => {
    mockList.mockRejectedValue(new Error('offline'));
    signInWith(['settings.manage']);
    const { container } = render(<SystemNoticesBanner />);

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
