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
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { StrictMode } from 'react';

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

    expect(await screen.findByRole('heading', { name: /too many attempts/i })).toBeInTheDocument();
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

  // W03-10: the met/unmet state was an icon marked aria-hidden, so a screen
  // reader read seven identical lines and never said which rule failed.
  it('says which rules are met in text, not only by icon', async () => {
    const user = userEvent.setup();
    openLink();

    await user.type(await screen.findByLabelText(/^new password/i), 'Abcdef123!xyz');

    const rule = (name: string) => screen.getAllByRole('listitem').find((li) => li.textContent?.endsWith(name));
    expect(rule('At least 12 characters')).toHaveTextContent('Met: At least 12 characters');
    expect(rule('No runs like 123 or abc')).toHaveTextContent('Not met: No runs like 123 or abc');
  });

  // W03-11: two checks of the link could overlap (React re-runs the effect, or
  // a second link opens before the first answer arrives) and the stale answer,
  // arriving last, overwrote the current one. Driven: a used link showed
  // "Too Many Attempts" beside a later 400 for that same link.
  it('ignores the answer to a check it has already replaced', async () => {
    let answerStale: (value: unknown) => void = () => undefined;
    validateResetToken
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            answerStale = reject;
          })
      )
      .mockResolvedValue({ valid: true });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/reset-password#token=abc']}>
          <ResetPasswordPage />
        </MemoryRouter>
      </StrictMode>
    );
    expect(await screen.findByLabelText(/^new password/i)).toBeInTheDocument();

    await act(async () => {
      answerStale(tooMany);
      await Promise.resolve();
    });

    expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /too many attempts/i })).not.toBeInTheDocument();
  });

  // W03-12: at 390px the invalid-link screen's "Back to sign in" was 40px tall.
  it('gives "Back to sign in" a touch-size target on every screen', async () => {
    validateResetToken.mockReset().mockRejectedValue({ response: { status: 400, data: { detail: 'Invalid' } } });
    openLink();
    expect(await screen.findByRole('link', { name: /back to sign in/i })).toHaveClass('touch:min-h-11');
  });

  it('gives the form screen\'s "Back to sign in" a touch-size target', async () => {
    openLink();
    await screen.findByLabelText(/^new password/i);
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveClass('touch:min-h-11');
  });

  it('gives the rate-limited screen\'s "Back to sign in" a touch-size target', async () => {
    validateResetToken.mockReset().mockRejectedValue(tooMany);
    openLink();
    await screen.findByRole('heading', { name: /too many attempts/i });
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveClass('touch:min-h-11');
  });
});
