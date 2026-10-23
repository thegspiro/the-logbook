import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockStepUp = vi.fn();
const state = { mfaEnabled: true };

vi.mock('../services/api', () => ({
  authService: { stepUp: (proof: unknown) => mockStepUp(proof) as unknown },
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { mfa_enabled: state.mfaEnabled } }),
}));

import { StepUpProvider } from './StepUpContext';
import { registerStepUpRequester, requestStepUp } from '../utils/stepUp';

beforeEach(() => {
  mockStepUp.mockReset();
  mockStepUp.mockResolvedValue({ verified: true, valid_for_minutes: 10 });
  state.mfaEnabled = true;
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
