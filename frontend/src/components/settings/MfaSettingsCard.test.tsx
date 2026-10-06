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

// QRCodeSVG's drawing is not what these tests check; the stub keeps only the
// role and title, which give the code its accessible name.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ role, title }: { role?: string; title?: string }) => (
    <svg role={role}>
      <title>{title}</title>
    </svg>
  ),
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
    expect(screen.getByRole('button', { name: /enable two-factor authentication/i })).toBeInTheDocument();
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
    expect(mockVerifySetup).toHaveBeenCalledWith('123456', expect.any(String));
  });

  it('names the QR code for screen readers (workflow review W04)', async () => {
    const user = userEvent.setup();
    mockSetup.mockResolvedValue({ secret: 'ABC123', qr_code_url: 'otpauth://x' });

    render(<MfaSettingsCard />);
    await user.click(await screen.findByRole('button', { name: /enable two-factor/i }));

    expect(await screen.findByRole('img', { name: /qr code .*authenticator app/i })).toBeInTheDocument();
  });

  it('keeps the recovery codes on screen until they are dismissed, then tells the parent', async () => {
    // W04-2: onChange fired as soon as MFA was enabled; the account page
    // answers it by reloading the user, which remounted this card and threw
    // away the codes — shown this once — before anyone could read them.
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockSetup.mockResolvedValue({ secret: 'ABC123', qr_code_url: 'otpauth://x' });
    mockVerifySetup.mockResolvedValue({ recovery_codes: ['code-1111', 'code-2222'] });
    mockGetStatus
      .mockResolvedValueOnce({ mfa_enabled: false, recovery_codes_remaining: 0 })
      .mockResolvedValue({ mfa_enabled: true, recovery_codes_remaining: 10 });

    render(<MfaSettingsCard onChange={onChange} />);
    await user.click(await screen.findByRole('button', { name: /enable two-factor/i }));
    await user.type(await screen.findByLabelText(/authenticator code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify & enable/i }));

    expect(await screen.findByText('code-1111')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^done$/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
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
    await user.type(await screen.findByLabelText(/current authenticator code to generate/i), '654321');
    await user.click(screen.getByRole('button', { name: /generate new codes/i }));

    await waitFor(() => expect(mockRegenerate).toHaveBeenCalledWith('654321', expect.any(String)));
    expect(await screen.findByText('new-1')).toBeInTheDocument();
  });

  it('retries a lost regeneration with the same key, and a new code with a new key (AUTH-7)', async () => {
    const user = userEvent.setup();
    mockGetStatus.mockResolvedValue({ mfa_enabled: true, recovery_codes_remaining: 5 });
    mockRegenerate.mockReset();
    mockRegenerate
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValue({ recovery_codes: ['kept-1'] });

    render(<MfaSettingsCard />);
    await user.click(await screen.findByRole('button', { name: /regenerate recovery codes/i }));
    const input = await screen.findByLabelText(/current authenticator code to generate/i);
    await user.type(input, '654321');
    await user.click(screen.getByRole('button', { name: /generate new codes/i }));
    await waitFor(() => expect(mockRegenerate).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /generate new codes/i }));
    await waitFor(() => expect(mockRegenerate).toHaveBeenCalledTimes(2));

    const firstKey = mockRegenerate.mock.calls[0]?.[1] as string;
    expect(firstKey).toEqual(expect.any(String));
    expect(mockRegenerate.mock.calls[1]).toEqual(['654321', firstKey]);

    await user.clear(input);
    await user.type(input, '111222');
    await user.click(screen.getByRole('button', { name: /generate new codes/i }));
    await waitFor(() => expect(mockRegenerate).toHaveBeenCalledTimes(3));
    expect(mockRegenerate.mock.calls[2]?.[0]).toBe('111222');
    expect(mockRegenerate.mock.calls[2]?.[1]).not.toBe(firstKey);
    expect(await screen.findByText('kept-1')).toBeInTheDocument();
  });

  it('disables MFA with a current authenticator code', async () => {
    const user = userEvent.setup();
    mockGetStatus.mockResolvedValue({ mfa_enabled: true, recovery_codes_remaining: 8 });
    mockDisable.mockResolvedValue({ mfa_enabled: false });

    render(<MfaSettingsCard />);
    await user.click(await screen.findByRole('button', { name: /^disable$/i }));
    await user.type(
      await screen.findByLabelText(/current authenticator code to disable two-factor authentication/i),
      '111222'
    );
    await user.click(screen.getByRole('button', { name: /disable two-factor authentication/i }));

    await waitFor(() => expect(mockDisable).toHaveBeenCalledWith('111222'));
  });
});
