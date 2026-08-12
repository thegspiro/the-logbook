import React, { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Mail, Server, Cloud, Info } from 'lucide-react';
import {
  OnboardingHeader,
  ProgressIndicator,
  BackButton,
  ResetProgressButton,
  AutoSaveNotification,
  ErrorAlert,
} from '../components';
import { useOnboardingStore } from '../store';
import { useApiRequest } from '../hooks';
import { apiClient } from '../services/api-client';

// Email platform logos (using simple SVG icons)
const GmailIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-10 w-10">
    <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L12 9.545l8.073-6.052C21.69 2.28 24 3.434 24 5.457z" />
  </svg>
);

const MicrosoftIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-10 w-10">
    <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z" />
  </svg>
);

interface EmailPlatform {
  id: 'gmail' | 'microsoft' | 'selfhosted' | 'cloudflare' | 'other';
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  features: string[];
  setupInfo?: string;
}

const EmailPlatformChoice: React.FC = () => {
  const navigate = useNavigate();

  // Zustand store
  const departmentName = useOnboardingStore((state) => state.departmentName);
  const logoPreview = useOnboardingStore((state) => state.logoData);
  const emailPlatform = useOnboardingStore((state) => state.emailPlatform);
  const setEmailPlatform = useOnboardingStore((state) => state.setEmailPlatform);
  const lastSaved = useOnboardingStore((state) => state.lastSaved);
  const { execute, isLoading, error, canRetry, clearError } = useApiRequest();

  useEffect(() => {
    // Redirect to start if no department name
    if (!departmentName) {
      void navigate('/onboarding/start');
    }
  }, [departmentName, navigate]);

  const platforms: EmailPlatform[] = [
    {
      id: 'gmail',
      name: 'Gmail',
      description: 'Google Workspace or Gmail',
      icon: <GmailIcon />,
      color: 'from-red-500 to-yellow-500',
      features: ['OAuth 2.0 authentication', 'Easy integration', 'Calendar sync available'],
      setupInfo: "You'll need a Google Workspace admin account or app password.",
    },
    {
      id: 'microsoft',
      name: 'Microsoft 365',
      description: 'Outlook, Exchange, or Microsoft 365',
      icon: <MicrosoftIcon />,
      color: 'from-blue-500 to-cyan-500',
      features: ['Azure AD integration', 'Exchange support', 'Teams integration'],
      setupInfo: "You'll need your Microsoft 365 tenant information.",
    },
    {
      id: 'selfhosted',
      name: 'Self-Hosted',
      description: 'Your own mail server (SMTP)',
      icon: <Server aria-hidden="true" className="h-10 w-10" />,
      color: 'from-green-500 to-emerald-500',
      features: ['Full control', 'SMTP/IMAP support', 'Custom configuration'],
      setupInfo: "You'll need SMTP server details (host, port, credentials).",
    },
    {
      id: 'cloudflare',
      name: 'Cloudflare',
      description: 'Cloudflare Email Service (REST API)',
      icon: <Cloud aria-hidden="true" className="h-10 w-10" />,
      color: 'from-orange-500 to-amber-500',
      features: ['REST API — no SMTP server needed', 'Automatic SPF/DKIM/DMARC', '$0.35 per 1,000 emails'],
      setupInfo: "You'll need your Cloudflare Account ID and an API token with email sending permission.",
    },
    {
      id: 'other',
      name: 'Other / Skip',
      description: 'Different provider or configure later',
      icon: <Mail aria-hidden="true" className="h-10 w-10" />,
      color: 'from-slate-500 to-slate-600',
      features: ['Configure manually', 'Skip for now', 'Set up later in settings'],
      setupInfo: 'You can configure email settings after setup is complete.',
    },
  ];

  const handleContinue = async () => {
    if (!emailPlatform) return;

    // Navigate to next step based on selection
    if (emailPlatform === 'other') {
      // Persist an explicit "configure later" outcome. Previously this route
      // skipped the API entirely, leaving the server unable to distinguish a
      // deliberate choice from an abandoned email step.
      const { data } = await execute(
        async () => {
          const response = await apiClient.saveEmailConfig({ platform: 'other', config: {} });
          if (response.error) throw new Error(response.error);
          return response;
        },
        { step: 'Email Platform Choice', action: 'Skip email configuration' }
      );
      if (data) void navigate('/onboarding/file-storage');
    } else {
      // Go to email configuration page
      void navigate('/onboarding/email-config');
    }
  };

  const currentYear = new Date().getFullYear();
  const selectedPlatformData = platforms.find((p) => p.id === emailPlatform);

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to safe-top flex min-h-screen flex-col bg-linear-to-br">
      <OnboardingHeader
        departmentName={departmentName}
        logoPreview={logoPreview}
        icon={<Mail aria-hidden="true" className="h-6 w-6 text-white" />}
      />

      {/* Main Content */}
      <main className="flex flex-1 items-center justify-center p-4 py-8">
        <div className="w-full max-w-5xl">
          {/* Navigation Buttons */}
          <div className="mb-6 flex items-center justify-between">
            <BackButton to="/onboarding/navigation-choice" />
            <ResetProgressButton />
          </div>

          {/* Page Header */}
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-600">
              <Mail aria-hidden="true" className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-theme-text-primary mb-3 text-4xl font-bold md:text-5xl">Email Platform</h2>
            <p className="text-theme-text-secondary mb-2 text-xl">Which email service does your department use?</p>
            <p className="text-theme-text-muted text-sm">This helps us send notifications and alerts to your team</p>
          </div>

          {/* Email Platform Options */}
          <div className="mb-8 grid gap-6 md:grid-cols-2">
            {platforms.map((platform) => (
              <button
                key={platform.id}
                onClick={() => setEmailPlatform(platform.id)}
                className={`group bg-theme-surface relative rounded-lg border-2 text-left backdrop-blur-xs transition-all duration-300 ${
                  emailPlatform === platform.id
                    ? 'border-theme-accent-red shadow-lg'
                    : 'border-theme-surface-border hover:border-theme-accent-red'
                }`}
                aria-pressed={emailPlatform === platform.id}
                aria-label={`Select ${platform.name}`}
              >
                <div className="p-6">
                  {/* Icon and Title */}
                  <div className="mb-4 flex items-start space-x-4">
                    <div
                      className={`flex h-16 w-16 items-center justify-center rounded-lg transition-all ${
                        emailPlatform === platform.id
                          ? `bg-linear-to-br ${platform.color} text-white`
                          : 'bg-theme-surface text-theme-text-muted group-hover:bg-theme-surface-hover'
                      }`}
                    >
                      {platform.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-theme-text-primary mb-1 text-2xl font-bold">{platform.name}</h3>
                      <p className="text-theme-text-secondary text-sm">{platform.description}</p>
                    </div>
                  </div>

                  {/* Features */}
                  <ul className="text-theme-text-secondary mb-4 space-y-2 text-sm">
                    {platform.features.map((feature, index) => (
                      <li key={index} className="flex items-start">
                        <span className="text-theme-accent-green mr-2 shrink-0">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Setup Info */}
                  {platform.setupInfo && (
                    <div className="bg-theme-surface-secondary border-theme-input-border rounded-lg border p-3">
                      <div className="flex items-start space-x-2">
                        <Info aria-hidden="true" className="text-theme-accent-blue mt-0.5 h-4 w-4 shrink-0" />
                        <p className="text-theme-text-muted text-xs">{platform.setupInfo}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Selected indicator */}
                {emailPlatform === platform.id && (
                  <div className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-red-600">
                    <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Info Box */}
          {selectedPlatformData && selectedPlatformData.id !== 'other' && (
            <div className="alert-info mb-8">
              <div className="flex items-start space-x-3">
                <Info aria-hidden="true" className="text-theme-alert-info-icon mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-theme-alert-info-title mb-1 text-sm font-medium">Next Step</p>
                  <p className="text-theme-alert-info-text text-sm">
                    After clicking Continue, you'll enter your {selectedPlatformData.name} connection details. Don't
                    worry, we'll guide you through the process step by step.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Continue Button */}
          <div className="mx-auto max-w-md">
            {error && (
              <div className="mb-4">
                <ErrorAlert
                  message={error}
                  canRetry={canRetry}
                  onRetry={() => void handleContinue()}
                  onDismiss={clearError}
                />
              </div>
            )}
            <button
              onClick={() => void handleContinue()}
              disabled={!emailPlatform || isLoading}
              className={`w-full rounded-lg px-8 py-4 text-lg font-semibold transition-all duration-300 ${
                emailPlatform && !isLoading
                  ? 'transform bg-linear-to-r from-red-600 to-orange-600 text-white shadow-lg hover:scale-105 hover:from-red-700 hover:to-orange-700 hover:shadow-xl'
                  : 'bg-theme-surface text-theme-text-muted cursor-not-allowed'
              }`}
              aria-label="Continue to next step"
            >
              {isLoading ? 'Saving...' : 'Continue'}
            </button>

            {/* Help Text */}
            <p className="text-theme-text-muted mt-4 text-center text-sm">
              {emailPlatform === 'other'
                ? 'You can configure email settings later in the admin panel'
                : 'Your email credentials are encrypted and stored securely'}
            </p>
          </div>

          {/* Progress Indicator */}
          <ProgressIndicator step="email_platform" className="border-theme-nav-border mt-6 border-t pt-6" />

          {/* Auto-Save Notification */}
          <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
        </div>
      </main>

      {/* Footer with Department Name and Copyright */}
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

export default EmailPlatformChoice;
