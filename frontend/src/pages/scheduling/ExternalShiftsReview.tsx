/**
 * Officer view of shifts members logged with other departments.
 *
 * Entries count as soon as a member saves them, so this is an after-the-fact
 * review rather than an approval queue: an officer rejects an entry that
 * should not count, which takes it out of every total, and can restore it.
 * The member sees the reason on their own screen.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertCircle, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ExternalShiftEntry, ExternalShiftStatus } from '../../modules/scheduling/services/api';
import { PromptDialog } from '../../components/ux/PromptDialog';
import { formatCalendarDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatHours } from '../../utils/hoursFormatting';

interface ExternalShiftsReviewProps {
  /** YYYY-MM-DD, inclusive. */
  startDate: string;
  endDate: string;
  /** Reject / restore need scheduling.manage; report-only viewers read. */
  canManage: boolean;
  /** Called after a reject or restore, so the totals above refresh. */
  onChanged: () => void;
}

type StatusFilter = ExternalShiftStatus | 'all';

export const ExternalShiftsReview: React.FC<ExternalShiftsReviewProps> = ({
  startDate,
  endDate,
  canManage,
  onChanged,
}) => {
  const [entries, setEntries] = useState<ExternalShiftEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ExternalShiftEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await schedulingService.getExternalShifts({
        start_date: startDate,
        end_date: endDate,
        limit: 200,
        ...(statusFilter === 'all' ? {} : { status: statusFilter }),
      });
      setEntries(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load shifts with other departments'));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReject = async (reason: string) => {
    const entry = rejecting;
    if (!entry) return;
    setBusyId(entry.id);
    try {
      await schedulingService.rejectExternalShift(entry.id, reason);
      toast.success('Shift no longer counts');
      setRejecting(null);
      void load();
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to reject the shift'));
    } finally {
      setBusyId(null);
    }
  };

  const handleRestore = async (entry: ExternalShiftEntry) => {
    setBusyId(entry.id);
    try {
      await schedulingService.restoreExternalShift(entry.id);
      toast.success('Shift counts again');
      void load();
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to restore the shift'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mt-8" aria-labelledby="external-shifts-review-heading">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="external-shifts-review-heading" className="text-theme-text-primary text-lg font-semibold">
            Shifts with other departments
          </h3>
          <p className="text-theme-text-muted text-sm">
            Logged by members for time on another jurisdiction&apos;s apparatus. They count as soon as they&apos;re
            logged{canManage ? '; reject one to take it out of the totals.' : '.'}
          </p>
        </div>
        <div>
          <label htmlFor="external-shifts-status" className="form-label">
            Show
          </label>
          <select
            id="external-shifts-status"
            className="form-input w-40"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All</option>
            <option value="counted">Counted</option>
            <option value="rejected">Not counted</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6" role="status" aria-label="Loading shifts with other departments">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
        </div>
      ) : error ? (
        <div className="alert-error flex items-start gap-2" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="card-secondary py-6 text-center">
          <p className="text-theme-text-muted text-sm">No shifts with other departments in this period.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="rwd-table w-full text-sm">
            <caption className="sr-only">Shifts members logged with other departments</caption>
            <thead>
              <tr className="border-theme-surface-border text-theme-text-secondary border-b text-left">
                <th scope="col" className="px-4 py-3 font-medium">
                  Member
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Date
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Department
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Hours
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
                {canManage && (
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const rejected = entry.status === 'rejected';
                const detail = [entry.apparatus, entry.role].filter(Boolean).join(' · ');
                return (
                  <tr key={entry.id} className="border-theme-surface-border hover:bg-theme-surface-hover border-b">
                    <td className="rwd-table-lead text-theme-text-primary px-4 py-3 font-medium" data-label="Member">
                      {entry.member_name || 'Unknown member'}
                    </td>
                    <td className="text-theme-text-secondary px-4 py-3" data-label="Date">
                      {formatCalendarDate(entry.shift_date)}
                    </td>
                    <td className="px-4 py-3" data-label="Department">
                      <p className="text-theme-text-primary">{entry.agency_name}</p>
                      {detail && <p className="text-theme-text-muted text-xs">{detail}</p>}
                      {entry.notes && <p className="text-theme-text-muted text-xs">{entry.notes}</p>}
                    </td>
                    <td className="text-theme-text-primary px-4 py-3 text-right" data-label="Hours">
                      {formatHours(entry.hours)}
                    </td>
                    <td className="px-4 py-3" data-label="Status">
                      {rejected ? (
                        <>
                          <span className="rounded-sm bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-400">
                            Not counted
                          </span>
                          {entry.rejection_reason && (
                            <p className="text-theme-text-muted mt-1 text-xs">
                              {entry.rejection_reason}
                              {entry.reviewer_name ? ` — ${entry.reviewer_name}` : ''}
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="rounded-sm bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/20 dark:text-green-400">
                          Counted
                        </span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right" data-label="Actions">
                        {rejected ? (
                          <button
                            type="button"
                            className="mobile-touch-target text-theme-text-primary hover:bg-theme-surface-secondary inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium"
                            disabled={busyId === entry.id}
                            onClick={() => void handleRestore(entry)}
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                            Restore
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="mobile-touch-target inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-500/10 dark:text-red-400"
                            disabled={busyId === entry.id}
                            onClick={() => setRejecting(entry)}
                          >
                            <XCircle className="h-4 w-4" aria-hidden="true" />
                            Reject
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {total > entries.length && (
            <p className="text-theme-text-muted mt-2 text-xs">
              Showing {entries.length} of {total}. Narrow the dates to see the rest.
            </p>
          )}
        </div>
      )}

      <PromptDialog
        isOpen={rejecting !== null}
        onClose={() => setRejecting(null)}
        onSubmit={(reason) => void handleReject(reason)}
        title="Stop counting this shift?"
        message={
          rejecting
            ? `${formatHours(rejecting.hours)} hours with ${rejecting.agency_name} on ${formatCalendarDate(rejecting.shift_date)} will be taken out of ${rejecting.member_name || 'the member'}'s totals. You can restore it later.`
            : undefined
        }
        label="Reason"
        hint="The member sees this on their own hours screen."
        multiline
        required
        confirmLabel="Reject shift"
        cancelLabel="Keep counting it"
        confirmVariant="warning"
        loading={busyId !== null}
      />
    </section>
  );
};

export default ExternalShiftsReview;
