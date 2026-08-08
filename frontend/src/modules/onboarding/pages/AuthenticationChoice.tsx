import React, { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Shield, CheckCircle, Info, Key, Mail, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  OnboardingHeader,
  ProgressIndicator,
  BackButton,
  ResetProgressButton,
  ErrorAlert,
  AutoSaveNotification,
} from '../components';
import { useApiRequest } from '../hooks';
import { useOnboardingStore } from '../store';
import { apiClient } from '../services/api-client';

interface AuthPlatform {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  features: string[];
  setupInfo: string;
  recommended?: boolean;
}

const AuthenticationChoice: React.FC = () => {
  const navigate = useNavigate();

  // Zustand store
  const departmentName = useOnboardingStore((state) => state.departmentName);
  const logoPreview = useOnboardingStore((state) => state.logoData);
  const emailPlatform = useOnboardingStore((state) => state.emailPlatform);
  const authPlatform = useOnboardingStore((state) => state.authPlatform);
  const setAuthPlatform = useOnboardingStore((state) => state.setAuthPlatform);
  const lastSaved = useOnboardingStore((state) => state.lastSaved);

  // API request hook
  const { execute, isLoading: isSaving, error, canRetry, clearError } = useApiRequest();

  useEffect(() => {
    if (!departmentName) {
      void navigate('/onboarding/start');
      return;
    }

    // Pre-select authentication based on email platform (only if not already selected)
    if (!authPlatform) {
      if (emailPlatform === 'gmail') {
        setAuthPlatform('google');
      } else if (emailPlatform === 'microsoft') {
        setAuthPlatform('microsoft');
      } else {
        setAuthPlatform('authentik');
      }
    }
  }, [navigate, departmentName, emailPlatform, authPlatform, setAuthPlatform]);

  // Google Icon
  const GoogleIcon = () => (
    <svg className="h-10 w-10" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#FFC107"
        d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
      />
      <path
        fill="#FF3D00"
        d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
      />
      <path
        fill="#1976D2"
        d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
      />
    </svg>
  );

  // Microsoft Icon
  const MicrosoftIcon = () => (
    <svg className="h-10 w-10" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#ff5722" d="M6 6h18v18H6z" />
      <path fill="#4caf50" d="M26 6h18v18H26z" />
      <path fill="#ffc107" d="M6 26h18v18H6z" />
      <path fill="#03a9f4" d="M26 26h18v18H26z" />
    </svg>
  );

  // Authentik Icon
  const AuthentikIcon = () => (
    <svg className="h-10 w-10" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="20" fill="#fd4b2d" />
      <path fill="#fff" d="M24 8l-4 12h8l-4 12 8-12h-6l4-12z" />
    </svg>
  );

  const platforms: AuthPlatform[] = [
    {
      id: 'google',
      name: 'Google OAuth',
      description: 'Sign in with Google accounts',
      icon: <GoogleIcon />,
      color: 'from-blue-500 to-green-500',
      features: [
        'Users sign in with Google accounts',
        'No password management needed',
        'Multi-factor authentication built-in',
        'Seamless for Google Workspace users',
      ],
      setupInfo: "You'll need to create a Google Cloud project and configure OAuth 2.0 credentials.",
      recommended: emailPlatform === 'gmail',
    },
    {
      id: 'microsoft',
      name: 'Microsoft Azure AD',
      description: 'Sign in with Microsoft accounts',
      icon: <MicrosoftIcon />,
      color: 'from-blue-600 to-cyan-400',
      features: [
        'Users sign in with Microsoft accounts',
        'Integration with Active Directory',
        'Enterprise-grade security',
        'Perfect for Microsoft 365 organizations',
      ],
      setupInfo: "You'll need to register an app in Azure Active Directory and configure authentication.",
      recommended: emailPlatform === 'microsoft',
    },
    {
      id: 'authentik',
      name: 'Authentik SSO',
      description: 'Self-hosted authentication platform',
      icon: <AuthentikIcon />,
      color: 'from-orange-600 to-red-500',
      features: [
        'Self-hosted, open-source SSO',
        'Complete control over user data',
        'Support for LDAP, SAML, OAuth',
        'Advanced authentication flows',
      ],
      setupInfo: "You'll need to deploy Authentik on your infrastructure and configure an OAuth2/OIDC provider.",
      recommended: emailPlatform === 'selfhosted' || emailPlatform === 'other',
    },
    {
      id: 'local',
      name: 'Local Passwords',
      description: 'Secure password-based authentication',
      icon: <Lock className="h-10 w-10 text-white" />,
      color: 'from-slate-600 to-slate-800',
      features: [
        'Passwords hashed with Argon2id (military-grade)',
        'Never stored in plain text',
        'Built-in password policies enforced',
        'No external services required',
      ],
      setupInfo:
        'Passwords are securely hashed and stored internally. Admins manage user accounts directly in the system.',
      recommended: false,
    },
  ];

  const currentYear = new Date().getFullYear();

  const handleContinue = async () => {
    if (!authPlatform) return;

    const { data, error: _apiError } = await execute(
      async () => {
        // SECURITY: Save authentication platform to server
        const response = await apiClient.saveAuthPlatform(authPlatform);

        if (response.error) {
          throw new Error(response.error);
        }

        return response;
      },
      {
        step: 'Authentication Choice',
        action: 'Save authentication platform',
        userContext: `Platform: ${authPlatform}`,
      }
    );

    if (data) {
      toast.success('Authentication platform saved');

      // Route to System Owner account creation
      void navigate('/onboarding/system-owner');
    }
  };

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to safe-top flex min-h-screen flex-col bg-linear-to-br">
      <OnboardingHeader
        departmentName={departmentName}
        logoPreview={logoPreview}
        icon={<Mail aria-hidden="true" className="h-6 w-6 text-white" />}
      />

      <main className="flex flex-1 items-center justify-center p-4 py-8">
        <div className="w-full max-w-5xl">
          {/* Navigation Buttons */}
          <div className="mb-6 flex items-center justify-between">
            <BackButton to="/onboarding/file-storage" />
            <ResetProgressButton />
          </div>

          {/* Page Header */}
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-purple-600">
              <Key aria-hidden="true" className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-theme-text-primary mb-3 text-4xl font-bold md:text-5xl">User Authentication</h2>
            <p className="text-theme-text-secondary mb-2 text-xl">How should users sign in to the system?</p>
            <p className="text-theme-text-muted text-sm">Choose your authentication provider</p>
          </div>

          {/* Smart Recommendation Notice */}
          {emailPlatform && (emailPlatform === 'gmail' || emailPlatform === 'microsoft') && (
            <div className="alert-success mx-auto mb-6 max-w-3xl">
              <div className="flex items-start space-x-3">
                <CheckCircle aria-hidden="true" className="text-theme-alert-success-icon mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-theme-alert-success-title mb-1 text-sm font-medium">Smart Recommendation</p>
                  <p className="text-theme-alert-success-text text-sm">
                    Based on your {emailPlatform === 'gmail' ? 'Gmail' : 'Microsoft 365'} setup, we recommend{' '}
                    {emailPlatform === 'gmail' ? 'Google OAuth' : 'Microsoft Azure AD'} for seamless integration with
                    your existing accounts.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Security Notice */}
          <div className="alert-info mx-auto mb-6 max-w-3xl">
            <div className="flex items-start space-x-3">
              <Shield aria-hidden="true" className="text-theme-alert-info-icon mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-theme-alert-info-title mb-1 text-sm font-medium">Enterprise Security</p>
                <p className="text-theme-alert-info-text text-sm">
                  All authentication methods support multi-factor authentication (MFA) and are designed to meet HIPAA
                  security requirements when properly configured.
                </p>
              </div>
            </div>
          </div>

          {/* Platform Cards */}
          <div className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {platforms.map((platform) => (
              <button
                key={platform.id}
                onClick={() => setAuthPlatform(platform.id)}
                className={`bg-theme-surface relative rounded-lg border-2 p-6 text-left backdrop-blur-xs transition-all duration-300 hover:scale-105 ${
                  authPlatform === platform.id
                    ? 'border-theme-accent-red shadow-lg'
                    : 'border-theme-surface-border hover:border-theme-text-muted/40'
                }`}
                aria-pressed={authPlatform === platform.id}
              >
                {/* Recommended Badge */}
                {platform.recommended && (
                  <div className="absolute -top-2 -right-2">
                    <span className="inline-flex items-center rounded-full bg-green-500 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                      <CheckCircle aria-hidden="true" className="mr-1 h-3 w-3" />
                      Recommended
                    </span>
                  </div>
                )}

                {/* Selected Indicator */}
                {authPlatform === platform.id && (
                  <div className="absolute top-4 left-4">
                    <CheckCircle aria-hidden="true" className="text-theme-accent-red h-6 w-6" />
                  </div>
                )}

                <div className={`${authPlatform === platform.id ? 'mt-8' : platform.recommended ? 'mt-6' : ''}`}>
                  {/* Icon */}
                  <div
                    className={`h-16 w-16 shrink-0 rounded-lg bg-linear-to-br ${platform.color} mb-4 flex items-center justify-center`}
                  >
                    {platform.icon}
                  </div>

                  {/* Content */}
                  <div className="mb-4">
                    <h3 className="text-theme-text-primary mb-1 text-xl font-bold">{platform.name}</h3>
                    <p className="text-theme-text-muted mb-3 text-sm">{platform.description}</p>

                    {/* Features */}
                    <ul className="mb-4 space-y-1.5">
                      {platform.features.map((feature, index) => (
                        <li key={index} className="text-theme-text-secondary flex items-start text-xs">
                          <CheckCircle
                            aria-hidden="true"
                            className="text-theme-accent-green mt-0.5 mr-2 h-3.5 w-3.5 shrink-0"
                          />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Setup Info */}
                    <div className="bg-theme-alert-info-bg border-theme-alert-info-border rounded-sm border px-3 py-2">
                      <p className="text-theme-alert-info-text flex items-start text-xs">
                        <Info className="mt-0.5 mr-1 h-3 w-3 shrink-0" />
                        <span>{platform.setupInfo}</span>
                      </p>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Error Alert */}
          {error && (
            <div className="mx-auto mb-6 max-w-md">
              <ErrorAlert message={error} canRetry={canRetry} onRetry={handleContinue} onDismiss={clearError} />
            </div>
          )}

          {/* Continue Button */}
          <div className="mx-auto max-w-md">
            <button
              onClick={() => {
                void handleContinue();
              }}
              disabled={!authPlatform || isSaving}
              className={`w-full rounded-lg px-8 py-4 text-lg font-semibold transition-all duration-300 ${
                authPlatform && !isSaving
                  ? 'transform bg-linear-to-r from-red-600 to-orange-600 text-white shadow-lg hover:scale-105 hover:from-red-700 hover:to-orange-700 hover:shadow-xl'
                  : 'bg-theme-surface text-theme-text-muted cursor-not-allowed'
              }`}
              aria-label="Continue to next step"
            >
              {isSaving ? 'Saving...' : 'Continue'}
            </button>
          </div>

          {/* Progress Indicator */}
          <ProgressIndicator step="authentication" className="border-theme-nav-border mt-6 border-t pt-6" />

          {/* Auto-Save Notification */}
          <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-theme-nav-bg border-theme-nav-border border-t px-6 py-4 backdrop-blur-xs">
        <div className="mx-auto max-w-7xl text-center">
          <p className="text-theme-text-secondary text-sm">
            © {currentYear} {departmentName}. All rights reserved.
          </p>
          <p className="text-theme-text-muted mt-1 text-xs">Powered by The Logbook</p>
        </div>
      </footer>
    </div>
  );
};

export default AuthenticationChoice;
