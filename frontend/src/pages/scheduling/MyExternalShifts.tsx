/**
 * The member's own shifts worked for other departments.
 *
 * Covers time on a neighbouring jurisdiction's apparatus, which has no shift
 * on this department's schedule to check in to. An entry counts from the
 * moment it is saved. An officer can reject one, which takes it out of the
 * member's totals; the member then sees the reason here, and the entry is
 * locked so the claim that was reviewed stays as it was.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertCircle, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ExternalShiftEntry } from '../../modules/scheduling/services/api';
import { useConfirm } from '../../contexts/ConfirmContext';
import { formatCalendarDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatHours } from '../../utils/hoursFormatting';
import { ExternalShiftFormModal } from './ExternalShiftFormModal';

interface MyExternalShiftsProps {
  /** Called after any change, so the hours totals beside this list refresh. */
  onChanged: () => void;
}

export const MyExternalShifts: React.FC<MyExternalShiftsProps> = ({ onChanged }) => {
  const { confirm } = useConfirm();
  const [entries, setEntries] = useState<ExternalShiftEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExternalShiftEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await schedulingService.getMyExternalShifts({ limit: 100 });
      setEntries(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load your outside shifts'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaved = () => {
    void load();
    onChanged();
  };

  const handleDelete = async (entry: ExternalShiftEntry) => {
    const ok = await confirm({
      title: 'Delete this shift?',
      message: `${formatHours(entry.hours)} hours with ${entry.agency_name} on ${formatCalendarDate(entry.shift_date)} will no longer count toward your hours.`,
      confirmLabel: 'Delete shift',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await schedulingService.deleteExternalShift(entry.id);
      toast.success('Shift deleted');
      handleSaved();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete the shift'));
    }
  };

  return (
    <section className="card p-4" aria-labelledby="my-external-shifts-heading">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 id="my-external-shifts-heading" className="text-theme-text-primary font-semibold">
            Shifts with other departments
          </h4>
          <p className="text-theme-text-muted text-sm">
            Log time on another jurisdiction&apos;s apparatus so it counts toward your hours.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary flex shrink-0 items-center gap-2"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Log outside shift
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6" role="status" aria-label="Loading your outside shifts">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
        </div>
      ) : error ? (
        <div className="alert-error flex items-start gap-2" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p>{error}</p>
            <button onClick={() => void load()} className="mt-2 text-sm font-medium underline">
              Try again
            </button>
          </div>
        </div>
      ) : entries.length === 0 ? (
        <p className="text-theme-text-muted py-4 text-sm">You haven&apos;t logged any shifts with other departments.</p>
      ) : (
        <ul className="divide-theme-surface-border divide-y">
          {entries.map((entry) => {
            const rejected = entry.status === 'rejected';
            const detail = [entry.apparatus_name, entry.role].filter(Boolean).join(' · ');
            return (
              <li key={entry.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-theme-text-primary font-medium">
                    {entry.agency_name}
                    {rejected && (
                      <span className="ml-2 rounded-sm bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-400">
                        Not counted
                      </span>
                    )}
                  </p>
                  <p className="text-theme-text-secondary text-sm">
                    {formatCalendarDate(entry.shift_date)} · {formatHours(entry.hours)} hrs
                    {detail ? ` · ${detail}` : ''}
                  </p>
                  {rejected && entry.rejection_reason && (
                    <p className="text-theme-text-secondary mt-1 text-sm">
                      <span className="font-medium">Reason:</span> {entry.rejection_reason}
                    </p>
                  )}
                </div>
                {!rejected && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={`Edit shift with ${entry.agency_name} on ${formatCalendarDate(entry.shift_date)}`}
                      onClick={() => {
                        setEditing(entry);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={`Delete shift with ${entry.agency_name} on ${formatCalendarDate(entry.shift_date)}`}
                      onClick={() => void handleDelete(entry)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {total > entries.length && (
        <p className="text-theme-text-muted mt-2 text-xs">Showing your {entries.length} most recent entries.</p>
      )}

      <ExternalShiftFormModal
        isOpen={formOpen}
        entry={editing}
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
      />
    </section>
  );
};

export default MyExternalShifts;
