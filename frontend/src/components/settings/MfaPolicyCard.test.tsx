import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetPolicy = vi.fn();
const mockSetPolicy = vi.fn();

vi.mock('../../services/authService', () => ({
  authService: {
    getMfaPolicy: (...a: unknown[]) => mockGetPolicy(...a) as unknown,
    setMfaPolicy: (...a: unknown[]) => mockSetPolicy(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { MfaPolicyCard } from './MfaPolicyCard';

describe('MfaPolicyCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPolicy.mockResolvedValue({ mfa_required: false });
  });

  it('loads and reflects the current org policy (off)', async () => {
    render(<MfaPolicyCard />);
    const toggle = await screen.findByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects the policy when MFA is required', async () => {
    mockGetPolicy.mockResolvedValue({ mfa_required: true });
    render(<MfaPolicyCard />);
    const toggle = await screen.findByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('enables the org-wide requirement when toggled on', async () => {
    const user = userEvent.setup();
    mockSetPolicy.mockResolvedValue({ mfa_required: true });

    render(<MfaPolicyCard />);
    const toggle = await screen.findByRole('switch');
    await user.click(toggle);

    await waitFor(() => expect(mockSetPolicy).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
  });

  it('turns new passkeys off without touching the MFA requirement', async () => {
    const user = userEvent.setup();
    mockGetPolicy.mockResolvedValue({ mfa_required: true, passkeys_enabled: true });
    mockSetPolicy.mockResolvedValue({ mfa_required: true, passkeys_enabled: false });

    render(<MfaPolicyCard />);
    const passkeys = await screen.findByRole('switch', { name: /allow passkeys/i });
    expect(passkeys).toHaveAttribute('aria-checked', 'true');
    await user.click(passkeys);

    await waitFor(() => expect(mockSetPolicy).toHaveBeenCalledWith(true, false));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /allow passkeys/i })).toHaveAttribute('aria-checked', 'false')
    );
    expect(screen.getByRole('switch', { name: /require two-factor/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('hides the passkey switch from a server that does not report it', async () => {
    render(<MfaPolicyCard />);
    await screen.findByRole('switch', { name: /require two-factor/i });
    expect(screen.queryByRole('switch', { name: /allow passkeys/i })).not.toBeInTheDocument();
  });
});
