/**
 * The shifts the import proposes, and the outside-agency hours it will log.
 *
 * Rows for one unit and day are grouped into a shift when their start and end
 * times agree; a confidence of 90% or more joins them without asking, 60-89%
 * is held here for the reviewer to confirm or keep separate. The same bands
 * decide whether a proposed shift is one already on the schedule. Times are
 * shown in the import's own zone — the one the file was written in.
 */

import React, { useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import { Pagination } from '../../../../components/ux';
import type {
  HistoryImportAnalysis,
  HistoryImportAttendance,
  HistoryImportMappingsUpdate,
  HistoryImportShift,
  MatchDecision,
} from '../../../../modules/scheduling/types/historyImport';
import { ExistingShiftStatus } from '../../../../modules/scheduling/types/historyImport';
import { formatShortDateTime, formatTime } from '../../../../utils/dateFormatting';
import { attendanceUnitLabel, hoursLabel, memberLabel, unitLabel } from './historyImportLabels';

interface ReviewShiftsProps {
  analysis: HistoryImportAnalysis;
  timezone: string;
  busy: boolean;
  onMappings: (payload: HistoryImportMappingsUpdate) => void;
  onRowDecision: (rowId: string, decision: MatchDecision | null) => void;
  /** Keep these rows apart from the entries before them. */
  onSplit: (rowIds: string[]) => void;
}

const PAGE_SIZE = 20;

const needsReview = (shift: HistoryImportShift): boolean =>
  shift.existing_status === ExistingShiftStatus.PENDING || shift.attendances.some((a) => a.needs_confirmation);

const AttendanceLine: React.FC<{
  att: HistoryImportAttendance;
  analysis: HistoryImportAnalysis;
  timezone: string;
  busy: boolean;
  showUnit?: boolean;
  onRowDecision: (rowId: string, decision: MatchDecision | null) => void;
  onSplit: (rowIds: string[]) => void;
}> = ({ att, analysis, timezone, busy, showUnit = false, onRowDecision, onSplit }) => {
  const seed = att.row_ids[0] ?? '';
  return (
    <li className="py-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 text-sm">
          <span className="text-theme-text-primary font-medium">{memberLabel(analysis, att.member_ref)}</span>
          <span className="text-theme-text-secondary">
            {showUnit ? ` · ${attendanceUnitLabel(analysis, att)}` : ''}
            {att.seat ? ` · ${att.seat}` : att.role ? ` · ${att.role}` : ''} ·{' '}
            {formatShortDateTime(att.start, timezone)} – {formatShortDateTime(att.end, timezone)} ·{' '}
            {hoursLabel(att.minutes)}
            {att.call_count != null ? ` · ${att.call_count} calls` : ''} · line
            {att.line_numbers.length > 1 ? 's' : ''} {att.line_numbers.join(', ')}
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
            {att.joined && (
              <span className="badge border border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400">
                <Link2 className="mr-1 h-3 w-3" aria-hidden="true" />
                Joined from {att.line_numbers.length} entries
              </span>
            )}
            {att.confidence < 100 && (
              <span className="badge border border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400">
                {att.confidence}% match
              </span>
            )}
            {att.duplicate_existing && (
              <span className="badge border border-gray-500/20 bg-gray-500/10 text-gray-700 dark:text-gray-300">
                Already recorded — will be skipped
              </span>
            )}
          </div>
        </div>
        {att.joined && (
          <button
            type="button"
            className="btn-secondary shrink-0"
            disabled={busy}
            onClick={() => onSplit(att.row_ids.slice(1))}
          >
            Split apart
          </button>
        )}
        {att.needs_confirmation && (
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => onRowDecision(seed, 'accept')}>
              Same shift
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => onRowDecision(seed, 'separate')}
            >
              Keep separate
            </button>
          </div>
        )}
      </div>
    </li>
  );
};

const ReviewShifts: React.FC<ReviewShiftsProps> = ({
  analysis,
  timezone,
  busy,
  onMappings,
  onRowDecision,
  onSplit,
}) => {
  const [onlyReview, setOnlyReview] = useState(true);
  const [page, setPage] = useState(1);

  const pending = analysis.shifts.filter(needsReview).length;
  const shifts = useMemo(
    () => (onlyReview && pending > 0 ? analysis.shifts.filter(needsReview) : analysis.shifts),
    [analysis.shifts, onlyReview, pending]
  );
  // Deciding a probable match removes it from the "needs a decision" list,
  // which can leave the current page past the end.
  const current = Math.min(page, Math.max(1, Math.ceil(shifts.length / PAGE_SIZE)));
  const shown = shifts.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const decideExisting = (key: string, decision: MatchDecision) => onMappings({ existing_shifts: { [key]: decision } });

  return (
    <section aria-labelledby="review-shifts-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="review-shifts-heading" className="text-theme-text-primary text-lg font-semibold">
            Shifts
          </h2>
          <p className="text-theme-text-secondary text-sm">
            {analysis.shifts.length} shifts on this department's units
            {pending > 0 ? `, ${pending} waiting on a decision` : ''}. Times are in {timezone.replace(/_/g, ' ')}.
          </p>
        </div>
        {pending > 0 && (
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={onlyReview}
              onChange={(e) => {
                setOnlyReview(e.target.checked);
                setPage(1);
              }}
            />
            Only shifts that need a decision
          </label>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="card text-theme-text-secondary p-4 text-sm">
          No shifts yet. Shifts appear once members and units are settled.
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((shift) => (
            <li key={shift.key} className="card p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-theme-text-primary font-semibold">
                    {unitLabel(analysis, 'own', shift.apparatus_id)} · {formatShortDateTime(shift.start, timezone)} –{' '}
                    {formatTime(shift.end, timezone)}
                  </h3>
                  <p className="text-theme-text-secondary text-sm">
                    {shift.attendances.length} {shift.attendances.length === 1 ? 'member' : 'members'} ·{' '}
                    {shift.existing_status === ExistingShiftStatus.AUTO ||
                    shift.existing_status === ExistingShiftStatus.ACCEPTED
                      ? `added to the shift already on the schedule (${shift.existing_confidence ?? 100}% match)`
                      : 'a new shift'}
                  </p>
                </div>
                {shift.existing_status === ExistingShiftStatus.PENDING && (
                  <div className="flex flex-col gap-2 sm:items-end">
                    <span className="text-theme-text-secondary text-sm">
                      {shift.existing_confidence}% match for a shift already on the schedule
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={busy}
                        onClick={() => decideExisting(shift.key, 'accept')}
                      >
                        Add to that shift
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busy}
                        onClick={() => decideExisting(shift.key, 'separate')}
                      >
                        Import separately
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <ul className="divide-theme-surface-border mt-2 divide-y">
                {shift.attendances.map((att) => (
                  <AttendanceLine
                    key={att.key}
                    att={att}
                    analysis={analysis}
                    timezone={timezone}
                    busy={busy}
                    onRowDecision={onRowDecision}
                    onSplit={onSplit}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {shifts.length > PAGE_SIZE && (
        <Pagination currentPage={current} totalItems={shifts.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      )}

      {analysis.external.length > 0 && (
        <div className="card p-4">
          <h3 className="text-theme-text-primary font-semibold">Outside-agency hours</h3>
          <p className="text-theme-text-secondary text-sm">
            {analysis.external.length} entries on other agencies' units, logged as outside-agency hours.
          </p>
          <ul className="divide-theme-surface-border mt-2 divide-y">
            {analysis.external.slice(0, 200).map((att) => (
              <AttendanceLine
                key={att.key}
                att={att}
                analysis={analysis}
                timezone={timezone}
                busy={busy}
                showUnit
                onRowDecision={onRowDecision}
                onSplit={onSplit}
              />
            ))}
          </ul>
          {analysis.external.length > 200 && (
            <p className="text-theme-text-secondary mt-2 text-sm">
              Showing the first 200. Every entry is listed on the Rows tab.
            </p>
          )}
        </div>
      )}
    </section>
  );
};

export default ReviewShifts;
