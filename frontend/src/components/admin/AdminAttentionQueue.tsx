import React, { useRef, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ShieldAlert } from 'lucide-react';
import type { AdminAttentionItem } from '../../types/adminHub';

/**
 * The "Needs attention" queue — the one module-specific part of the admin frame.
 *
 * Same 4px danger accent and row shape on every admin page; the exception types
 * are the module's own. An empty queue means the card disappears entirely —
 * never an empty-state illustration, because "nothing is wrong" is worth zero
 * vertical space on a page whose job is the work below it.
 *
 * Each row names a subject, carries an age or a deadline, and offers one action
 * that ends it. Anything that cannot be acted on today belongs in a metric.
 */

interface AdminAttentionQueueProps {
  items: AdminAttentionItem[];
  /** Names the page for screen readers, e.g. "Training". */
  moduleLabel: string;
  /** Layout the frame owns — the phone/desk order swap lives there. */
  className?: string | undefined;
}

/**
 * Rows a phone shows before collapsing the rest onto one tap-through line.
 * A 44px action button per row is most of a small screen; two rows keep the
 * tab bar and the work below it on the first screen, and the line names what
 * is being held back rather than hiding it.
 */
const MOBILE_ROWS_SHOWN = 2;

export const AdminAttentionQueue: React.FC<AdminAttentionQueueProps> = ({ items, moduleLabel, className = '' }) => {
  // Which rows are on screen is decided by CSS rather than a measured
  // viewport, so the rows exist in the markup at every width and a resize can
  // never leave a summary line standing beside the rows it summarises.
  const [showAllOnMobile, setShowAllOnMobile] = useState(false);
  const collapsedOnMobile = !showAllOnMobile && items.length > MOBILE_ROWS_SHOWN;
  const hiddenOnMobile = collapsedOnMobile ? items.slice(MOBILE_ROWS_SHOWN) : [];
  const firstHidden = hiddenOnMobile[0];

  // The summary line unmounts the moment it is activated. Without moving focus
  // onto the first row it reveals, focus drops to the document body and the
  // row the admin just asked for is a whole page away again.
  const firstCollapsedRowRef = useRef<HTMLLIElement>(null);
  const revealAllOnMobile = () => {
    setShowAllOnMobile(true);
    window.requestAnimationFrame(() => firstCollapsedRowRef.current?.focus());
  };

  if (items.length === 0) return null;

  const headingId = `admin-attention-${moduleLabel.toLowerCase().replace(/\W+/g, '-')}`;

  return (
    <section
      aria-labelledby={headingId}
      className={`card border-theme-alert-danger-border border-l-theme-alert-danger-icon overflow-hidden border-l-4 ${className}`}
    >
      <div className="bg-theme-alert-danger-bg border-theme-alert-danger-border flex items-center gap-2.5 border-b px-4 py-3 sm:px-5">
        <ShieldAlert className="text-theme-alert-danger-icon h-4.5 w-4.5 shrink-0" aria-hidden="true" />
        <h2 id={headingId} className="text-theme-alert-danger-title text-[11px] font-bold tracking-[0.14em] uppercase">
          Needs attention
        </h2>
        <span
          className="bg-theme-alert-danger-icon inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white tabular-nums"
          aria-label={`${items.length} ${items.length === 1 ? 'exception' : 'exceptions'} in ${moduleLabel}`}
        >
          {items.length}
        </span>
        <span className="text-theme-alert-danger-text ml-auto hidden text-sm sm:inline">Clears as you finish</span>
      </div>

      <ul>
        {items.map((item, index) => (
          <li
            key={item.key}
            ref={index === MOBILE_ROWS_SHOWN ? firstCollapsedRowRef : undefined}
            tabIndex={index === MOBILE_ROWS_SHOWN ? -1 : undefined}
            className={`border-theme-surface-hover focus:ring-theme-focus-ring items-center gap-3 border-t px-4 py-3 first:border-t-0 focus:ring-2 focus:outline-hidden focus:ring-inset sm:gap-4 sm:px-5 ${
              collapsedOnMobile && index >= MOBILE_ROWS_SHOWN ? 'hidden sm:flex' : 'flex'
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-theme-text-primary text-[15px] leading-snug font-semibold sm:text-base">
                {item.title}
              </p>
              {item.detail && <p className="text-theme-text-muted mt-0.5 text-xs sm:text-sm">{item.detail}</p>}
            </div>
            <Link
              to={item.href}
              className={`focus:ring-theme-focus-ring inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold whitespace-nowrap transition-colors focus:ring-2 focus:outline-hidden sm:text-[15px] ${
                item.severity === 'critical'
                  ? 'border border-transparent bg-red-600 text-white hover:bg-red-700 active:bg-red-800'
                  : 'border-theme-surface-border bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover border'
              }`}
            >
              {item.actionLabel}
            </Link>
          </li>
        ))}

        {firstHidden && (
          <li className="border-theme-surface-hover bg-theme-surface-secondary border-t sm:hidden">
            <button
              type="button"
              onClick={revealAllOnMobile}
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

export default AdminAttentionQueue;
