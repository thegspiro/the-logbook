/**
 * Progress Steps Component (#27)
 *
 * Multi-step form progress indicator showing completion state
 * for each step in a multi-part workflow.
 */

import React from 'react';
import { Check } from 'lucide-react';

export interface Step {
  label: string;
  description?: string;
}

interface ProgressStepsProps {
  steps: Step[];
  currentStep: number;
  className?: string;
}

export const ProgressSteps: React.FC<ProgressStepsProps> = ({
  steps,
  currentStep,
  className = '',
}) => {
  return (
    <nav aria-label="Progress" className={className}>
      {/* Desktop horizontal */}
      <ol className="hidden sm:flex items-center w-full">
        {steps.map((step, index) => {
          const isComplete = index < currentStep;
          const isCurrent = index === currentStep;
          return (
            <li key={index} className={`flex items-center ${index < steps.length - 1 ? 'flex-1' : ''}`}>
              <div className="flex items-center gap-2">
                <div
                  className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    isComplete
                      ? 'bg-green-600 text-white'
                      : isCurrent
                      ? 'bg-red-600 text-white ring-2 ring-red-600 ring-offset-2 ring-offset-[var(--surface-bg)]'
                      : 'bg-theme-surface-secondary text-theme-text-muted border border-theme-surface-border'
                  }`}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {isComplete ? <Check className="w-4 h-4" /> : index + 1}
                </div>
                <div className="hidden md:block">
                  <p className={`text-sm font-medium ${isCurrent ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}>
                    {step.label}
                  </p>
                  {step.description && (
                    <p className="text-xs text-theme-text-muted">{step.description}</p>
                  )}
                </div>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-3 ${
                    isComplete ? 'bg-green-600' : 'bg-theme-surface-border'
                  }`}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Mobile compact */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-theme-text-primary">
            Step {currentStep + 1} of {steps.length}
          </span>
          <span className="text-sm text-theme-text-muted">
            {steps[currentStep]?.label}
          </span>
        </div>
        <div className="w-full bg-theme-surface-secondary rounded-full h-2">
          <div
            className="h-2 rounded-full bg-red-600 transition-all"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>
    </nav>
  );
};
