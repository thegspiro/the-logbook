/**
 * Getting-started checklist for a department that has not set training up.
 *
 * A fresh install opens the training dashboard on a wall of empty widgets,
 * none of which says where to begin. This walks the officer through the order
 * the pieces depend on one another — courses, then the requirements members
 * are measured against, then a first session that credits attendance — and
 * ticks each step off from counts the dashboard summary already reports.
 */

import React, { useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Circle, X } from 'lucide-react';
import type { TrainingDashboardSummary } from '../../services/trainingServices';
import { SETUP_GUIDE_HIDDEN_KEY, buildSetupSteps } from './trainingSetupSteps';

const readHidden = (): boolean => {
  try {
    return localStorage.getItem(SETUP_GUIDE_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
};

interface TrainingSetupGuideProps {
  stats: TrainingDashboardSummary['stats'];
}

export const TrainingSetupGuide: React.FC<TrainingSetupGuideProps> = ({ stats }) => {
  const [hidden, setHidden] = useState(readHidden);
  const steps = buildSetupSteps(stats);
  const required = steps.filter((step) => !step.optional);
  const doneCount = required.filter((step) => step.done).length;

  // The optional step does not hold the guide open: a department that never
  // runs formal programs would otherwise be shown it forever.
  if (hidden || doneCount === required.length) return null;

  const hide = () => {
    try {
      localStorage.setItem(SETUP_GUIDE_HIDDEN_KEY, '1');
    } catch {
      // Storage can be unavailable (private mode); hiding for this visit still helps.
    }
    setHidden(true);
  };

  return (
    <section className="card mb-6 p-6" aria-labelledby="training-setup-guide-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="training-setup-guide-title" className="text-theme-text-primary text-lg font-semibold">
            Set up training for your department
          </h2>
          <p className="text-theme-text-muted mt-1 text-sm">
            {doneCount} of {required.length} steps done. Work through them in order: each one builds on the one before.
          </p>
        </div>
        <button type="button" onClick={hide} className="btn-icon" aria-label="Hide the setup guide">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <ol className="mt-4 space-y-3">
        {steps.map((step, index) => (
          <li key={step.id} className="bg-theme-surface-secondary flex gap-3 rounded-lg p-4">
            {step.done ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700 dark:text-green-400" aria-hidden="true" />
            ) : (
              <Circle className="text-theme-text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-theme-text-primary text-sm font-medium">
                {index + 1}. {step.title}
                {step.optional && <span className="text-theme-text-muted font-normal"> (optional)</span>}
                <span className="sr-only">{step.done ? ' — done' : ' — not done yet'}</span>
              </p>
              <p className="text-theme-text-muted mt-1 text-sm">{step.description}</p>
              {!step.done && (
                <Link
                  to={step.href}
                  className="mobile-touch-target mt-1 text-sm font-medium text-red-800 hover:underline dark:text-red-300"
                >
                  {step.action} →
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
};

export default TrainingSetupGuide;
