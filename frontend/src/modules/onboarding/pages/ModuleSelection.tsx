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
import { apiClient } from '../services/api-client';
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
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!departmentName) {
      navigate('/onboarding/start');
      return;
    }

    // Initialize with all enabled modules by default
    const defaultEnabled = AVAILABLE_MODULES.filter((m) => m.enabled).map((m) => m.id);
    setSelectedModules(defaultEnabled);
  }, [departmentName, navigate]);

  const toggleModule = (moduleId: string) => {
    const module = AVAILABLE_MODULES.find((m) => m.id === moduleId);
    if (!module || !module.canDisable) return; // Can't toggle core modules

    setSelectedModules((prev) =>
      prev.includes(moduleId) ? prev.filter((id) => id !== moduleId) : [...prev, moduleId]
    );
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
      navigate('/onboarding/admin-user');
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to save module configuration';
      toast.error(errorMessage);
      setIsSaving(false);
    }
  };

  const renderModuleCard = (module: Module) => {
    const isSelected = selectedModules.includes(module.id);
    const isExpanded = expandedModule === module.id;
    const icon = iconMap[module.icon] || <Circle className="w-6 h-6" />;

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
        className={`bg-white/10 backdrop-blur-sm rounded-lg border-2 transition-all duration-300 ${
          isSelected
            ? 'border-white/40 shadow-lg'
            : module.canDisable
            ? 'border-white/10 hover:border-white/20'
            : 'border-white/20'
        }`}
      >
        <div
          className={`p-4 ${module.canDisable ? 'cursor-pointer' : 'cursor-default'}`}
          onClick={() => module.canDisable && toggleModule(module.id)}
        >
          <div className="flex items-start space-x-4">
            {/* Selection Indicator */}
            <div className="flex-shrink-0 mt-1">
              {isSelected ? (
                <CheckCircle className="w-6 h-6 text-green-400" />
              ) : module.canDisable ? (
                <Circle className="w-6 h-6 text-slate-400" />
              ) : (
                <CheckCircle className="w-6 h-6 text-blue-400" />
              )}
            </div>

            {/* Icon */}
            <div className={`flex-shrink-0 bg-gradient-to-br ${getCategoryColor()} rounded-lg p-3`}>
              <div className="text-white">{icon}</div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-bold text-white">{module.name}</h3>
                {getCategoryBadge()}
              </div>
              <p className="text-slate-300 text-sm mb-2">{module.description}</p>

              {/* Expand/Collapse Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpanded(module.id);
                }}
                className="text-cyan-400 text-sm font-medium hover:text-cyan-300 flex items-center space-x-1"
              >
                <span>{isExpanded ? 'Less' : 'More'} info</span>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {!module.canDisable && (
                <p className="text-blue-400 text-xs mt-2 flex items-center space-x-1">
                  <Info className="w-3 h-3" />
                  <span>Always enabled</span>
                </p>
              )}

              {module.requiresSetup && (
                <p className="text-yellow-400 text-xs mt-2 flex items-center space-x-1">
                  <Info className="w-3 h-3" />
                  <span>{module.setupDescription}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="border-t border-white/10 p-4 bg-slate-900/30">
            <h4 className="text-white font-semibold mb-2">About this module</h4>
            <p className="text-slate-300 text-sm mb-4">{module.longDescription}</p>

            <h4 className="text-white font-semibold mb-2">Key features</h4>
            <ul className="space-y-1">
              {module.features.map((feature, index) => (
                <li key={index} className="text-slate-300 text-sm flex items-start space-x-2">
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const coreModules = AVAILABLE_MODULES.filter((m) => m.category === 'core');
  const recommendedModules = AVAILABLE_MODULES.filter((m) => m.category === 'recommended');
  const optionalModules = AVAILABLE_MODULES.filter((m) => m.category === 'optional');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex flex-col">
      <OnboardingHeader departmentName={departmentName} logoPreview={logoPreview} />

      <main className="flex-1 flex items-center justify-center p-4 py-8">
        <div className="max-w-5xl w-full">
          {/* Page Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-600 rounded-full mb-4">
              <Settings className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-3">Select Modules</h2>
            <p className="text-xl text-slate-300 mb-2">
              Choose which features to enable for your department
            </p>
            <p className="text-sm text-slate-400">
              Don't worry – modules can be enabled, disabled, or added later in System Settings
            </p>
          </div>

          {/* Info Banner */}
          <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-blue-300 text-sm font-medium mb-1">Module Categories</p>
                <div className="text-blue-200 text-sm space-y-1">
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
            <h3 className="text-2xl font-bold text-white mb-4 flex items-center space-x-2">
              <span>Core Modules</span>
              <span className="text-sm font-normal text-slate-400">(Always Enabled)</span>
            </h3>
            <div className="space-y-4">{coreModules.map(renderModuleCard)}</div>
          </div>

          {/* Recommended Modules */}
          <div className="mb-8">
            <h3 className="text-2xl font-bold text-white mb-4 flex items-center space-x-2">
              <span>Recommended Modules</span>
              <span className="text-sm font-normal text-slate-400">(Click to toggle)</span>
            </h3>
            <div className="space-y-4">{recommendedModules.map(renderModuleCard)}</div>
          </div>

          {/* Optional Modules */}
          <div className="mb-8">
            <h3 className="text-2xl font-bold text-white mb-4 flex items-center space-x-2">
              <span>Optional Modules</span>
              <span className="text-sm font-normal text-slate-400">(Click to enable)</span>
            </h3>
            <div className="space-y-4">{optionalModules.map(renderModuleCard)}</div>
          </div>

          {/* Summary */}
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20 mb-8">
            <h3 className="text-xl font-bold text-white mb-2">Selection Summary</h3>
            <p className="text-slate-300 text-sm mb-4">
              You have selected <strong>{selectedModules.length}</strong> modules (
              {coreModules.length} core, {selectedModules.filter((id) => recommendedModules.some((m) => m.id === id)).length} recommended,{' '}
              {selectedModules.filter((id) => optionalModules.some((m) => m.id === id)).length} optional)
            </p>
            <p className="text-slate-400 text-xs">
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
                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
              }`}
            >
              {isSaving ? 'Saving Module Configuration...' : 'Continue to Admin Setup'}
            </button>

            {/* Progress Indicator */}
            <ProgressIndicator
              currentStep={8}
              totalSteps={9}
              className="mt-6 pt-6 border-t border-white/10"
            />
          </div>
        </div>
      </main>

      <OnboardingFooter departmentName={departmentName} />
    </div>
  );
};

export default ModuleSelection;
