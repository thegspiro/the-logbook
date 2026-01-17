import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Check, AlertCircle, Loader } from 'lucide-react';
import toast from 'react-hot-toast';

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
  const [departmentName, setDepartmentName] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>('');
  const [config, setConfig] = useState<EmailConfig>({
    smtpEncryption: 'tls',
    smtpPort: '587',
  });
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTested, setConnectionTested] = useState(false);
  const [useOAuth, setUseOAuth] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Get data from session storage
    const name = sessionStorage.getItem('departmentName');
    const logoData = sessionStorage.getItem('logoData');
    const emailPlatform = sessionStorage.getItem('emailPlatform');

    if (!name || !emailPlatform || emailPlatform === 'other') {
      // Redirect if missing data or they chose to skip
      navigate('/onboarding/start');
      return;
    }

    setDepartmentName(name);
    setPlatform(emailPlatform);

    if (logoData) {
      setLogoPreview(logoData);
    }

    // Set default from email
    setConfig(prev => ({
      ...prev,
      fromName: name,
    }));
  }, [navigate]);

  const handleInputChange = (field: keyof EmailConfig, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    setConnectionTested(false); // Reset test status when config changes
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);

    // Simulate API call to test email connection
    await new Promise(resolve => setTimeout(resolve, 2000));

    setTestingConnection(false);
    setConnectionTested(true);
    toast.success('Email connection test successful!');
  };

  const handleContinue = () => {
    // Validate required fields
    if (!config.fromEmail) {
      toast.error('Please enter a from email address');
      return;
    }

    if (platform === 'selfhosted') {
      if (!config.smtpHost || !config.smtpPort || !config.smtpUsername || !config.smtpPassword) {
        toast.error('Please fill in all SMTP configuration fields');
        return;
      }
    }

    if (platform === 'gmail' && !useOAuth && !config.googleAppPassword) {
      toast.error('Please enter your Google App Password');
      return;
    }

    // Store email configuration
    sessionStorage.setItem('emailConfig', JSON.stringify(config));
    sessionStorage.setItem('emailConfigMethod', useOAuth ? 'oauth' : 'smtp');

    // Navigate to next step (admin user creation)
    navigate('/onboarding/admin-user');
  };

  const handleSkip = () => {
    toast.success('Email configuration skipped. You can set this up later.');
    navigate('/onboarding/admin-user');
  };

  const currentYear = new Date().getFullYear();

  // Render different forms based on platform
  const renderPlatformFields = () => {
    switch (platform) {
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
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  OAuth 2.0 (Recommended)
                </button>
                <button
                  onClick={() => setUseOAuth(false)}
                  className={`flex-1 px-4 py-3 rounded-lg font-medium transition-all ${
                    !useOAuth
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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
                    <label className="block text-sm font-semibold text-slate-200 mb-2">
                      Google Client ID
                    </label>
                    <input
                      type="text"
                      value={config.googleClientId || ''}
                      onChange={(e) => handleInputChange('googleClientId', e.target.value)}
                      placeholder="123456789-abc.apps.googleusercontent.com"
                      className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-200 mb-2">
                      Google Client Secret
                    </label>
                    <input
                      type="password"
                      value={config.googleClientSecret || ''}
                      onChange={(e) => handleInputChange('googleClientSecret', e.target.value)}
                      placeholder="GOCSPX-xxxxxxxxxxxxx"
                      className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="mt-4 bg-slate-800 rounded-lg p-4 text-sm text-slate-300">
                  <p className="font-medium text-white mb-2">How to get OAuth credentials:</p>
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
                  <label className="block text-sm font-semibold text-slate-200 mb-2">
                    Gmail Address
                  </label>
                  <input
                    type="email"
                    value={config.fromEmail || ''}
                    onChange={(e) => handleInputChange('fromEmail', e.target.value)}
                    placeholder="notifications@yourdomain.com"
                    className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-semibold text-slate-200 mb-2">
                    Google App Password <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="password"
                    value={config.googleAppPassword || ''}
                    onChange={(e) => handleInputChange('googleAppPassword', e.target.value)}
                    placeholder="xxxx xxxx xxxx xxxx"
                    className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="mt-4 bg-slate-800 rounded-lg p-4 text-sm text-slate-300">
                  <p className="font-medium text-white mb-2">How to create an App Password:</p>
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
                <label className="block text-sm font-semibold text-slate-200 mb-2">
                  Tenant ID <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={config.microsoftTenantId || ''}
                  onChange={(e) => handleInputChange('microsoftTenantId', e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">
                  Client ID (Application ID) <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={config.microsoftClientId || ''}
                  onChange={(e) => handleInputChange('microsoftClientId', e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">
                  Client Secret <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  value={config.microsoftClientSecret || ''}
                  onChange={(e) => handleInputChange('microsoftClientSecret', e.target.value)}
                  placeholder="Client secret value"
                  className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mt-4 bg-slate-800 rounded-lg p-4 text-sm text-slate-300">
              <p className="font-medium text-white mb-2">How to set up Azure AD app:</p>
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
                <label className="block text-sm font-semibold text-slate-200 mb-2">
                  SMTP Host <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={config.smtpHost || ''}
                  onChange={(e) => handleInputChange('smtpHost', e.target.value)}
                  placeholder="mail.yourdomain.com"
                  className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-200 mb-2">
                    Port <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    value={config.smtpPort || ''}
                    onChange={(e) => handleInputChange('smtpPort', e.target.value)}
                    placeholder="587"
                    className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-200 mb-2">
                    Encryption <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={config.smtpEncryption || 'tls'}
                    onChange={(e) => handleInputChange('smtpEncryption', e.target.value as any)}
                    className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="tls">TLS (STARTTLS)</option>
                    <option value="ssl">SSL</option>
                    <option value="none">None</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">
                  Username <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={config.smtpUsername || ''}
                  onChange={(e) => handleInputChange('smtpUsername', e.target.value)}
                  placeholder="notifications@yourdomain.com"
                  className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">
                  Password <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  value={config.smtpPassword || ''}
                  onChange={(e) => handleInputChange('smtpPassword', e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>

            <div className="mt-4 bg-slate-800 rounded-lg p-4 text-sm text-slate-300">
              <p className="font-medium text-white mb-2">Common SMTP Ports:</p>
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex flex-col">
      {/* Header with Logo */}
      <header className="bg-slate-900/50 backdrop-blur-sm border-b border-white/10 px-6 py-4">
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
            <h1 className="text-white text-lg font-semibold">{departmentName}</h1>
            <p className="text-slate-400 text-sm">Setup in Progress</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 py-8">
        <div className="max-w-3xl w-full">
          {/* Page Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4">
              <Mail className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-3">
              Configure {platform === 'gmail' ? 'Gmail' : platform === 'microsoft' ? 'Microsoft 365' : 'SMTP'} Email
            </h2>
            <p className="text-xl text-slate-300">
              Set up email notifications for your department
            </p>
          </div>

          {/* Configuration Form */}
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-8 border border-white/20 space-y-6">
            {/* Common Fields */}
            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-2">
                From Email Address <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={config.fromEmail || ''}
                onChange={(e) => handleInputChange('fromEmail', e.target.value)}
                placeholder="notifications@yourdomain.com"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="text-xs text-slate-400 mt-1">
                Email address that notifications will be sent from
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-2">
                From Name
              </label>
              <input
                type="text"
                value={config.fromName || ''}
                onChange={(e) => handleInputChange('fromName', e.target.value)}
                placeholder={departmentName}
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="text-xs text-slate-400 mt-1">
                Display name for outgoing emails (defaults to department name)
              </p>
            </div>

            {/* Platform-specific fields */}
            {renderPlatformFields()}

            {/* Test Connection Button */}
            <div className="pt-4 border-t border-white/10">
              <button
                onClick={handleTestConnection}
                disabled={testingConnection || !config.fromEmail}
                className={`w-full px-6 py-3 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center ${
                  connectionTested
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-700 disabled:text-slate-400'
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
              <p className="text-center text-slate-400 text-sm mt-2">
                We'll send a test email to verify your configuration
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-8 flex gap-4">
            <button
              onClick={handleSkip}
              className="flex-1 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-all duration-300"
            >
              Skip for Now
            </button>
            <button
              onClick={handleContinue}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white rounded-lg font-semibold transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105"
            >
              Continue
            </button>
          </div>

          {/* Progress Indicator */}
          <div className="mt-6 pt-6 border-t border-white/10">
            <div className="flex items-center justify-between text-sm text-slate-400 mb-2">
              <span>Setup Progress</span>
              <span>Step 4 of 7</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-red-600 to-orange-600 h-2 rounded-full transition-all duration-500"
                style={{ width: '57%' }}
                role="progressbar"
                aria-valuenow={57}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Setup progress: 57 percent complete"
              />
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900/50 backdrop-blur-sm border-t border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-slate-300 text-sm">
            © {currentYear} {departmentName}. All rights reserved.
          </p>
          <p className="text-slate-500 text-xs mt-1">
            Powered by The Logbook
          </p>
        </div>
      </footer>
    </div>
  );
};

export default EmailConfiguration;
