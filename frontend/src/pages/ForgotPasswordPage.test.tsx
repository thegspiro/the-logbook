/**
 * The forgot-password confirmation says what the server said.
 *
 * It used to discard the response and always show "Check Your Email" with
 * "The link will expire in 1 hour": the link lasts 30 minutes, and when the
 * department signs in through Google or Microsoft the server sends no link at
 * all and says so (workflow review W03-1, W03-2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const requestPasswordReset = vi.fn();
vi.mock('../services/api', () => ({
  authService: { requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args) as unknown },
}));
vi.mock('../hooks/useCaptcha', () => ({
  useCaptcha: () => ({
    required: false,
    ready: true,
    error: null,
    containerRef: { current: null },
    getToken: vi.fn(),
    reset: vi.fn(),
  }),
}));

import { ForgotPasswordPage } from './ForgotPasswordPage';

const submit = async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>
  );
  await user.type(screen.getByLabelText(/email address/i), 'member@example.org');
  await user.click(screen.getByRole('button', { name: /send reset link/i }));
};

beforeEach(() => {
  requestPasswordReset.mockReset();
});

describe('ForgotPasswordPage', () => {
  it('states the expiry the server reports', async () => {
    requestPasswordReset.mockResolvedValue({ message: 'If an account…', expires_in_minutes: 30 });

    await submit();

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.getByText(/the link will expire in 30 minutes/i)).toBeInTheDocument();
    expect(screen.queryByText(/1 hour/i)).not.toBeInTheDocument();
  });

  it('says nothing about an expiry the server did not report', async () => {
    requestPasswordReset.mockResolvedValue({ message: 'If an account…' });

    await submit();

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.queryByText(/will expire/i)).not.toBeInTheDocument();
  });

  it('does not claim an email is coming when the department uses an outside sign-in', async () => {
    requestPasswordReset.mockResolvedValue({
      message: 'This organization uses Google for authentication. Please reset your password through Google.',
      auth_provider: 'google',
    });

    await submit();

    expect(await screen.findByText(/no reset link was sent/i)).toBeInTheDocument();
    expect(screen.getByText(/reset your password through google/i)).toBeInTheDocument();
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument();
  });
});
