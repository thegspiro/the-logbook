import { useNavigate } from 'react-router';
import type { OperationsDashboard } from '../../services/api';

export default function ChiefOperationsDashboard({ data }: { data: OperationsDashboard }) {
  const navigate = useNavigate();
  return (
    // items-start, not the grid default of stretch: these panels hold lists of
    // different lengths, so a stretched one-item card grows to match a
    // five-item neighbour and renders as a mostly empty box.
    <div className="grid items-start gap-4 lg:grid-cols-2" aria-label="Chief operations summary">
      {data.sections.map((section) => (
        <section key={section.key} className="card p-4" aria-labelledby={`operations-${section.key}`}>
          <h4 id={`operations-${section.key}`} className="text-theme-text-primary font-semibold">
            {section.title}
          </h4>
          {section.items.length === 0 ? (
            <p className="text-theme-text-muted mt-3 text-sm">
              {section.key === 'critical_exceptions' ? 'No critical exceptions' : 'Nothing to report'}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {section.items.map((item) => (
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
                          ? section.key === 'critical_exceptions'
                            ? 'No critical exceptions'
                            : 'None pending'
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
          )}
        </section>
      ))}
    </div>
  );
}
