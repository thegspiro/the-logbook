/**
 * The fleet board's "Maintenance due" list, opened as /apparatus?maintenance=due.
 *
 * DASH-38 (owner decision 2026-11-01): no apparatus maintenance page is built;
 * the fleet board carries the dashboard tile's figure instead. The tile counts
 * the fleet summary's `maintenance_due_soon`, which is
 * `ApparatusService.get_maintenance_due(days_ahead=30)` with overdue work
 * included. This list asks that same method for the same window, so its length
 * is the tile's number.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Clock, Loader2, Wrench } from 'lucide-react';
import { apparatusMaintenanceService } from '../services/api';
import type { ApparatusMaintenanceDue } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

// The fleet summary's window: `get_fleet_summary` in
// backend/app/services/apparatus_service.py.
export const APPARATUS_MAINTENANCE_DUE_DAYS = 30;

export const MaintenanceDueList: React.FC = () => {
  const tz = useTimezone();
  const [items, setItems] = useState<ApparatusMaintenanceDue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apparatusMaintenanceService
      .getMaintenanceDue({ daysAhead: APPARATUS_MAINTENANCE_DUE_DAYS, includeOverdue: true })
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load the maintenance due'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="card p-12 text-center" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted mx-auto h-8 w-8 animate-spin" />
        <p className="text-theme-text-secondary mt-3">Loading maintenance due...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert-danger" role="alert">
        {error}
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <p className="text-theme-text-secondary border-theme-surface-border border-b px-4 py-3 text-sm">
        {items.length} maintenance {items.length === 1 ? 'item' : 'items'} due in the next{' '}
        {APPARATUS_MAINTENANCE_DUE_DAYS} days or overdue
      </p>
      {items.length === 0 ? (
        <div className="p-12 text-center">
          <Wrench className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-secondary">
            No apparatus maintenance is due in the next {APPARATUS_MAINTENANCE_DUE_DAYS} days.
          </p>
        </div>
      ) : (
        <ul className="divide-theme-surface-border divide-y">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={`/apparatus/${item.apparatusId}?tab=maintenance`}
                className="hover:bg-theme-surface-secondary flex items-center gap-3 px-4 py-3 transition-colors"
              >
                {item.isOverdue ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
                ) : (
                  <Clock className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                )}
                <span className="text-theme-text-primary w-20 shrink-0 font-medium">{item.apparatusUnitNumber}</span>
                <span className="text-theme-text-secondary min-w-0 flex-1 truncate text-sm">
                  {item.maintenanceTypeName}
                </span>
                {item.isOverdue && (
                  <span className="badge shrink-0 bg-red-500/10 text-red-900 dark:text-red-300">Overdue</span>
                )}
                <span className="text-theme-text-muted shrink-0 text-sm">
                  {item.dueDate ? formatDate(item.dueDate, tz) : 'No due date'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default MaintenanceDueList;
