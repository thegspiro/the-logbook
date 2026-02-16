import React from 'react';
import { Check, ChevronRight } from 'lucide-react';

interface ProgressIndicatorProps {
  currentStep: number;
  totalSteps: number;
  className?: string;
}

// Define all onboarding steps with their names
const ONBOARDING_STEPS = [
  { id: 1, name: 'Welcome', shortName: 'Welcome' },
  { id: 2, name: 'Organization Setup', shortName: 'Organization' },
  { id: 3, name: 'Navigation Choice', shortName: 'Navigation' },
  { id: 4, name: 'Email Platform', shortName: 'Email' },
  { id: 5, name: 'Email Configuration', shortName: 'Config' },
  { id: 6, name: 'File Storage', shortName: 'Storage' },
  { id: 7, name: 'Authentication', shortName: 'Auth' },
  { id: 8, name: 'IT Team Backup', shortName: 'IT Backup' },
  { id: 9, name: 'Module Selection', shortName: 'Modules' },
  { id: 10, name: 'Admin User Creation', shortName: 'Admin User' },
];

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  currentStep,
  totalSteps,
  className = '',
}) => {
  const percentage = Math.round((currentStep / totalSteps) * 100);
  const currentStepInfo = ONBOARDING_STEPS[currentStep - 1];

  return (
    <div className={className}>
      {/* Current Step Label */}
      <div className="flex items-center justify-between text-sm mb-3">
        <span className="text-theme-text-muted">Setup Progress</span>
        <span className="text-theme-text-primary font-medium">
          Step {currentStep} of {totalSteps}: {currentStepInfo?.name || 'Setup'}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-800 rounded-full h-2 mb-4">
        <div
          className="bg-gradient-to-r from-red-600 to-orange-600 h-2 rounded-full transition-all duration-500"
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Setup progress: ${percentage} percent complete`}
        />
      </div>

      {/* Breadcrumb-Style Step Indicators (Mobile: Scrollable, Desktop: All visible) */}
      <div className="overflow-x-auto pb-2 -mx-2 px-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900">
        <div className="flex items-center space-x-1 min-w-max">
          {ONBOARDING_STEPS.map((step, index) => {
            const isCompleted = step.id < currentStep;
            const isCurrent = step.id === currentStep;

            return (
              <React.Fragment key={step.id}>
                {/* Step Indicator */}
                <div
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-md transition-all ${
                    isCurrent
                      ? 'bg-red-600 text-white shadow-lg'
                      : isCompleted
                      ? 'bg-green-600/20 text-green-700 dark:text-green-400'
                      : 'bg-slate-800/50 text-slate-500'
                  }`}
                >
                  {/* Step Number/Check */}
                  <div
                    className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                      isCurrent
                        ? 'bg-white text-red-600'
                        : isCompleted
                        ? 'bg-green-500 text-white'
                        : 'bg-slate-700 text-theme-text-muted'
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="w-3 h-3" aria-hidden="true" />
                    ) : (
                      step.id
                    )}
                  </div>

                  {/* Step Name (hide on very small screens for first/last steps) */}
                  <span
                    className={`text-xs font-medium whitespace-nowrap ${
                      isCurrent ? 'text-theme-text-primary' : ''
                    }`}
                  >
                    <span className="hidden sm:inline">{step.name}</span>
                    <span className="sm:hidden">{step.shortName}</span>
                  </span>
                </div>

                {/* Chevron Separator (except after last step) */}
                {index < ONBOARDING_STEPS.length - 1 && (
                  <ChevronRight
                    className={`w-4 h-4 flex-shrink-0 ${
                      isCompleted ? 'text-green-700 dark:text-green-400' : 'text-slate-600'
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
          <p className="text-green-700 dark:text-green-400 text-sm font-medium flex items-center justify-center space-x-2">
            <Check className="w-4 h-4" aria-hidden="true" />
            <span>Setup Complete!</span>
          </p>
        </div>
      )}
    </div>
  );
};

export default ProgressIndicator;
