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

export const ProgressSteps: React.FC<ProgressStepsProps> = ({ steps, currentStep, className = '' }) => {
  return (
    <nav aria-label="Progress" className={className}>
      {/* Desktop horizontal */}
      <ol className="hidden w-full items-center sm:flex">
        {steps.map((step, index) => {
          const isComplete = index < currentStep;
          const isCurrent = index === currentStep;
          return (
            <li key={index} className={`flex items-center ${index < steps.length - 1 ? 'flex-1' : ''}`}>
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                    isComplete
                      ? 'bg-green-600 text-white'
                      : isCurrent
                        ? 'bg-red-600 text-white ring-2 ring-red-600 ring-offset-2 ring-offset-(--surface-bg)'
                        : 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border border'
                  }`}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {isComplete ? <Check className="h-4 w-4" /> : index + 1}
                </div>
                <div className="hidden md:block">
                  <p
                    className={`text-sm font-medium ${isCurrent ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}
                  >
                    {step.label}
                  </p>
                  {step.description && <p className="text-theme-text-muted text-xs">{step.description}</p>}
                </div>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`mx-3 h-0.5 flex-1 ${isComplete ? 'bg-green-600' : 'bg-theme-surface-border'}`}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Mobile compact */}
      <div className="sm:hidden">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-theme-text-primary text-sm font-medium">
            Step {currentStep + 1} of {steps.length}
          </span>
          <span className="text-theme-text-muted text-sm">{steps[currentStep]?.label}</span>
        </div>
        <div className="bg-theme-surface-secondary h-2 w-full rounded-full">
          <div
            className="h-2 rounded-full bg-red-600 transition-all"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>
    </nav>
  );
};
