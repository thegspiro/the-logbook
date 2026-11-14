import { CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { OperationsDashboard, OperationsItem } from '../../services/api';

// What a zero means depends on the section: no shifts today is "none
// scheduled", a trend with nothing in it is "none this period". The single
// "None pending" every row used to share was wrong for all but approvals.
const ZERO_TEXT: Record<string, string> = {
  operational_readiness: 'None scheduled',
  critical_exceptions: 'None',
  upcoming_command_dates: 'None scheduled',
  period_trends: 'None this period',
  pending_approvals: 'None pending',
};

// Sections where zero is the good outcome, so an all-zero one is folded into a
// single "All clear" line. Membership health and trends are not here: zero
// active members or zero training records is not a clean bill of health.
const FOLD_WHEN_CLEAR = new Set(['critical_exceptions', 'pending_approvals']);

export default function ChiefOperationsDashboard({ data }: { data: OperationsDashboard }) {
  const navigate = useNavigate();

  const rows = (sectionKey: string, items: OperationsItem[]) => (
    <ul className="mt-3 space-y-2">
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            className="bg-theme-surface-secondary flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-left"
            onClick={() => void navigate(item.href)}
          >
            <span>
              <span className="text-theme-text-primary block text-sm font-medium">{item.label}</span>
              <span className="text-theme-text-muted block text-xs">
                {item.count === 0
                  ? (ZERO_TEXT[sectionKey] ?? 'None')
                  : [item.most_urgent, item.oldest_age_days != null && `${item.oldest_age_days} days old`]
                      .filter(Boolean)
                      .join(' · ')}
              </span>
            </span>
            <span className="text-theme-text-primary text-lg font-bold tabular-nums">{item.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    // items-start, not the grid default of stretch: these panels hold lists of
    // different lengths, so a stretched one-item card grows to match a
    // five-item neighbour and renders as a mostly empty box.
    <div className="grid items-start gap-4 lg:grid-cols-2" aria-label="Chief operations summary">
      {data.sections.map((section) => {
        const allClear =
          FOLD_WHEN_CLEAR.has(section.key) &&
          section.items.length > 0 &&
          section.items.every((item) => item.count === 0);
        return (
          <section key={section.key} className="card p-4" aria-labelledby={`operations-${section.key}`}>
            <h4 id={`operations-${section.key}`} className="text-theme-text-primary font-semibold">
              {section.title}
            </h4>
            {section.items.length === 0 ? (
              <p className="text-theme-text-muted mt-3 text-sm">
                {section.key === 'critical_exceptions' ? 'No critical exceptions' : 'Nothing to report'}
              </p>
            ) : allClear ? (
              // A native disclosure keeps every check one click away without
              // spending a row on each zero.
              <details className="mt-3">
                <summary className="text-theme-text-secondary flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-700 dark:text-green-400" aria-hidden="true" />
                  {`All clear · ${section.items.length} ${section.items.length === 1 ? 'check' : 'checks'}`}
                </summary>
                {rows(section.key, section.items)}
              </details>
            ) : (
              rows(section.key, section.items)
            )}
          </section>
        );
      })}
    </div>
  );
}
