/**
 * Reset Password Page
 *
 * Allows users to set a new password using a reset token from email.
 */

import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Lock, Eye, EyeOff } from 'lucide-react';
import { authService } from '../services/api';
import { validatePasswordStrength } from '../utils/passwordValidation';
import { getErrorMessage } from '../utils/errorHandling';

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [tokenValid, setTokenValid] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');

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
          setUserEmail(result.email || '');
        } else {
          setError('This password reset link is invalid or has expired');
        }
      } catch (err: unknown) {
        setError(
          getErrorMessage(err, 'This password reset link is invalid or has expired')
        );
      } finally {
        setIsValidating(false);
      }
    };

    validateToken();
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
        navigate('/login');
      }, 3000);
    } catch (err: unknown) {
      setError(
        getErrorMessage(err, 'Failed to reset password. Please try again or request a new reset link.')
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-red-500 mb-4"></div>
          <p className="text-theme-text-primary text-lg">Validating reset link...</p>
        </div>
      </main>
    );
  }

  if (!tokenValid) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full">
          <div className="bg-theme-surface backdrop-blur-sm border border-theme-surface-border rounded-lg p-8 text-center">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-500/20 mb-4">
              <svg className="h-10 w-10 text-red-700 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-theme-text-primary mb-4">Invalid Reset Link</h2>
            <p className="text-theme-text-secondary mb-6">{error}</p>
            <div className="space-y-3">
              <Link
                to="/forgot-password"
                className="block w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
              >
                Request New Reset Link
              </Link>
              <Link
                to="/login"
                className="block text-theme-text-secondary hover:text-theme-text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-3 py-2"
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
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full">
          <div className="bg-theme-surface backdrop-blur-sm border border-theme-surface-border rounded-lg p-8 text-center">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-500/20 mb-4">
              <CheckCircle className="h-10 w-10 text-green-700 dark:text-green-400" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-bold text-theme-text-primary mb-4">Password Reset Successful!</h2>
            <p className="text-theme-text-secondary mb-4">
              Your password has been successfully reset. You can now log in with your new password.
            </p>
            <p className="text-sm text-theme-text-muted mb-6">
              Redirecting to login page...
            </p>
            <Link
              to="/login"
              className="inline-flex items-center space-x-2 text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-3 py-2"
            >
              <span>Go to Login Now</span>
              <ArrowLeft className="w-4 h-4 rotate-180" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-theme-text-primary mb-2">
            Set New Password
          </h1>
          {userEmail && (
            <p className="text-theme-text-secondary">
              for <strong className="text-theme-text-primary">{userEmail}</strong>
            </p>
          )}
        </div>

        <div className="bg-theme-surface backdrop-blur-sm border border-theme-surface-border rounded-lg p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="rounded-md bg-red-500/20 border border-red-500/50 p-4" role="alert" aria-live="polite">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-700 dark:text-red-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-red-200">{error}</p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-theme-text-primary mb-2">
                New Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-theme-text-muted" aria-hidden="true" />
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  className="block w-full pl-10 pr-10 py-2 border border-theme-surface-border rounded-md bg-theme-surface-secondary text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                  placeholder="Enter new password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-theme-text-muted hover:text-theme-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:rounded"
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
                  <p className="text-xs text-theme-text-secondary font-medium">Password must contain:</p>
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
                          <CheckCircle className="w-4 h-4 text-green-700 dark:text-green-400 flex-shrink-0" aria-hidden="true" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border-2 border-theme-input-border flex-shrink-0" aria-hidden="true" />
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
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-theme-text-primary mb-2">
                Confirm New Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-theme-text-muted" aria-hidden="true" />
                </div>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  className="block w-full pl-10 pr-10 py-2 border border-theme-surface-border rounded-md bg-theme-surface-secondary text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-theme-text-muted hover:text-theme-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:rounded"
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
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-theme-text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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
              className="inline-flex items-center space-x-2 text-sm text-theme-text-secondary hover:text-theme-text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-3 py-2"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Back to Login</span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
};

export default ResetPasswordPage;
