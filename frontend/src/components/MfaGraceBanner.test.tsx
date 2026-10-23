import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';

const state: { user: { mfa_grace_ends_at?: string | null; mfa_enabled?: boolean } | null } = { user: null };

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: state.user }),
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import { MfaGraceBanner } from './MfaGraceBanner';

beforeEach(() => {
  state.user = null;
});

describe('MfaGraceBanner', () => {
  it('counts down to the end of the grace period with a link to set MFA up', () => {
    state.user = { mfa_grace_ends_at: '2026-11-06T12:00:00Z', mfa_enabled: false };
    renderWithRouter(<MfaGraceBanner />);

    expect(screen.getByRole('status')).toHaveTextContent(/two-factor authentication/i);
    expect(screen.getByRole('link', { name: 'Set it up now' })).toHaveAttribute('href', '/account');
  });

  it('shows nothing outside a grace period', () => {
    state.user = { mfa_grace_ends_at: null, mfa_enabled: false };
    const { container } = renderWithRouter(<MfaGraceBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing once enrolled', () => {
    state.user = { mfa_grace_ends_at: '2026-11-06T12:00:00Z', mfa_enabled: true };
    const { container } = renderWithRouter(<MfaGraceBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
