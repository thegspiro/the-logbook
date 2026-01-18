import React from 'react';

interface ProgressIndicatorProps {
  currentStep: number;
  totalSteps: number;
  className?: string;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  currentStep,
  totalSteps,
  className = '',
}) => {
  const percentage = Math.round((currentStep / totalSteps) * 100);

  return (
    <div className={className}>
      <div className="flex items-center justify-between text-sm text-slate-400 mb-2">
        <span>Setup Progress</span>
        <span>
          Step {currentStep} of {totalSteps}
        </span>
      </div>
      <div className="w-full bg-slate-800 rounded-full h-2">
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
    </div>
  );
};

export default ProgressIndicator;
