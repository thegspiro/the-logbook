import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive, Cloud, Database, FolderOpen, CheckCircle, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { OnboardingHeader, OnboardingFooter, ProgressIndicator } from '../components';
import { useOnboardingStorage } from '../hooks';
import { apiClient } from '../services/api-client';

interface FileStoragePlatform {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  features: string[];
  setupInfo: string;
  recommended?: boolean;
}

const FileStorageChoice: React.FC = () => {
  const navigate = useNavigate();
  const { departmentName, logoPreview, onboardingData } = useOnboardingStorage();
  const [selectedPlatform, setSelectedPlatform] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // Get email platform to pre-select file storage
  const emailPlatform = onboardingData.emailPlatform || sessionStorage.getItem('emailPlatform');

  useEffect(() => {
    if (!departmentName) {
      navigate('/onboarding/start');
      return;
    }

    // Pre-select file storage based on email platform
    if (emailPlatform === 'gmail') {
      setSelectedPlatform('googledrive');
    } else if (emailPlatform === 'microsoft') {
      setSelectedPlatform('onedrive');
    } else {
      setSelectedPlatform('local');
    }
  }, [navigate, departmentName, emailPlatform]);

  // Google Drive Icon
  const GoogleDriveIcon = () => (
    <svg className="w-10 h-10" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  );

  // OneDrive Icon
  const OneDriveIcon = () => (
    <svg className="w-10 h-10" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#0078d4" d="M30.5 15.5c-5.24 0-9.8 3.05-11.95 7.45-3.55.25-6.55 2.65-7.45 5.95C5.7 29.9 2 34.15 2 39.25c0 5.65 4.6 10.25 10.25 10.25h25.5C43.45 49.5 48 44.95 48 39.25S43.45 29 37.75 29c-.45 0-.9.05-1.35.1-.5-7.45-6.7-13.6-14.4-13.6z"/>
      <path fill="#0364b8" d="M18.55 22.95c-.35-.8-.65-1.65-.9-2.5 3.55.25 6.55 2.65 7.45 5.95 5.4 1 9.1 5.25 9.1 10.35 0 .45-.05.9-.1 1.35 5.7-.05 10.35-4.65 10.35-10.35S43.45 17.4 37.75 17.4c-.45 0-.9.05-1.35.1-.5-7.45-6.7-13.6-14.4-13.6-5.24 0-9.8 3.05-11.95 7.45-3.55.25-6.55 2.65-7.45 5.95 4.4-1 8.15-3.65 10.95-7.35z"/>
    </svg>
  );

  const platforms: FileStoragePlatform[] = [
    {
      id: 'googledrive',
      name: 'Google Drive',
      description: 'Store files in Google Drive',
      icon: <GoogleDriveIcon />,
      color: 'from-blue-500 to-green-500',
      features: [
        '15 GB free storage (expandable)',
        'Easy sharing and collaboration',
        'Automatic backup and sync',
        'Integrated with Google Workspace'
      ],
      setupInfo: 'You\'ll need to authorize access to your Google Drive account using OAuth 2.0.',
      recommended: emailPlatform === 'gmail',
    },
    {
      id: 'onedrive',
      name: 'OneDrive / SharePoint',
      description: 'Microsoft cloud storage',
      icon: <OneDriveIcon />,
      color: 'from-blue-600 to-blue-400',
      features: [
        '5 GB free storage (expandable)',
        'Deep integration with Office 365',
        'Advanced security features',
        'SharePoint document libraries'
      ],
      setupInfo: 'You\'ll need your Microsoft 365 credentials and app registration details.',
      recommended: emailPlatform === 'microsoft',
    },
    {
      id: 's3',
      name: 'Amazon S3',
      description: 'AWS cloud storage',
      icon: <Database className="w-10 h-10 text-orange-500" />,
      color: 'from-orange-600 to-yellow-500',
      features: [
        'Pay-as-you-go pricing',
        'Highly scalable and reliable',
        '99.999999999% durability',
        'Advanced security and compliance'
      ],
      setupInfo: 'You\'ll need an AWS account, Access Key ID, and Secret Access Key.',
    },
    {
      id: 'local',
      name: 'Local Storage',
      description: 'Store files on your server',
      icon: <HardDrive className="w-10 h-10 text-slate-400" />,
      color: 'from-slate-600 to-slate-400',
      features: [
        'Complete control over your data',
        'No third-party dependencies',
        'No monthly fees',
        'Requires manual backups'
      ],
      setupInfo: 'Files will be stored in your configured upload directory. Make sure you have adequate storage space and a backup strategy.',
      recommended: emailPlatform === 'selfhosted' || emailPlatform === 'other',
    },
    {
      id: 'other',
      name: 'Configure Later',
      description: 'Skip for now',
      icon: <FolderOpen className="w-10 h-10 text-slate-500" />,
      color: 'from-slate-700 to-slate-500',
      features: [
        'Set up file storage later',
        'Use local storage as default',
        'Can be changed in settings'
      ],
      setupInfo: 'You can configure file storage later in the system settings.',
    },
  ];

  const handleContinue = async () => {
    if (!selectedPlatform) return;

    setIsSaving(true);

    try {
      // SECURITY: Save file storage choice to server
      // If platform requires API keys/secrets, they'll be entered in the config page
      const response = await apiClient.saveFileStorageConfig({
        platform: selectedPlatform,
        config: {}, // Config will be added in next step if needed
      });

      if (response.error) {
        toast.error(response.error);
        setIsSaving(false);
        return;
      }

      // SECURITY: Only store non-sensitive metadata in sessionStorage
      sessionStorage.setItem('fileStoragePlatform', selectedPlatform);

      toast.success('File storage platform saved');

      // Route based on selection
      if (selectedPlatform === 'other') {
        navigate('/onboarding/authentication');
      } else {
        navigate('/onboarding/file-storage-config');
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to save file storage choice';
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
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4">
              <Cloud className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-3">
              File Storage
            </h2>
            <p className="text-xl text-slate-300 mb-2">
              Where should department files be stored?
            </p>
            <p className="text-sm text-slate-400">
              Documents, images, reports, and other files
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
                    Based on your {emailPlatform === 'gmail' ? 'Gmail' : 'Microsoft 365'} email selection,
                    we've pre-selected {emailPlatform === 'gmail' ? 'Google Drive' : 'OneDrive'} for seamless
                    integration with your existing platform.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Platform Cards */}
          <div className="grid md:grid-cols-2 gap-4 mb-8">
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
                  <div className="absolute top-4 right-4">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-500 text-white">
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

                <div className={`flex items-start space-x-4 ${selectedPlatform === platform.id ? 'mt-8' : platform.recommended ? 'mt-8' : ''}`}>
                  {/* Icon */}
                  <div className={`flex-shrink-0 w-16 h-16 rounded-lg bg-gradient-to-br ${platform.color} flex items-center justify-center`}>
                    {platform.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-bold text-white mb-1">
                      {platform.name}
                    </h3>
                    <p className="text-slate-400 text-sm mb-3">
                      {platform.description}
                    </p>

                    {/* Features */}
                    <ul className="space-y-1 mb-3">
                      {platform.features.map((feature, index) => (
                        <li key={index} className="flex items-start text-sm text-slate-300">
                          <CheckCircle className="w-4 h-4 text-green-400 mr-2 flex-shrink-0 mt-0.5" />
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
            <ProgressIndicator currentStep={6} totalSteps={8} className="mt-6 pt-6 border-t border-white/10" />
          </div>
        </div>
      </main>

      <OnboardingFooter departmentName={departmentName} />
    </div>
  );
};

export default FileStorageChoice;
