import React, { useState } from 'react';
import { ChevronDown, ShieldAlert, Loader2 } from 'lucide-react';
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

/**
 * Rows a phone shows before collapsing the rest onto one tap-through line.
 * A 44px action button per row is most of a small screen: at three rows the
 * three quick actions below the week fall past the fold, which is the reach
 * a member has at 2am. Every row is still one tap away.
 */
const MOBILE_ROWS_SHOWN = 2;

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
  // Collapsing is a phone concern only, and which rows are on screen is decided
  // by CSS rather than a measured viewport — the rows exist in the markup at
  // every width, so a resize can never leave the panel showing a summary line
  // for rows that are already visible beside it.
  const [showAllOnMobile, setShowAllOnMobile] = useState(false);
  const collapsedOnMobile = !showAllOnMobile && items.length > MOBILE_ROWS_SHOWN;
  const hiddenOnMobile = collapsedOnMobile ? items.slice(MOBILE_ROWS_SHOWN) : [];
  const firstHidden = hiddenOnMobile[0];

  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="needs-you-heading"
      className="card border-theme-alert-danger-border border-l-theme-alert-danger-icon overflow-hidden border-l-4"
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
        {items.map((item, index) => (
          <li
            key={item.id}
            className={`border-theme-surface-hover items-center gap-3 border-t px-4 py-3 first:border-t-0 sm:gap-4 sm:px-5 ${
              collapsedOnMobile && index >= MOBILE_ROWS_SHOWN ? 'hidden sm:flex' : 'flex'
            }`}
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

        {firstHidden && (
          <li className="border-theme-surface-hover bg-theme-surface-secondary border-t sm:hidden">
            <button
              type="button"
              onClick={() => setShowAllOnMobile(true)}
              className="focus:ring-theme-focus-ring flex min-h-[44px] w-full items-center gap-2 px-4 text-left focus:ring-2 focus:outline-hidden focus:ring-inset"
            >
              <span className="text-theme-text-secondary min-w-0 flex-1 truncate text-[13px]">
                {firstHidden.title}
                {hiddenOnMobile.length > 1 && `, and ${hiddenOnMobile.length - 1} more`}
              </span>
              <span className="text-theme-accent-red inline-flex shrink-0 items-center gap-0.5 text-[13px] font-semibold">
                Show all
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </button>
          </li>
        )}
      </ul>
    </section>
  );
};

export default DashboardNeedsYou;
