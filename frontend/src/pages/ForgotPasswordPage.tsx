/**
 * Forgot Password Page
 *
 * Allows users to request a password reset link via email.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Mail, CheckCircle } from 'lucide-react';
import { authService } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';

/** Cooldown between successive reset requests (in seconds). */
const RESET_COOLDOWN_SECONDS = 60;

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1));
    }, 1_000);
    return () => clearInterval(id);
  }, [cooldown]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (cooldown > 0) return;

      setIsLoading(true);

      try {
        await authService.requestPasswordReset({ email });
        setSuccess(true);
        setCooldown(RESET_COOLDOWN_SECONDS);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Failed to send reset email. Please try again or contact your administrator.'));
        setCooldown(RESET_COOLDOWN_SECONDS);
      } finally {
        setIsLoading(false);
      }
    },
    [email, cooldown]
  );

  if (success) {
    return (
      <main className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          <div className="card p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
              <CheckCircle className="h-10 w-10 text-green-700 dark:text-green-400" aria-hidden="true" />
            </div>
            <h2 className="text-theme-text-primary mb-4 text-2xl font-bold">Check Your Email</h2>
            <p className="text-theme-text-secondary mb-6">
              If an account exists with the email <strong className="text-theme-text-primary">{email}</strong>, you will
              receive a password reset link shortly.
            </p>
            <p className="text-theme-text-muted mb-6 text-sm">
              The link will expire in 1 hour. If you don't see the email, check your spam folder.
            </p>
            <Link
              to="/login"
              className="focus:ring-theme-focus-ring inline-flex items-center space-x-2 rounded-sm px-3 py-2 font-medium text-red-700 transition-colors hover:text-red-700 focus:ring-2 focus:outline-hidden dark:text-red-400 dark:hover:text-red-300"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Login</span>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-theme-text-primary mb-2 text-3xl font-extrabold">Forgot Your Password?</h1>
          <p className="text-theme-text-secondary">
            Enter your email address and we'll send you a link to reset your password
          </p>
        </div>

        <div className="card p-8">
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="space-y-6"
          >
            {error && (
              <div
                className="bg-theme-alert-danger-bg border-theme-alert-danger-border rounded-md border p-4"
                role="alert"
                aria-live="polite"
              >
                <div className="flex">
                  <div className="shrink-0">
                    <svg
                      className="text-theme-alert-danger-icon h-5 w-5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-theme-alert-danger-text text-sm font-medium">{error}</p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="email" className="text-theme-text-primary mb-2 block text-sm font-medium">
                Email Address
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Mail className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="border-theme-surface-border bg-theme-surface-secondary text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border py-2 pr-3 pl-10 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading || cooldown > 0}
                className="btn-primary flex w-full justify-center rounded-md text-sm font-medium disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <svg
                      className="text-theme-text-primary mr-3 -ml-1 h-5 w-5 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Sending Reset Link...
                  </>
                ) : cooldown > 0 ? (
                  `Wait ${cooldown}s`
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="text-theme-text-secondary hover:text-theme-text-primary focus:ring-theme-focus-ring inline-flex items-center space-x-2 rounded-sm px-3 py-2 text-sm transition-colors focus:ring-2 focus:outline-hidden"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Login</span>
            </Link>
          </div>
        </div>

        <div className="bg-theme-alert-info-bg border-theme-alert-info-border mt-6 rounded-lg border p-4">
          <div className="flex items-start space-x-3">
            <svg
              className="text-theme-alert-info-icon mt-0.5 h-5 w-5 shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <h4 className="text-theme-alert-info-title mb-1 text-sm font-medium">Security Note</h4>
              <p className="text-theme-alert-info-text text-sm">
                For security reasons, we don't reveal whether an email exists in our system. You'll receive an email
                only if the account exists.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export default ForgotPasswordPage;
