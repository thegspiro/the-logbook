import { BookOpenCheck, CheckCircle2, Circle, RotateCcw } from 'lucide-react';
import { Link } from 'react-router';

import { useLearningProgress } from '../../hooks/useLearningProgress';
import { stepKey } from './learningPaths';

export default function LearningCenterPage() {
  const { visiblePaths, completed, completedCount, totalCount, percent, reset } = useLearningProgress();

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <BookOpenCheck className="h-7 w-7 text-cyan-700 dark:text-cyan-400" aria-hidden="true" />
            <h1 className="text-theme-text-primary text-3xl font-bold">Learning Center</h1>
          </div>
          <p className="text-theme-text-muted max-w-2xl">
            Short, task-based lessons for the things you will do in your first few weeks. Each one explains why the task
            matters, walks you through it, and tells you what finished looks like.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={completedCount === 0}
          className="border-theme-surface-border text-theme-text-muted hover:bg-theme-surface-hover focus:ring-theme-focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reset progress
        </button>
      </div>

      <section aria-label="Overall learning progress" className="card mb-6 p-5">
        <div className="mb-2 flex items-center justify-between gap-4 text-sm">
          <span className="text-theme-text-primary font-semibold">Overall progress</span>
          <span className="text-theme-text-muted" aria-live="polite">
            {completedCount} of {totalCount} tasks
          </span>
        </div>
        <div
          className="bg-theme-surface-hover h-2.5 overflow-hidden rounded-full"
          role="progressbar"
          aria-label="Completed learning tasks"
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-valuenow={completedCount}
          aria-valuetext={`${completedCount} of ${totalCount} tasks complete`}
        >
          <div className="h-full rounded-full bg-cyan-600 transition-all" style={{ width: `${percent}%` }} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {visiblePaths.map((path) => {
          const done = path.steps.filter((step) => completed[stepKey(path.id, step.id)]).length;
          const finished = done === path.steps.length;
          return (
            <section key={path.id} className="card flex flex-col p-5">
              <div className="mb-4">
                <p className="text-theme-text-muted mb-1 text-xs font-semibold tracking-wide uppercase">
                  {path.audience} · {path.duration}
                </p>
                <h2 className="text-theme-text-primary text-xl font-bold">{path.title}</h2>
                <p className="text-theme-text-muted mt-2 text-sm">{path.outcome}</p>
              </div>

              <p className="text-theme-text-primary mb-3 text-sm font-semibold">
                {done} of {path.steps.length} complete
              </p>

              {/* A preview, not a control. Ticking a task off belongs on the
                  lesson, where the member has just read what the task is —
                  a checkbox here only ever recorded an intention. */}
              <ul className="mb-5 space-y-2">
                {path.steps.map((step) => {
                  const stepDone = Boolean(completed[stepKey(path.id, step.id)]);
                  return (
                    <li key={step.id} className="flex items-start gap-2.5">
                      {stepDone ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                      ) : (
                        <Circle className="text-theme-text-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      <span
                        className={`text-sm ${stepDone ? 'text-theme-text-muted line-through' : 'text-theme-text-primary'}`}
                      >
                        {step.label}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <Link
                to={`/learning/${path.id}`}
                className="btn-primary mt-auto inline-flex min-h-11 items-center justify-center gap-2 text-sm font-semibold"
              >
                {finished ? 'Review lesson' : done > 0 ? 'Continue lesson' : 'Start lesson'}
                <span className="sr-only">: {path.title}</span>
              </Link>
            </section>
          );
        })}
      </div>

      <p className="text-theme-text-muted mt-6 text-sm">
        Progress is stored in this browser for your account only. Completing a learning task does not change operational
        records or certify training.
      </p>
    </main>
  );
}
