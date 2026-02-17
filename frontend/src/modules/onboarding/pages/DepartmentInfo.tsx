import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Building2, Image as ImageIcon, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { isValidImageFile } from '../utils/validation';
import { useOnboardingSession } from '../hooks/useOnboardingSession';
import { useApiRequest } from '../hooks';
import { ProgressIndicator, LoadingOverlay, ErrorAlert, AutoSaveNotification } from '../components';
import { useOnboardingStore } from '../store';

const DepartmentInfo: React.FC = () => {
  // Local UI state
  const [logo, setLogo] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Zustand store
  const departmentName = useOnboardingStore(state => state.departmentName);
  const setDepartmentName = useOnboardingStore(state => state.setDepartmentName);
  const logoPreview = useOnboardingStore(state => state.logoData);
  const setLogoPreview = useOnboardingStore(state => state.setLogoData);
  const lastSaved = useOnboardingStore(state => state.lastSaved);

  // Hooks
  const { initializeSession, hasSession, isLoading: sessionLoading } = useOnboardingSession();
  const { isLoading: isSaving, error, canRetry, clearError } = useApiRequest();

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
      toast.error(validation.error || 'Invalid file');
      return;
    }

    // Show warning if file is large but still valid
    if (validation.warning) {
      toast(validation.warning, { icon: '⚠️' });
    }

    clearError();
    setLogo(file);
    setIsProcessingFile(true); // Show loading overlay

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoPreview(reader.result as string);
      setIsProcessingFile(false); // Hide loading overlay
    };
    reader.onerror = () => {
      toast.error('Failed to read image file');
      setIsProcessingFile(false);
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

  const handleContinue = () => {
    // Validation
    if (!departmentName.trim()) {
      toast.error('Please enter your department name');
      return;
    }

    if (departmentName.trim().length < 3) {
      toast.error('Department name must be at least 3 characters');
      return;
    }

    if (departmentName.length > 100) {
      toast.error('Department name must be less than 100 characters');
      return;
    }

    // Data is already stored in Zustand store with persistence
    // Navigate to navigation choice (step 2)
    navigate('/onboarding/navigation-choice');
  };

  const handleSkipLogo = () => {
    if (!departmentName.trim()) {
      toast.error('Please enter your department name before continuing');
      return;
    }

    // Same as handleContinue but without logo
    handleContinue();
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
                clearError();
              }}
              placeholder="e.g., Springfield Volunteer Fire Department"
              className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
              maxLength={100}
              autoFocus
              aria-required="true"
              aria-invalid={error ? 'true' : 'false'}
              aria-describedby="departmentNameHelp"
            />
            <p id="departmentNameHelp" className="mt-1 text-xs text-slate-400">
              {departmentName.length}/100 characters
            </p>
          </div>

          {/* Logo Upload */}
          <div className="relative">
            <label className="block text-sm font-semibold text-slate-200 mb-2">
              Department Logo <span className="text-slate-400 font-normal">(Optional)</span>
            </label>

            <div className="relative">
              <LoadingOverlay isVisible={isProcessingFile} message="Processing image..." />

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
                  {/* Preview - transparent background to preserve PNG transparency */}
                  <div className="flex-shrink-0 w-24 h-24 rounded-lg flex items-center justify-center overflow-hidden bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZTJlOGYwIi8+PHJlY3QgeD0iOCIgeT0iOCIgd2lkdGg9IjgiIGhlaWdodD0iOCIgZmlsbD0iI2UyZThmMCIvPjxyZWN0IHg9IjgiIHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiNmMWY1ZjkiLz48cmVjdCB5PSI4IiB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZjFmNWY5Ii8+PC9zdmc+')]">
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
            </div>

            <p className="mt-2 text-xs text-slate-400 flex items-start">
              <ImageIcon className="w-4 h-4 mr-1 flex-shrink-0 mt-0.5" />
              <span>
                Your logo will be displayed in the header and on reports. You can change it later in settings.
              </span>
            </p>
          </div>

          {/* Error Message */}
          {/* Error Alert */}
          {error && (
            <ErrorAlert
              message={error}
              canRetry={canRetry}
              onRetry={handleContinue}
              onDismiss={clearError}
            />
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
          <ProgressIndicator currentStep={1} totalSteps={10} className="pt-4 border-t border-white/10" />

          {/* Auto-save Notification */}
          <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
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
