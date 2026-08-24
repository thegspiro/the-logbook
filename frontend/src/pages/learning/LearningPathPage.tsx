import { ArrowLeft, ArrowRight, CheckCircle2, Circle, ExternalLink, Target } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router';

import { useLearningProgress } from '../../hooks/useLearningProgress';
import { findLearningPath } from './learningPaths';

/**
 * One lesson, taught in the app.
 *
 * Each step states why it matters, how to do it against the screens in this
 * build, and what proves it is done — then links to the screen itself. The
 * external reference guide stays available at the foot of the page for anyone
 * who wants the full manual, but nothing here requires reaching it.
 */
export default function LearningPathPage() {
  const { pathId } = useParams<{ pathId: string }>();
  const { isStepComplete, setStepComplete } = useLearningProgress();
  const path = findLearningPath(pathId);

  // An unknown id is a stale bookmark or a mistyped URL, not an error state
  // worth a screen of its own.
  if (!path) return <Navigate to="/learning" replace />;

  const done = path.steps.filter((step) => isStepComplete(path.id, step.id)).length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to="/learning"
        className="text-theme-text-muted hover:text-theme-text-primary focus:ring-theme-focus-ring mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium focus:ring-2 focus:outline-hidden"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Learning Center
      </Link>

      <header className="mb-6">
        <p className="text-theme-text-muted mb-1 text-xs font-semibold tracking-wide uppercase">
          {path.audience} · {path.duration}
        </p>
        <h1 className="text-theme-text-primary text-3xl font-bold">{path.title}</h1>
        <p className="text-theme-text-muted mt-2">{path.outcome}</p>
        <p className="text-theme-text-primary mt-4 text-sm font-semibold" aria-live="polite">
          {done} of {path.steps.length} complete
        </p>
      </header>

      <ol className="space-y-5">
        {path.steps.map((step, index) => {
          const checked = isStepComplete(path.id, step.id);
          return (
            <li key={step.id} className="card p-5">
              <div className="flex items-start gap-3">
                <span
                  className="bg-theme-surface-hover text-theme-text-primary mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-theme-text-primary text-lg font-bold">{step.label}</h2>

                  <p className="text-theme-text-muted mt-2 text-sm">{step.why}</p>

                  <h3 className="text-theme-text-primary mt-4 text-sm font-semibold">How to do it</h3>
                  <ol className="text-theme-text-muted mt-1.5 list-decimal space-y-1.5 pl-5 text-sm">
                    {step.how.map((instruction) => (
                      <li key={instruction}>{instruction}</li>
                    ))}
                  </ol>

                  <p className="border-theme-surface-border text-theme-text-primary mt-4 flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm">
                    <Target className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                    <span>
                      <span className="font-semibold">You are done when: </span>
                      {step.success}
                    </span>
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Link
                      to={step.path}
                      // Same reason as the checkbox: several "Open the screen"
                      // links on one page need distinguishing by step.
                      aria-label={`Open the screen for: ${step.label}`}
                      className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 text-sm font-semibold"
                    >
                      Open the screen
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>

                    <label className="border-theme-surface-border hover:bg-theme-surface-hover inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => setStepComplete(path.id, step.id, event.target.checked)}
                        // Every step's box reads "Mark complete", so the
                        // visible label alone would announce the same name
                        // several times over with nothing to tell them apart.
                        aria-label={`Mark complete: ${step.label}`}
                        className="peer sr-only"
                      />
                      {checked ? (
                        <CheckCircle2
                          className="peer-focus-visible:ring-theme-focus-ring h-5 w-5 shrink-0 rounded-full text-green-600 peer-focus-visible:ring-2"
                          aria-hidden="true"
                        />
                      ) : (
                        <Circle
                          className="text-theme-text-muted peer-focus-visible:ring-theme-focus-ring h-5 w-5 shrink-0 rounded-full peer-focus-visible:ring-2"
                          aria-hidden="true"
                        />
                      )}
                      <span className="text-theme-text-primary text-sm font-medium">
                        {checked ? 'Completed' : 'Mark complete'}
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="border-theme-surface-border mt-8 border-t pt-5">
        <p className="text-theme-text-muted mb-3 text-sm">
          Everything above is the short version. The full reference guide covers officer workflows, edge cases, and
          troubleshooting — it opens on the project site and needs an internet connection.
        </p>
        <a
          href={path.guideUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover focus:ring-theme-focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold focus:ring-2 focus:outline-hidden"
        >
          Read the full reference guide
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    </main>
  );
}
