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
});
