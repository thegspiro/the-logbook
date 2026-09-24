/**
 * Length of service, stint by stint.
 *
 * Shown to the member and to members-managers only: a stint records how the
 * member left (including an involuntary drop), which colleagues have no call
 * to read. The backend enforces the same rule on the endpoint.
 *
 * Managers edit the whole list at once and save it in one request. A member
 * who has never left has no stored stints — the card shows the one implied by
 * their hire date — so correcting it and adding the earlier stint it overlaps
 * cannot be two separate saves without the first being invalid on its own.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { memberStatusService } from '../../services/api';
import { SeparationStatus } from '../../constants/enums';
import type { ServiceHistory, ServicePeriod, ServicePeriodInput } from '../../types/user';
import { formatDate, getTodayLocalDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { blankToNull } from '../../utils/formValues';
import { formatServiceSpan, spanBetween, spanFromDays } from '../../utils/serviceLength';

const SEPARATION_LABELS: Record<SeparationStatus, string> = {
  [SeparationStatus.DROPPED_VOLUNTARY]: 'Dropped (voluntary)',
  [SeparationStatus.DROPPED_INVOLUNTARY]: 'Dropped (involuntary)',
  [SeparationStatus.RETIRED]: 'Retired',
};

interface EditRow {
  key: string;
  id: string | null;
  startsOnHireDate: boolean;
  start: string;
  end: string;
  separation: SeparationStatus | '';
  counts: boolean;
  notes: string;
}

let rowSeq = 0;
const nextKey = () => `row-${String(++rowSeq)}`;

function toRow(p: ServicePeriod): EditRow {
  return {
    key: p.id ?? nextKey(),
    id: p.id,
    startsOnHireDate: p.start_is_hire_date,
    start: p.start_is_hire_date ? '' : (p.start_date ?? ''),
    end: p.end_date ?? '',
    separation: p.separation_status ?? '',
    counts: p.counts_toward_service,
    notes: p.notes ?? '',
  };
}

/** Every field on every row: the save replaces the list, so nothing may be omitted. */
function toInput(row: EditRow): ServicePeriodInput {
  const end = blankToNull(row.end);
  return {
    ...(row.id ? { id: row.id } : {}),
    start_date: row.startsOnHireDate ? null : blankToNull(row.start),
    end_date: end,
    counts_toward_service: row.counts,
    separation_status: end && row.separation ? row.separation : null,
    notes: blankToNull(row.notes),
  };
}

interface ServiceHistorySectionProps {
  userId: string;
  canEdit: boolean;
  tz: string;
  /** Changes whenever the member's status does, so a leave or rejoin is reflected. */
  refreshKey?: string | undefined;
}

export const ServiceHistorySection: React.FC<ServiceHistorySectionProps> = ({ userId, canEdit, tz, refreshKey }) => {
  const today = getTodayLocalDate(tz);
  const [history, setHistory] = useState<ServiceHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setHistory(await memberStatusService.getServiceHistory(userId));
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Unable to load service history.'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setEditing(false);
    void load();
  }, [load, refreshKey]);

  const startEditing = () => {
    if (!history) return;
    setRows(history.periods.map(toRow));
    setSaveError(null);
    setEditing(true);
  };

  const updateRow = (key: string, changes: Partial<EditRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...changes } : r)));

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      {
        key: nextKey(),
        id: null,
        startsOnHireDate: false,
        start: '',
        end: '',
        separation: '',
        counts: true,
        notes: '',
      },
    ]);

  const save = async () => {
    const missingStart = rows.some((r) => !r.startsOnHireDate && !r.start);
    if (missingStart) {
      setSaveError('Every stint needs a start date.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      setHistory(await memberStatusService.replaceServicePeriods(userId, rows.map(toInput)));
      setEditing(false);
      toast.success('Service history saved');
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err, 'Unable to save service history.'));
    } finally {
      setSaving(false);
    }
  };

  const hireDateLabel = history?.hire_date ? formatDate(history.hire_date, tz) : null;

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-theme-text-primary text-lg font-semibold">Service History</h2>
        {canEdit && history && !editing && (
          <button
            type="button"
            onClick={startEditing}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm"
            aria-label="Edit service history"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-4" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
        </div>
      ) : loadError || !history ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadError ?? 'Unable to load service history.'}</p>
      ) : editing ? (
        <div className="space-y-4">
          <p className="text-theme-text-muted text-sm">
            Record each continuous stint of membership. Time between stints is not counted. Leave the end date blank for
            the stint the member is serving now.
          </p>
          {rows.length === 0 && (
            <p className="text-theme-text-muted text-sm">
              No stints recorded. Saving an empty list calculates service from the hire date.
            </p>
          )}
          {rows.map((row, index) => (
            <fieldset
              key={row.key}
              className="border-theme-surface-border m-0 min-w-0 space-y-3 rounded-lg border p-3"
              disabled={saving}
            >
              <legend className="text-theme-text-secondary px-1 text-xs font-medium uppercase">
                Stint {index + 1}
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${row.key}-start`} className="form-label">
                    Start
                  </label>
                  <input
                    id={`${row.key}-start`}
                    type="date"
                    className="form-input"
                    max={today}
                    disabled={row.startsOnHireDate}
                    value={row.startsOnHireDate ? (history.hire_date ?? '') : row.start}
                    onChange={(e) => updateRow(row.key, { start: e.target.value })}
                  />
                  {history.hire_date && (
                    <label className="text-theme-text-muted mt-1 flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="form-checkbox"
                        checked={row.startsOnHireDate}
                        onChange={(e) => updateRow(row.key, { startsOnHireDate: e.target.checked })}
                      />
                      Starts on the hire date ({hireDateLabel})
                    </label>
                  )}
                </div>
                <div>
                  <label htmlFor={`${row.key}-end`} className="form-label">
                    End <span className="text-theme-text-muted font-normal">(blank if still serving)</span>
                  </label>
                  <input
                    id={`${row.key}-end`}
                    type="date"
                    className="form-input"
                    max={today}
                    value={row.end}
                    onChange={(e) => updateRow(row.key, { end: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={`${row.key}-separation`} className="form-label">
                    How it ended
                  </label>
                  <select
                    id={`${row.key}-separation`}
                    className="form-input"
                    disabled={!row.end}
                    value={row.end ? row.separation : ''}
                    onChange={(e) => updateRow(row.key, { separation: e.target.value as SeparationStatus | '' })}
                  >
                    <option value="">Not recorded</option>
                    {Object.values(SeparationStatus).map((s) => (
                      <option key={s} value={s}>
                        {SEPARATION_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${row.key}-notes`} className="form-label">
                    Notes <span className="text-theme-text-muted font-normal">(optional)</span>
                  </label>
                  <input
                    id={`${row.key}-notes`}
                    type="text"
                    className="form-input"
                    maxLength={2000}
                    value={row.notes}
                    onChange={(e) => updateRow(row.key, { notes: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={row.counts}
                    onChange={(e) => updateRow(row.key, { counts: e.target.checked })}
                  />
                  Counts toward length of service
                </label>
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                  className="btn-icon text-red-700 dark:text-red-400"
                  aria-label={`Remove stint ${String(index + 1)}`}
                  title="Remove stint"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </fieldset>
          ))}
          <button
            type="button"
            onClick={addRow}
            disabled={saving}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm"
          >
            <Plus className="h-4 w-4" />
            Add stint
          </button>
          {saveError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {saveError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="btn-primary inline-flex items-center gap-2"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save history
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="bg-theme-surface-secondary rounded-lg p-3">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Credited service</p>
              <p className="text-theme-text-primary mt-1 text-lg font-semibold">
                {history.effective_service_start
                  ? formatServiceSpan(spanBetween(history.effective_service_start, today))
                  : 'Not known'}
              </p>
            </div>
            {history.prior_days > 0 && (
              <div className="bg-theme-surface-secondary rounded-lg p-3">
                <p className="text-theme-text-muted text-xs font-medium uppercase">Prior service (not counted)</p>
                <p className="text-theme-text-primary mt-1 text-lg font-semibold">
                  {formatServiceSpan(spanFromDays(history.prior_days, today))}
                </p>
              </div>
            )}
          </div>

          {!history.is_recorded && (
            <p className="text-theme-text-muted text-sm">
              {history.hire_date
                ? 'Calculated from the hire date. No time away is recorded.'
                : 'No hire date or service stints are on file.'}
              {history.is_estimated && ' The end of service is estimated from the last status change.'}
            </p>
          )}

          {history.periods.length > 0 && (
            <ul className="divide-theme-surface-border divide-y" aria-label="Service stints">
              {history.periods.map((p, index) => (
                <li key={p.id ?? `implicit-${String(index)}`} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-theme-text-primary">
                      {p.start_date ? formatDate(p.start_date, tz) : 'Unknown start'} –{' '}
                      {p.end_date ? formatDate(p.end_date, tz) : 'present'}
                    </span>
                    <span className="text-theme-text-secondary">
                      {formatServiceSpan(spanFromDays(p.days, p.end_date ?? today))}
                    </span>
                  </div>
                  <div className="text-theme-text-muted mt-0.5 flex flex-wrap gap-x-3 text-xs">
                    {p.separation_status && <span>{SEPARATION_LABELS[p.separation_status]}</span>}
                    {!p.counts_toward_service && (
                      <span className="font-medium text-amber-800 dark:text-amber-300">Not counted</span>
                    )}
                    {p.notes && <span>{p.notes}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default ServiceHistorySection;
