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
        isOverdue
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-theme-surface-border'
      }`}
    >
      {/* Top: name + overdue badge */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-theme-text-primary font-medium text-sm">{itemName}</h3>
        {isOverdue ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400 whitespace-nowrap shrink-0">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            Overdue
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400 whitespace-nowrap shrink-0">
            Active
          </span>
        )}
      </div>

      {/* Details */}
      <div className="space-y-1 mb-3 text-xs text-theme-text-secondary">
        {memberName && (
          <p>Member: <span className="text-theme-text-primary">{memberName}</span></p>
        )}
        {checkoutDate && (
          <p>Checked out: <span className="text-theme-text-primary">{checkoutDate}</span></p>
        )}
        {dueDate && (
          <p>
            Due:{' '}
            <span className={isOverdue ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-theme-text-primary'}>
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
              className="btn-info flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm"
            >
              <ArrowDownToLine className="w-4 h-4" aria-hidden="true" />
              Check In
            </button>
          )}
          {onExtend && (
            <button
              onClick={onExtend}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors"
            >
              <CalendarClock className="w-4 h-4" aria-hidden="true" />
              Extend
            </button>
          )}
        </div>
      )}
    </div>
  );
};
