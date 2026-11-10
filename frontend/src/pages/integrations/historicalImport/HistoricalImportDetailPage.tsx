/**
 * Historical Data Import — one export.
 *
 * Four steps, top to bottom: say which column means what and which columns hold
 * hours or calls; check how every row sorted and what was cleaned up on the
 * way; send the shift and on-call rows to shift review in month batches; and
 * download the log of where each row stands. Training and administrative hours
 * are sorted and counted here and imported by their own steps.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Send, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import toast from 'react-hot-toast';
import { SkeletonPage } from '../../../components/ux';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { HISTORY_IMPORT_STATUS_COLORS, HistoricalRecordType } from '../../../constants/enums';
import { useTimezone } from '../../../hooks/useTimezone';
import { historicalImportService } from '../../../modules/integrations/services/historicalImportApi';
import type {
  HistoricalImportDetail,
  HistoricalImportSettingsUpdate,
} from '../../../modules/integrations/types/historicalImport';
import {
  HISTORICAL_FIELD_LABELS,
  HISTORICAL_RECORD_TYPE_LABELS,
  ROUTING_NOTE_LABELS,
} from '../../../modules/integrations/types/historicalImport';
import { formatCalendarDate, formatDateTime, formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { timezoneOptions, zoneLabel } from '../../scheduling/admin/historyImport/historyImportTimezones';
import AdminHoursSection from './AdminHoursSection';
import DrillsSection from './DrillsSection';
import StaffingSection from './StaffingSection';
import TrainingSection from './TrainingSection';

/** Where each kind of record is reviewed and committed, on this page. */
const IMPORTED_BY: Record<string, string> = {
  shift: 'Shift review, below',
  on_call: 'Shift review, below',
  admin: 'Admin Hours, below',
  training: 'Training, below',
};

const HOURS_PREFIX = 'hours:';
const CALLS_PREFIX = 'calls:';

/** One select per column for hours and calls: `hours:<type>`, `calls:<slug>` or unused. */
const columnRole = (detail: HistoricalImportDetail, header: string): string => {
  const hours = detail.hour_columns[header];
  if (hours) return `${HOURS_PREFIX}${hours}`;
  const calls = detail.call_columns[header];
  if (calls) return `${CALLS_PREFIX}${calls}`;
  return '';
};

const SettingsForm: React.FC<{
  detail: HistoricalImportDetail;
  busy: boolean;
  onSave: (payload: HistoricalImportSettingsUpdate) => void;
}> = ({ detail, busy, onSave }) => {
  const viewerZone = useTimezone();
  const [mapping, setMapping] = useState<Record<string, string>>(detail.column_mapping);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [sourceSystem, setSourceSystem] = useState(detail.import.source_system);
  const [zone, setZone] = useState(detail.import.timezone);

  const initialRoles = useMemo(
    () => Object.fromEntries(detail.headers.map((h) => [h, columnRole(detail, h)])),
    [detail]
  );
  useEffect(() => {
    setMapping(detail.column_mapping);
    setRoles(initialRoles);
    setSourceSystem(detail.import.source_system);
    setZone(detail.import.timezone);
  }, [detail, initialRoles]);

  const locked = detail.settings_locked;
  const fieldHeaders = new Set(Object.values(mapping));
  const otherHeaders = detail.headers.filter((h) => !fieldHeaders.has(h));
  const dirty =
    JSON.stringify(mapping) !== JSON.stringify(detail.column_mapping) ||
    JSON.stringify(roles) !== JSON.stringify(initialRoles) ||
    sourceSystem !== detail.import.source_system ||
    zone !== detail.import.timezone;

  const save = () => {
    const column_mapping: Record<string, string | null> = {};
    for (const field of detail.fields) column_mapping[field] = mapping[field] || null;
    const hour_columns: HistoricalImportSettingsUpdate['hour_columns'] = {};
    const call_columns: Record<string, string | null> = {};
    for (const header of detail.headers) {
      const role = fieldHeaders.has(header) ? '' : (roles[header] ?? '');
      const hours = role.startsWith(HOURS_PREFIX) ? role.slice(HOURS_PREFIX.length) : '';
      const calls = role.startsWith(CALLS_PREFIX) ? role.slice(CALLS_PREFIX.length) : '';
      hour_columns[header] = detail.record_types.find((t) => t === hours) ?? null;
      call_columns[header] = calls || null;
    }
    onSave({
      column_mapping,
      hour_columns,
      call_columns,
      ...(sourceSystem.trim() !== detail.import.source_system ? { source_system: sourceSystem.trim() } : {}),
      ...(zone !== detail.import.timezone ? { timezone: zone } : {}),
    });
  };

  return (
    <form
      className="card space-y-6 p-4 sm:p-6"
      aria-labelledby="historical-settings-heading"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div>
        <h2 id="historical-settings-heading" className="text-theme-text-primary text-lg font-semibold">
          1. How to read the file
        </h2>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Detected from the header row. Correct anything that was guessed wrong, then save.
        </p>
        {locked && (
          <p role="status" className="alert-warning mt-3 text-sm">
            Shift batches built from these settings are still in review. Commit or discard them before changing how the
            file is read.
          </p>
        )}
      </div>

      <fieldset disabled={locked || busy} className="space-y-6">
        <div className="field-grid gap-4">
          <div>
            <label htmlFor="historical-settings-system" className="form-label">
              Source system
            </label>
            <input
              id="historical-settings-system"
              className="form-input"
              maxLength={100}
              value={sourceSystem}
              onChange={(e) => setSourceSystem(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="historical-settings-zone" className="form-label">
              Times in the file are in
            </label>
            <select
              id="historical-settings-zone"
              className="form-input"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
            >
              {timezoneOptions(detail.import.timezone, viewerZone).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <h3 className="text-theme-text-primary mb-2 font-semibold">Columns</h3>
          <div className="field-grid gap-4">
            {detail.fields.map((field) => {
              const id = `historical-field-${field}`;
              const current = mapping[field] ?? '';
              return (
                <div key={field}>
                  <label htmlFor={id} className="form-label">
                    {HISTORICAL_FIELD_LABELS[field] ?? field}
                  </label>
                  <select
                    id={id}
                    className="form-input"
                    value={current}
                    onChange={(e) => {
                      const header = e.target.value;
                      const next = Object.fromEntries(Object.entries(mapping).filter(([key]) => key !== field));
                      setMapping(header ? { ...next, [field]: header } : next);
                    }}
                  >
                    <option value="">Not in this file</option>
                    {detail.headers.map((header) => (
                      <option key={header} value={header} disabled={fieldHeaders.has(header) && header !== current}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="text-theme-text-primary mb-1 font-semibold">Hours and calls</h3>
          <p className="text-theme-text-secondary mb-2 text-sm">
            A row becomes whatever kind of record its nonzero hours column says. Call columns are credited on shifts.
          </p>
          <ul className="divide-theme-surface-border divide-y">
            {otherHeaders.map((header) => {
              const id = `historical-role-${header}`;
              return (
                <li key={header} className="split-row gap-3 py-2 sm:items-center">
                  <label
                    htmlFor={id}
                    className="split-row-main text-theme-text-primary text-sm font-medium break-words"
                  >
                    {header}
                  </label>
                  <div className="split-row-aside sm:w-80">
                    <select
                      id={id}
                      className="form-input"
                      value={roles[header] ?? ''}
                      onChange={(e) => setRoles({ ...roles, [header]: e.target.value })}
                    >
                      <option value="">Not used</option>
                      <optgroup label="Hours">
                        {detail.record_types
                          .filter((t) => t !== HistoricalRecordType.IGNORE)
                          .map((type) => (
                            <option key={type} value={`${HOURS_PREFIX}${type}`}>
                              {HISTORICAL_RECORD_TYPE_LABELS[type] ?? type}
                            </option>
                          ))}
                      </optgroup>
                      {detail.call_types.length > 0 && (
                        <optgroup label="Calls">
                          {detail.call_types.map((callType) => (
                            <option key={callType.slug} value={`${CALLS_PREFIX}${callType.slug}`}>
                              {callType.label} calls
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </fieldset>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={!dirty || busy || locked}
          onClick={() => {
            setMapping(detail.column_mapping);
            setRoles(initialRoles);
            setSourceSystem(detail.import.source_system);
            setZone(detail.import.timezone);
          }}
        >
          Reset
        </button>
        <button type="submit" className="btn-primary" disabled={!dirty || busy || locked || !sourceSystem.trim()}>
          Save and re-sort
        </button>
      </div>
    </form>
  );
};

const RoutingPanel: React.FC<{ detail: HistoricalImportDetail }> = ({ detail }) => {
  const { routing } = detail;
  return (
    <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="historical-routing-heading">
      <div>
        <h2 id="historical-routing-heading" className="text-theme-text-primary text-lg font-semibold">
          2. How the rows sorted
        </h2>
        <p className="text-theme-text-secondary mt-1 text-sm">
          {formatNumber(routing.rows)} rows read. {formatNumber(routing.skipped)} had no hours and are skipped
          {routing.with_errors > 0 ? `; ${formatNumber(routing.with_errors)} could not be read` : ''}.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="rwd-table w-full text-sm">
          <thead>
            <tr className="text-theme-text-secondary text-left">
              <th scope="col" className="py-2 pr-4">
                Kind
              </th>
              <th scope="col" className="py-2 pr-4">
                Records
              </th>
              <th scope="col" className="py-2 pr-4">
                Hours
              </th>
              <th scope="col" className="py-2 pr-4">
                Dates
              </th>
              <th scope="col" className="py-2">
                Imported by
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(routing.types).map(([type, totals]) => (
              <tr key={type} className="border-theme-surface-border border-t">
                <td data-label="Kind" className="text-theme-text-primary py-2 pr-4 font-medium">
                  {HISTORICAL_RECORD_TYPE_LABELS[type] ?? type}
                </td>
                <td data-label="Records" className="py-2 pr-4">
                  {formatNumber(totals.records)}
                </td>
                <td data-label="Hours" className="py-2 pr-4">
                  {formatNumber(totals.hours)}
                </td>
                <td data-label="Dates" className="py-2 pr-4">
                  {totals.first_date && totals.last_date
                    ? `${formatCalendarDate(totals.first_date)} – ${formatCalendarDate(totals.last_date)}`
                    : '—'}
                </td>
                <td data-label="Imported by" className="text-theme-text-secondary py-2">
                  {IMPORTED_BY[type] ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {Object.keys(routing.notes).length > 0 && (
        <div>
          <h3 className="text-theme-text-primary mb-1 font-semibold">Clean-up applied</h3>
          <ul className="space-y-2 text-sm">
            {Object.entries(routing.notes).map(([kind, note]) => (
              <li key={kind}>
                <details>
                  <summary className="text-theme-text-primary cursor-pointer">
                    {ROUTING_NOTE_LABELS[kind] ?? kind}: {formatNumber(note.count)}
                  </summary>
                  <ul className="text-theme-text-secondary mt-1 ml-4 list-disc">
                    {note.examples.map((example) => (
                      <li key={`${kind}-${example.line_number}`}>
                        Line {example.line_number}: {example.message}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}

      {routing.errors.length > 0 && (
        <div>
          <h3 className="text-theme-text-primary mb-1 font-semibold">Rows that could not be read</h3>
          <ul className="text-theme-text-secondary list-disc space-y-1 pl-5 text-sm">
            {routing.errors.map((error) => (
              <li key={error.line_number}>
                Line {error.line_number}: {error.messages.join(' ')}
              </li>
            ))}
          </ul>
          {routing.with_errors > routing.errors.length && (
            <p className="text-theme-text-secondary mt-1 text-sm">The log lists every one.</p>
          )}
        </div>
      )}
    </section>
  );
};

const HistoricalImportDetailPage: React.FC = () => {
  const { importId = '' } = useParams<{ importId: string }>();
  const tz = useTimezone();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const [detail, setDetail] = useState<HistoricalImportDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await historicalImportService.getImport(importId));
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load this import'));
    }
  }, [importId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await action();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = (payload: HistoricalImportSettingsUpdate) =>
    void run(async () => {
      setDetail(await historicalImportService.updateSettings(importId, payload));
      toast.success('Saved. Rows re-sorted.');
    }, 'Could not save those settings');

  const sendShifts = async () => {
    if (!detail) return;
    const records = detail.importable_types.reduce((total, t) => total + (detail.routing.types[t]?.records ?? 0), 0);
    const ok = await confirm({
      title: 'Send shifts to review?',
      message: `Up to ${formatNumber(records)} shift and on-call rows go to shift review, split into batches by month. Rows already imported are left out. Nothing reaches the schedule until each batch is committed, and the settings above are locked while a batch is in review.`,
      confirmLabel: 'Send to review',
      cancelLabel: 'Not yet',
    });
    if (!ok) return;
    await run(async () => {
      const batches = await historicalImportService.createShiftBatches(importId);
      toast.success(`${batches.length} ${batches.length === 1 ? 'batch' : 'batches'} ready for review`);
      await load();
    }, 'Could not send the shifts');
  };

  const discardBatches = async () => {
    const ok = await confirm({
      title: 'Discard the batches in review?',
      message:
        'Every shift batch still in review is deleted, with the decisions made on it. Committed batches are not affected.',
      confirmLabel: 'Discard batches',
      cancelLabel: 'Keep them',
      variant: 'danger',
    });
    if (!ok) return;
    await run(async () => {
      const discarded = await historicalImportService.discardOpenBatches(importId);
      toast.success(`${discarded} ${discarded === 1 ? 'batch' : 'batches'} discarded`);
      await load();
    }, 'Could not discard the batches');
  };

  const downloadLog = () =>
    void run(async () => {
      const blob = await historicalImportService.downloadLog(importId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'historical_import_log.csv';
      link.click();
      URL.revokeObjectURL(url);
    }, 'Could not download the log');

  const discardImport = async () => {
    const ok = await confirm({
      title: 'Discard this import?',
      message:
        'The upload and any shift batches still in review are deleted. Committed batches stay on the schedule, and their rows stay recorded as imported.',
      confirmLabel: 'Discard import',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    await run(async () => {
      await historicalImportService.discard(importId);
      toast.success('Import discarded');
      void navigate('/integrations/historical-import');
    }, 'Could not discard the import');
  };

  const openBatches = detail?.batches.filter((b) => b.status === 'draft').length ?? 0;
  const canSend =
    !!detail &&
    !detail.settings_locked &&
    detail.importable_types.some((t) => (detail.routing.types[t]?.records ?? 0) > 0);

  return (
    <div className="mx-auto min-h-screen max-w-5xl p-4 sm:p-6">
      <Link
        to="/integrations/historical-import"
        className="text-theme-text-secondary hover:text-theme-text-primary mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All historical imports
      </Link>

      {loadError ? (
        <div role="alert" className="alert-danger text-sm">
          {loadError}
        </div>
      ) : !detail ? (
        <SkeletonPage rows={4} showStats={false} />
      ) : (
        <div className="space-y-6">
          <div className="split-row gap-3 sm:items-start">
            <div className="split-row-main">
              <h1 className="text-theme-text-primary text-2xl font-bold break-words sm:text-3xl">
                {detail.import.source_filename}
              </h1>
              <p className="text-theme-text-secondary mt-1 text-sm">
                {detail.import.source_system} · {formatNumber(detail.import.row_count)} rows · times in{' '}
                {zoneLabel(detail.import.timezone)} · uploaded {formatDateTime(detail.import.created_at, tz)}
              </p>
            </div>
            <div className="split-row-aside flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2"
                disabled={busy}
                onClick={downloadLog}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download log
              </button>
              <button
                type="button"
                className="btn-icon text-theme-text-secondary"
                aria-label="Discard this import"
                disabled={busy}
                onClick={() => void discardImport()}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <SettingsForm detail={detail} busy={busy} onSave={saveSettings} />
          <RoutingPanel detail={detail} />

          <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="historical-shifts-heading">
            <div className="split-row gap-3 sm:items-start">
              <div className="split-row-main">
                <h2 id="historical-shifts-heading" className="text-theme-text-primary text-lg font-semibold">
                  3. Shifts and on-call time
                </h2>
                <p className="text-theme-text-secondary mt-1 text-sm">
                  Sent to shift review in batches by month. Review each one there — who each member is, which unit each
                  name means, which members were one crew — and commit it. {formatNumber(detail.rows_imported)} rows
                  imported so far.
                </p>
              </div>
              <div className="split-row-aside flex flex-wrap gap-2">
                {openBatches > 0 && (
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => void discardBatches()}>
                    Discard batches in review
                  </button>
                )}
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-2"
                  disabled={busy || !canSend}
                  onClick={() => void sendShifts()}
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Send to shift review
                </button>
              </div>
            </div>
            {detail.batches.length === 0 ? (
              <p className="text-theme-text-secondary text-sm">No batches yet.</p>
            ) : (
              <ul className="divide-theme-surface-border divide-y">
                {detail.batches.map((batch) => (
                  <li key={batch.id} className="split-row gap-3 py-3 sm:items-center">
                    <div className="split-row-main">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-theme-text-primary font-medium break-words">{batch.source_filename}</span>
                        <span className={`badge border ${HISTORY_IMPORT_STATUS_COLORS[batch.status] ?? ''}`}>
                          {batch.status === 'committed' ? 'Committed' : 'In review'}
                        </span>
                      </div>
                      <p className="text-theme-text-secondary mt-1 text-sm">
                        {formatNumber(batch.row_count)} rows
                        {batch.summary
                          ? ` · ${formatNumber(batch.summary.shifts_created ?? 0)} shifts, ${formatNumber(
                              batch.summary.attendance_created ?? 0
                            )} attendance records, ${formatNumber(
                              batch.summary.external_hours_created ?? 0
                            )} outside-agency entries, ${formatNumber(batch.summary.calls_recorded ?? 0)} calls`
                          : ''}
                      </p>
                    </div>
                    <Link to={`/scheduling/admin/history-import/${batch.id}`} className="split-row-aside btn-secondary">
                      {batch.status === 'committed' ? 'View' : 'Review'}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <AdminHoursSection detail={detail} />

          <TrainingSection detail={detail} />

          <DrillsSection detail={detail} />

          <StaffingSection detail={detail} />
        </div>
      )}
    </div>
  );
};

export default HistoricalImportDetailPage;
