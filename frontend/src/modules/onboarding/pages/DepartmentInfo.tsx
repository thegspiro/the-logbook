import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Building2, Image as ImageIcon, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { isValidImageFile } from '../utils/validation';
import { useOnboardingSession } from '../hooks/useOnboardingSession';
import { apiClient } from '../services/api-client';

const DepartmentInfo: React.FC = () => {
  const [departmentName, setDepartmentName] = useState('');
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [navigationLayout, setNavigationLayout] = useState<'top' | 'left'>('top');
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { initializeSession, hasSession, isLoading: sessionLoading } = useOnboardingSession();

  // Initialize session on mount
  useEffect(() => {
    if (!hasSession && !sessionLoading) {
      initializeSession().catch(err => {
        console.error('Failed to initialize session:', err);
        toast.error('Failed to start onboarding session. Please refresh the page.');
      });
    }
  }, [hasSession, sessionLoading, initializeSession]);

  const handleLogoChange = (file: File | null) => {
    if (!file) {
      setLogo(null);
      setLogoPreview(null);
      return;
    }

    // Validate file using secure validation utility
    const validation = isValidImageFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return;
    }

    setError(null);
    setLogo(file);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    handleLogoChange(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files?.[0] || null;
    handleLogoChange(file);
  };

  const handleRemoveLogo = () => {
    setLogo(null);
    setLogoPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleContinue = async () => {
    if (!departmentName.trim()) {
      setError('Please enter your department name');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // Save department info to server-side session
      const response = await apiClient.saveDepartmentInfo({
        name: departmentName,
        logo: logoPreview || undefined, // Base64 logo data (safe to send)
        navigation_layout: navigationLayout,
      });

      if (response.error) {
        setError(response.error);
        toast.error(response.error);
        setIsSaving(false);
        return;
      }

      // SECURITY: Only store non-sensitive data in sessionStorage for UI purposes
      sessionStorage.setItem('departmentName', departmentName);
      if (logoPreview) {
        sessionStorage.setItem('logoData', logoPreview);
      }
      sessionStorage.setItem('navigationLayout', navigationLayout);

      toast.success('Department information saved');

      // Navigate to navigation choice
      navigate('/onboarding/navigation-choice');
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to save department information';
      setError(errorMessage);
      toast.error(errorMessage);
      setIsSaving(false);
    }
  };

  const handleSkipLogo = async () => {
    if (!departmentName.trim()) {
      setError('Please enter your department name before continuing');
      return;
    }

    // Same as handleContinue but without logo
    await handleContinue();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-full mb-4">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-3">
            Let's Get Started
          </h1>
          <p className="text-xl text-slate-300">
            Tell us about your department
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-8 border border-white/20 space-y-6">
          {/* Department Name */}
          <div>
            <label
              htmlFor="departmentName"
              className="block text-sm font-semibold text-slate-200 mb-2"
            >
              Department Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              id="departmentName"
              value={departmentName}
              onChange={(e) => {
                setDepartmentName(e.target.value);
                setError(null);
              }}
              placeholder="e.g., Springfield Volunteer Fire Department"
              className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
              autoFocus
              aria-required="true"
              aria-invalid={error && !departmentName.trim() ? 'true' : 'false'}
            />
          </div>

          {/* Logo Upload */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-2">
              Department Logo <span className="text-slate-400 font-normal">(Optional)</span>
            </label>

            {!logoPreview ? (
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer ${
                  dragActive
                    ? 'border-red-500 bg-red-500/10'
                    : 'border-slate-600 hover:border-red-500 hover:bg-white/5'
                }`}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    fileInputRef.current?.click();
                  }
                }}
                aria-label="Upload department logo"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileInputChange}
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  className="hidden"
                  aria-label="File input for logo"
                />
                <div className="flex flex-col items-center space-y-3">
                  <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center">
                    <Upload className="w-8 h-8 text-slate-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium mb-1">
                      Drop your logo here, or click to browse
                    </p>
                    <p className="text-sm text-slate-400">
                      PNG, JPG or WebP (max 5MB)
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="border-2 border-slate-600 rounded-lg p-6 bg-slate-900/50">
                <div className="flex items-start space-x-4">
                  {/* Preview */}
                  <div className="flex-shrink-0 w-24 h-24 bg-white rounded-lg flex items-center justify-center overflow-hidden">
                    <img
                      src={logoPreview}
                      alt="Department logo preview"
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-white font-medium truncate">
                          {logo?.name}
                        </p>
                        <p className="text-sm text-slate-400 mt-1">
                          {logo && (logo.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <button
                        onClick={handleRemoveLogo}
                        className="flex-shrink-0 ml-4 p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                        aria-label="Remove logo"
                      >
                        <X className="w-5 h-5 text-red-400" />
                      </button>
                    </div>

                    {/* Change button */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-3 text-sm text-red-400 hover:text-red-300 font-medium transition-colors"
                    >
                      Change logo
                    </button>
                  </div>
                </div>
              </div>
            )}

            <p className="mt-2 text-xs text-slate-400 flex items-start">
              <ImageIcon className="w-4 h-4 mr-1 flex-shrink-0 mt-0.5" />
              <span>
                Your logo will be displayed in the header and on reports. You can change it later in settings.
              </span>
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <button
              onClick={handleContinue}
              disabled={!departmentName.trim() || isSaving}
              className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all duration-300 ${
                departmentName.trim() && !isSaving
                  ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
                  : 'bg-slate-700 text-slate-400 cursor-not-allowed'
              }`}
              aria-label="Continue to next step"
            >
              {isSaving ? 'Saving...' : 'Continue'}
            </button>

            {departmentName.trim() && !logo && (
              <button
                onClick={handleSkipLogo}
                className="sm:w-auto px-6 py-3 bg-transparent border border-slate-500 hover:border-slate-400 text-slate-300 hover:text-white rounded-lg font-semibold transition-all duration-300"
                aria-label="Skip logo upload"
              >
                Skip Logo for Now
              </button>
            )}
          </div>

          {/* Progress Indicator */}
          <div className="pt-4 border-t border-white/10">
            <div className="flex items-center justify-between text-sm text-slate-400 mb-2">
              <span>Setup Progress</span>
              <span>Step 1 of 7</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-red-600 to-orange-600 h-2 rounded-full transition-all duration-500"
                style={{ width: '14%' }}
                role="progressbar"
                aria-valuenow={14}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Setup progress: 14 percent complete"
              />
            </div>
          </div>
        </div>

        {/* Help Text */}
        <div className="mt-6 text-center">
          <p className="text-slate-400 text-sm">
            Need help?{' '}
            <a
              href="/docs"
              className="text-red-400 hover:text-red-300 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              View Documentation
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default DepartmentInfo;
