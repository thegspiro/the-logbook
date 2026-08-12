import React, { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Package, CheckCircle, XCircle, Clock4, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api-client';
import {
  OnboardingHeader,
  ProgressIndicator,
  BackButton,
  ResetProgressButton,
  ErrorAlert,
  AutoSaveNotification,
} from '../components';
import { useApiRequest } from '../hooks';
import { useOnboardingStore } from '../store';
import { getUserFacingModules, type ModuleDefinition } from '../config';
import { FeatureStatus } from '../../../constants/enums';

const ModuleOverview: React.FC = () => {
  const navigate = useNavigate();
  const departmentName = useOnboardingStore((state) => state.departmentName);
  const logoPreview = useOnboardingStore((state) => state.logoData);
  const lastSaved = useOnboardingStore((state) => state.lastSaved);
  const moduleStatuses = useOnboardingStore((state) => state.moduleStatuses);
  const setModuleStatus = useOnboardingStore((state) => state.setModuleStatus);
  const setModuleStatuses = useOnboardingStore((state) => state.setModuleStatuses);
  const { execute, isLoading: isSaving, error, canRetry, clearError } = useApiRequest();

  // Guard: redirect to start if org setup hasn't been completed
  React.useEffect(() => {
    if (!departmentName) {
      void navigate('/onboarding/start');
    }
  }, [departmentName, navigate]);

  // Get modules from the central registry (excludes system modules)
  const modules: ModuleDefinition[] = useMemo(() => getUserFacingModules(), []);

  // Initialize essential modules as enabled if store is empty
  React.useEffect(() => {
    if (Object.keys(moduleStatuses).length === 0) {
      const initialStatuses = modules
        .filter((m) => m.priority === 'essential')
        .reduce(
          (acc, m) => ({ ...acc, [m.id]: 'enabled' as const }),
          {} as Record<string, 'enabled' | 'skipped' | 'ignored'>
        );
      setModuleStatuses(initialStatuses);
    }
  }, [modules, moduleStatuses, setModuleStatuses]);

  const handleModuleAction = (moduleId: string, action: 'start' | 'skip' | 'ignore') => {
    const module = modules.find((m) => m.id === moduleId);

    if (action === 'start' && module?.configRoute) {
      // Save current state and navigate to module config
      setModuleStatus(moduleId, 'enabled');
      void navigate(module.configRoute);
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
            .filter(([_, status]) => status === FeatureStatus.ENABLED)
            .map(([id]) => id),
        });

        if (response.error) {
          throw new Error(response.error);
        }

        toast.success('Module configuration saved! Finalizing setup...');

        // Complete onboarding
        const completeResponse = await apiClient.completeOnboarding();

        if (completeResponse.error) {
          throw new Error('Modules saved but setup could not be finalized. Please contact support.');
        }

        toast.success('Setup complete!');

        // Ensure auth store is loaded before navigating — the completion
        // screen links straight into the protected /setup route.
        const { useAuthStore } = await import('../../../stores/authStore');
        await useAuthStore.getState().loadUser();

        void navigate('/onboarding/complete');
        return response;
      },
      {
        step: 'Module Selection',
        action: 'Save modules and complete onboarding',
      }
    );

    if (apiError) {
      return;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'essential':
        return 'text-theme-alert-danger-text bg-theme-alert-danger-bg border-theme-alert-danger-border';
      case 'recommended':
        return 'text-theme-alert-info-text bg-theme-alert-info-bg border-theme-alert-info-border';
      case 'optional':
        return 'text-theme-text-muted bg-theme-surface-secondary border-theme-surface-border';
      default:
        return 'text-theme-text-muted bg-theme-surface-secondary border-theme-surface-border';
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'enabled':
        return <CheckCircle aria-hidden="true" className="text-theme-accent-green h-4 w-4" />;
      case 'skipped':
        return <Clock4 aria-hidden="true" className="text-theme-accent-yellow h-4 w-4" />;
      case 'ignored':
        return <XCircle aria-hidden="true" className="text-theme-text-muted h-4 w-4" />;
      default:
        return null;
    }
  };

  const groupedModules = {
    essential: modules.filter((m) => m.priority === 'essential'),
    recommended: modules.filter((m) => m.priority === 'recommended'),
    optional: modules.filter((m) => m.priority === 'optional'),
  };

  const enabledCount = Object.values(moduleStatuses).filter((s) => s === FeatureStatus.ENABLED).length;
  const currentYear = new Date().getFullYear();

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to safe-top flex min-h-screen flex-col bg-linear-to-br">
      <OnboardingHeader
        departmentName={departmentName}
        logoPreview={logoPreview}
        icon={<Mail aria-hidden="true" className="h-6 w-6 text-white" />}
      />

      <main className="flex-1 p-4 py-8">
        <div className="mx-auto w-full max-w-6xl">
          {/* Navigation Buttons */}
          <div className="mb-6 flex items-center justify-between">
            <BackButton to="/onboarding/positions" />
            <ResetProgressButton />
          </div>

          {/* Header */}
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-600">
              <Package aria-hidden="true" className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-theme-text-primary mb-3 text-4xl font-bold md:text-5xl">Choose Your Modules</h1>
            <p className="text-theme-text-secondary mb-2 text-xl">Select which features you want to use</p>
            <p className="text-theme-text-muted mx-auto max-w-2xl text-sm">
              Don't worry - you can enable, disable, or reconfigure any module at any time from your dashboard. The
              platform is designed to be flexible and adapt to your needs as they evolve.
            </p>
          </div>

          {/* Stats Banner */}
          <div className="card mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center space-x-4">
              <div className="text-theme-text-primary">
                <span className="text-2xl font-bold">{enabledCount}</span>
                <span className="text-theme-text-muted ml-2">modules enabled</span>
              </div>
            </div>
            <button
              onClick={() => {
                void handleContinue();
              }}
              disabled={isSaving || enabledCount === 0}
              className={`rounded-lg px-6 py-2 font-semibold transition-all ${
                enabledCount > 0 && !isSaving
                  ? 'bg-linear-to-r from-red-600 to-orange-600 text-white hover:from-red-700 hover:to-orange-700'
                  : 'bg-theme-surface text-theme-text-muted cursor-not-allowed'
              }`}
            >
              {isSaving ? 'Finalizing Setup...' : 'Complete Setup & Go to Dashboard'}
            </button>
          </div>

          {error && (
            <div className="mx-auto mb-6 max-w-md">
              <ErrorAlert message={error} canRetry={canRetry} onRetry={handleContinue} onDismiss={clearError} />
            </div>
          )}

          {/* Essential Modules */}
          <div className="mb-8">
            <div className="mb-4 flex items-center">
              <div className="bg-theme-alert-danger-border h-px flex-1"></div>
              <h2 className="text-theme-alert-danger-text px-4 text-lg font-bold">ESSENTIAL MODULES</h2>
              <div className="bg-theme-alert-danger-border h-px flex-1"></div>
            </div>
            <p className="text-theme-text-muted mb-6 text-center text-sm">
              These core modules are recommended for all departments and are enabled by default
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {groupedModules.essential.map((module) => {
                const Icon = module.icon;
                const status = moduleStatuses[module.id];
                return (
                  <div
                    key={module.id}
                    className="bg-theme-surface rounded-lg border-2 border-red-500/30 p-6 backdrop-blur-xs transition-all hover:border-red-500/50"
                  >
                    <div className="mb-4 flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-600">
                          <Icon className="h-6 w-6 text-white" />
                        </div>
                        {status && getStatusIcon(status)}
                      </div>
                      <span
                        className={`rounded-full border px-2 py-1 text-xs font-semibold ${getPriorityColor(module.priority)}`}
                      >
                        ESSENTIAL
                      </span>
                    </div>
                    <h3 className="text-theme-text-primary mb-2 text-lg font-bold">{module.name}</h3>
                    <p className="text-theme-text-secondary mb-4 text-sm leading-relaxed">{module.description}</p>
                    <div className="flex flex-col space-y-2">
                      <button
                        onClick={() => handleModuleAction(module.id, 'start')}
                        className="btn-primary w-full font-medium"
                      >
                        Configure Now
                      </button>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleModuleAction(module.id, 'skip')}
                          className="bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-secondary flex-1 rounded-lg px-4 py-2 text-sm transition-colors"
                        >
                          Later
                        </button>
                        <button
                          onClick={() => handleModuleAction(module.id, 'ignore')}
                          className="bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-muted flex-1 rounded-lg px-4 py-2 text-sm transition-colors"
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
            <div className="mb-4 flex items-center">
              <div className="bg-theme-alert-info-border h-px flex-1"></div>
              <h2 className="text-theme-alert-info-text px-4 text-lg font-bold">RECOMMENDED MODULES</h2>
              <div className="bg-theme-alert-info-border h-px flex-1"></div>
            </div>
            <p className="text-theme-text-muted mb-6 text-center text-sm">
              Popular modules that enhance operations - configure what fits your workflow
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {groupedModules.recommended.map((module) => {
                const Icon = module.icon;
                const status = moduleStatuses[module.id];
                return (
                  <div key={module.id} className="card p-6 transition-all hover:border-blue-500/50">
                    <div className="mb-4 flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-600">
                          <Icon className="h-6 w-6 text-white" />
                        </div>
                        {status && getStatusIcon(status)}
                      </div>
                      <span
                        className={`rounded-full border px-2 py-1 text-xs font-semibold ${getPriorityColor(module.priority)}`}
                      >
                        RECOMMENDED
                      </span>
                    </div>
                    <h3 className="text-theme-text-primary mb-2 text-lg font-bold">{module.name}</h3>
                    <p className="text-theme-text-secondary mb-4 text-sm leading-relaxed">{module.description}</p>
                    <div className="flex flex-col space-y-2">
                      <button
                        onClick={() => handleModuleAction(module.id, 'start')}
                        className="btn-info w-full font-medium"
                      >
                        Configure Now
                      </button>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleModuleAction(module.id, 'skip')}
                          className="bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-secondary flex-1 rounded-lg px-4 py-2 text-sm transition-colors"
                        >
                          Skip For Now
                        </button>
                        <button
                          onClick={() => handleModuleAction(module.id, 'ignore')}
                          className="bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-muted flex-1 rounded-lg px-4 py-2 text-sm transition-colors"
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
            <div className="mb-4 flex items-center">
              <div className="bg-theme-surface-border h-px flex-1"></div>
              <h2 className="text-theme-text-muted px-4 text-lg font-bold">OPTIONAL MODULES</h2>
              <div className="bg-theme-surface-border h-px flex-1"></div>
            </div>
            <p className="text-theme-text-muted mb-6 text-center text-sm">
              Advanced features you can enable when needed - completely optional
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              {groupedModules.optional.map((module) => {
                const Icon = module.icon;
                const status = moduleStatuses[module.id];
                const isEnabled = status === FeatureStatus.ENABLED;
                return (
                  <div
                    key={module.id}
                    className={`card-secondary p-5 backdrop-blur-xs transition-all ${
                      isEnabled ? 'border-green-500/60 ring-1 ring-green-500/40' : 'hover:border-theme-surface-hover'
                    }`}
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex items-center space-x-2">
                        <div className="bg-theme-surface flex h-10 w-10 items-center justify-center rounded-lg">
                          <Icon className="text-theme-text-secondary h-5 w-5" />
                        </div>
                        {status && getStatusIcon(status)}
                      </div>
                    </div>
                    <h3 className="text-theme-text-primary mb-2 text-base font-bold">{module.name}</h3>
                    <p className="text-theme-text-muted mb-4 text-xs leading-relaxed">{module.description}</p>
                    <div className="flex flex-col space-y-2">
                      <button
                        onClick={() => handleModuleAction(module.id, 'start')}
                        aria-pressed={isEnabled}
                        className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          isEnabled
                            ? 'bg-green-600 text-white hover:bg-green-700'
                            : 'bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover'
                        }`}
                      >
                        {isEnabled ? (
                          <>
                            <CheckCircle aria-hidden="true" className="h-4 w-4" />
                            Enabled
                          </>
                        ) : (
                          'Enable'
                        )}
                      </button>
                      <button
                        onClick={() => handleModuleAction(module.id, 'ignore')}
                        className="bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-muted w-full rounded-lg px-3 py-2 text-xs transition-colors"
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
          <div className="card p-6">
            <ProgressIndicator step="modules" />
            <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
          </div>
        </div>
      </main>

      <footer className="bg-theme-nav-bg border-theme-nav-border border-t px-6 py-4 backdrop-blur-xs">
        <div className="mx-auto max-w-7xl text-center">
          <p className="text-theme-text-secondary text-sm">
            © {currentYear} {departmentName}. All rights reserved.
          </p>
          <p className="text-theme-text-muted mt-1 text-xs">Powered by The Logbook</p>
        </div>
      </footer>
    </div>
  );
};

export default ModuleOverview;
