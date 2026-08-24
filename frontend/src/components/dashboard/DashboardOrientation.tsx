import React from 'react';
import { GraduationCap, X } from 'lucide-react';
import { Link } from 'react-router';

import { useLearningProgress } from '../../hooks/useLearningProgress';

/**
 * Dashboard entry point into the Learning Center.
 *
 * The Learning Center sits in all three navigation surfaces and a new member
 * still never opens it — the dashboard is where they land, and nothing there
 * said the lessons existed. This is that missing signpost, so it appears only
 * while there is orientation left to do and stays gone once waved off.
 */
export const DashboardOrientation: React.FC = () => {
  const { visiblePaths, completedCount, totalCount, promptDismissed, dismissPrompt } = useLearningProgress();

  const finished = totalCount > 0 && completedCount === totalCount;
  if (promptDismissed || finished || totalCount === 0) return null;

  const started = completedCount > 0;
  // Untouched orientation opens the first lesson directly — that is always
  // Getting Started, which is not gated on a module. Once they have started,
  // the index is the better landing place: it shows which lesson is unfinished.
  const firstPath = visiblePaths[0];

  return (
    <section
      aria-labelledby="orientation-heading"
      className="flex flex-col gap-3 rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700 dark:text-cyan-400" aria-hidden="true" />
        <div>
          <p id="orientation-heading" className="text-theme-text-primary text-sm font-medium">
            {started ? `Orientation: ${completedCount} of ${totalCount} tasks done` : 'New here? Start with the basics'}
          </p>
          <p className="text-theme-text-muted text-xs">
            {started
              ? 'Pick up where you left off in the Learning Center.'
              : 'A 15-minute walkthrough covers your dashboard, your account, and who to contact.'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={dismissPrompt}
          className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target rounded px-3 text-sm"
        >
          <span className="sr-only">Dismiss orientation prompt</span>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        <Link
          to={started || !firstPath ? '/learning' : `/learning/${firstPath.id}`}
          className="btn-primary mobile-touch-target inline-flex items-center rounded-md text-sm font-medium"
        >
          {started ? 'Continue' : 'Start'}
        </Link>
      </div>
    </section>
  );
};

export default DashboardOrientation;
