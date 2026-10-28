import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockStepUp = vi.fn();
const mockPasskeyOptions = vi.fn();
const mockAssertion = vi.fn();
const state = { mfaEnabled: true, passkeyCount: 0 };

vi.mock('../services/api', () => ({
  authService: {
    stepUp: (proof: unknown) => mockStepUp(proof) as unknown,
    getStepUpPasskeyOptions: () => mockPasskeyOptions() as unknown,
  },
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { mfa_enabled: state.mfaEnabled, passkey_count: state.passkeyCount } }),
}));
vi.mock('../utils/passkeys', () => ({
  passkeysSupported: () => true,
  getPasskeyAssertion: (options: unknown) => mockAssertion(options) as unknown,
  passkeyPromptError: () => 'The passkey request was cancelled or timed out. Try again.',
}));

import { StepUpProvider } from './StepUpContext';
import { registerStepUpRequester, requestStepUp } from '../utils/stepUp';

beforeEach(() => {
  mockStepUp.mockReset();
  mockStepUp.mockResolvedValue({ verified: true, valid_for_minutes: 10 });
  mockPasskeyOptions.mockReset();
  mockPasskeyOptions.mockResolvedValue({ challenge: 'c-1', allowCredentials: [] });
  mockAssertion.mockReset();
  mockAssertion.mockResolvedValue({ id: 'cred-1', response: {} });
  state.mfaEnabled = true;
  state.passkeyCount = 0;
});

afterEach(() => {
  registerStepUpRequester(null);
});

function open(): Promise<boolean> {
  let result: Promise<boolean> = Promise.resolve(false);
  act(() => {
    result = requestStepUp();
  });
  return result;
}

describe('StepUpProvider', () => {
  it('asks for an authenticator code when MFA is enrolled, and resolves true once confirmed', async () => {
    render(<StepUpProvider>content</StepUpProvider>);
    const outcome = open();

    await userEvent.type(await screen.findByLabelText('Authenticator code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await expect(outcome).resolves.toBe(true);
    expect(mockStepUp).toHaveBeenCalledWith({ code: '123456' });
    await waitFor(() => expect(screen.queryByLabelText('Authenticator code')).not.toBeInTheDocument());
  });

  it('asks for the password when MFA is not enrolled', async () => {
    state.mfaEnabled = false;
    render(<StepUpProvider>content</StepUpProvider>);
    const outcome = open();

    await userEvent.type(await screen.findByLabelText('Password'), 'hunter2 ');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await expect(outcome).resolves.toBe(true);
    expect(mockStepUp).toHaveBeenCalledWith({ password: 'hunter2 ' });
  });

  it('stays open and shows the reason when verification fails', async () => {
    mockStepUp.mockRejectedValue(new Error('Verification failed'));
    render(<StepUpProvider>content</StepUpProvider>);
    void open();

    await userEvent.type(await screen.findByLabelText('Authenticator code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification failed');
    expect(screen.getByLabelText('Authenticator code')).toBeInTheDocument();
  });

  it('resolves false when cancelled', async () => {
    render(<StepUpProvider>content</StepUpProvider>);
    const outcome = open();

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await expect(outcome).resolves.toBe(false);
    expect(mockStepUp).not.toHaveBeenCalled();
  });
});

describe('StepUpProvider with a passkey', () => {
  it('confirms with the passkey and resolves true', async () => {
    state.mfaEnabled = false;
    state.passkeyCount = 1;
    render(<StepUpProvider>content</StepUpProvider>);
    const outcome = open();

    const button = await screen.findByRole('button', { name: 'Use your passkey' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    await expect(outcome).resolves.toBe(true);
    expect(mockAssertion).toHaveBeenCalledWith({ challenge: 'c-1', allowCredentials: [] });
    expect(mockStepUp).toHaveBeenCalledWith({ passkey_credential: { id: 'cred-1', response: {} } });
  });

  it('offers no password to a member whose only second factor is a passkey', async () => {
    state.mfaEnabled = false;
    state.passkeyCount = 1;
    render(<StepUpProvider>content</StepUpProvider>);
    void open();

    await screen.findByRole('button', { name: 'Use your passkey' });
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('offers both the passkey and the code to a member with both', async () => {
    state.passkeyCount = 1;
    render(<StepUpProvider>content</StepUpProvider>);
    void open();

    expect(await screen.findByRole('button', { name: 'Use your passkey' })).toBeInTheDocument();
    expect(screen.getByLabelText('Authenticator code')).toBeInTheDocument();
  });

  it('stays open with a fresh challenge when the prompt is cancelled', async () => {
    state.mfaEnabled = false;
    state.passkeyCount = 1;
    mockAssertion.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));
    render(<StepUpProvider>content</StepUpProvider>);
    void open();

    const button = await screen.findByRole('button', { name: 'Use your passkey' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled or timed out/);
    expect(mockStepUp).not.toHaveBeenCalled();
    await waitFor(() => expect(mockPasskeyOptions).toHaveBeenCalledTimes(2));
  });
});
