import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockList = vi.fn();
const mockStatus = vi.fn();
const mockOptions = vi.fn();
const mockRegister = vi.fn();
const mockDelete = vi.fn();
const mockRegenerate = vi.fn();
const mockCreate = vi.fn();
const mockSupported = vi.fn();

vi.mock('../../services/authService', () => ({
  authService: {
    listPasskeys: (...a: unknown[]) => mockList(...a) as unknown,
    getMfaStatus: (...a: unknown[]) => mockStatus(...a) as unknown,
    getPasskeyRegistrationOptions: (...a: unknown[]) => mockOptions(...a) as unknown,
    registerPasskey: (...a: unknown[]) => mockRegister(...a) as unknown,
    deletePasskey: (...a: unknown[]) => mockDelete(...a) as unknown,
    regeneratePasskeyRecoveryCodes: (...a: unknown[]) => mockRegenerate(...a) as unknown,
  },
}));

vi.mock('../../utils/passkeys', () => ({
  passkeysSupported: () => mockSupported() as unknown,
  createPasskey: (options: unknown) => mockCreate(options) as unknown,
  isPasskeyPromptError: (err: unknown) => err instanceof Error && err.name === 'NotAllowedError',
  passkeyPromptError: () => 'The passkey request was cancelled or timed out. Try again.',
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
  },
}));

import { PasskeySettingsCard } from './PasskeySettingsCard';

const phone = {
  id: 'pk-1',
  name: 'My phone',
  created_at: '2026-10-01T12:00:00Z',
  last_used_at: null,
  backed_up: true,
};

const listOf = (passkeys: (typeof phone)[], overrides: Record<string, unknown> = {}) => ({
  passkeys,
  max_passkeys: 3,
  available: true,
  allowed: true,
  ...overrides,
});

describe('PasskeySettingsCard', () => {
  beforeEach(() => {
    for (const m of [
      mockList,
      mockStatus,
      mockOptions,
      mockRegister,
      mockDelete,
      mockRegenerate,
      mockCreate,
      mockSupported,
      mockToastSuccess,
      mockToastError,
    ]) {
      m.mockReset();
    }
    mockList.mockResolvedValue(listOf([]));
    mockStatus.mockResolvedValue({ mfa_enabled: false, passkey_count: 0, recovery_codes_remaining: 0 });
    mockOptions.mockResolvedValue({ challenge: 'c-1', rp: { id: 'logbook.example.org' } });
    mockCreate.mockResolvedValue({ id: 'cred-1', response: {} });
    mockRegister.mockResolvedValue({ passkey: phone, recovery_codes: [] });
    mockDelete.mockResolvedValue(undefined);
    mockSupported.mockReturnValue(true);
  });

  it('adds a passkey in two taps and shows first-time recovery codes once', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockRegister.mockResolvedValue({ passkey: phone, recovery_codes: ['aaaaa-1', 'bbbbb-2'] });
    renderWithRouter(<PasskeySettingsCard onChange={onChange} />);

    await user.click(await screen.findByRole('button', { name: /add a passkey/i }));
    const nameField = await screen.findByLabelText(/name this passkey/i);
    await user.clear(nameField);
    await user.type(nameField, 'Work laptop');
    await user.click(screen.getByRole('button', { name: /create passkey/i }));

    expect(mockCreate).toHaveBeenCalledWith({ challenge: 'c-1', rp: { id: 'logbook.example.org' } });
    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith('Work laptop', { id: 'cred-1', response: {} }));
    expect(await screen.findByText('aaaaa-1')).toBeInTheDocument();
    // The parent reloads the user, which remounts this card; it must not hear
    // about the change until the codes have been read.
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^done$/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('lists passkeys and removes one after confirmation', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce(listOf([phone])).mockResolvedValue(listOf([]));
    renderWithRouter(<PasskeySettingsCard />);

    expect(await screen.findByText('My phone')).toBeInTheDocument();
    expect(screen.getByText(/syncs across your devices/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove passkey My phone' }));
    await user.click(await screen.findByRole('button', { name: 'Remove passkey' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('pk-1'));
  });

  it('keeps the passkey when the member backs out of removing it', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue(listOf([phone]));
    renderWithRouter(<PasskeySettingsCard />);

    await user.click(await screen.findByRole('button', { name: 'Remove passkey My phone' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('stops offering to add at the limit', async () => {
    mockList.mockResolvedValue(
      listOf([phone, { ...phone, id: 'pk-2', name: 'Laptop' }, { ...phone, id: 'pk-3', name: 'Spare' }])
    );
    renderWithRouter(<PasskeySettingsCard />);

    expect(await screen.findByText(/most passkeys allowed \(3\)/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add a passkey/i })).not.toBeInTheDocument();
  });

  it('explains when the site cannot use passkeys', async () => {
    mockList.mockResolvedValue(listOf([], { available: false }));
    renderWithRouter(<PasskeySettingsCard />);

    expect(await screen.findByText(/reached over HTTPS/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add a passkey/i })).not.toBeInTheDocument();
  });

  it('explains when the organization has turned passkeys off', async () => {
    mockList.mockResolvedValue(listOf([phone], { allowed: false }));
    renderWithRouter(<PasskeySettingsCard />);

    expect(await screen.findByText(/turned off adding new passkeys/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add a passkey/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove passkey My phone' })).toBeInTheDocument();
  });

  it('explains when the browser cannot create passkeys', async () => {
    mockSupported.mockReturnValue(false);
    renderWithRouter(<PasskeySettingsCard />);

    expect(await screen.findByText(/browser cannot create passkeys/i)).toBeInTheDocument();
  });

  it('reports a cancelled prompt and starts over', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));
    renderWithRouter(<PasskeySettingsCard />);

    await user.click(await screen.findByRole('button', { name: /add a passkey/i }));
    await user.click(await screen.findByRole('button', { name: /create passkey/i }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('The passkey request was cancelled or timed out. Try again.')
    );
    expect(mockRegister).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /add a passkey/i })).toBeInTheDocument();
  });

  it('lets a passkey-only member generate new recovery codes', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue(listOf([phone]));
    mockStatus.mockResolvedValue({ mfa_enabled: false, passkey_count: 1, recovery_codes_remaining: 2 });
    mockRegenerate.mockResolvedValue({ recovery_codes: ['new-1', 'new-2'] });
    renderWithRouter(<PasskeySettingsCard />);

    expect(await screen.findByText('2 recovery codes left')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /generate new recovery codes/i }));
    await user.click(await screen.findByRole('button', { name: 'Generate new codes' }));

    expect(await screen.findByText('new-1')).toBeInTheDocument();
  });

  it('leaves recovery codes to the authenticator card when the app is on', async () => {
    mockList.mockResolvedValue(listOf([phone]));
    mockStatus.mockResolvedValue({ mfa_enabled: true, passkey_count: 1, recovery_codes_remaining: 8 });
    renderWithRouter(<PasskeySettingsCard />);

    expect(await screen.findByText('My phone')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate new recovery codes/i })).not.toBeInTheDocument();
  });
});
