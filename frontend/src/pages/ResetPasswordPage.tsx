/**
 * Reset Password Page
 *
 * Allows users to set a new password using a reset token from email.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { ArrowLeft, CheckCircle, Lock, Eye, EyeOff } from 'lucide-react';
import { authService } from '../services/api';
import { validatePasswordStrength } from '../utils/passwordValidation';
import { getErrorMessage } from '../utils/errorHandling';

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Read token from URL fragment (#token=...) so it's never sent to the
  // server in Referer headers or logged in access logs.
  const token = useMemo(() => {
    const hash = location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    return params.get('token');
  }, [location.hash]);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [tokenValid, setTokenValid] = useState(false);

  // Validate token on mount
  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setError('Invalid or missing reset token');
        setIsValidating(false);
        return;
      }

      try {
        const result = await authService.validateResetToken(token);
        if (result.valid) {
          setTokenValid(true);
        } else {
          setError('This password reset link is invalid or has expired');
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'This password reset link is invalid or has expired'));
      } finally {
        setIsValidating(false);
      }
    };

    void validateToken();
  }, [token]);

  const passwordValidation = validatePasswordStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Validate password strength
    if (!passwordValidation.isValid) {
      setError('Please ensure your password meets all the requirements');
      return;
    }

    if (!token) {
      setError('Invalid reset token');
      return;
    }

    setIsLoading(true);

    try {
      await authService.confirmPasswordReset({
        token,
        new_password: password,
      });
      setSuccess(true);
      // Redirect to login after 3 seconds
      setTimeout(() => {
        void navigate('/login');
      }, 3000);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to reset password. Please try again or request a new reset link.'));
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <main className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br px-4 py-12 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-t-4 border-b-4 border-red-500"></div>
          <p className="text-theme-text-primary text-lg">Validating reset link...</p>
        </div>
      </main>
    );
  }

  if (!tokenValid) {
    return (
      <main className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          <div className="card p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20">
              <svg
                className="h-10 w-10 text-red-700 dark:text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-theme-text-primary mb-4 text-2xl font-bold">Invalid Reset Link</h2>
            <p className="text-theme-text-secondary mb-6">{error}</p>
            <div className="space-y-3">
              <Link to="/forgot-password" className="btn-primary block w-full rounded-md text-sm font-medium">
                Request New Reset Link
              </Link>
              <Link
                to="/login"
                className="text-theme-text-secondary hover:text-theme-text-primary focus:ring-theme-focus-ring block rounded-sm px-3 py-2 transition-colors focus:ring-2 focus:outline-hidden"
              >
                Back to Login
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (success) {
    return (
      <main className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          <div className="card p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
              <CheckCircle className="h-10 w-10 text-green-700 dark:text-green-400" aria-hidden="true" />
            </div>
            <h2 className="text-theme-text-primary mb-4 text-2xl font-bold">Password Reset Successful!</h2>
            <p className="text-theme-text-secondary mb-4">
              Your password has been successfully reset. You can now log in with your new password.
            </p>
            <p className="text-theme-text-muted mb-6 text-sm">Redirecting to login page...</p>
            <Link
              to="/login"
              className="focus:ring-theme-focus-ring inline-flex items-center space-x-2 rounded-sm px-3 py-2 font-medium text-red-700 transition-colors hover:text-red-700 focus:ring-2 focus:outline-hidden dark:text-red-400 dark:hover:text-red-300"
            >
              <span>Go to Login Now</span>
              <ArrowLeft className="h-4 w-4 rotate-180" aria-hidden="true" />
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
          <h1 className="text-theme-text-primary mb-2 text-3xl font-extrabold">Set New Password</h1>
          <p className="text-theme-text-secondary">Choose a strong, unique password</p>
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
              <label htmlFor="password" className="text-theme-text-primary mb-2 block text-sm font-medium">
                New Password
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  className="border-theme-surface-border bg-theme-surface-secondary text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border py-2 pr-10 pl-10 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                  placeholder="Enter new password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-theme-text-muted hover:text-theme-text-primary absolute inset-y-0 right-0 flex items-center pr-3 focus:outline-hidden focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-red-500"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-5 w-5" aria-hidden="true" />
                  )}
                </button>
              </div>

              {/* Password strength indicator */}
              {password && (
                <div className="mt-3 space-y-2">
                  <p className="text-theme-text-secondary text-xs font-medium">Password must contain:</p>
                  <ul className="space-y-1 text-xs">
                    {[
                      { label: 'At least 8 characters', valid: passwordValidation.checks.length },
                      { label: 'One uppercase letter', valid: passwordValidation.checks.uppercase },
                      { label: 'One lowercase letter', valid: passwordValidation.checks.lowercase },
                      { label: 'One number', valid: passwordValidation.checks.number },
                      { label: 'One special character', valid: passwordValidation.checks.special },
                    ].map((check, idx) => (
                      <li key={idx} className="flex items-center space-x-2">
                        {check.valid ? (
                          <CheckCircle
                            className="h-4 w-4 shrink-0 text-green-700 dark:text-green-400"
                            aria-hidden="true"
                          />
                        ) : (
                          <div
                            className="border-theme-input-border h-4 w-4 shrink-0 rounded-full border-2"
                            aria-hidden="true"
                          />
                        )}
                        <span className={check.valid ? 'text-green-700 dark:text-green-300' : 'text-theme-text-muted'}>
                          {check.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="text-theme-text-primary mb-2 block text-sm font-medium">
                Confirm New Password
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                </div>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  className="border-theme-surface-border bg-theme-surface-secondary text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border py-2 pr-10 pl-10 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="text-theme-text-muted hover:text-theme-text-primary absolute inset-y-0 right-0 flex items-center pr-3 focus:outline-hidden focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-red-500"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-5 w-5" aria-hidden="true" />
                  )}
                </button>
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="mt-2 text-sm text-red-700 dark:text-red-300">Passwords do not match</p>
              )}
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading || !passwordValidation.isValid || password !== confirmPassword}
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
                    Resetting Password...
                  </>
                ) : (
                  'Reset Password'
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
      </div>
    </main>
  );
};

export default ResetPasswordPage;
