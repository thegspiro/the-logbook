import React from 'react';
import { Check, ChevronRight } from 'lucide-react';

/**
 * The onboarding flow in order, matching routes.tsx.
 *
 * Pages name their step with a key instead of a hardcoded number. When this
 * list held numbers that each page repeated, the two drifted: NavigationChoice
 * passed currentStep={2} against a list whose second entry was "Organization
 * Setup", so the wizard's own progress bar mislabeled the step the user was
 * looking at. A key can't drift — inserting a step here renumbers everything.
 */
const ONBOARDING_STEPS = [
  { key: 'organization', name: 'Organization Setup', shortName: 'Organization' },
  { key: 'stations', name: 'Stations', shortName: 'Stations' },
  { key: 'apparatus', name: 'Apparatus', shortName: 'Apparatus' },
  { key: 'navigation', name: 'Navigation Choice', shortName: 'Navigation' },
  { key: 'email_platform', name: 'Email Platform', shortName: 'Email' },
  { key: 'email_config', name: 'Email Configuration', shortName: 'Config' },
  { key: 'file_storage', name: 'File Storage', shortName: 'Storage' },
  { key: 'authentication', name: 'Authentication', shortName: 'Auth' },
  { key: 'system_owner', name: 'System Owner', shortName: 'Owner' },
  { key: 'it_team', name: 'IT Team Backup', shortName: 'IT Backup' },
  { key: 'positions', name: 'Positions', shortName: 'Positions' },
  { key: 'modules', name: 'Module Selection', shortName: 'Modules' },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]['key'];

interface ProgressIndicatorProps {
  step: OnboardingStepKey;
  className?: string;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  step,
  className = '',
}) => {
  const stepIndex = ONBOARDING_STEPS.findIndex(s => s.key === step);
  const currentStep = stepIndex + 1;
  const totalSteps = ONBOARDING_STEPS.length;
  const percentage = Math.round((currentStep / totalSteps) * 100);
  const currentStepInfo = ONBOARDING_STEPS[stepIndex];

  return (
    <div className={`max-w-2xl mx-auto w-full ${className}`}>
      {/* Current Step Label */}
      <div className="flex items-center justify-between text-sm mb-3">
        <span className="text-theme-text-muted">Setup Progress</span>
        <span className="text-theme-text-primary font-medium">
          Step {currentStep} of {totalSteps}: {currentStepInfo?.name || 'Setup'}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-theme-surface rounded-full h-2 mb-4">
        <div
          className="bg-linear-to-r from-red-600 to-orange-600 h-2 rounded-full transition-all duration-500"
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Setup progress: ${percentage} percent complete`}
        />
      </div>

      {/* Breadcrumb-Style Step Indicators (Mobile: Scrollable, Desktop: All visible) */}
      <div className="overflow-x-auto pb-2 -mx-2 px-2 scrollbar-thin scrollbar-thumb-theme-surface-hover scrollbar-track-theme-surface">
        <div className="flex items-center space-x-1 min-w-max">
          {ONBOARDING_STEPS.map((listStep, index) => {
            const stepNumber = index + 1;
            const isCompleted = stepNumber < currentStep;
            const isCurrent = stepNumber === currentStep;

            return (
              <React.Fragment key={listStep.key}>
                {/* Step Indicator */}
                <div
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-md transition-all ${
                    isCurrent
                      ? 'bg-red-600 text-white shadow-lg'
                      : isCompleted
                      ? 'bg-theme-accent-green-muted text-theme-accent-green'
                      : 'bg-theme-input-bg text-theme-text-muted'
                  }`}
                >
                  {/* Step Number/Check */}
                  <div
                    className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                      isCurrent
                        ? 'bg-theme-surface text-red-600'
                        : isCompleted
                        ? 'bg-green-600 text-white'
                        : 'bg-theme-surface-hover text-theme-text-muted'
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="w-3 h-3" aria-hidden="true" />
                    ) : (
                      stepNumber
                    )}
                  </div>

                  {/* Step Name (hide on very small screens for first/last steps) */}
                  <span
                    className={`text-xs font-medium whitespace-nowrap ${
                      isCurrent ? 'text-theme-text-primary' : ''
                    }`}
                  >
                    <span className="hidden sm:inline">{listStep.name}</span>
                    <span className="sm:hidden">{listStep.shortName}</span>
                  </span>
                </div>

                {/* Chevron Separator (except after last step) */}
                {index < ONBOARDING_STEPS.length - 1 && (
                  <ChevronRight
                    className={`w-4 h-4 shrink-0 ${
                      isCompleted ? 'text-theme-accent-green' : 'text-theme-text-muted'
                    }`}
                    aria-hidden="true"
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Completion Message */}
      {percentage === 100 && (
        <div className="mt-3 text-center">
          <p className="text-theme-accent-green text-sm font-medium flex items-center justify-center space-x-2">
            <Check className="w-4 h-4" aria-hidden="true" />
            <span>Setup Complete!</span>
          </p>
        </div>
      )}
    </div>
  );
};

export default ProgressIndicator;
