import React from 'react';
import { Check, ChevronRight } from 'lucide-react';

import { ONBOARDING_STEPS } from '../config/steps';
import type { OnboardingStepKey } from '../config/steps';

/**
 * The step order now lives in `config/steps.ts` and is imported, not restated.
 *
 * It was declared here as well as in the route table and in every page's
 * hardcoded next-link, and the copies drifted: NavigationChoice once passed
 * currentStep={2} against a list whose second entry was "Organization Setup",
 * so the wizard's own progress bar mislabeled the step being looked at.
 */

export type { OnboardingStepKey };

interface ProgressIndicatorProps {
  step: OnboardingStepKey;
  className?: string;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ step, className = '' }) => {
  const stepIndex = ONBOARDING_STEPS.findIndex((s) => s.key === step);
  const currentStep = stepIndex + 1;
  const totalSteps = ONBOARDING_STEPS.length;
  const percentage = Math.round((currentStep / totalSteps) * 100);
  const currentStepInfo = ONBOARDING_STEPS[stepIndex];

  // "Step 4 of 11" overstates what is left when seven of those eleven are
  // skippable, and a department that intends to skip them has no way to tell
  // from the bar. Saying which steps are optional is the honest version of
  // that number, and it comes from the step's own flag rather than a second
  // list here.
  const requiredRemaining = ONBOARDING_STEPS.filter((s, index) => !s.optional && index + 1 > currentStep).length;

  return (
    <div className={`mx-auto w-full max-w-2xl ${className}`}>
      {/* Current Step Label */}
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-theme-text-muted">Setup Progress</span>
        <span className="text-theme-text-primary font-medium">
          Step {currentStep} of {totalSteps}: {currentStepInfo?.name || 'Setup'}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="bg-theme-surface mb-4 h-2 w-full rounded-full">
        <div
          className="h-2 rounded-full bg-linear-to-r from-red-600 to-orange-600 transition-all duration-500"
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Setup progress: ${percentage} percent complete`}
        />
      </div>

      <p className="text-theme-text-muted mb-4 text-xs">
        {currentStepInfo?.optional
          ? requiredRemaining === 0
            ? 'This step is optional — Skip is a complete answer, and setup can be finished from here.'
            : 'This step is optional — Skip is a complete answer.'
          : 'This step is required to finish setup.'}
      </p>

      {/* Breadcrumb-Style Step Indicators (Mobile: Scrollable, Desktop: All visible) */}
      {/* Already built to scroll on a phone; the marker is what says so to the
          mobile presentation pass, which otherwise reads the 1454px step row as
          content spilling off the screen. The steps are plain divs rather than
          controls, so this one does need `tabIndex` — there is nothing inside
          it a keyboard could otherwise reach to scroll it. */}
      <div
        className="scrollbar-thumb-theme-surface-hover scrollbar-track-theme-surface -mx-2 scrollbar-thin overflow-x-auto px-2 pb-2"
        data-mobile-scroll-region
        aria-label="Setup steps"
        tabIndex={0}
      >
        <div className="flex min-w-max items-center space-x-1">
          {ONBOARDING_STEPS.map((listStep, index) => {
            const stepNumber = index + 1;
            const isCompleted = stepNumber < currentStep;
            const isCurrent = stepNumber === currentStep;

            return (
              <React.Fragment key={listStep.key}>
                {/* Step Indicator */}
                <div
                  className={`flex items-center space-x-2 rounded-md px-3 py-1.5 transition-all ${
                    isCurrent
                      ? 'bg-red-800 text-white shadow-lg'
                      : isCompleted
                        ? 'bg-theme-accent-green-muted text-theme-accent-green'
                        : 'bg-theme-input-bg text-theme-text-muted'
                  }`}
                >
                  {/* Step Number/Check */}
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      isCurrent
                        ? 'bg-theme-surface text-red-600'
                        : isCompleted
                          ? 'bg-green-700 text-white'
                          : 'bg-theme-surface-hover text-theme-text-muted'
                    }`}
                  >
                    {isCompleted ? <Check className="h-3 w-3" aria-hidden="true" /> : stepNumber}
                  </div>

                  {/* Step Name (hide on very small screens for first/last steps) */}
                  {/* Weight, not colour, marks the current step. The container
                      it sits in is `bg-red-800 text-white` when current, so
                      overriding to `text-theme-text-primary` here put dark
                      slate on dark red — about 1.5:1, and the one step label a
                      person most needs to read. Inheriting white keeps it at
                      the container's 8.31:1. */}
                  <span className={`text-xs whitespace-nowrap ${isCurrent ? 'font-semibold' : 'font-medium'}`}>
                    <span className="hidden sm:inline">{listStep.name}</span>
                    <span className="sm:hidden">{listStep.shortName}</span>
                    {/* Marked on the step itself rather than in a legend: a
                        legend is one more thing to read, and the strip scrolls
                        on a phone so a legend may not be on screen with it. */}
                    {listStep.optional && (
                      <span className="ml-1 opacity-70" title="Optional">
                        <span aria-hidden="true">(optional)</span>
                        <span className="sr-only">, optional</span>
                      </span>
                    )}
                  </span>
                </div>

                {/* Chevron Separator (except after last step) */}
                {index < ONBOARDING_STEPS.length - 1 && (
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 ${isCompleted ? 'text-theme-accent-green' : 'text-theme-text-muted'}`}
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
          <p className="text-theme-accent-green flex items-center justify-center space-x-2 text-sm font-medium">
            <Check className="h-4 w-4" aria-hidden="true" />
            <span>Setup Complete!</span>
          </p>
        </div>
      )}
    </div>
  );
};

export default ProgressIndicator;
