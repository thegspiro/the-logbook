import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import axios from 'axios';

// OAuth configuration - these would be loaded from organization settings
interface OAuthConfig {
  googleEnabled: boolean;
  microsoftEnabled: boolean;
}

interface OrgBranding {
  name: string | null;
  logo: string | null;
}

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoading, isAuthenticated, error, clearError } = useAuthStore();

  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [branding, setBranding] = useState<OrgBranding>({ name: null, logo: null });
  const [oauthConfig, setOAuthConfig] = useState<OAuthConfig>({
    googleEnabled: false,
    microsoftEnabled: false,
  });

  // If user is already authenticated, redirect to dashboard
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Load branding and OAuth configuration on mount
  useEffect(() => {
    // Clear any previous errors when component mounts
    clearError();

    // Load organization branding (logo + name) for the login page
    const loadBranding = async () => {
      try {
        const response = await axios.get('/api/v1/auth/branding');
        setBranding(response.data);
      } catch (err) {
        // Branding is optional - login page works fine without it
      }
    };

    const loadOAuthConfig = async () => {
      try {
        const response = await axios.get('/api/v1/auth/oauth-config');
        setOAuthConfig(response.data);
      } catch {
        // OAuth config is optional - leave defaults (disabled)
      }
    };

    loadBranding();
    loadOAuthConfig();
  }, [clearError]);

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.username.trim()) {
      errors.username = 'Username or email is required';
    }

    if (!formData.password) {
      errors.password = 'Password is required';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      await login({
        username: formData.username,
        password: formData.password,
      });
      // Redirect to the page the user was trying to access (saved by
      // ProtectedRoute), or default to /dashboard.
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard';
      navigate(from, { replace: true });
    } catch (err) {
      // Error is handled by the store and displayed via error state
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    // Clear error for this field when user starts typing
    if (formErrors[name]) {
      setFormErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const handleGoogleLogin = () => {
    // Redirect to Google OAuth endpoint
    window.location.href = '/api/v1/auth/oauth/google';
  };

  const handleMicrosoftLogin = () => {
    // Redirect to Microsoft OAuth endpoint
    window.location.href = '/api/v1/auth/oauth/microsoft';
  };

  const hasOAuthEnabled = oauthConfig.googleEnabled || oauthConfig.microsoftEnabled;

  return (
    <main className="relative min-h-screen flex items-center justify-center bg-theme-surface-secondary py-12 px-4 sm:px-6 lg:px-8 pb-24" id="main-content">
      <div className="max-w-md w-full space-y-8">
        <div>
          {branding.logo ? (
            <div className="flex justify-center">
              <img
                src={branding.logo}
                alt={branding.name ? `${branding.name} logo` : 'Organization logo'}
                className="h-24 w-24 rounded-lg object-cover shadow-md"
              />
            </div>
          ) : (
            <div className="flex justify-center">
              <div className="h-24 w-24 rounded-lg bg-red-600 flex items-center justify-center shadow-md">
                <svg className="h-12 w-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" />
                </svg>
              </div>
            </div>
          )}
          <h1 className="mt-4 text-center text-3xl font-extrabold text-theme-text-primary">
            {branding.name ? `Sign in to ${branding.name}` : 'Sign in to your account'}
          </h1>
          <p className="mt-2 text-center text-sm text-theme-text-secondary">
            Access The Logbook platform
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit} aria-label="Sign in form">
          {(location.state as { reason?: string })?.reason === 'timeout' && (
            <div className="rounded-md bg-yellow-50 border border-yellow-200 p-4" role="alert" aria-live="polite">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-yellow-700 dark:text-yellow-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-yellow-800">
                    Your session has expired due to inactivity. Please sign in again.
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 p-4" role="alert" aria-live="polite">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-700 dark:text-red-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-red-800">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="username" className="sr-only">
                Username or Email
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                aria-invalid={formErrors.username ? 'true' : 'false'}
                aria-describedby={formErrors.username ? 'username-error' : undefined}
                className={`appearance-none rounded-none relative block w-full px-3 py-2 border ${
                  formErrors.username ? 'border-red-300' : 'border-theme-input-border'
                } placeholder-theme-text-muted text-theme-text-primary rounded-t-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm`}
                placeholder="Username or Email"
                value={formData.username}
                onChange={handleChange}
                disabled={isLoading}
              />
              {formErrors.username && (
                <p id="username-error" className="mt-1 text-sm text-red-600" role="alert">{formErrors.username}</p>
              )}
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                aria-invalid={formErrors.password ? 'true' : 'false'}
                aria-describedby={formErrors.password ? 'password-error' : undefined}
                className={`appearance-none rounded-none relative block w-full px-3 py-2 border ${
                  formErrors.password ? 'border-red-300' : 'border-theme-input-border'
                } placeholder-theme-text-muted text-theme-text-primary rounded-b-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm`}
                placeholder="Password"
                value={formData.password}
                onChange={handleChange}
                disabled={isLoading}
              />
              {formErrors.password && (
                <p id="password-error" className="mt-1 text-sm text-red-600" role="alert">{formErrors.password}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end">
            <div className="text-sm">
              <a href="/forgot-password" className="font-medium text-indigo-600 hover:text-indigo-700 dark:hover:text-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded px-1">
                Forgot your password?
              </a>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-theme-text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </div>

          {/* OAuth login options */}
          {hasOAuthEnabled && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-theme-input-border" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-theme-surface-secondary text-theme-text-muted">Or continue with</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {oauthConfig.googleEnabled && (
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isLoading}
                    className="w-full inline-flex justify-center py-2 px-4 border border-theme-surface-border rounded-md shadow-sm bg-theme-surface text-sm font-medium text-theme-text-muted hover:bg-theme-surface-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    <span className="ml-2">Google</span>
                  </button>
                )}

                {oauthConfig.microsoftEnabled && (
                  <button
                    type="button"
                    onClick={handleMicrosoftLogin}
                    disabled={isLoading}
                    className="w-full inline-flex justify-center py-2 px-4 border border-theme-surface-border rounded-md shadow-sm bg-theme-surface text-sm font-medium text-theme-text-muted hover:bg-theme-surface-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11.4 24H0V12.6h11.4V24z" fill="#F1511B"/>
                      <path d="M24 24H12.6V12.6H24V24z" fill="#80CC28"/>
                      <path d="M11.4 11.4H0V0h11.4v11.4z" fill="#00ADEF"/>
                      <path d="M24 11.4H12.6V0H24v11.4z" fill="#FBBC09"/>
                    </svg>
                    <span className="ml-2">Microsoft</span>
                  </button>
                )}
              </div>
            </>
          )}

          <div className="text-center mt-4">
            <p className="text-sm text-theme-text-secondary">
              Need an account? Contact your department administrator.
            </p>
          </div>
        </form>
      </div>

      <footer className="absolute bottom-0 left-0 right-0 py-4 text-center">
        <p className="text-theme-text-muted text-sm">
          &copy; {new Date().getFullYear()} {branding.name || 'Your Organization'}. All rights reserved.
        </p>
        <p className="text-theme-text-muted text-xs mt-1">Powered by The Logbook</p>
      </footer>
    </main>
  );
};
