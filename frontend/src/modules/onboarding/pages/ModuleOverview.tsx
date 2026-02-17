import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Package,
  CheckCircle,
  XCircle,
  Clock4,
  Mail,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api-client';
import { ProgressIndicator, BackButton, ResetProgressButton, ErrorAlert, AutoSaveNotification } from '../components';
import { useApiRequest } from '../hooks';
import { useOnboardingStore } from '../store';
import { getUserFacingModules, type ModuleDefinition } from '../config';

const ModuleOverview: React.FC = () => {
  const navigate = useNavigate();
  const departmentName = useOnboardingStore(state => state.departmentName);
  const logoPreview = useOnboardingStore(state => state.logoData);
  const lastSaved = useOnboardingStore(state => state.lastSaved);
  const moduleStatuses = useOnboardingStore(state => state.moduleStatuses);
  const setModuleStatus = useOnboardingStore(state => state.setModuleStatus);
  const setModuleStatuses = useOnboardingStore(state => state.setModuleStatuses);
  const { execute, isLoading: isSaving, error, canRetry, clearError } = useApiRequest();

  // Get modules from the central registry (excludes system modules)
  const modules: ModuleDefinition[] = useMemo(() => getUserFacingModules(), []);

  // Initialize essential modules as enabled if store is empty
  React.useEffect(() => {
    if (Object.keys(moduleStatuses).length === 0) {
      const initialStatuses = modules
        .filter(m => m.priority === 'essential')
        .reduce((acc, m) => ({ ...acc, [m.id]: 'enabled' as const }), {} as Record<string, 'enabled' | 'skipped' | 'ignored'>);
      setModuleStatuses(initialStatuses);
    }
  }, [modules, moduleStatuses, setModuleStatuses]);

  const handleModuleAction = async (moduleId: string, action: 'start' | 'skip' | 'ignore') => {
    const module = modules.find(m => m.id === moduleId);

    if (action === 'start' && module?.configRoute) {
      // Save current state and navigate to module config
      setModuleStatus(moduleId, 'enabled');
      navigate(module.configRoute);
    } else if (action === 'skip') {
      setModuleStatus(moduleId, 'skipped');
      toast.success(`${module?.name} marked as "Configure Later"`);
    } else if (action === 'ignore') {
      setModuleStatus(moduleId, 'ignored');
      toast.success(`${module?.name} disabled`);
    }
  };

  const handleContinue = async () => {
    clearError();

    const { data: _data, error: apiError } = await execute(
      async () => {
        const response = await apiClient.saveModuleConfig({
          modules: Object.entries(moduleStatuses)
            .filter(([_, status]) => status === 'enabled')
            .map(([id]) => id),
        });

        if (response.error) {
          throw new Error(response.error);
        }

        toast.success('Module configuration saved!');
        navigate('/onboarding/admin-user');
        return response;
      },
      {
        step: 'Module Selection',
        action: 'Save module configuration',
      }
    );

    if (apiError) {
      return;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'essential': return 'text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/30';
      case 'recommended': return 'text-blue-700 dark:text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'optional': return 'text-theme-text-muted bg-slate-500/10 border-theme-input-border/30';
      default: return 'text-theme-text-muted bg-slate-500/10 border-theme-input-border/30';
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'enabled': return <CheckCircle className="w-4 h-4 text-green-700 dark:text-green-400" />;
      case 'skipped': return <Clock4 className="w-4 h-4 text-yellow-700 dark:text-yellow-400" />;
      case 'ignored': return <XCircle className="w-4 h-4 text-theme-text-muted" />;
      default: return null;
    }
  };

  const groupedModules = {
    essential: modules.filter(m => m.priority === 'essential'),
    recommended: modules.filter(m => m.priority === 'recommended'),
    optional: modules.filter(m => m.priority === 'optional'),
  };

  const enabledCount = Object.values(moduleStatuses).filter(s => s === 'enabled').length;
  const currentYear = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-bg via-red-900 to-theme-bg flex flex-col">
      <header className="bg-theme-input-bg backdrop-blur-sm border-b border-theme-surface-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center">
          {logoPreview ? (
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center overflow-hidden mr-4">
              <img src={logoPreview} alt={`${departmentName} logo`} className="max-w-full max-h-full object-contain" />
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

      <main className="flex-1 p-4 py-8">
        <div className="max-w-6xl w-full mx-auto">
          {/* Navigation Buttons */}
          <div className="flex justify-between items-center mb-6">
            <BackButton to="/onboarding/roles" />
            <ResetProgressButton />
          </div>

          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-full mb-4">
              <Package className="w-8 h-8 text-theme-text-primary" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-theme-text-primary mb-3">
              Choose Your Modules
            </h1>
            <p className="text-xl text-theme-text-secondary mb-2">
              Select which features you want to use
            </p>
            <p className="text-sm text-theme-text-muted max-w-2xl mx-auto">
              Don't worry - you can enable, disable, or reconfigure any module at any time from your dashboard.
              The platform is designed to be flexible and adapt to your needs as they evolve.
            </p>
          </div>

          {/* Stats Banner */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border mb-6 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="text-theme-text-primary">
                <span className="text-2xl font-bold">{enabledCount}</span>
                <span className="text-theme-text-muted ml-2">modules enabled</span>
              </div>
            </div>
            <button
              onClick={handleContinue}
              disabled={isSaving || enabledCount === 0}
              className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                enabledCount > 0 && !isSaving
                  ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-theme-text-primary'
                  : 'bg-theme-surface-hover text-theme-text-muted cursor-not-allowed'
              }`}
            >
              {isSaving ? 'Saving...' : 'Continue to Admin Setup'}
            </button>
          </div>

          {error && (
            <div className="max-w-md mx-auto mb-6">
              <ErrorAlert message={error} canRetry={canRetry} onRetry={handleContinue} onDismiss={clearError} />
            </div>
          )}

          {/* Essential Modules */}
          <div className="mb-8">
            <div className="flex items-center mb-4">
              <div className="flex-1 h-px bg-red-500/30"></div>
              <h2 className="px-4 text-lg font-bold text-red-700 dark:text-red-400">ESSENTIAL MODULES</h2>
              <div className="flex-1 h-px bg-red-500/30"></div>
            </div>
            <p className="text-center text-theme-text-muted text-sm mb-6">
              These core modules are recommended for all departments and are enabled by default
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {groupedModules.essential.map(module => {
                const Icon = module.icon;
                const status = moduleStatuses[module.id];
                return (
                  <div
                    key={module.id}
                    className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border-2 border-red-500/30 hover:border-red-500/50 transition-all"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center">
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        {status && getStatusIcon(status)}
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full border font-semibold ${getPriorityColor(module.priority)}`}>
                        ESSENTIAL
                      </span>
                    </div>
                    <h3 className="text-theme-text-primary font-bold text-lg mb-2">{module.name}</h3>
                    <p className="text-theme-text-secondary text-sm mb-4 leading-relaxed">{module.description}</p>
                    <div className="flex flex-col space-y-2">
                      <button
                        onClick={() => handleModuleAction(module.id, 'start')}
                        className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                      >
                        Configure Now
                      </button>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleModuleAction(module.id, 'skip')}
                          className="flex-1 px-4 py-2 bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-secondary rounded-lg text-sm transition-colors"
                        >
                          Later
                        </button>
                        <button
                          onClick={() => handleModuleAction(module.id, 'ignore')}
                          className="flex-1 px-4 py-2 bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-muted rounded-lg text-sm transition-colors"
                        >
                          Disable
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recommended Modules */}
          <div className="mb-8">
            <div className="flex items-center mb-4">
              <div className="flex-1 h-px bg-blue-500/30"></div>
              <h2 className="px-4 text-lg font-bold text-blue-700 dark:text-blue-400">RECOMMENDED MODULES</h2>
              <div className="flex-1 h-px bg-blue-500/30"></div>
            </div>
            <p className="text-center text-theme-text-muted text-sm mb-6">
              Popular modules that enhance operations - configure what fits your workflow
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {groupedModules.recommended.map(module => {
                const Icon = module.icon;
                const status = moduleStatuses[module.id];
                return (
                  <div
                    key={module.id}
                    className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border hover:border-blue-500/50 transition-all"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        {status && getStatusIcon(status)}
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full border font-semibold ${getPriorityColor(module.priority)}`}>
                        RECOMMENDED
                      </span>
                    </div>
                    <h3 className="text-theme-text-primary font-bold text-lg mb-2">{module.name}</h3>
                    <p className="text-theme-text-secondary text-sm mb-4 leading-relaxed">{module.description}</p>
                    <div className="flex flex-col space-y-2">
                      <button
                        onClick={() => handleModuleAction(module.id, 'start')}
                        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                      >
                        Configure Now
                      </button>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleModuleAction(module.id, 'skip')}
                          className="flex-1 px-4 py-2 bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-secondary rounded-lg text-sm transition-colors"
                        >
                          Skip For Now
                        </button>
                        <button
                          onClick={() => handleModuleAction(module.id, 'ignore')}
                          className="flex-1 px-4 py-2 bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-muted rounded-lg text-sm transition-colors"
                        >
                          Ignore
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Optional Modules */}
          <div className="mb-8">
            <div className="flex items-center mb-4">
              <div className="flex-1 h-px bg-theme-surface-border"></div>
              <h2 className="px-4 text-lg font-bold text-theme-text-muted">OPTIONAL MODULES</h2>
              <div className="flex-1 h-px bg-theme-surface-border"></div>
            </div>
            <p className="text-center text-theme-text-muted text-sm mb-6">
              Advanced features you can enable when needed - completely optional
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {groupedModules.optional.map(module => {
                const Icon = module.icon;
                const status = moduleStatuses[module.id];
                return (
                  <div
                    key={module.id}
                    className="bg-theme-surface-secondary backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border hover:border-theme-input-border/50 transition-all"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-2">
                        <div className="w-10 h-10 bg-theme-surface-hover rounded-lg flex items-center justify-center">
                          <Icon className="w-5 h-5 text-theme-text-secondary" />
                        </div>
                        {status && getStatusIcon(status)}
                      </div>
                    </div>
                    <h3 className="text-theme-text-primary font-bold text-base mb-2">{module.name}</h3>
                    <p className="text-theme-text-muted text-xs mb-4 leading-relaxed">{module.description}</p>
                    <div className="flex flex-col space-y-2">
                      <button
                        onClick={() => handleModuleAction(module.id, 'start')}
                        className="w-full px-3 py-2 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text-primary rounded-lg text-sm font-medium transition-colors"
                      >
                        Enable
                      </button>
                      <button
                        onClick={() => handleModuleAction(module.id, 'ignore')}
                        className="w-full px-3 py-2 bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-muted rounded-lg text-xs transition-colors"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Progress Indicator */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border">
            <ProgressIndicator currentStep={9} totalSteps={10} />
            <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
          </div>
        </div>
      </main>

      <footer className="bg-theme-input-bg backdrop-blur-sm border-t border-theme-surface-border px-6 py-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-theme-text-secondary text-sm">© {currentYear} {departmentName}. All rights reserved.</p>
          <p className="text-theme-text-muted text-xs mt-1">Powered by The Logbook</p>
        </div>
      </footer>
    </div>
  );
};

export default ModuleOverview;
