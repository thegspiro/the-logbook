import { useMemo, useState } from 'react';
import { BookOpenCheck, CheckCircle2, Circle, ExternalLink, RotateCcw } from 'lucide-react';
import { Link } from 'react-router';

type LearningStep = {
  id: string;
  label: string;
  path: string;
};

type LearningPath = {
  id: string;
  title: string;
  audience: string;
  duration: string;
  outcome: string;
  steps: LearningStep[];
  guideUrl: string;
};

const STORAGE_KEY = 'logbook.learning-progress.v1';

const learningPaths: LearningPath[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    audience: 'Every member',
    duration: '15 minutes',
    outcome: 'Find your next responsibility, review your account, and know where to get help.',
    steps: [
      { id: 'dashboard', label: 'Review your dashboard and next scheduled item', path: '/dashboard' },
      { id: 'account', label: 'Verify your contact and security settings', path: '/account' },
      { id: 'notifications', label: 'Review your notifications inbox', path: '/notifications?tab=inbox' },
    ],
    guideUrl: 'https://github.com/thegspiro/the-logbook/blob/main/docs/training/00-getting-started.md',
  },
  {
    id: 'training',
    title: 'Training: Submission to Credit',
    audience: 'Members and training officers',
    duration: '15–30 minutes',
    outcome: 'Submit a record, review its status, and verify the durable credited result.',
    steps: [
      { id: 'history', label: 'Review My Training and one active requirement', path: '/training/my-training' },
      { id: 'submit', label: 'Submit a real or designated practice activity', path: '/training/submit' },
      { id: 'verify', label: 'Verify Pending Review or the final credited result', path: '/training/my-training' },
    ],
    guideUrl: 'https://github.com/thegspiro/the-logbook/blob/main/docs/training/02-training.md',
  },
  {
    id: 'scheduling',
    title: 'Scheduling: Cover a Vacancy',
    audience: 'Members and scheduling officers',
    duration: '15–30 minutes',
    outcome: 'Interpret an assignment, choose the right request, and confirm the resulting coverage.',
    steps: [
      { id: 'my-shifts', label: 'Verify your next assignment and status', path: '/scheduling?tab=my-shifts' },
      { id: 'open-shifts', label: 'Identify an eligible open shift', path: '/scheduling?tab=open-shifts' },
      { id: 'requests', label: 'Review the durable request or assignment status', path: '/scheduling?tab=requests' },
    ],
    guideUrl: 'https://github.com/thegspiro/the-logbook/blob/main/docs/training/03-scheduling.md',
  },
];

function readProgress(): Record<string, boolean> {
  try {
    // `JSON.parse` is typed `any`, so the old shape check narrowed nothing and
    // the return was an unchecked cast: an array, or a value holding strings,
    // was handed back as `Record<string, boolean>`. Anything can be in
    // localStorage — an older payload, or a hand-edited one — and a
    // non-boolean here renders as a completed step.
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
      )
    );
  } catch {
    return {};
  }
}

export default function LearningCenterPage() {
  const [progress, setProgress] = useState<Record<string, boolean>>(readProgress);

  const completed = useMemo(() => Object.values(progress).filter(Boolean).length, [progress]);
  const total = learningPaths.reduce((sum, path) => sum + path.steps.length, 0);

  const setComplete = (pathId: string, stepId: string, checked: boolean) => {
    const key = `${pathId}.${stepId}`;
    setProgress((current) => {
      const next = { ...current, [key]: checked };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setProgress({});
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <BookOpenCheck className="h-7 w-7 text-cyan-700 dark:text-cyan-400" aria-hidden="true" />
            <h1 className="text-theme-text-primary text-3xl font-bold">Learning Center</h1>
          </div>
          <p className="text-theme-text-muted max-w-2xl">
            Short, task-based paths help you learn the essentials. Open a task, complete it in the application, then
            mark it finished here.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={completed === 0}
          className="border-theme-surface-border text-theme-text-muted hover:bg-theme-surface-hover focus:ring-theme-focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reset progress
        </button>
      </div>

      <section
        aria-label="Overall learning progress"
        className="bg-theme-surface border-theme-surface-border mb-6 rounded-xl border p-5"
      >
        <div className="mb-2 flex items-center justify-between gap-4 text-sm">
          <span className="text-theme-text-primary font-semibold">Overall progress</span>
          <span className="text-theme-text-muted" aria-live="polite">
            {completed} of {total} tasks
          </span>
        </div>
        <div
          className="bg-theme-surface-hover h-2.5 overflow-hidden rounded-full"
          role="progressbar"
          aria-label="Completed learning tasks"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
        >
          <div
            className="h-full rounded-full bg-cyan-600 transition-all"
            style={{ width: `${Math.round((completed / total) * 100)}%` }}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {learningPaths.map((path) => {
          const pathCompleted = path.steps.filter((step) => progress[`${path.id}.${step.id}`]).length;
          return (
            <section
              key={path.id}
              className="bg-theme-surface border-theme-surface-border flex flex-col rounded-xl border p-5 shadow-sm"
            >
              <div className="mb-4">
                <p className="text-theme-text-muted mb-1 text-xs font-semibold tracking-wide uppercase">
                  {path.audience} · {path.duration}
                </p>
                <h2 className="text-theme-text-primary text-xl font-bold">{path.title}</h2>
                <p className="text-theme-text-muted mt-2 text-sm">{path.outcome}</p>
              </div>

              <p className="text-theme-text-primary mb-3 text-sm font-semibold">
                {pathCompleted} of {path.steps.length} complete
              </p>
              <ol className="mb-5 space-y-3">
                {path.steps.map((step) => {
                  const key = `${path.id}.${step.id}`;
                  const checked = Boolean(progress[key]);
                  return (
                    <li key={step.id} className="border-theme-surface-border rounded-lg border p-3">
                      <label className="flex cursor-pointer items-start gap-3 rounded-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => setComplete(path.id, step.id, event.target.checked)}
                          className="peer sr-only"
                        />
                        {checked ? (
                          <CheckCircle2
                            className="peer-focus-visible:ring-theme-focus-ring mt-0.5 h-5 w-5 shrink-0 rounded-full text-green-600 peer-focus-visible:ring-2"
                            aria-hidden="true"
                          />
                        ) : (
                          <Circle
                            className="text-theme-text-muted peer-focus-visible:ring-theme-focus-ring mt-0.5 h-5 w-5 shrink-0 rounded-full peer-focus-visible:ring-2"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={`text-sm ${checked ? 'text-theme-text-muted line-through' : 'text-theme-text-primary'}`}
                        >
                          {step.label}
                        </span>
                      </label>
                      <Link
                        to={step.path}
                        className="focus:ring-theme-focus-ring mt-2 ml-8 inline-flex rounded-sm text-sm font-medium text-cyan-700 hover:underline focus:ring-2 focus:outline-hidden dark:text-cyan-400"
                      >
                        Open task
                      </Link>
                    </li>
                  );
                })}
              </ol>

              <a
                href={path.guideUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="focus:ring-theme-focus-ring mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 focus:ring-2 focus:outline-hidden"
              >
                Read full guide
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </section>
          );
        })}
      </div>

      <p className="text-theme-text-muted mt-6 text-sm">
        Progress is stored only in this browser. Completing a learning task does not change operational records or
        certify training.
      </p>
    </main>
  );
}
