/**
 * Getting-started checklist for a department that has not set scheduling up.
 *
 * The administration hub lists every scheduling tool at once, which says what
 * exists but not where to begin. This walks a new officer through the order
 * the pieces depend on — a template, optionally a pattern, then shifts on the
 * calendar — and ticks each step off from the scheduling summary's counts.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { schedulingService, type SchedulingSummary } from '../../../modules/scheduling/services/api';
import { SCHEDULING_SETUP_GUIDE_HIDDEN_KEY, buildSchedulingSetupSteps } from './schedulingSetupSteps';

const readHidden = (): boolean => {
  try {
    return localStorage.getItem(SCHEDULING_SETUP_GUIDE_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
};

export const SchedulingSetupGuide: React.FC = () => {
  const [hidden, setHidden] = useState(readHidden);
  const [summary, setSummary] = useState<SchedulingSummary | null>(null);

  useEffect(() => {
    if (hidden) return undefined;
    let current = true;
    // The guide is advice layered over a hub that works without it; if the
    // counts do not load it stays out of the way rather than guessing which
    // steps are done.
    schedulingService
      .getSummary()
      .then((data) => {
        if (current) setSummary(data);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [hidden]);

  if (hidden || !summary) return null;

  const steps = buildSchedulingSetupSteps(summary);
  const required = steps.filter((step) => !step.optional);
  const doneCount = required.filter((step) => step.done).length;
  // The optional pattern does not hold the guide open: a department that
  // schedules shift by shift would otherwise be shown it forever.
  if (doneCount === required.length) return null;

  const hide = () => {
    try {
      localStorage.setItem(SCHEDULING_SETUP_GUIDE_HIDDEN_KEY, '1');
    } catch {
      // Storage can be unavailable (private mode); hiding for this visit still helps.
    }
    setHidden(true);
  };

  return (
    <section className="card mb-8 p-6" aria-labelledby="scheduling-setup-guide-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="scheduling-setup-guide-title" className="text-theme-text-primary text-lg font-semibold">
            Set up scheduling for your department
          </h2>
          <p className="text-theme-text-muted mt-1 text-sm">
            {doneCount} of {required.length} required steps done. Work through them in order: each one builds on the one
            before.
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
                  className="mt-2 inline-block text-sm font-medium text-red-700 hover:underline dark:text-red-400"
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

export default SchedulingSetupGuide;
