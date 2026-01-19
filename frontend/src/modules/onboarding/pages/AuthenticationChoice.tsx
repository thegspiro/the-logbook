import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, CheckCircle, Info, Key } from 'lucide-react';
import toast from 'react-hot-toast';
import { OnboardingHeader, OnboardingFooter, ProgressIndicator } from '../components';
import { useOnboardingStorage } from '../hooks';
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
  const { departmentName, logoPreview, onboardingData } = useOnboardingStorage();
  const [selectedPlatform, setSelectedPlatform] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // Get email platform to pre-select authentication
  const emailPlatform = onboardingData.emailPlatform || sessionStorage.getItem('emailPlatform');

  useEffect(() => {
    if (!departmentName) {
      navigate('/onboarding/start');
      return;
    }

    // Pre-select authentication based on email platform
    if (emailPlatform === 'gmail') {
      setSelectedPlatform('google');
    } else if (emailPlatform === 'microsoft') {
      setSelectedPlatform('microsoft');
    } else {
      setSelectedPlatform('authentik');
    }
  }, [navigate, departmentName, emailPlatform]);

  // Google Icon
  const GoogleIcon = () => (
    <svg className="w-10 h-10" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/>
      <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/>
      <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/>
      <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/>
    </svg>
  );

  // Microsoft Icon
  const MicrosoftIcon = () => (
    <svg className="w-10 h-10" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#ff5722" d="M6 6h18v18H6z"/>
      <path fill="#4caf50" d="M26 6h18v18H26z"/>
      <path fill="#ffc107" d="M6 26h18v18H6z"/>
      <path fill="#03a9f4" d="M26 26h18v18H26z"/>
    </svg>
  );

  // Authentik Icon
  const AuthentikIcon = () => (
    <svg className="w-10 h-10" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="20" fill="#fd4b2d"/>
      <path fill="#fff" d="M24 8l-4 12h8l-4 12 8-12h-6l4-12z"/>
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
        'Seamless for Google Workspace users'
      ],
      setupInfo: 'You\'ll need to create a Google Cloud project and configure OAuth 2.0 credentials.',
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
        'Perfect for Microsoft 365 organizations'
      ],
      setupInfo: 'You\'ll need to register an app in Azure Active Directory and configure authentication.',
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
        'Advanced authentication flows'
      ],
      setupInfo: 'You\'ll need to deploy Authentik on your infrastructure and configure an OAuth2/OIDC provider.',
      recommended: emailPlatform === 'selfhosted' || emailPlatform === 'other',
    },
  ];

  const handleContinue = async () => {
    if (!selectedPlatform) return;

    setIsSaving(true);

    try {
      // SECURITY: Save authentication platform to server
      const response = await apiClient.saveAuthPlatform(selectedPlatform);

      if (response.error) {
        toast.error(response.error);
        setIsSaving(false);
        return;
      }

      // SECURITY: Only store non-sensitive metadata in sessionStorage
      sessionStorage.setItem('authPlatform', selectedPlatform);

      toast.success('Authentication platform saved');

      // Route to IT team and backup access setup
      navigate('/onboarding/it-team');
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to save authentication platform';
      toast.error(errorMessage);
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex flex-col">
      <OnboardingHeader departmentName={departmentName} logoPreview={logoPreview} />

      <main className="flex-1 flex items-center justify-center p-4 py-8">
        <div className="max-w-5xl w-full">
          {/* Page Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-600 rounded-full mb-4">
              <Key className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-3">
              User Authentication
            </h2>
            <p className="text-xl text-slate-300 mb-2">
              How should users sign in to the system?
            </p>
            <p className="text-sm text-slate-400">
              Choose your authentication provider
            </p>
          </div>

          {/* Smart Recommendation Notice */}
          {emailPlatform && (emailPlatform === 'gmail' || emailPlatform === 'microsoft') && (
            <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4 mb-6 max-w-3xl mx-auto">
              <div className="flex items-start space-x-3">
                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-green-300 text-sm font-medium mb-1">
                    Smart Recommendation
                  </p>
                  <p className="text-green-200 text-sm">
                    Based on your {emailPlatform === 'gmail' ? 'Gmail' : 'Microsoft 365'} setup,
                    we recommend {emailPlatform === 'gmail' ? 'Google OAuth' : 'Microsoft Azure AD'} for
                    seamless integration with your existing accounts.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Security Notice */}
          <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-4 mb-6 max-w-3xl mx-auto">
            <div className="flex items-start space-x-3">
              <Shield className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-blue-300 text-sm font-medium mb-1">
                  Enterprise Security
                </p>
                <p className="text-blue-200 text-sm">
                  All authentication methods support multi-factor authentication (MFA) and are
                  HIPAA compliant when properly configured.
                </p>
              </div>
            </div>
          </div>

          {/* Platform Cards */}
          <div className="grid md:grid-cols-3 gap-4 mb-8">
            {platforms.map((platform) => (
              <button
                key={platform.id}
                onClick={() => setSelectedPlatform(platform.id)}
                className={`relative bg-white/10 backdrop-blur-sm rounded-lg p-6 text-left border-2 transition-all duration-300 hover:scale-105 ${
                  selectedPlatform === platform.id
                    ? 'border-red-500 shadow-lg shadow-red-500/50'
                    : 'border-white/20 hover:border-white/40'
                }`}
                aria-pressed={selectedPlatform === platform.id}
              >
                {/* Recommended Badge */}
                {platform.recommended && (
                  <div className="absolute -top-2 -right-2">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-500 text-white shadow-lg">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Recommended
                    </span>
                  </div>
                )}

                {/* Selected Indicator */}
                {selectedPlatform === platform.id && (
                  <div className="absolute top-4 left-4">
                    <CheckCircle className="w-6 h-6 text-red-500" />
                  </div>
                )}

                <div className={`${selectedPlatform === platform.id ? 'mt-8' : platform.recommended ? 'mt-6' : ''}`}>
                  {/* Icon */}
                  <div className={`flex-shrink-0 w-16 h-16 rounded-lg bg-gradient-to-br ${platform.color} flex items-center justify-center mb-4`}>
                    {platform.icon}
                  </div>

                  {/* Content */}
                  <div className="mb-4">
                    <h3 className="text-xl font-bold text-white mb-1">
                      {platform.name}
                    </h3>
                    <p className="text-slate-400 text-sm mb-3">
                      {platform.description}
                    </p>

                    {/* Features */}
                    <ul className="space-y-1.5 mb-4">
                      {platform.features.map((feature, index) => (
                        <li key={index} className="flex items-start text-xs text-slate-300">
                          <CheckCircle className="w-3.5 h-3.5 text-green-400 mr-2 flex-shrink-0 mt-0.5" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Setup Info */}
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded px-3 py-2">
                      <p className="text-blue-200 text-xs flex items-start">
                        <Info className="w-3 h-3 mr-1 flex-shrink-0 mt-0.5" />
                        <span>{platform.setupInfo}</span>
                      </p>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Continue Button */}
          <div className="max-w-md mx-auto">
            <button
              onClick={handleContinue}
              disabled={!selectedPlatform || isSaving}
              className={`w-full px-8 py-4 rounded-lg font-semibold text-lg transition-all duration-300 ${
                selectedPlatform && !isSaving
                  ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
                  : 'bg-slate-700 text-slate-400 cursor-not-allowed'
              }`}
              aria-label="Continue to next step"
            >
              {isSaving ? 'Saving...' : 'Continue'}
            </button>

            {/* Progress Indicator */}
            <ProgressIndicator currentStep={7} totalSteps={8} className="mt-6 pt-6 border-t border-white/10" />
          </div>
        </div>
      </main>

      <OnboardingFooter departmentName={departmentName} />
    </div>
  );
};

export default AuthenticationChoice;
