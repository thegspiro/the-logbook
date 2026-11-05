/**
 * Historical Data Import — company drills.
 *
 * The CompanyDrill rows mark department drills, which a session-attendance
 * requirement grades members on. A date counts as a held drill when enough
 * members logged it (three by default): a date one member logged is far
 * likelier to be their own training flagged as a drill. Each held drill
 * becomes a past, finalized training session linked to the requirements
 * chosen here, and each member's imported record of that date is attached to
 * it. It runs after the training step, whose records it attaches, and it is
 * safe to run again.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { historicalImportService } from '../../../modules/integrations/services/historicalImportApi';
import type {
  DrillPreview,
  HistoricalImportDetail,
  TrainingSettingsUpdate,
} from '../../../modules/integrations/types/historicalImport';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

interface DrillsSectionProps {
  detail: HistoricalImportDetail;
}

const DrillsSection: React.FC<DrillsSectionProps> = ({ detail }) => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const importId = detail.import.id;
  const [opened, setOpened] = useState(false);
  const [preview, setPreview] = useState<DrillPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const hasTrainingColumn = Object.values(detail.hour_columns).includes('training');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setPreview(await historicalImportService.getDrillPreview(importId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not read the drill rows'));
    } finally {
      setBusy(false);
    }
  }, [importId]);

  useEffect(() => {
    if (opened) void load();
  }, [opened, load]);

  const save = (payload: TrainingSettingsUpdate) =>
    void (async () => {
      setBusy(true);
      try {
        await historicalImportService.updateTrainingSettings(importId, payload);
        setPreview(await historicalImportService.getDrillPreview(importId));
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not save that change'));
      } finally {
        setBusy(false);
      }
    })();

  const chosen = preview?.settings.drill_requirement_ids ?? [];
  const toggleRequirement = (id: string) =>
    save({ drill_requirement_ids: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id] });

  const commit = async () => {
    if (!preview) return;
    const ok = await confirm({
      title: 'Create the held drills?',
      message: `This makes ${formatNumber(preview.qualifying_dates)} past, finalized drill sessions linked to the ${
        chosen.length === 1 ? 'requirement' : `${chosen.length} requirements`
      } you chose, and attaches each member's imported record of that date. Running it again creates nothing twice and re-links the sessions to the requirements chosen then.`,
      confirmLabel: 'Create drills',
      variant: 'info',
      cancelLabel: 'Not yet',
    });
    if (!ok) return;
    setBusy(true);
    try {
      setPreview(await historicalImportService.commitDrills(importId));
      toast.success('Drills created');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not create the drills'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="historical-drills-heading">
      <div className="split-row gap-3 sm:items-start">
        <div className="split-row-main">
          <h2 id="historical-drills-heading" className="text-theme-text-primary text-lg font-semibold">
            6. Company drills
          </h2>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Dates enough members logged as a department drill become held drills that count toward the attendance
            requirements you choose. Do this after the training records are imported.
          </p>
        </div>
        {!opened && (
          <button
            type="button"
            className="split-row-aside btn-secondary"
            disabled={!hasTrainingColumn}
            onClick={() => setOpened(true)}
          >
            Set up drills
          </button>
        )}
      </div>

      {opened && !preview && <p className="text-theme-text-secondary text-sm">Reading the file…</p>}

      {preview && (
        <>
          {preview.result && (
            <p role="status" className="alert-success text-sm">
              {formatNumber(preview.result.sessions_created ?? 0)} drills created
              {preview.result.sessions_relinked
                ? `, ${formatNumber(preview.result.sessions_relinked)} re-linked`
                : ''}, {formatNumber(preview.result.records_attached ?? 0)} attendance records attached.
            </p>
          )}

          <div className="field-grid gap-4">
            <div>
              <label htmlFor="drill-column" className="form-label">
                Drill column
              </label>
              <select
                id="drill-column"
                className="form-input"
                value={preview.settings.drill_column ?? ''}
                disabled={busy}
                onChange={(e) => save({ drill_column: e.target.value })}
              >
                <option value="">Not in this file</option>
                {preview.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
              <p className="text-theme-text-secondary mt-1 text-xs">A yes/no column marking a department drill.</p>
            </div>
            <div>
              <label htmlFor="drill-min-members" className="form-label">
                Members needed
              </label>
              <input
                id="drill-min-members"
                type="number"
                min={1}
                max={50}
                className="form-input"
                defaultValue={preview.settings.drill_min_members ?? 3}
                key={preview.settings.drill_min_members ?? 3}
                disabled={busy}
                onBlur={(e) => {
                  const value = Number(e.target.value);
                  if (value >= 1 && value !== preview.settings.drill_min_members) save({ drill_min_members: value });
                }}
              />
              <p className="text-theme-text-secondary mt-1 text-xs">
                A date with fewer members stays an ordinary training record.
              </p>
            </div>
          </div>

          <p className="text-theme-text-secondary text-sm">
            {formatNumber(preview.drill_rows)} drill rows on {formatNumber(preview.drill_dates)} dates;{' '}
            <strong className="text-theme-text-primary">{formatNumber(preview.qualifying_dates)}</strong> dates have
            enough members ({formatNumber(preview.qualifying_rows)} rows).
            {preview.sessions_created > 0 && ` ${formatNumber(preview.sessions_created)} already created.`}
          </p>

          <fieldset disabled={busy}>
            <legend className="form-label">Counts toward</legend>
            {preview.requirements.length === 0 ? (
              <p className="text-theme-text-secondary text-sm">
                The department has no session-attendance requirement yet. Create one under Training → Requirements
                first.
              </p>
            ) : (
              <div className="space-y-2">
                {preview.requirements.map((r) => (
                  <label key={r.id} className="text-theme-text-primary flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={chosen.includes(r.id)}
                      onChange={() => toggleRequirement(r.id)}
                    />
                    {r.name}
                    {r.required_attendance_pct ? (
                      <span className="text-theme-text-muted">({r.required_attendance_pct}%)</span>
                    ) : null}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {preview.dates.length > 0 && (
            <details>
              <summary className="text-theme-text-secondary cursor-pointer text-sm">
                Held drills, newest first
                {preview.qualifying_dates > preview.dates.length
                  ? ` (first ${formatNumber(preview.dates.length)})`
                  : ''}
              </summary>
              <ul className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                {preview.dates.map((d) => (
                  <li key={d.date} className="text-theme-text-secondary">
                    {formatDate(d.date, tz)} · {d.members} members{d.session_created ? ' · created' : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {!preview.training_committed && (
            <p className="alert-info text-sm">Import the training records (step 5) first: the drills attach them.</p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !preview.can_commit}
              onClick={() => void commit()}
            >
              {preview.sessions_created > 0 ? 'Update drills' : 'Create drills'}
            </button>
          </div>
        </>
      )}
    </section>
  );
};

export default DrillsSection;
