import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetStatus = vi.fn();
const mockSetup = vi.fn();
const mockVerifySetup = vi.fn();
const mockDisable = vi.fn();
const mockRegenerate = vi.fn();

vi.mock('../../services/authService', () => ({
  authService: {
    getMfaStatus: (...a: unknown[]) => mockGetStatus(...a) as unknown,
    setupMfa: (...a: unknown[]) => mockSetup(...a) as unknown,
    verifyMfaSetup: (...a: unknown[]) => mockVerifySetup(...a) as unknown,
    disableMfa: (...a: unknown[]) => mockDisable(...a) as unknown,
    regenerateRecoveryCodes: (...a: unknown[]) => mockRegenerate(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// QRCodeSVG renders an SVG that jsdom doesn't need; stub it to keep tests light.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => null,
}));

import { MfaSettingsCard } from './MfaSettingsCard';

describe('MfaSettingsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStatus.mockResolvedValue({ mfa_enabled: false, recovery_codes_remaining: 0 });
  });

  it('shows MFA off and offers to enable when not enrolled', async () => {
    render(<MfaSettingsCard />);
    expect(await screen.findByText(/two-factor authentication is/i)).toBeInTheDocument();
    expect(screen.getByText('off')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /enable two-factor authentication/i }),
    ).toBeInTheDocument();
  });

  it('walks through enrollment and shows one-time recovery codes', async () => {
    const user = userEvent.setup();
    mockSetup.mockResolvedValue({ secret: 'ABC123', qr_code_url: 'otpauth://x' });
    mockVerifySetup.mockResolvedValue({ recovery_codes: ['code-1111', 'code-2222'] });
    // After enabling, status reflects enrolled.
    mockGetStatus
      .mockResolvedValueOnce({ mfa_enabled: false, recovery_codes_remaining: 0 })
      .mockResolvedValue({ mfa_enabled: true, recovery_codes_remaining: 10 });

    render(<MfaSettingsCard />);
    await user.click(await screen.findByRole('button', { name: /enable two-factor/i }));

    await user.type(await screen.findByLabelText(/authenticator code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify & enable/i }));

    expect(await screen.findByText('code-1111')).toBeInTheDocument();
    expect(screen.getByText('code-2222')).toBeInTheDocument();
    expect(mockVerifySetup).toHaveBeenCalledWith('123456');
  });

  it('warns when recovery codes are running low', async () => {
    mockGetStatus.mockResolvedValue({ mfa_enabled: true, recovery_codes_remaining: 2 });
    render(<MfaSettingsCard />);
    expect(await screen.findByText(/running low on recovery codes/i)).toBeInTheDocument();
  });

  it('warns harder when zero recovery codes remain', async () => {
    mockGetStatus.mockResolvedValue({ mfa_enabled: true, recovery_codes_remaining: 0 });
    render(<MfaSettingsCard />);
    expect(await screen.findByText(/no recovery codes left/i)).toBeInTheDocument();
  });

  it('regenerates recovery codes with a current authenticator code', async () => {
    const user = userEvent.setup();
    mockGetStatus.mockResolvedValue({ mfa_enabled: true, recovery_codes_remaining: 5 });
    mockRegenerate.mockResolvedValue({ recovery_codes: ['new-1', 'new-2'] });

    render(<MfaSettingsCard />);
    await user.click(await screen.findByRole('button', { name: /regenerate recovery codes/i }));
    await user.type(
      await screen.findByLabelText(/current authenticator code to generate/i),
      '654321',
    );
    await user.click(screen.getByRole('button', { name: /generate new codes/i }));

    await waitFor(() => expect(mockRegenerate).toHaveBeenCalledWith('654321'));
    expect(await screen.findByText('new-1')).toBeInTheDocument();
  });

  it('disables MFA with a current authenticator code', async () => {
    const user = userEvent.setup();
    mockGetStatus.mockResolvedValue({ mfa_enabled: true, recovery_codes_remaining: 8 });
    mockDisable.mockResolvedValue({ mfa_enabled: false });

    render(<MfaSettingsCard />);
    await user.click(await screen.findByRole('button', { name: /^disable$/i }));
    await user.type(await screen.findByLabelText(/current authenticator code to disable/i), '111222');
    await user.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => expect(mockDisable).toHaveBeenCalledWith('111222'));
  });
});
