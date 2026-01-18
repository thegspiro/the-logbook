import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Server, Info } from 'lucide-react';

// Email platform logos (using simple SVG icons)
const GmailIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10">
    <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L12 9.545l8.073-6.052C21.69 2.28 24 3.434 24 5.457z" />
  </svg>
);

const MicrosoftIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10">
    <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z" />
  </svg>
);

interface EmailPlatform {
  id: 'gmail' | 'microsoft' | 'selfhosted' | 'other';
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  features: string[];
  setupInfo?: string;
}

const EmailPlatformChoice: React.FC = () => {
  const [departmentName, setDepartmentName] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Get department info from session storage
    const name = sessionStorage.getItem('departmentName');
    const logoData = sessionStorage.getItem('logoData');

    if (!name) {
      // If no department name, redirect back to start
      navigate('/onboarding/start');
      return;
    }

    setDepartmentName(name);
    if (logoData) {
      setLogoPreview(logoData);
    }
  }, [navigate]);

  const platforms: EmailPlatform[] = [
    {
      id: 'gmail',
      name: 'Gmail',
      description: 'Google Workspace or Gmail',
      icon: <GmailIcon />,
      color: 'from-red-500 to-yellow-500',
      features: [
        'OAuth 2.0 authentication',
        'Easy integration',
        'Calendar sync available',
      ],
      setupInfo: 'You\'ll need a Google Workspace admin account or app password.',
    },
    {
      id: 'microsoft',
      name: 'Microsoft 365',
      description: 'Outlook, Exchange, or Microsoft 365',
      icon: <MicrosoftIcon />,
      color: 'from-blue-500 to-cyan-500',
      features: [
        'Azure AD integration',
        'Exchange support',
        'Teams integration',
      ],
      setupInfo: 'You\'ll need your Microsoft 365 tenant information.',
    },
    {
      id: 'selfhosted',
      name: 'Self-Hosted',
      description: 'Your own mail server (SMTP)',
      icon: <Server className="w-10 h-10" />,
      color: 'from-green-500 to-emerald-500',
      features: [
        'Full control',
        'SMTP/IMAP support',
        'Custom configuration',
      ],
      setupInfo: 'You\'ll need SMTP server details (host, port, credentials).',
    },
    {
      id: 'other',
      name: 'Other / Skip',
      description: 'Different provider or configure later',
      icon: <Mail className="w-10 h-10" />,
      color: 'from-slate-500 to-slate-600',
      features: [
        'Configure manually',
        'Skip for now',
        'Set up later in settings',
      ],
      setupInfo: 'You can configure email settings after setup is complete.',
    },
  ];

  const handleContinue = () => {
    if (!selectedPlatform) return;

    // Store email platform preference
    sessionStorage.setItem('emailPlatform', selectedPlatform);

    // Navigate to next step based on selection
    if (selectedPlatform === 'other') {
      // Skip email configuration, go to file storage selection
      navigate('/onboarding/file-storage');
    } else {
      // Go to email configuration page
      navigate('/onboarding/email-config');
    }
  };

  const currentYear = new Date().getFullYear();
  const selectedPlatformData = platforms.find(p => p.id === selectedPlatform);

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
        <div className="max-w-5xl w-full">
          {/* Page Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4">
              <Mail className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-3">
              Email Platform
            </h2>
            <p className="text-xl text-slate-300 mb-2">
              Which email service does your department use?
            </p>
            <p className="text-sm text-slate-400">
              This helps us send notifications and alerts to your team
            </p>
          </div>

          {/* Email Platform Options */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {platforms.map((platform) => (
              <button
                key={platform.id}
                onClick={() => setSelectedPlatform(platform.id)}
                className={`group relative bg-white/10 backdrop-blur-sm rounded-lg border-2 transition-all duration-300 text-left ${
                  selectedPlatform === platform.id
                    ? 'border-red-500 shadow-lg shadow-red-500/50'
                    : 'border-white/20 hover:border-red-400/50'
                }`}
                aria-pressed={selectedPlatform === platform.id}
                aria-label={`Select ${platform.name}`}
              >
                <div className="p-6">
                  {/* Icon and Title */}
                  <div className="flex items-start space-x-4 mb-4">
                    <div
                      className={`w-16 h-16 rounded-lg flex items-center justify-center transition-all ${
                        selectedPlatform === platform.id
                          ? `bg-gradient-to-br ${platform.color} text-white`
                          : 'bg-slate-800 text-slate-400 group-hover:bg-slate-700'
                      }`}
                    >
                      {platform.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-2xl font-bold text-white mb-1">
                        {platform.name}
                      </h3>
                      <p className="text-slate-300 text-sm">
                        {platform.description}
                      </p>
                    </div>
                  </div>

                  {/* Features */}
                  <ul className="space-y-2 text-sm text-slate-300 mb-4">
                    {platform.features.map((feature, index) => (
                      <li key={index} className="flex items-start">
                        <span className="text-green-400 mr-2 flex-shrink-0">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Setup Info */}
                  {platform.setupInfo && (
                    <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                      <div className="flex items-start space-x-2">
                        <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-slate-400">
                          {platform.setupInfo}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Selected indicator */}
                {selectedPlatform === platform.id && (
                  <div className="absolute top-4 right-4 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Info Box */}
          {selectedPlatformData && selectedPlatformData.id !== 'other' && (
            <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-4 mb-8">
              <div className="flex items-start space-x-3">
                <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-blue-300 text-sm font-medium mb-1">
                    Next Step
                  </p>
                  <p className="text-blue-200 text-sm">
                    After clicking Continue, you'll enter your {selectedPlatformData.name} connection details.
                    Don't worry, we'll guide you through the process step by step.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Continue Button */}
          <div className="max-w-md mx-auto">
            <button
              onClick={handleContinue}
              disabled={!selectedPlatform}
              className={`w-full px-8 py-4 rounded-lg font-semibold text-lg transition-all duration-300 ${
                selectedPlatform
                  ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
                  : 'bg-slate-700 text-slate-400 cursor-not-allowed'
              }`}
              aria-label="Continue to next step"
            >
              Continue
            </button>

            {/* Help Text */}
            <p className="text-center text-slate-400 text-sm mt-4">
              {selectedPlatform === 'other'
                ? 'You can configure email settings later in the admin panel'
                : 'Your email credentials are encrypted and stored securely'}
            </p>

            {/* Progress Indicator */}
            <div className="mt-6 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between text-sm text-slate-400 mb-2">
                <span>Setup Progress</span>
                <span>Step 3 of 7</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-red-600 to-orange-600 h-2 rounded-full transition-all duration-500"
                  style={{ width: '42%' }}
                  role="progressbar"
                  aria-valuenow={42}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Setup progress: 42 percent complete"
                />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer with Department Name and Copyright */}
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

export default EmailPlatformChoice;
