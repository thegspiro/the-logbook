import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle,
  Circle,
  Info,
  LayoutDashboard,
  Users,
  Calendar,
  UserCog,
  Settings,
  Truck,
  Package,
  MessageSquare,
  GraduationCap,
  FileText,
  FolderOpen,
  Briefcase,
  DollarSign,
  Globe,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { OnboardingHeader, OnboardingFooter, ProgressIndicator } from '../components';
import { useOnboardingStorage } from '../hooks';
import { useOnboardingStore } from '../store';
import { apiClient } from '../services/api-client';
import { getErrorMessage } from '@/utils/errorHandling';
import { AVAILABLE_MODULES, Module } from '../../../types/modules';

// Icon mapping
const iconMap: Record<string, React.ReactNode> = {
  LayoutDashboard: <LayoutDashboard className="w-6 h-6" />,
  Users: <Users className="w-6 h-6" />,
  Calendar: <Calendar className="w-6 h-6" />,
  UserCog: <UserCog className="w-6 h-6" />,
  Settings: <Settings className="w-6 h-6" />,
  Truck: <Truck className="w-6 h-6" />,
  Package: <Package className="w-6 h-6" />,
  MessageSquare: <MessageSquare className="w-6 h-6" />,
  GraduationCap: <GraduationCap className="w-6 h-6" />,
  FileText: <FileText className="w-6 h-6" />,
  FolderOpen: <FolderOpen className="w-6 h-6" />,
  Briefcase: <Briefcase className="w-6 h-6" />,
  DollarSign: <DollarSign className="w-6 h-6" />,
  Globe: <Globe className="w-6 h-6" />,
};

const ModuleSelection: React.FC = () => {
  const navigate = useNavigate();
  const { departmentName, logoPreview } = useOnboardingStorage();

  // Use Zustand store for persisted module selection
  const selectedModules = useOnboardingStore((state) => state.selectedModules);
  const setSelectedModules = useOnboardingStore((state) => state.setSelectedModules);
  const storeToggleModule = useOnboardingStore((state) => state.toggleModule);

  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!departmentName) {
      navigate('/onboarding/start');
      return;
    }

    // Only initialize with defaults if no modules have been selected yet
    if (selectedModules.length === 0) {
      const defaultEnabled = AVAILABLE_MODULES.filter((m) => m.enabled).map((m) => m.id);
      setSelectedModules(defaultEnabled);
    }
  }, [departmentName, navigate, selectedModules.length, setSelectedModules]);

  const toggleModule = (moduleId: string) => {
    const module = AVAILABLE_MODULES.find((m) => m.id === moduleId);
    if (!module || !module.canDisable) return; // Can't toggle core modules

    storeToggleModule(moduleId);
  };

  const toggleExpanded = (moduleId: string) => {
    setExpandedModule(expandedModule === moduleId ? null : moduleId);
  };

  const handleContinue = async () => {
    setIsSaving(true);

    try {
      // Save module configuration to server
      const response = await apiClient.saveModuleConfig({
        modules: selectedModules,
      });

      if (response.error) {
        toast.error(response.error);
        setIsSaving(false);
        return;
      }

      // Store in sessionStorage for reference
      sessionStorage.setItem('selectedModules', JSON.stringify(selectedModules));

      toast.success('Module configuration saved');

      // Navigate to admin user creation
      navigate('/onboarding/system-owner');
    } catch (err: unknown) {
      const errorMessage = getErrorMessage(err, 'Failed to save module configuration');
      toast.error(errorMessage);
      setIsSaving(false);
    }
  };

  const renderModuleCard = (module: Module) => {
    const isSelected = selectedModules.includes(module.id);
    const isExpanded = expandedModule === module.id;
    const icon = iconMap[module.icon] || <Circle aria-hidden="true" className="w-6 h-6" />;

    const getCategoryColor = () => {
      switch (module.category) {
        case 'core':
          return 'from-blue-600 to-cyan-600';
        case 'recommended':
          return 'from-green-600 to-emerald-600';
        case 'optional':
          return 'from-purple-600 to-pink-600';
      }
    };

    const getCategoryBadge = () => {
      switch (module.category) {
        case 'core':
          return (
            <span className="text-xs font-semibold px-2 py-1 bg-blue-600 text-white rounded">
              CORE
            </span>
          );
        case 'recommended':
          return (
            <span className="text-xs font-semibold px-2 py-1 bg-green-600 text-white rounded">
              RECOMMENDED
            </span>
          );
        case 'optional':
          return (
            <span className="text-xs font-semibold px-2 py-1 bg-purple-600 text-white rounded">
              OPTIONAL
            </span>
          );
      }
    };

    return (
      <div
        key={module.id}
        className={`bg-theme-surface backdrop-blur-sm rounded-lg border-2 transition-all duration-300 ${
          isSelected
            ? 'border-theme-surface-border shadow-lg ring-2 ring-white/40'
            : module.canDisable
            ? 'border-theme-surface-border hover:border-theme-surface-hover'
            : 'border-theme-surface-border'
        }`}
      >
        <div
          className={`p-4 ${module.canDisable ? 'cursor-pointer' : 'cursor-default'}`}
          onClick={() => module.canDisable && toggleModule(module.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleModule(module.id); } }}
        >
          <div className="flex items-start space-x-4">
            {/* Selection Indicator */}
            <div className="flex-shrink-0 mt-1">
              {isSelected ? (
                <CheckCircle aria-hidden="true" className="w-6 h-6 text-theme-accent-green" />
              ) : module.canDisable ? (
                <Circle aria-hidden="true" className="w-6 h-6 text-theme-text-muted" />
              ) : (
                <CheckCircle aria-hidden="true" className="w-6 h-6 text-theme-accent-blue" />
              )}
            </div>

            {/* Icon */}
            <div className={`flex-shrink-0 bg-gradient-to-br ${getCategoryColor()} rounded-lg p-3`}>
              <div className="text-white">{icon}</div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-bold text-theme-text-primary">{module.name}</h3>
                {getCategoryBadge()}
              </div>
              <p className="text-theme-text-secondary text-sm mb-3">{module.description}</p>

              {/* Key Features - Always Visible */}
              <div className="mb-3">
                <h4 className="text-theme-text-primary text-xs font-semibold mb-1.5 uppercase tracking-wide">Key Features:</h4>
                <ul className="space-y-1">
                  {module.features.slice(0, 3).map((feature, index) => (
                    <li key={index} className="text-theme-text-secondary text-sm flex items-start space-x-2">
                      <CheckCircle aria-hidden="true" className="w-3.5 h-3.5 text-theme-accent-green flex-shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                  {module.features.length > 3 && !isExpanded && (
                    <li className="text-theme-text-muted text-sm italic">
                      + {module.features.length - 3} more feature{module.features.length - 3 !== 1 ? 's' : ''}
                    </li>
                  )}
                </ul>
              </div>

              {/* Expand/Collapse Button - Only for additional details */}
              {module.longDescription && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpanded(module.id);
                  }}
                  className="text-theme-accent-cyan text-sm font-medium hover:text-theme-accent-cyan flex items-center space-x-1 mb-2"
                >
                  <span>{isExpanded ? 'Hide' : 'View'} full details</span>
                  {isExpanded ? (
                    <ChevronUp aria-hidden="true" className="w-4 h-4" />
                  ) : (
                    <ChevronDown aria-hidden="true" className="w-4 h-4" />
                  )}
                </button>
              )}

              {!module.canDisable && (
                <p className="text-theme-alert-info-icon text-xs mt-2 flex items-center space-x-1">
                  <Info aria-hidden="true" className="w-3 h-3" />
                  <span>Always enabled</span>
                </p>
              )}

              {module.requiresSetup && (
                <p className="text-theme-alert-warning-icon text-xs mt-2 flex items-center space-x-1">
                  <Info aria-hidden="true" className="w-3 h-3" />
                  <span>{module.setupDescription}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Expanded Details - Full Description and All Features */}
        {isExpanded && (
          <div className="border-t border-theme-nav-border p-4 bg-theme-surface-secondary">
            <h4 className="text-theme-text-primary font-semibold mb-2">About this module</h4>
            <p className="text-theme-text-secondary text-sm mb-4">{module.longDescription}</p>

            {module.features.length > 3 && (
              <>
                <h4 className="text-theme-text-primary font-semibold mb-2">All features ({module.features.length})</h4>
                <ul className="space-y-1">
                  {module.features.map((feature, index) => (
                    <li key={index} className="text-theme-text-secondary text-sm flex items-start space-x-2">
                      <CheckCircle aria-hidden="true" className="w-4 h-4 text-theme-accent-green flex-shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const coreModules = AVAILABLE_MODULES.filter((m) => m.category === 'core');
  const recommendedModules = AVAILABLE_MODULES.filter((m) => m.category === 'recommended');
  const optionalModules = AVAILABLE_MODULES.filter((m) => m.category === 'optional');

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex flex-col">
      <OnboardingHeader departmentName={departmentName} logoPreview={logoPreview} />

      <main className="flex-1 flex items-center justify-center p-4 py-8">
        <div className="max-w-5xl w-full">
          {/* Page Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-600 rounded-full mb-4">
              <Settings aria-hidden="true" className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-theme-text-primary mb-3">Select Modules</h2>
            <p className="text-xl text-theme-text-secondary mb-2">
              Choose which features to enable for your department
            </p>
            <p className="text-sm text-theme-text-muted">
              Don't worry – modules can be enabled, disabled, or added later in System Settings
            </p>
          </div>

          {/* Info Banner */}
          <div className="alert-info mb-6">
            <div className="flex items-start space-x-3">
              <Info aria-hidden="true" className="w-5 h-5 text-theme-alert-info-icon flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-theme-alert-info-title text-sm font-medium mb-1">Module Categories</p>
                <div className="text-theme-alert-info-text text-sm space-y-1">
                  <p>
                    <strong>Core Modules:</strong> Always enabled – essential for all departments
                  </p>
                  <p>
                    <strong>Recommended Modules:</strong> Enabled by default – highly useful for most
                    departments
                  </p>
                  <p>
                    <strong>Optional Modules:</strong> Enable based on your specific needs
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Core Modules */}
          <div className="mb-8">
            <h3 className="text-2xl font-bold text-theme-text-primary mb-4 flex items-center space-x-2">
              <span>Core Modules</span>
              <span className="text-sm font-normal text-theme-text-muted">(Always Enabled)</span>
            </h3>
            <div className="space-y-4">{coreModules.map(renderModuleCard)}</div>
          </div>

          {/* Recommended Modules */}
          <div className="mb-8">
            <h3 className="text-2xl font-bold text-theme-text-primary mb-4 flex items-center space-x-2">
              <span>Recommended Modules</span>
              <span className="text-sm font-normal text-theme-text-muted">(Click to toggle)</span>
            </h3>
            <div className="space-y-4">{recommendedModules.map(renderModuleCard)}</div>
          </div>

          {/* Optional Modules */}
          <div className="mb-8">
            <h3 className="text-2xl font-bold text-theme-text-primary mb-4 flex items-center space-x-2">
              <span>Optional Modules</span>
              <span className="text-sm font-normal text-theme-text-muted">(Click to enable)</span>
            </h3>
            <div className="space-y-4">{optionalModules.map(renderModuleCard)}</div>
          </div>

          {/* Summary */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border mb-8">
            <h3 className="text-xl font-bold text-theme-text-primary mb-2">Selection Summary</h3>
            <p className="text-theme-text-secondary text-sm mb-4">
              You have selected <strong>{selectedModules.length}</strong> modules (
              {coreModules.length} core, {selectedModules.filter((id) => recommendedModules.some((m) => m.id === id)).length} recommended,{' '}
              {selectedModules.filter((id) => optionalModules.some((m) => m.id === id)).length} optional)
            </p>
            <p className="text-theme-text-muted text-xs">
              💡 You can enable or disable modules at any time from System Settings
            </p>
          </div>

          {/* Continue Button */}
          <div className="max-w-md mx-auto">
            <button
              onClick={handleContinue}
              disabled={isSaving}
              className={`w-full px-8 py-4 rounded-lg font-semibold text-lg transition-all duration-300 ${
                isSaving
                  ? 'bg-theme-surface text-theme-text-muted cursor-not-allowed'
                  : 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
              }`}
            >
              {isSaving ? 'Saving Module Configuration...' : 'Continue to Admin Setup'}
            </button>

          </div>

          {/* Progress Indicator */}
          <ProgressIndicator
            currentStep={8}
            totalSteps={10}
            className="mt-6 pt-6 border-t border-theme-nav-border"
          />
        </div>
      </main>

      <OnboardingFooter departmentName={departmentName} />
    </div>
  );
};

export default ModuleSelection;
