import React from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * One thing the signed-in member has to do. The panel renders rows in the
 * order it is given them — the caller decides what outranks what.
 */
export interface NeedsYouItem {
  id: string;
  icon: LucideIcon;
  title: string;
  detail?: string | undefined;
  actionLabel: string;
  onAction: () => void;
  /** Weight of the row's action. Reserve `primary` for the single most urgent row. */
  tone?: 'primary' | 'warning' | 'neutral' | undefined;
  busy?: boolean | undefined;
}

interface DashboardNeedsYouProps {
  items: NeedsYouItem[];
}

const TONE_CLASSES: Record<NonNullable<NeedsYouItem['tone']>, string> = {
  primary: 'border border-transparent bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
  warning:
    'border-theme-alert-warning-border bg-theme-alert-warning-bg text-theme-alert-warning-title hover:bg-theme-alert-warning-bg/70 border',
  neutral: 'border-theme-surface-border bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover border',
};

/**
 * The dashboard's single call-to-action panel.
 *
 * Everything the member is on the hook for — an expiring certification, a
 * message awaiting acknowledgement, an overdue action item — is collected here
 * instead of being restated by each feature's own banner. It disappears
 * entirely when the list is empty, so a quiet week costs no vertical space.
 */
const DashboardNeedsYou: React.FC<DashboardNeedsYouProps> = ({ items }) => {
  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="needs-you-heading"
      className="border-theme-alert-danger-border border-l-theme-alert-danger-icon bg-theme-surface overflow-hidden rounded-lg border border-l-4 shadow-sm"
    >
      <div className="bg-theme-alert-danger-bg border-theme-alert-danger-border flex items-center gap-2.5 border-b px-4 py-3 sm:px-5">
        <ShieldAlert className="text-theme-alert-danger-icon h-4.5 w-4.5 shrink-0" aria-hidden="true" />
        <h2
          id="needs-you-heading"
          className="text-theme-alert-danger-title text-[11px] font-bold tracking-[0.14em] uppercase"
        >
          Needs you
        </h2>
        <span
          className="bg-theme-alert-danger-icon inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white tabular-nums"
          aria-label={`${items.length} item${items.length === 1 ? '' : 's'} need your attention`}
        >
          {items.length}
        </span>
        <span className="text-theme-alert-danger-text ml-auto hidden text-sm sm:inline">Clears as you finish</span>
      </div>

      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            className="border-theme-surface-hover flex items-center gap-3 border-t px-4 py-3 first:border-t-0 sm:gap-4 sm:px-5"
          >
            <item.icon className="text-theme-text-muted hidden h-5 w-5 shrink-0 sm:block" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-theme-text-primary text-[15px] leading-snug font-semibold sm:text-base">
                {item.title}
              </p>
              {item.detail && <p className="text-theme-text-muted mt-0.5 text-xs sm:text-sm">{item.detail}</p>}
            </div>
            <button
              type="button"
              onClick={item.onAction}
              disabled={item.busy}
              className={`focus:ring-theme-focus-ring inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold whitespace-nowrap transition-colors focus:ring-2 focus:outline-hidden disabled:pointer-events-none disabled:opacity-60 sm:text-[15px] ${
                TONE_CLASSES[item.tone ?? 'neutral']
              }`}
            >
              {item.busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {item.actionLabel}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default DashboardNeedsYou;
