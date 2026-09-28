/**
 * The reset page (workflow review W03).
 *
 * - W03-3: a 429 from the shared reset budget read "Invalid Reset Link" about
 *   a link that was fine.
 * - W03-4: the checklist said "At least 8 characters" while 12 are required,
 *   and lacked the two run rules the server enforces.
 * - W03-5: opening a second link in the same tab kept the first one's error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const validateResetToken = vi.fn();
const confirmPasswordReset = vi.fn();
vi.mock('../services/api', () => ({
  authService: {
    validateResetToken: (...args: unknown[]) => validateResetToken(...args) as unknown,
    confirmPasswordReset: (...args: unknown[]) => confirmPasswordReset(...args) as unknown,
  },
}));

import { ResetPasswordPage } from './ResetPasswordPage';

const tooMany = {
  response: { status: 429, headers: { 'retry-after': '300' }, data: { detail: 'Too many requests.' } },
};

const openLink = (hash = '#token=abc') =>
  render(
    <MemoryRouter initialEntries={[`/reset-password${hash}`]}>
      <ResetPasswordPage />
    </MemoryRouter>
  );

beforeEach(() => {
  validateResetToken.mockReset();
  confirmPasswordReset.mockReset();
  validateResetToken.mockResolvedValue({ valid: true });
});

describe('ResetPasswordPage', () => {
  it('asks the member to wait, not to discard the link, when rate limited on arrival', async () => {
    validateResetToken.mockRejectedValue(tooMany);

    openLink();

    expect(await screen.findByText(/please wait a few minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/wait 5 minutes/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid reset link/i)).not.toBeInTheDocument();
  });

  it('keeps the form and names the wait when rate limited on submit', async () => {
    confirmPasswordReset.mockRejectedValue(tooMany);
    const user = userEvent.setup();
    openLink();

    await user.type(await screen.findByLabelText(/^new password/i), 'Hydrant$Blue947');
    await user.type(screen.getByLabelText(/^confirm new password/i), 'Hydrant$Blue947');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByText(/too many attempts\. wait 5 minutes/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
  });

  it('lists the rules the server enforces, with the real minimum length', async () => {
    const user = userEvent.setup();
    openLink();

    await user.type(await screen.findByLabelText(/^new password/i), 'x');

    expect(screen.getByText('At least 12 characters')).toBeInTheDocument();
    expect(screen.getByText('No runs like 123 or abc')).toBeInTheDocument();
    expect(screen.getByText('No character three times in a row')).toBeInTheDocument();
    expect(screen.queryByText(/at least 8 characters/i)).not.toBeInTheDocument();
  });

  it('refuses a password with a run before sending it', async () => {
    const user = userEvent.setup();
    openLink();

    await user.type(await screen.findByLabelText(/^new password/i), 'Abcdef123!xyz');
    await user.type(screen.getByLabelText(/^confirm new password/i), 'Abcdef123!xyz');
    expect(screen.getByRole('button', { name: /reset password/i })).toBeDisabled();
    expect(confirmPasswordReset).not.toHaveBeenCalled();
  });
});
