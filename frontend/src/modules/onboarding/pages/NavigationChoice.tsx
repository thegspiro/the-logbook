import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, PanelLeft } from 'lucide-react';

const NavigationChoice: React.FC = () => {
  const [departmentName, setDepartmentName] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [selectedLayout, setSelectedLayout] = useState<'top' | 'left' | null>(null);
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

  const handleContinue = () => {
    if (!selectedLayout) return;

    // Store navigation preference
    sessionStorage.setItem('navigationLayout', selectedLayout);

    // Navigate to email platform choice
    navigate('/onboarding/email-platform');
  };

  const currentYear = new Date().getFullYear();

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
              <LayoutDashboard className="w-6 h-6 text-white" />
            </div>
          )}
          <div>
            <h1 className="text-white text-lg font-semibold">{departmentName}</h1>
            <p className="text-slate-400 text-sm">Setup in Progress</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full">
          {/* Page Header */}
          <div className="text-center mb-8">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-3">
              Choose Your Navigation Style
            </h2>
            <p className="text-xl text-slate-300">
              How would you like to navigate your intranet?
            </p>
          </div>

          {/* Navigation Options */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* Top Navigation Option */}
            <button
              onClick={() => setSelectedLayout('top')}
              className={`group relative bg-white/10 backdrop-blur-sm rounded-lg border-2 transition-all duration-300 overflow-hidden ${
                selectedLayout === 'top'
                  ? 'border-red-500 shadow-lg shadow-red-500/50'
                  : 'border-white/20 hover:border-red-400/50'
              }`}
              aria-pressed={selectedLayout === 'top'}
              aria-label="Top navigation layout"
            >
              <div className="p-6">
                {/* Icon */}
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-colors ${
                    selectedLayout === 'top'
                      ? 'bg-red-600'
                      : 'bg-slate-800 group-hover:bg-red-600/20'
                  }`}
                >
                  <LayoutDashboard
                    className={`w-8 h-8 transition-colors ${
                      selectedLayout === 'top' ? 'text-white' : 'text-slate-400'
                    }`}
                  />
                </div>

                {/* Title */}
                <h3 className="text-2xl font-bold text-white mb-2">
                  Top Navigation
                </h3>
                <p className="text-slate-300 mb-6">
                  Links displayed horizontally across the top of the page
                </p>

                {/* Preview */}
                <div className="bg-slate-900/80 rounded-lg p-4 border border-slate-700">
                  <div className="space-y-2">
                    {/* Header bar */}
                    <div className="bg-slate-800 rounded h-8 flex items-center px-2 space-x-1">
                      <div className="bg-red-500 rounded h-4 w-12"></div>
                      <div className="bg-slate-600 rounded h-4 w-16"></div>
                      <div className="bg-slate-600 rounded h-4 w-16"></div>
                      <div className="bg-slate-600 rounded h-4 w-16"></div>
                      <div className="bg-slate-600 rounded h-4 w-16"></div>
                    </div>
                    {/* Content area */}
                    <div className="bg-slate-700 rounded h-32"></div>
                  </div>
                  <p className="text-xs text-slate-400 mt-3 text-center">
                    Horizontal menu bar
                  </p>
                </div>

                {/* Benefits */}
                <ul className="mt-4 space-y-2 text-sm text-slate-300">
                  <li className="flex items-start">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>More horizontal screen space</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>Familiar website layout</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>Better for wide screens</span>
                  </li>
                </ul>
              </div>

              {/* Selected indicator */}
              {selectedLayout === 'top' && (
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

            {/* Left Sidebar Option */}
            <button
              onClick={() => setSelectedLayout('left')}
              className={`group relative bg-white/10 backdrop-blur-sm rounded-lg border-2 transition-all duration-300 overflow-hidden ${
                selectedLayout === 'left'
                  ? 'border-red-500 shadow-lg shadow-red-500/50'
                  : 'border-white/20 hover:border-red-400/50'
              }`}
              aria-pressed={selectedLayout === 'left'}
              aria-label="Left sidebar navigation layout"
            >
              <div className="p-6">
                {/* Icon */}
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-colors ${
                    selectedLayout === 'left'
                      ? 'bg-red-600'
                      : 'bg-slate-800 group-hover:bg-red-600/20'
                  }`}
                >
                  <PanelLeft
                    className={`w-8 h-8 transition-colors ${
                      selectedLayout === 'left' ? 'text-white' : 'text-slate-400'
                    }`}
                  />
                </div>

                {/* Title */}
                <h3 className="text-2xl font-bold text-white mb-2">
                  Left Sidebar
                </h3>
                <p className="text-slate-300 mb-6">
                  Links displayed vertically down the left side of the page
                </p>

                {/* Preview */}
                <div className="bg-slate-900/80 rounded-lg p-4 border border-slate-700">
                  <div className="flex space-x-2">
                    {/* Sidebar */}
                    <div className="bg-slate-800 rounded w-16 flex flex-col space-y-1 p-1">
                      <div className="bg-red-500 rounded h-4 w-full"></div>
                      <div className="bg-slate-600 rounded h-4 w-full"></div>
                      <div className="bg-slate-600 rounded h-4 w-full"></div>
                      <div className="bg-slate-600 rounded h-4 w-full"></div>
                      <div className="bg-slate-600 rounded h-4 w-full"></div>
                    </div>
                    {/* Content area */}
                    <div className="bg-slate-700 rounded flex-1 h-32"></div>
                  </div>
                  <p className="text-xs text-slate-400 mt-3 text-center">
                    Vertical sidebar menu
                  </p>
                </div>

                {/* Benefits */}
                <ul className="mt-4 space-y-2 text-sm text-slate-300">
                  <li className="flex items-start">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>More vertical navigation space</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>App-like experience</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>Better for many menu items</span>
                  </li>
                </ul>
              </div>

              {/* Selected indicator */}
              {selectedLayout === 'left' && (
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
          </div>

          {/* Continue Button */}
          <div className="max-w-md mx-auto">
            <button
              onClick={handleContinue}
              disabled={!selectedLayout}
              className={`w-full px-8 py-4 rounded-lg font-semibold text-lg transition-all duration-300 ${
                selectedLayout
                  ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
                  : 'bg-slate-700 text-slate-400 cursor-not-allowed'
              }`}
              aria-label="Continue to next step"
            >
              Continue
            </button>

            {/* Help Text */}
            <p className="text-center text-slate-400 text-sm mt-4">
              Don't worry, you can change this later in settings
            </p>

            {/* Progress Indicator */}
            <div className="mt-6 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between text-sm text-slate-400 mb-2">
                <span>Setup Progress</span>
                <span>Step 2 of 7</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-red-600 to-orange-600 h-2 rounded-full transition-all duration-500"
                  style={{ width: '28%' }}
                  role="progressbar"
                  aria-valuenow={28}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Setup progress: 28 percent complete"
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

export default NavigationChoice;
