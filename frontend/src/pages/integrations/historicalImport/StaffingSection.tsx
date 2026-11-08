/**
 * Historical Data Import — staffing roster.
 *
 * Who was scheduled into which seat, at which event. It comes as a seats file
 * joined to an events file on an event number, or as one flat file whose seat
 * rows carry their own dates. This step stores the files, says which column
 * means what, and reports how they join: unfilled seats, seats whose event the
 * export lacks, events outside the file's usual years (possible test entries)
 * and upcoming events. The roster credits no hours; the hours file did that.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FileDropzone } from '../../../components/ux';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { historicalImportService } from '../../../modules/integrations/services/historicalImportApi';
import {
  StaffingFileKind,
  type HistoricalImportDetail,
  type StaffingFile,
  type StaffingPreview,
  type StaffingSummary,
} from '../../../modules/integrations/types/historicalImport';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import StaffingCommitPanel from './StaffingCommitPanel';
import StaffingMappingPanel from './StaffingMappingPanel';

const MAX_UPLOAD_MB = 40;

const FIELD_LABELS: Record<string, string> = {
  event_key: 'Event number',
  seat_id: 'Seat number',
  title: 'Seat title',
  membership_number: 'Member number',
  member_name: 'Member name',
  first_name: 'First name',
  last_name: 'Last name',
  required: 'Required seat',
  date: 'Date',
  start_time: 'Start time',
  end_time: 'End time',
  activity: 'Activity',
  location: 'Location',
};

const FILE_COPY: Record<StaffingFileKind, { title: string; help: string }> = {
  [StaffingFileKind.SEATS]: {
    title: 'Seats file',
    help: 'One row per seat at an event: its title and who held it.',
  },
  [StaffingFileKind.EVENTS]: {
    title: 'Events file',
    help: 'One row per event: its date, times and activity. Not needed when each seat row carries its date.',
  },
};

interface StaffingSectionProps {
  detail: HistoricalImportDetail;
}

const StaffingSection: React.FC<StaffingSectionProps> = ({ detail }) => {
  const { confirm } = useConfirm();
  const importId = detail.import.id;
  const [opened, setOpened] = useState(false);
  const [preview, setPreview] = useState<StaffingPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action: () => Promise<StaffingPreview>, failure: string) => {
    setBusy(true);
    try {
      setPreview(await action());
      return true;
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, failure));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (opened) void run(() => historicalImportService.getStaffing(importId), 'Could not read the staffing files');
  }, [opened, importId, run]);

  const upload = (kind: StaffingFileKind, file: File | undefined) => {
    if (!file) return;
    void run(() => historicalImportService.uploadStaffingFile(importId, kind, file), 'Could not store that file').then(
      (ok) => {
        if (ok) toast.success(`${FILE_COPY[kind].title} stored`);
      }
    );
  };

  const remove = async (kind: StaffingFileKind) => {
    const ok = await confirm({
      title: `Remove the ${FILE_COPY[kind].title.toLowerCase()}?`,
      message: 'The uploaded file and how its columns are read are deleted. Nothing else changes.',
      confirmLabel: 'Remove file',
      cancelLabel: 'Keep it',
    });
    if (ok) void run(() => historicalImportService.removeStaffingFile(importId, kind), 'Could not remove that file');
  };

  const changeColumn = (file: StaffingFile, field: string, header: string) => {
    const mapping: Record<string, string | null> = { ...file.column_mapping, [field]: header || null };
    void run(
      () => historicalImportService.updateStaffingMapping(importId, file.kind, mapping),
      'Could not save that change'
    );
  };

  const fileOf = (kind: StaffingFileKind) => preview?.files.find((f) => f.kind === kind);

  return (
    <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="historical-staffing-heading">
      <div className="split-row gap-3 sm:items-start">
        <div className="split-row-main">
          <h2 id="historical-staffing-heading" className="text-theme-text-primary text-lg font-semibold">
            7. Staffing roster
          </h2>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Who was scheduled into which seat at each shift and event. The roster credits no hours: the hours file
            already did.
          </p>
        </div>
        {!opened && (
          <button type="button" className="split-row-aside btn-secondary" onClick={() => setOpened(true)}>
            Set up staffing
          </button>
        )}
      </div>

      {opened && !preview && <p className="text-theme-text-secondary text-sm">Reading the files…</p>}

      {preview && (
        <>
          {[StaffingFileKind.SEATS, StaffingFileKind.EVENTS].map((kind) => {
            const file = fileOf(kind);
            const fields = preview.fields[kind] ?? [];
            return (
              <div key={kind} className="card-secondary space-y-3 p-4">
                <div className="split-row gap-3">
                  <div className="split-row-main">
                    <h3 className="text-theme-text-primary font-semibold">{FILE_COPY[kind].title}</h3>
                    <p className="text-theme-text-secondary text-xs">{FILE_COPY[kind].help}</p>
                  </div>
                  {file && (
                    <button
                      type="button"
                      className="split-row-aside btn-secondary"
                      disabled={busy}
                      onClick={() => void remove(kind)}
                    >
                      Remove
                    </button>
                  )}
                </div>

                {file ? (
                  <>
                    <p className="text-theme-text-secondary text-sm">
                      {file.source_filename} · {formatNumber(file.row_count)} rows
                    </p>
                    <div className="field-grid gap-3">
                      {fields.map((field) => {
                        const id = `staffing-${kind}-${field}`;
                        return (
                          <div key={field}>
                            <label htmlFor={id} className="form-label">
                              {FIELD_LABELS[field] ?? field}
                            </label>
                            <select
                              id={id}
                              className="form-input"
                              value={file.column_mapping[field] ?? ''}
                              disabled={busy}
                              onChange={(e) => changeColumn(file, field, e.target.value)}
                            >
                              <option value="">Not in this file</option>
                              {file.headers.map((header) => (
                                <option key={header} value={header}>
                                  {header}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <FileDropzone
                    accept=".csv,text/csv"
                    maxSizeMB={MAX_UPLOAD_MB}
                    label={`Drop the ${FILE_COPY[kind].title.toLowerCase()} here or click to browse`}
                    onFilesSelected={(files) => upload(kind, files[0])}
                  />
                )}
              </div>
            );
          })}

          {preview.problems.length > 0 && (
            <ul className="alert-info list-disc space-y-1 pl-8 text-sm">
              {preview.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}

          {preview.summary && <StaffingSummaryView summary={preview.summary} flatFile={preview.flat_file} />}

          {preview.summary && <StaffingMappingPanel importId={importId} />}

          {preview.summary && <StaffingCommitPanel importId={importId} />}
        </>
      )}
    </section>
  );
};

const StaffingSummaryView: React.FC<{ summary: StaffingSummary; flatFile: boolean }> = ({ summary, flatFile }) => {
  const tz = useTimezone();
  const { seats, events } = summary;
  return (
    <div className="space-y-3" role="status">
      <p className="text-theme-text-secondary text-sm">
        <strong className="text-theme-text-primary">{formatNumber(seats.rows)}</strong> seats:{' '}
        {formatNumber(seats.filled)} filled, {formatNumber(seats.unfilled)} unfilled.{' '}
        <strong className="text-theme-text-primary">{formatNumber(events.rows)}</strong> events
        {flatFile ? ' (from the seat rows)' : ''}: {formatNumber(events.staffed)} with seats,{' '}
        {formatNumber(events.unstaffed)} without. Of those, {formatNumber(events.unstaffed_importable)} have a date in
        the usual range and become calendar events.
        {events.first_date && events.last_date
          ? ` They run from ${formatDate(events.first_date, tz)} to ${formatDate(events.last_date, tz)}.`
          : ''}
      </p>

      {seats.missing_event > 0 && (
        <div className="alert-warning space-y-1 text-sm">
          <p>
            {formatNumber(seats.missing_event)} seats ({formatNumber(seats.missing_event_filled)} filled) name{' '}
            {formatNumber(seats.missing_event_keys)} events the events file does not have, so there is no date to place
            them on. They are left out unless those events are exported too.
          </p>
          <p className="text-xs">
            For example, event{seats.missing_event_examples.length === 1 ? '' : 's'}{' '}
            {seats.missing_event_examples
              .slice(0, 5)
              .map((m) => `${m.event_key} (${formatNumber(m.seats)} seats)`)
              .join(', ')}
            .
          </p>
        </div>
      )}

      {seats.without_event_key > 0 && (
        <p className="text-theme-text-secondary text-sm">
          {formatNumber(seats.without_event_key)} seats name no event at all and are left out.
        </p>
      )}

      {events.outside_usual_range > 0 && (
        <div className="alert-warning space-y-1 text-sm">
          <p>
            {formatNumber(events.outside_usual_range)} events fall outside {events.usual_first_year}–
            {events.usual_last_year}, the years most of the file covers. They look like test entries or typing slips and
            are skipped.
          </p>
          <ul className="list-disc pl-5 text-xs">
            {events.outside_usual_range_examples.slice(0, 10).map((e) => (
              <li key={e.line_number}>
                Line {e.line_number}: {formatDate(e.date, tz)} · {e.activity || 'No activity'} · {formatNumber(e.seats)}{' '}
                seats
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="text-theme-text-secondary list-disc space-y-1 pl-5 text-sm">
        {events.upcoming > 0 && <li>{formatNumber(events.upcoming)} upcoming events become scheduled events.</li>}
        {events.overnight > 0 && (
          <li>{formatNumber(events.overnight)} events end at or before their start and run past midnight.</li>
        )}
        {events.undated > 0 && (
          <li>
            {formatNumber(events.undated)} events have no readable date and are left out (line
            {events.undated_examples.length === 1 ? '' : 's'} {events.undated_examples.slice(0, 5).join(', ')}).
          </li>
        )}
        {events.duplicate_keys > 0 && (
          <li>{formatNumber(events.duplicate_keys)} event rows repeat an event number; the first is used.</li>
        )}
      </ul>
    </div>
  );
};

export default StaffingSection;
