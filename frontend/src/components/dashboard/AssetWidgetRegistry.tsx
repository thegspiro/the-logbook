import React from 'react';
import { AlertTriangle, Building2, Package, Truck } from 'lucide-react';
import { useNavigate } from 'react-router';

export interface AssetWidgetData {
  id: string;
  module: 'inventory' | 'apparatus' | 'facilities';
  title: string;
  count: number;
  href: string;
  empty_state: string;
  severity: 'neutral' | 'warning' | 'danger';
}

const moduleIcon = { inventory: Package, apparatus: Truck, facilities: Building2 };

/** Registered renderer shared by every organization asset widget. */
export const AssetWidgetRegistry: React.FC<{ widgets: AssetWidgetData[] }> = ({ widgets }) => {
  const navigate = useNavigate();
  if (!widgets.length) return null;

  return (
    <section aria-labelledby="asset-widgets-heading">
      <h3 id="asset-widgets-heading" className="text-theme-text-primary mb-3 text-lg font-semibold">
        Assets &amp; operations
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {widgets.map((widget) => {
          const Icon = moduleIcon[widget.module];
          return (
            <button
              key={widget.id}
              type="button"
              onClick={() => void navigate(widget.href)}
              className="card hover:border-theme-accent-blue min-h-32 p-4 text-left transition-colors"
              aria-label={`${widget.title}: ${widget.count}. Open filtered results`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="bg-theme-surface-secondary rounded-lg p-2">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span
                  className={`text-2xl font-bold tabular-nums ${widget.severity === 'danger' && widget.count ? 'text-red-600 dark:text-red-400' : widget.severity === 'warning' && widget.count ? 'text-amber-600 dark:text-amber-400' : 'text-theme-text-primary'}`}
                >
                  {widget.count}
                </span>
              </div>
              <p className="text-theme-text-primary mt-2 font-semibold">{widget.title}</p>
              {widget.count === 0 && <p className="text-theme-text-muted mt-1 text-xs">{widget.empty_state}</p>}
              {widget.count > 0 && (
                <p className="text-theme-text-muted mt-1 flex items-center gap-1 text-xs">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  View filtered results
                </p>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
};
