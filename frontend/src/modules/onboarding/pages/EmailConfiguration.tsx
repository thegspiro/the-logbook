import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Check, AlertCircle, Loader } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api-client';
import { isValidPort, isValidEmail } from '../utils/validation';
import { ProgressIndicator, BackButton, ResetProgressButton, ErrorAlert, AutoSaveNotification } from '../components';
import { useApiRequest } from '../hooks';
import { useOnboardingStore } from '../store';
import { getErrorMessage } from '@/utils/errorHandling';

interface EmailConfig {
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
  const departmentName = useOnboardingStore(state => state.departmentName);
  const logoPreview = useOnboardingStore(state => state.logoData);
  const emailPlatform = useOnboardingStore(state => state.emailPlatform);
  const lastSaved = useOnboardingStore(state => state.lastSaved);

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
  const { execute: executeSave, isLoading: isSaving, error: saveError, canRetry: canRetrySave, clearError: clearSaveError } = useApiRequest();

  useEffect(() => {
    // Redirect if missing data or they chose to skip
    if (!departmentName || !emailPlatform || emailPlatform === 'other') {
      navigate('/onboarding/start');
      return;
    }

    // Set default from name if not already set
    if (!config.fromName) {
      setConfig(prev => ({
        ...prev,
        fromName: departmentName,
      }));
    }
  }, [departmentName, emailPlatform, navigate, config.fromName]);

  const handleInputChange = (field: keyof EmailConfig, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }));
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
      navigate('/onboarding/file-storage');
    }
  };

  const handleSkip = () => {
    toast.success('Email configuration skipped. You can set this up later.');
    navigate('/onboarding/file-storage');
  };

  const currentYear = new Date().getFullYear();

  // Render different forms based on platform
  const renderPlatformFields = () => {
    switch (emailPlatform) {
      case 'gmail':
        return (
          <>
            {/* OAuth vs App Password Toggle */}
            <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-4 mb-6">
              <div className="flex items-start space-x-3 mb-4">
                <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-blue-300 text-sm font-medium mb-1">
                    Choose Authentication Method
                  </p>
                  <p className="text-blue-200 text-sm">
                    OAuth 2.0 is recommended for better security. App Password is simpler but less secure.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setUseOAuth(true)}
                  className={`flex-1 px-4 py-3 rounded-lg font-medium transition-all ${
                    useOAuth
                      ? 'bg-blue-600 text-white'
                      : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
                  }`}
                >
                  OAuth 2.0 (Recommended)
                </button>
                <button
                  onClick={() => setUseOAuth(false)}
                  className={`flex-1 px-4 py-3 rounded-lg font-medium transition-all ${
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
                    <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                      Google Client ID
                    </label>
                    <input
                      type="text"
                      value={config.googleClientId || ''}
                      onChange={(e) => handleInputChange('googleClientId', e.target.value)}
                      placeholder="123456789-abc.apps.googleusercontent.com"
                      className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                      Google Client Secret
                    </label>
                    <input
                      type="password"
                      value={config.googleClientSecret || ''}
                      onChange={(e) => handleInputChange('googleClientSecret', e.target.value)}
                      placeholder="GOCSPX-xxxxxxxxxxxxx"
                      className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="mt-4 bg-theme-surface-secondary rounded-lg p-4 text-sm text-theme-text-secondary">
                  <p className="font-medium text-theme-text-primary mb-2">How to get OAuth credentials:</p>
                  <ol className="list-decimal list-inside space-y-1">
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
                    className="text-blue-400 hover:text-blue-300 underline mt-2 inline-block"
                  >
                    Open Google Cloud Console →
                  </a>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                    Gmail Address
                  </label>
                  <input
                    type="email"
                    value={config.fromEmail || ''}
                    onChange={(e) => handleInputChange('fromEmail', e.target.value)}
                    placeholder="notifications@yourdomain.com"
                    className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                    Google App Password <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="password"
                    value={config.googleAppPassword || ''}
                    onChange={(e) => handleInputChange('googleAppPassword', e.target.value)}
                    placeholder="xxxx xxxx xxxx xxxx"
                    className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="mt-4 bg-theme-surface-secondary rounded-lg p-4 text-sm text-theme-text-secondary">
                  <p className="font-medium text-theme-text-primary mb-2">How to create an App Password:</p>
                  <ol className="list-decimal list-inside space-y-1">
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
                    className="text-blue-400 hover:text-blue-300 underline mt-2 inline-block"
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
            <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-4 mb-6">
              <div className="flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-blue-300 text-sm font-medium mb-1">
                    Microsoft 365 / Azure AD Setup
                  </p>
                  <p className="text-blue-200 text-sm">
                    You'll need admin access to your Microsoft 365 tenant to configure email integration.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                  Tenant ID <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={config.microsoftTenantId || ''}
                  onChange={(e) => handleInputChange('microsoftTenantId', e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                  Client ID (Application ID) <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={config.microsoftClientId || ''}
                  onChange={(e) => handleInputChange('microsoftClientId', e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                  Client Secret <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  value={config.microsoftClientSecret || ''}
                  onChange={(e) => handleInputChange('microsoftClientSecret', e.target.value)}
                  placeholder="Client secret value"
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mt-4 bg-theme-surface-secondary rounded-lg p-4 text-sm text-theme-text-secondary">
              <p className="font-medium text-theme-text-primary mb-2">How to set up Azure AD app:</p>
              <ol className="list-decimal list-inside space-y-1">
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
                className="text-blue-400 hover:text-blue-300 underline mt-2 inline-block"
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
                <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                  SMTP Host <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={config.smtpHost || ''}
                  onChange={(e) => handleInputChange('smtpHost', e.target.value)}
                  placeholder="mail.yourdomain.com"
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                    Port <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    value={config.smtpPort || ''}
                    onChange={(e) => handleInputChange('smtpPort', e.target.value)}
                    placeholder="587"
                    className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                    Encryption <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={config.smtpEncryption || 'tls'}
                    onChange={(e) => handleInputChange('smtpEncryption', e.target.value as 'tls' | 'ssl' | 'none')}
                    className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="tls">TLS (STARTTLS)</option>
                    <option value="ssl">SSL</option>
                    <option value="none">None</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                  Username <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={config.smtpUsername || ''}
                  onChange={(e) => handleInputChange('smtpUsername', e.target.value)}
                  placeholder="notifications@yourdomain.com"
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                  Password <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  value={config.smtpPassword || ''}
                  onChange={(e) => handleInputChange('smtpPassword', e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>

            <div className="mt-4 bg-theme-surface-secondary rounded-lg p-4 text-sm text-theme-text-secondary">
              <p className="font-medium text-theme-text-primary mb-2">Common SMTP Ports:</p>
              <ul className="space-y-1">
                <li>• <span className="text-green-400">587</span> - TLS/STARTTLS (recommended)</li>
                <li>• <span className="text-blue-400">465</span> - SSL</li>
                <li>• <span className="text-yellow-400">25</span> - Unencrypted (not recommended)</li>
              </ul>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex flex-col">
      {/* Header with Logo */}
      <header className="bg-theme-nav-bg backdrop-blur-sm border-b border-theme-nav-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center">
          {logoPreview ? (
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center overflow-hidden mr-4">
              <img
                src={logoPreview}
                alt={`${departmentName} logo`}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center mr-4">
              <Mail className="w-6 h-6 text-white" />
            </div>
          )}
          <div>
            <h1 className="text-theme-text-primary text-lg font-semibold">{departmentName}</h1>
            <p className="text-theme-text-muted text-sm">Setup in Progress</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 py-8">
        <div className="max-w-3xl w-full">
          {/* Navigation Buttons */}
          <div className="flex justify-between items-center mb-6">
            <BackButton to="/onboarding/email-platform" />
            <ResetProgressButton />
          </div>

          {/* Page Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4">
              <Mail className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-theme-text-primary mb-3">
              Configure {emailPlatform === 'gmail' ? 'Gmail' : emailPlatform === 'microsoft' ? 'Microsoft 365' : 'SMTP'} Email
            </h2>
            <p className="text-xl text-theme-text-secondary">
              Set up email notifications for your department
            </p>
          </div>

          {/* Configuration Form */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-8 border border-theme-surface-border space-y-6">
            {/* Common Fields */}
            <div>
              <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                From Email Address <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={config.fromEmail || ''}
                onChange={(e) => handleInputChange('fromEmail', e.target.value)}
                placeholder="notifications@yourdomain.com"
                className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Email address that notifications will be sent from
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-theme-text-secondary mb-2">
                From Name
              </label>
              <input
                type="text"
                value={config.fromName || ''}
                onChange={(e) => handleInputChange('fromName', e.target.value)}
                placeholder={departmentName}
                className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Display name for outgoing emails (defaults to department name)
              </p>
            </div>

            {/* Platform-specific fields */}
            {renderPlatformFields()}

            {/* Test Connection Button */}
            <div className="pt-4 border-t border-theme-nav-border">
              <button
                onClick={handleTestConnection}
                disabled={testingConnection || !config.fromEmail}
                className={`w-full px-6 py-3 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center ${
                  connectionTested
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-theme-surface disabled:text-theme-text-muted'
                }`}
              >
                {testingConnection ? (
                  <>
                    <Loader className="w-5 h-5 mr-2 animate-spin" />
                    Testing Connection...
                  </>
                ) : connectionTested ? (
                  <>
                    <Check className="w-5 h-5 mr-2" />
                    Connection Test Passed
                  </>
                ) : (
                  'Test Email Connection'
                )}
              </button>
              <p className="text-center text-theme-text-muted text-sm mt-2">
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
              className="flex-1 px-6 py-3 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary rounded-lg font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Skip for Now
            </button>
            <button
              onClick={handleContinue}
              disabled={isSaving}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white rounded-lg font-semibold transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {isSaving ? 'Saving Securely...' : 'Continue'}
            </button>
          </div>

          {/* Progress Indicator */}
          <ProgressIndicator currentStep={4} totalSteps={10} className="mt-6 pt-6 border-t border-theme-nav-border" />

          {/* Auto-Save Notification */}
          <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-theme-nav-bg backdrop-blur-sm border-t border-theme-nav-border px-6 py-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-theme-text-secondary text-sm">
            © {currentYear} {departmentName}. All rights reserved.
          </p>
          <p className="text-theme-text-muted text-xs mt-1">
            Powered by The Logbook
          </p>
        </div>
      </footer>
    </div>
  );
};

export default EmailConfiguration;
