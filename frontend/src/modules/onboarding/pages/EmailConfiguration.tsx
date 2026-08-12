import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Mail, Check, AlertCircle, Loader } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api-client';
import { isValidPort, isValidEmail } from '../utils/validation';
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
import { getErrorMessage } from '@/utils/errorHandling';

interface EmailConfig {
  // Cloudflare Email Service
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;

  // Gmail/Google Workspace
  googleClientId?: string;
  googleClientSecret?: string;
  googleAppPassword?: string;

  // Microsoft 365
  microsoftTenantId?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;

  // Self-hosted SMTP
  smtpHost?: string;
  smtpPort?: string;
  smtpUsername?: string;
  smtpPassword?: string;
  smtpEncryption?: 'none' | 'tls' | 'ssl';

  // Common
  fromEmail?: string;
  fromName?: string;
}

const EmailConfiguration: React.FC = () => {
  const navigate = useNavigate();

  // Zustand store
  const departmentName = useOnboardingStore((state) => state.departmentName);
  const logoPreview = useOnboardingStore((state) => state.logoData);
  const emailPlatform = useOnboardingStore((state) => state.emailPlatform);
  const lastSaved = useOnboardingStore((state) => state.lastSaved);

  // Local state for email configuration
  const [config, setConfig] = useState<EmailConfig>({
    smtpEncryption: 'tls',
    smtpPort: '587',
    fromName: departmentName,
  });
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTested, setConnectionTested] = useState(false);
  const [useOAuth, setUseOAuth] = useState(true);

  // API request hooks - separate instances for test and save
  const {
    execute: executeSave,
    isLoading: isSaving,
    error: saveError,
    canRetry: canRetrySave,
    clearError: clearSaveError,
  } = useApiRequest();

  useEffect(() => {
    // Redirect if missing data or they chose to skip
    if (!departmentName || !emailPlatform || emailPlatform === 'other') {
      void navigate('/onboarding/start');
      return;
    }

    // Set default from name if not already set
    if (!config.fromName) {
      setConfig((prev) => ({
        ...prev,
        fromName: departmentName,
      }));
    }
  }, [departmentName, emailPlatform, navigate, config.fromName]);

  const handleInputChange = (field: keyof EmailConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setConnectionTested(false); // Reset test status when config changes
  };

  const handleTestConnection = async () => {
    // Validate required fields before testing
    if (!config.fromEmail) {
      toast.error('Please enter a from email address');
      return;
    }

    if (!isValidEmail(config.fromEmail)) {
      toast.error('Please enter a valid email address');
      return;
    }

    if (emailPlatform === 'cloudflare') {
      const missingFields = [];
      if (!config.cloudflareAccountId) missingFields.push('Account ID');
      if (!config.cloudflareApiToken) missingFields.push('API Token');
      if (missingFields.length > 0) {
        toast.error(`Missing required Cloudflare fields: ${missingFields.join(', ')}`);
        return;
      }
    }

    if (emailPlatform === 'selfhosted') {
      // Check for missing SMTP fields and list them
      const missingFields = [];
      if (!config.smtpHost) missingFields.push('Server Address');
      if (!config.smtpPort) missingFields.push('Port');
      if (!config.smtpUsername) missingFields.push('Username');
      if (!config.smtpPassword) missingFields.push('Password');

      if (missingFields.length > 0) {
        toast.error(`Missing required SMTP fields: ${missingFields.join(', ')}`);
        return;
      }

      const portNumber = parseInt(config.smtpPort || '0', 10);
      if (!isValidPort(portNumber)) {
        toast.error('Please enter a valid port number (1-65535)');
        return;
      }
    }

    if (emailPlatform === 'gmail' && !useOAuth && !config.googleAppPassword) {
      toast.error('Please enter your Google App Password');
      return;
    }

    setTestingConnection(true);
    setConnectionTested(false);

    try {
      // Test email connection with real API call
      const response = await apiClient.testEmailConnection({
        platform: emailPlatform || 'other',
        config: {
          ...config,
          authMethod: useOAuth ? 'oauth' : 'smtp',
        },
      });

      setTestingConnection(false);

      if (response.error) {
        toast.error(`Connection test failed: ${response.error}`);
        return;
      }

      if (response.data?.success) {
        setConnectionTested(true);
        toast.success(response.data.message || 'Email connection test successful!');
      } else {
        toast.error(response.data?.message || 'Connection test failed');
      }
    } catch (err: unknown) {
      setTestingConnection(false);
      const errorMessage = getErrorMessage(err, 'Failed to test email connection');
      toast.error(errorMessage);
    }
  };

  const handleContinue = async () => {
    // Validate required fields
    if (!config.fromEmail) {
      toast.error('Please enter a from email address');
      return;
    }

    if (!isValidEmail(config.fromEmail)) {
      toast.error('Please enter a valid email address');
      return;
    }

    if (emailPlatform === 'cloudflare') {
      const missingFields = [];
      if (!config.cloudflareAccountId) missingFields.push('Account ID');
      if (!config.cloudflareApiToken) missingFields.push('API Token');
      if (missingFields.length > 0) {
        toast.error(`Missing required Cloudflare fields: ${missingFields.join(', ')}`);
        return;
      }
    }

    if (emailPlatform === 'selfhosted') {
      // Check for missing SMTP fields and list them
      const missingFields = [];
      if (!config.smtpHost) missingFields.push('Server Address');
      if (!config.smtpPort) missingFields.push('Port');
      if (!config.smtpUsername) missingFields.push('Username');
      if (!config.smtpPassword) missingFields.push('Password');

      if (missingFields.length > 0) {
        toast.error(`Missing required SMTP fields: ${missingFields.join(', ')}`);
        return;
      }

      // Validate SMTP port number
      const portNumber = parseInt(config.smtpPort || '0', 10);
      if (!isValidPort(portNumber)) {
        toast.error('Please enter a valid port number (1-65535)');
        return;
      }
    }

    if (emailPlatform === 'gmail' && !useOAuth && !config.googleAppPassword) {
      toast.error('Please enter your Google App Password');
      return;
    }

    const { data, error: _apiError } = await executeSave(
      async () => {
        // SECURITY CRITICAL: Send email config to server (NOT sessionStorage!)
        // Passwords, API keys, and secrets will be encrypted server-side
        const response = await apiClient.saveEmailConfig({
          platform: emailPlatform || 'other',
          config: {
            ...config,
            authMethod: useOAuth ? 'oauth' : 'smtp',
          },
        });

        if (response.error) {
          throw new Error(response.error);
        }

        return response;
      },
      {
        step: 'Email Configuration',
        action: 'Save email configuration',
        userContext: `Platform: ${emailPlatform}, From: ${config.fromEmail}`,
      }
    );

    if (data) {
      // SECURITY: Clear sensitive data from memory
      setConfig({
        smtpEncryption: 'tls',
        smtpPort: '587',
      });

      toast.success('Email configuration saved securely');

      // Navigate to next step (file storage selection)
      void navigate('/onboarding/file-storage');
    }
  };

  const handleSkip = () => {
    toast.success('Email configuration skipped. You can set this up later.');
    void navigate('/onboarding/file-storage');
  };

  const currentYear = new Date().getFullYear();

  // Render different forms based on platform
  const renderPlatformFields = () => {
    switch (emailPlatform) {
      case 'gmail':
        return (
          <>
            {/* OAuth vs App Password Toggle */}
            <div className="alert-info mb-6">
              <div className="mb-4 flex items-start space-x-3">
                <AlertCircle aria-hidden="true" className="text-theme-alert-info-icon mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-theme-alert-info-title mb-1 text-sm font-medium">Choose Authentication Method</p>
                  <p className="text-theme-alert-info-text text-sm">
                    OAuth 2.0 is recommended for better security. App Password is simpler but less secure.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setUseOAuth(true)}
                  aria-pressed={useOAuth}
                  className={`flex-1 rounded-lg px-4 py-3 font-medium transition-all ${
                    useOAuth
                      ? 'bg-blue-600 text-white'
                      : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
                  }`}
                >
                  OAuth 2.0 (Recommended)
                </button>
                <button
                  onClick={() => setUseOAuth(false)}
                  aria-pressed={!useOAuth}
                  className={`flex-1 rounded-lg px-4 py-3 font-medium transition-all ${
                    !useOAuth
                      ? 'bg-blue-600 text-white'
                      : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
                  }`}
                >
                  App Password
                </button>
              </div>
            </div>

            {useOAuth ? (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                      Google Client ID
                    </label>
                    <input
                      type="text"
                      value={config.googleClientId || ''}
                      onChange={(e) => handleInputChange('googleClientId', e.target.value)}
                      placeholder="123456789-abc.apps.googleusercontent.com"
                      className="form-input placeholder-theme-text-muted py-3"
                    />
                  </div>

                  <div>
                    <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                      Google Client Secret
                    </label>
                    <input
                      type="password"
                      value={config.googleClientSecret || ''}
                      onChange={(e) => handleInputChange('googleClientSecret', e.target.value)}
                      placeholder="GOCSPX-xxxxxxxxxxxxx"
                      className="form-input placeholder-theme-text-muted py-3"
                    />
                  </div>
                </div>

                <div className="bg-theme-surface-secondary text-theme-text-secondary mt-4 rounded-lg p-4 text-sm">
                  <p className="text-theme-text-primary mb-2 font-medium">How to get OAuth credentials:</p>
                  <ol className="list-inside list-decimal space-y-1">
                    <li>Go to Google Cloud Console</li>
                    <li>Create a new project or select existing</li>
                    <li>Enable Gmail API</li>
                    <li>Create OAuth 2.0 credentials</li>
                    <li>Copy Client ID and Client Secret here</li>
                  </ol>
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-alert-info-icon hover:text-theme-alert-info-title mt-2 inline-block underline"
                  >
                    Open Google Cloud Console →
                  </a>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">Gmail Address</label>
                  <input
                    type="email"
                    value={config.fromEmail || ''}
                    onChange={(e) => handleInputChange('fromEmail', e.target.value)}
                    placeholder="notifications@yourdomain.com"
                    className="form-input placeholder-theme-text-muted py-3"
                  />
                </div>

                <div className="mt-4">
                  <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                    Google App Password <span className="text-theme-accent-red">*</span>
                  </label>
                  <input
                    type="password"
                    value={config.googleAppPassword || ''}
                    onChange={(e) => handleInputChange('googleAppPassword', e.target.value)}
                    placeholder="xxxx xxxx xxxx xxxx"
                    className="form-input placeholder-theme-text-muted py-3"
                  />
                </div>

                <div className="bg-theme-surface-secondary text-theme-text-secondary mt-4 rounded-lg p-4 text-sm">
                  <p className="text-theme-text-primary mb-2 font-medium">How to create an App Password:</p>
                  <ol className="list-inside list-decimal space-y-1">
                    <li>Enable 2-Factor Authentication on your Google account</li>
                    <li>Go to Google Account Security settings</li>
                    <li>Select "App passwords"</li>
                    <li>Generate a new app password for "Mail"</li>
                    <li>Copy the 16-character password here</li>
                  </ol>
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-alert-info-icon hover:text-theme-alert-info-title mt-2 inline-block underline"
                  >
                    Create App Password →
                  </a>
                </div>
              </>
            )}
          </>
        );

      case 'microsoft':
        return (
          <>
            <div className="alert-info mb-6">
              <div className="flex items-start space-x-3">
                <AlertCircle aria-hidden="true" className="text-theme-alert-info-icon mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-theme-alert-info-title mb-1 text-sm font-medium">Microsoft 365 / Azure AD Setup</p>
                  <p className="text-theme-alert-info-text text-sm">
                    You'll need admin access to your Microsoft 365 tenant to configure email integration.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                  Tenant ID <span className="text-theme-accent-red">*</span>
                </label>
                <input
                  type="text"
                  value={config.microsoftTenantId || ''}
                  onChange={(e) => handleInputChange('microsoftTenantId', e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="form-input placeholder-theme-text-muted py-3"
                />
              </div>

              <div>
                <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                  Client ID (Application ID) <span className="text-theme-accent-red">*</span>
                </label>
                <input
                  type="text"
                  value={config.microsoftClientId || ''}
                  onChange={(e) => handleInputChange('microsoftClientId', e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="form-input placeholder-theme-text-muted py-3"
                />
              </div>

              <div>
                <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                  Client Secret <span className="text-theme-accent-red">*</span>
                </label>
                <input
                  type="password"
                  value={config.microsoftClientSecret || ''}
                  onChange={(e) => handleInputChange('microsoftClientSecret', e.target.value)}
                  placeholder="Client secret value"
                  className="form-input placeholder-theme-text-muted py-3"
                />
              </div>
            </div>

            <div className="bg-theme-surface-secondary text-theme-text-secondary mt-4 rounded-lg p-4 text-sm">
              <p className="text-theme-text-primary mb-2 font-medium">How to set up Azure AD app:</p>
              <ol className="list-inside list-decimal space-y-1">
                <li>Go to Azure Portal → Azure Active Directory</li>
                <li>App registrations → New registration</li>
                <li>Note the Tenant ID and Application (client) ID</li>
                <li>Certificates & secrets → New client secret</li>
                <li>API permissions → Add Microsoft Graph Mail.Send</li>
              </ol>
              <a
                href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                target="_blank"
                rel="noopener noreferrer"
                className="text-theme-alert-info-icon hover:text-theme-alert-info-title mt-2 inline-block underline"
              >
                Open Azure Portal →
              </a>
            </div>
          </>
        );

      case 'selfhosted':
        return (
          <>
            <div className="space-y-4">
              <div>
                <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                  SMTP Host <span className="text-theme-accent-red">*</span>
                </label>
                <input
                  type="text"
                  value={config.smtpHost || ''}
                  onChange={(e) => handleInputChange('smtpHost', e.target.value)}
                  placeholder="mail.yourdomain.com"
                  className="form-input placeholder-theme-text-muted py-3"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                    Port <span className="text-theme-accent-red">*</span>
                  </label>
                  <input
                    type="number"
                    value={config.smtpPort || ''}
                    onChange={(e) => handleInputChange('smtpPort', e.target.value)}
                    placeholder="587"
                    className="form-input placeholder-theme-text-muted py-3"
                  />
                </div>

                <div>
                  <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                    Encryption <span className="text-theme-accent-red">*</span>
                  </label>
                  <select
                    value={config.smtpEncryption || 'tls'}
                    onChange={(e) => handleInputChange('smtpEncryption', e.target.value)}
                    className="form-input py-3"
                  >
                    <option value="tls">TLS (STARTTLS)</option>
                    <option value="ssl">SSL</option>
                    <option value="none">None</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                  Username <span className="text-theme-accent-red">*</span>
                </label>
                <input
                  type="text"
                  value={config.smtpUsername || ''}
                  onChange={(e) => handleInputChange('smtpUsername', e.target.value)}
                  placeholder="notifications@yourdomain.com"
                  className="form-input placeholder-theme-text-muted py-3"
                />
              </div>

              <div>
                <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                  Password <span className="text-theme-accent-red">*</span>
                </label>
                <input
                  type="password"
                  value={config.smtpPassword || ''}
                  onChange={(e) => handleInputChange('smtpPassword', e.target.value)}
                  placeholder="••••••••"
                  className="form-input placeholder-theme-text-muted py-3"
                />
              </div>
            </div>

            <div className="bg-theme-surface-secondary text-theme-text-secondary mt-4 rounded-lg p-4 text-sm">
              <p className="text-theme-text-primary mb-2 font-medium">Common SMTP Ports:</p>
              <ul className="space-y-1">
                <li>
                  • <span className="text-theme-accent-green">587</span> - TLS/STARTTLS (recommended)
                </li>
                <li>
                  • <span className="text-theme-accent-blue">465</span> - SSL
                </li>
                <li>
                  • <span className="text-theme-accent-yellow">25</span> - Unencrypted (not recommended)
                </li>
              </ul>
            </div>
          </>
        );

      case 'cloudflare':
        return (
          <>
            <div className="alert-info mb-6">
              <div className="flex items-start space-x-3">
                <AlertCircle aria-hidden="true" className="text-theme-alert-info-icon mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-theme-alert-info-title mb-1 text-sm font-medium">Cloudflare Email Service</p>
                  <p className="text-theme-alert-info-text text-sm">
                    Sends transactional email via Cloudflare's REST API. Your domain's DNS must be managed by
                    Cloudflare.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                  Account ID <span className="text-theme-accent-red">*</span>
                </label>
                <input
                  type="text"
                  value={config.cloudflareAccountId || ''}
                  onChange={(e) => handleInputChange('cloudflareAccountId', e.target.value)}
                  placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="form-input placeholder-theme-text-muted py-3"
                />
              </div>

              <div>
                <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                  API Token <span className="text-theme-accent-red">*</span>
                </label>
                <input
                  type="password"
                  value={config.cloudflareApiToken || ''}
                  onChange={(e) => handleInputChange('cloudflareApiToken', e.target.value)}
                  placeholder="API token with email sending permission"
                  className="form-input placeholder-theme-text-muted py-3"
                />
              </div>
            </div>

            <div className="bg-theme-surface-secondary text-theme-text-secondary mt-4 rounded-lg p-4 text-sm">
              <p className="text-theme-text-primary mb-2 font-medium">How to get Cloudflare credentials:</p>
              <ol className="list-inside list-decimal space-y-1">
                <li>Log into the Cloudflare dashboard</li>
                <li>Copy your Account ID from the Overview page sidebar</li>
                <li>Go to My Profile → API Tokens → Create Token</li>
                <li>Create a token with the Email Sending permission</li>
                <li>Enable Email Routing on your domain</li>
              </ol>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to safe-top flex min-h-screen flex-col bg-linear-to-br">
      <OnboardingHeader
        departmentName={departmentName}
        logoPreview={logoPreview}
        icon={<Mail aria-hidden="true" className="h-6 w-6 text-white" />}
      />

      {/* Main Content */}
      <main className="flex flex-1 items-center justify-center p-4 py-8">
        <div className="w-full max-w-3xl">
          {/* Navigation Buttons */}
          <div className="mb-6 flex items-center justify-between">
            <BackButton to="/onboarding/email-platform" />
            <ResetProgressButton />
          </div>

          {/* Page Header */}
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-600">
              <Mail aria-hidden="true" className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-theme-text-primary mb-3 text-4xl font-bold md:text-5xl">
              Configure{' '}
              {emailPlatform === 'gmail'
                ? 'Gmail'
                : emailPlatform === 'microsoft'
                  ? 'Microsoft 365'
                  : emailPlatform === 'cloudflare'
                    ? 'Cloudflare'
                    : 'SMTP'}{' '}
              Email
            </h2>
            <p className="text-theme-text-secondary text-xl">Set up email notifications for your department</p>
          </div>

          {/* Configuration Form */}
          <div className="card space-y-6 p-8">
            {/* Common Fields */}
            <div>
              <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">
                From Email Address <span className="text-theme-accent-red">*</span>
              </label>
              <input
                type="email"
                value={config.fromEmail || ''}
                onChange={(e) => handleInputChange('fromEmail', e.target.value)}
                placeholder="notifications@yourdomain.com"
                className="form-input placeholder-theme-text-muted py-3"
              />
              <p className="text-theme-text-muted mt-1 text-xs">Email address that notifications will be sent from</p>
            </div>

            <div>
              <label className="text-theme-text-secondary mb-2 block text-sm font-semibold">From Name</label>
              <input
                type="text"
                value={config.fromName || ''}
                onChange={(e) => handleInputChange('fromName', e.target.value)}
                placeholder={departmentName}
                className="form-input placeholder-theme-text-muted py-3"
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Display name for outgoing emails (defaults to department name)
              </p>
            </div>

            {/* Platform-specific fields */}
            {renderPlatformFields()}

            {/* Test Connection Button */}
            <div className="border-theme-nav-border border-t pt-4">
              <button
                onClick={() => {
                  void handleTestConnection();
                }}
                disabled={testingConnection || !config.fromEmail}
                className={`flex w-full items-center justify-center rounded-lg px-6 py-3 font-semibold transition-all duration-300 ${
                  connectionTested
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'disabled:bg-theme-surface disabled:text-theme-text-muted bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {testingConnection ? (
                  <>
                    <Loader aria-hidden="true" className="mr-2 h-5 w-5 animate-spin" />
                    Testing Connection...
                  </>
                ) : connectionTested ? (
                  <>
                    <Check className="mr-2 h-5 w-5" />
                    Connection Test Passed
                  </>
                ) : (
                  'Test Email Connection'
                )}
              </button>
              <p className="text-theme-text-muted mt-2 text-center text-sm">
                We'll send a test email to verify your configuration
              </p>
            </div>
          </div>

          {/* Error Alert */}
          {saveError && (
            <div className="mt-6">
              <ErrorAlert
                message={saveError}
                canRetry={canRetrySave}
                onRetry={handleContinue}
                onDismiss={clearSaveError}
              />
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-8 flex gap-4">
            <button
              onClick={handleSkip}
              disabled={isSaving}
              className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary flex-1 rounded-lg px-6 py-3 font-semibold transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Skip for Now
            </button>
            <button
              onClick={() => {
                void handleContinue();
              }}
              disabled={isSaving}
              className="flex-1 transform rounded-lg bg-linear-to-r from-red-600 to-orange-600 px-6 py-3 font-semibold text-white shadow-lg transition-all duration-300 hover:scale-105 hover:from-red-700 hover:to-orange-700 hover:shadow-xl disabled:transform-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? 'Saving Securely...' : 'Continue'}
            </button>
          </div>

          {/* Progress Indicator */}
          <ProgressIndicator step="email_config" className="border-theme-nav-border mt-6 border-t pt-6" />

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

export default EmailConfiguration;
