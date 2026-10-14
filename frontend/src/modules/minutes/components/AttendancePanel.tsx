/**
 * The roll call of a set of minutes.
 *
 * Read-only for everyone who can open the minutes; editable by a minutes
 * manager while the minutes are a draft. Each line carries a status (present,
 * late, left early, excused, absent, guest) and an optional note. The server
 * derives "counted toward quorum" from the status, so this screen never sets
 * `present` itself — it would only be one more place to disagree.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Trash2, UserPlus, Users } from 'lucide-react';
import { minutesService } from '../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import type { AttendanceStatus, AttendeeEntry } from '../types/minutes';
import { ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LABELS, statusOf } from '../utils/attendance';

const STATUS_CHIP: Record<AttendanceStatus, string> = {
  present: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  late: 'bg-lime-100 text-lime-800 dark:bg-lime-500/20 dark:text-lime-400',
  left_early: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400',
  excused: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  absent: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  guest: 'bg-theme-surface-secondary text-theme-text-primary',
};

interface AttendancePanelProps {
  minutesId: string;
  attendees: AttendeeEntry[];
  canEdit: boolean;
  /** Called after a save so the parent can reload the minutes (quorum moves). */
  onSaved: () => Promise<void> | void;
}

export const AttendancePanel: React.FC<AttendancePanelProps> = ({ minutesId, attendees, canEdit, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<AttendeeEntry[]>([]);
  const [guestName, setGuestName] = useState('');
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const counts = ATTENDANCE_STATUSES.map((status) => ({
    status,
    count: attendees.filter((a) => statusOf(a) === status).length,
  })).filter((c) => c.count > 0);

  const startEditing = () => {
    setRows(attendees.map((a) => ({ ...a, status: statusOf(a) })));
    setGuestName('');
    setEditing(true);
  };

  const setRow = (index: number, patch: Partial<AttendeeEntry>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const handleSuggest = async () => {
    setSuggesting(true);
    try {
      const suggestions = await minutesService.getAttendanceSuggestions(minutesId);
      setRows(suggestions.entries.map((a) => ({ ...a, status: statusOf(a) })));
      toast.success(
        suggestions.source === 'event'
          ? `Roll filled in from check-ins at ${suggestions.event_title ?? 'the linked event'}. Review it before saving.`
          : 'Roll filled in from the member list, everyone marked absent. Mark who was there.'
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not build a roll call'));
    } finally {
      setSuggesting(false);
    }
  };

  const handleAddGuest = () => {
    const name = guestName.trim();
    if (!name) return;
    setRows((current) => [...current, { name, status: 'guest', present: false }]);
    setGuestName('');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Every field the roll owns is sent, so a note the secretary cleared is
      // cleared rather than silently kept (an omitted key means "leave alone").
      await minutesService.updateMinutes(minutesId, {
        attendees: rows.map((row) => ({
          user_id: row.user_id ?? null,
          name: row.name.trim(),
          role: blankToNull(row.role),
          status: statusOf(row),
          note: blankToNull(row.note),
        })),
      });
      // Quorum is a count of this roll; refresh it, but a department with no
      // quorum rule configured must not turn a saved roll into an error.
      try {
        await minutesService.recalculateQuorum(minutesId);
      } catch {
        // Quorum checking is optional and the roll itself is already saved.
      }
      await onSaved();
      setEditing(false);
      toast.success('Attendance saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save attendance'));
    } finally {
      setSaving(false);
    }
  };

  if (!editing && attendees.length === 0 && !canEdit) return null;

  return (
    <div className="border-theme-surface-border mt-4 border-t pt-4" aria-labelledby="attendance-heading">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id="attendance-heading" className="text-theme-text-secondary flex items-center gap-2 text-sm font-medium">
          <Users className="h-4 w-4" aria-hidden="true" />
          Attendance ({attendees.length})
        </h3>
        {canEdit && !editing && (
          <button type="button" onClick={startEditing} className="btn-secondary touch:min-h-11 text-sm">
            {attendees.length === 0 ? 'Take roll call' : 'Edit attendance'}
          </button>
        )}
      </div>

      {!editing && (
        <>
          {counts.length > 0 && (
            <p className="text-theme-text-muted mb-2 text-xs">
              {counts.map((c) => `${c.count} ${ATTENDANCE_STATUS_LABELS[c.status].toLowerCase()}`).join(' · ')}
            </p>
          )}
          {attendees.length === 0 ? (
            <p className="text-theme-text-muted text-xs italic">No roll call recorded.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {attendees.map((a, i) => {
                const status = statusOf(a);
                return (
                  <li
                    key={`${a.user_id ?? 'guest'}-${i}`}
                    className={`rounded-sm px-2 py-1 text-xs ${STATUS_CHIP[status]}`}
                    title={a.note ?? undefined}
                  >
                    {a.name}
                    {a.role ? ` (${a.role})` : ''}
                    <span className="ml-1 font-semibold">{`· ${ATTENDANCE_STATUS_LABELS[status]}`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {editing && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={suggesting}
              onClick={() => {
                void handleSuggest();
              }}
              className="btn-secondary touch:min-h-11 text-sm"
            >
              {suggesting ? 'Building…' : 'Suggest from event or members'}
            </button>
            <button
              type="button"
              onClick={() =>
                setRows((current) =>
                  current.map((row) => (statusOf(row) === 'guest' ? row : { ...row, status: 'present' }))
                )
              }
              className="btn-secondary touch:min-h-11 text-sm"
            >
              Mark all members present
            </button>
          </div>

          {rows.length === 0 && (
            <p className="text-theme-text-muted text-xs italic">
              Nobody on the roll yet. Use the suggestion above, or add guests below.
            </p>
          )}

          <ul className="space-y-2">
            {rows.map((row, index) => (
              <li
                key={`${row.user_id ?? 'guest'}-${index}`}
                className="border-theme-surface-border grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)_auto] sm:items-center"
              >
                <span className="text-theme-text-primary truncate text-sm font-medium">{row.name}</span>
                <div>
                  <label htmlFor={`attendance-status-${index}`} className="sr-only">
                    Attendance for {row.name}
                  </label>
                  <select
                    id={`attendance-status-${index}`}
                    value={statusOf(row)}
                    onChange={(e) => setRow(index, { status: e.target.value as AttendanceStatus })}
                    className="form-input"
                  >
                    {ATTENDANCE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {ATTENDANCE_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`attendance-note-${index}`} className="sr-only">
                    Note for {row.name}
                  </label>
                  <input
                    id={`attendance-note-${index}`}
                    type="text"
                    maxLength={300}
                    placeholder="Note (arrived 7:20, left at 8:45…)"
                    value={row.note ?? ''}
                    onChange={(e) => setRow(index, { note: e.target.value })}
                    className="form-input"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                  className="btn-icon text-red-600 hover:text-red-700"
                  aria-label={`Remove ${row.name} from the roll`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 sm:max-w-xs">
              <label htmlFor="attendance-guest-name" className="form-label">
                Add a guest
              </label>
              <input
                id="attendance-guest-name"
                type="text"
                maxLength={200}
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddGuest();
                  }
                }}
                className="form-input"
              />
            </div>
            <button
              type="button"
              onClick={handleAddGuest}
              disabled={!guestName.trim()}
              className="btn-secondary touch:min-h-11 inline-flex items-center gap-1 text-sm"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add guest
            </button>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                void handleSave();
              }}
              className="btn-primary touch:min-h-11"
            >
              {saving ? 'Saving…' : 'Save attendance'}
            </button>
            <button type="button" disabled={saving} onClick={() => setEditing(false)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendancePanel;
