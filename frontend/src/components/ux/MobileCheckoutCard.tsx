/**
 * MobileCheckoutCard
 *
 * Touch-friendly card replacing table rows for checkout/equipment items on small screens.
 */

import React from 'react';
import { ArrowDownToLine, CalendarClock, AlertTriangle } from 'lucide-react';

interface MobileCheckoutCardProps {
  /** Item name */
  itemName: string;
  /** Person who checked it out */
  memberName?: string | undefined;
  /** Checkout date (formatted) */
  checkoutDate?: string | undefined;
  /** Due date (formatted) */
  dueDate?: string | undefined;
  /** Whether overdue */
  isOverdue?: boolean | undefined;
  /** Check-in handler */
  onCheckIn?: (() => void) | undefined;
  /** Extend handler */
  onExtend?: (() => void) | undefined;
}

export const MobileCheckoutCard: React.FC<MobileCheckoutCardProps> = ({
  itemName,
  memberName,
  checkoutDate,
  dueDate,
  isOverdue,
  onCheckIn,
  onExtend,
}) => {
  return (
    <div
      className={`bg-theme-surface rounded-lg border p-4 ${
        isOverdue ? 'border-red-500/30 bg-red-500/5' : 'border-theme-surface-border'
      }`}
    >
      {/* Top: name + overdue badge */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-theme-text-primary text-sm font-medium">{itemName}</h3>
        {isOverdue ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-700 dark:bg-red-500/20 dark:text-red-400">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Overdue
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-green-700 dark:bg-green-500/20 dark:text-green-400">
            Active
          </span>
        )}
      </div>

      {/* Details */}
      <div className="text-theme-text-secondary mb-3 space-y-1 text-xs">
        {memberName && (
          <p>
            Member: <span className="text-theme-text-primary">{memberName}</span>
          </p>
        )}
        {checkoutDate && (
          <p>
            Checked out: <span className="text-theme-text-primary">{checkoutDate}</span>
          </p>
        )}
        {dueDate && (
          <p>
            Due:{' '}
            <span className={isOverdue ? 'font-semibold text-red-600 dark:text-red-400' : 'text-theme-text-primary'}>
              {dueDate}
            </span>
          </p>
        )}
      </div>

      {/* Actions */}
      {(onCheckIn || onExtend) && (
        <div className="flex items-center gap-2">
          {onCheckIn && (
            <button
              onClick={onCheckIn}
              className="btn-info flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-sm"
            >
              <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
              Check In
            </button>
          )}
          {onExtend && (
            <button
              onClick={onExtend}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm transition-colors"
            >
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              Extend
            </button>
          )}
        </div>
      )}
    </div>
  );
};
