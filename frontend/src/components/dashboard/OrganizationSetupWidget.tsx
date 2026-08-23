import React from 'react';
import { Rocket } from 'lucide-react';
import { dashboardWidget } from './widgetRegistry';

interface Props {
  completed: number;
  total: number;
  onOpen: () => void;
}

/** Default-visible only while setup remains incomplete. */
const OrganizationSetupWidget: React.FC<Props> = ({ completed, total, onOpen }) => {
  const definition = dashboardWidget('department-setup');
  if (!definition || total <= 0 || completed >= total) return null;
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="organization-setup-heading" data-widget-id={definition.id}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="bg-theme-accent-red-muted text-theme-accent-red flex h-11 w-11 shrink-0 items-center justify-center rounded-lg">
          <Rocket className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h4 id="organization-setup-heading" className="text-theme-text-primary font-semibold">
              {definition.title}
            </h4>
            <span className="text-theme-text-secondary text-sm font-semibold tabular-nums">
              {completed} of {total}
            </span>
          </div>
          <div
            className="bg-theme-surface-hover mt-2 h-2 overflow-hidden rounded-full"
            role="progressbar"
            aria-label="Organization setup progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={completed}
          >
            <div
              className="bg-theme-accent-red h-full rounded-full"
              style={{ width: `${(completed / total) * 100}%` }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="btn-primary btn-auto min-h-[44px] shrink-0 px-4 text-sm font-semibold"
        >
          Continue setup
        </button>
      </div>
    </section>
  );
};

export default OrganizationSetupWidget;
