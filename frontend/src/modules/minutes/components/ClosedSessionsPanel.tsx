/**
 * Closed (executive) sessions held during a meeting.
 *
 * What the public record needs: why the body went into closed session, on what
 * authority, when, and who was in the room and for how long — plus a summary
 * that is safe to publish ("no action was taken"). What was said stays in the
 * minutes' own executive-session section. Part of the minutes, so editable
 * only on a draft, and covered by the adopted version's hash.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { DoorClosed, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../../components/Modal';
import DateTimeQuarterHour from '../../../components/ux/DateTimeQuarterHour';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatForDateTimeInput, formatDateTime, formatTime, localToUTC } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import { minutesService } from '../services/api';
import { PanelDisclosure } from './PanelDisclosure';
import type { AttendeeEntry, ClosedSession, ClosedSessionParticipant, Motion } from '../types/minutes';
import { statusOf } from '../utils/attendance';

interface ParticipantDraft {
  user_id: string | null;
  name: string;
  joined: string;
  left: string;
}

interface Draft {
  reason: string;
  legal_basis: string;
  started: string;
  ended: string;
  motion_id: string;
  summary: string;
  participants: ParticipantDraft[];
}

const emptyDraft = (): Draft => ({
  reason: '',
  legal_basis: '',
  started: '',
  ended: '',
  motion_id: '',
  summary: '',
  participants: [],
});

interface ClosedSessionsPanelProps {
  minutesId: string;
  /** A minutes manager on draft or rejected minutes. */
  canEdit: boolean;
  attendees: AttendeeEntry[];
  motions: Motion[];
  /** Whether the panel starts unfolded. The minutes page folds it; the default keeps it open. */
  defaultOpen?: boolean;
}

export const ClosedSessionsPanel: React.FC<ClosedSessionsPanelProps> = ({
  minutesId,
  canEdit,
  attendees,
  motions,
  defaultOpen = true,
}) => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [sessions, setSessions] = useState<ClosedSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [guestName, setGuestName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await minutesService.getClosedSessions(minutesId));
    } catch {
      setSessions([]);
    } finally {
      setLoaded(true);
    }
  }, [minutesId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toLocalInput = (iso?: string | null) => (iso ? formatForDateTimeInput(iso, tz) : '');
  const toIso = (local: string) => (local ? localToUTC(local, tz) : null);

  const openNew = () => {
    setDraft(emptyDraft());
    setGuestName('');
    setFormError(null);
    setEditing('new');
  };

  const openEdit = (session: ClosedSession) => {
    setDraft({
      reason: session.reason,
      legal_basis: session.legal_basis ?? '',
      started: toLocalInput(session.started_at),
      ended: toLocalInput(session.ended_at),
      motion_id: session.motion_id ?? '',
      summary: session.summary ?? '',
      participants: session.participants.map((p) => ({
        user_id: p.user_id ?? null,
        name: p.name,
        joined: toLocalInput(p.joined_at),
        left: toLocalInput(p.left_at),
      })),
    });
    setGuestName('');
    setFormError(null);
    setEditing(session.id);
  };

  const addFromRoll = () => {
    const present = attendees.filter((a) => ['present', 'late', 'left_early'].includes(statusOf(a)));
    setDraft((current) => {
      const known = new Set(current.participants.map((p) => p.user_id).filter(Boolean));
      const added = present
        .filter((a) => !a.user_id || !known.has(a.user_id))
        .map((a) => ({
          user_id: a.user_id ?? null,
          name: a.name,
          joined: current.started,
          left: current.ended,
        }));
      return { ...current, participants: [...current.participants, ...added] };
    });
  };

  const addGuest = () => {
    const name = guestName.trim();
    if (!name) return;
    setDraft((current) => ({
      ...current,
      participants: [...current.participants, { user_id: null, name, joined: current.started, left: current.ended }],
    }));
    setGuestName('');
  };

  const setParticipant = (index: number, patch: Partial<ParticipantDraft>) => {
    setDraft((current) => ({
      ...current,
      participants: current.participants.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.reason.trim() || !draft.started) {
      setFormError('Say why the body went into closed session and when it began.');
      return;
    }
    const participants: ClosedSessionParticipant[] = draft.participants.map((p) => ({
      user_id: p.user_id,
      name: p.name,
      joined_at: toIso(p.joined),
      left_at: toIso(p.left),
    }));
    // Every field the form owns is sent so a cleared one is cleared, not kept.
    const payload = {
      reason: draft.reason.trim(),
      legal_basis: blankToNull(draft.legal_basis),
      started_at: toIso(draft.started) ?? '',
      ended_at: toIso(draft.ended),
      motion_id: blankToNull(draft.motion_id),
      participants,
      summary: blankToNull(draft.summary),
    };
    setSaving(true);
    setFormError(null);
    try {
      if (editing === 'new') await minutesService.addClosedSession(minutesId, payload);
      else if (editing) await minutesService.updateClosedSession(minutesId, editing, payload);
      setEditing(null);
      await load();
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, 'Failed to save the closed session'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (session: ClosedSession) => {
    const ok = await confirm({
      title: 'Remove this closed session?',
      message: `The record of “${session.reason}” will be removed from these minutes.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      await minutesService.deleteClosedSession(minutesId, session.id);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to remove the closed session'));
    }
  };

  if (!loaded || (sessions.length === 0 && !canEdit)) return null;

  return (
    <PanelDisclosure
      id="closed-sessions-heading"
      icon={<DoorClosed className="h-5 w-5" aria-hidden="true" />}
      title="Closed sessions"
      count={sessions.length}
      defaultOpen={defaultOpen}
      actions={
        canEdit && (
          <button
            type="button"
            onClick={openNew}
            className="btn-secondary touch:min-h-11 inline-flex items-center gap-1 text-sm"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Record a closed session
          </button>
        )
      }
    >
      {sessions.length === 0 && (
        <p className="text-theme-text-muted mt-2 text-xs italic">
          No closed session recorded. If the body met in closed session, record why, when, and who stayed.
        </p>
      )}

      <div className="mt-2 space-y-3">
        {sessions.map((session, index) => (
          <article key={session.id} className="border-theme-surface-border rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-theme-text-primary font-medium">
                  {index + 1}. {session.reason}
                </h3>
                <p className="text-theme-text-muted text-xs">
                  {formatDateTime(session.started_at, tz)}
                  {session.ended_at ? ` to ${formatTime(session.ended_at, tz)}` : ' (end not recorded)'}
                  {session.legal_basis ? ` · ${session.legal_basis}` : ''}
                </p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(session)}
                    className="btn-icon"
                    aria-label={`Edit closed session ${index + 1}`}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleDelete(session);
                    }}
                    className="btn-icon text-red-600 hover:text-red-700"
                    aria-label={`Remove closed session ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
            {session.participants.length > 0 && (
              <div className="mt-2">
                <p className="text-theme-text-secondary text-xs font-medium">
                  In the room ({session.participants.length})
                </p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {session.participants.map((p, i) => (
                    <li
                      key={`${p.user_id ?? 'guest'}-${i}`}
                      className="bg-theme-surface-secondary rounded-sm px-2 py-1 text-xs"
                    >
                      {p.name}
                      {p.joined_at
                        ? ` · ${formatTime(p.joined_at, tz)}${p.left_at ? `–${formatTime(p.left_at, tz)}` : ''}`
                        : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {session.summary && (
              <p className="text-theme-text-primary mt-2 text-sm whitespace-pre-wrap">{session.summary}</p>
            )}
          </article>
        ))}
      </div>

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Record a closed session' : 'Edit closed session'}
        size="lg"
        onSubmit={(e) => {
          void handleSave(e);
        }}
        footer={
          <>
            <button type="button" onClick={() => setEditing(null)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Save closed session'}
            </button>
          </>
        }
      >
        {formError && (
          <p className="alert-danger mb-3 text-sm" role="alert">
            {formError}
          </p>
        )}
        <div className="space-y-3">
          <div>
            <label htmlFor="cs-reason" className="form-label">
              Reason
            </label>
            <input
              id="cs-reason"
              type="text"
              maxLength={300}
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              placeholder="e.g. Personnel matter"
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="cs-basis" className="form-label">
              Authority (bylaw or statute)
            </label>
            <input
              id="cs-basis"
              type="text"
              maxLength={300}
              value={draft.legal_basis}
              onChange={(e) => setDraft({ ...draft, legal_basis: e.target.value })}
              className="form-input"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <span className="form-label">Began</span>
              <DateTimeQuarterHour
                value={draft.started}
                onChange={(started) => setDraft({ ...draft, started })}
                timezone={tz}
                timeLabel="Closed session began"
              />
            </div>
            <div>
              <span className="form-label">Ended</span>
              <DateTimeQuarterHour
                value={draft.ended}
                onChange={(ended) => setDraft({ ...draft, ended })}
                timezone={tz}
                timeLabel="Closed session ended"
              />
            </div>
          </div>
          {motions.length > 0 && (
            <div>
              <label htmlFor="cs-motion" className="form-label">
                Motion that opened it
              </label>
              <select
                id="cs-motion"
                value={draft.motion_id}
                onChange={(e) => setDraft({ ...draft, motion_id: e.target.value })}
                className="form-input"
              >
                <option value="">None recorded</option>
                {motions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.motion_text.slice(0, 80)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <fieldset>
            <legend className="form-label">Who was in the room</legend>
            <div className="mb-2 flex flex-wrap gap-2">
              <button type="button" onClick={addFromRoll} className="btn-secondary text-sm">
                Add everyone present at the meeting
              </button>
            </div>
            <ul className="space-y-2">
              {draft.participants.map((p, index) => (
                <li
                  key={`${p.user_id ?? 'guest'}-${index}`}
                  className="border-theme-surface-border rounded-md border p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-theme-text-primary text-sm font-medium">{p.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          participants: current.participants.filter((_, i) => i !== index),
                        }))
                      }
                      className="btn-icon text-red-600"
                      aria-label={`Remove ${p.name} from the closed session`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <span className="text-theme-text-muted text-xs">Joined</span>
                      <DateTimeQuarterHour
                        value={p.joined}
                        onChange={(joined) => setParticipant(index, { joined })}
                        timezone={tz}
                        timeLabel={`${p.name} joined`}
                      />
                    </div>
                    <div>
                      <span className="text-theme-text-muted text-xs">Left</span>
                      <DateTimeQuarterHour
                        value={p.left}
                        onChange={(left) => setParticipant(index, { left })}
                        timezone={tz}
                        timeLabel={`${p.name} left`}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor="cs-guest" className="text-theme-text-muted text-xs">
                  Add someone by name (counsel, a guest)
                </label>
                <input
                  id="cs-guest"
                  type="text"
                  maxLength={200}
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addGuest();
                    }
                  }}
                  className="form-input"
                />
              </div>
              <button type="button" onClick={addGuest} disabled={!guestName.trim()} className="btn-secondary text-sm">
                Add
              </button>
            </div>
          </fieldset>

          <div>
            <label htmlFor="cs-summary" className="form-label">
              What may be said publicly
            </label>
            <textarea
              id="cs-summary"
              rows={3}
              maxLength={4000}
              value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              placeholder="e.g. No action was taken."
              className="form-input"
            />
            <p className="text-theme-text-muted mt-1 text-xs">
              This appears on the published minutes. Record what was discussed in the executive-session section, which
              stays restricted.
            </p>
          </div>
        </div>
      </Modal>
    </PanelDisclosure>
  );
};

export default ClosedSessionsPanel;
