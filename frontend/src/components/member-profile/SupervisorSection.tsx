/**
 * Who the member reports to, and who they reported to before.
 *
 * Shown to the member and to members-managers, like the rest of the profile's
 * administrative cards; the backend enforces the same rule on the endpoint.
 * Managers set, change or end the assignment. The choice of supervisor comes
 * from the backend's own candidate list (current members of the department,
 * not the member), so the picker cannot offer someone the save would refuse.
 *
 * Dates are inclusive: a change from a given date ends the previous
 * assignment the day before, and a change dated the day the current
 * assignment began corrects it rather than adding a one-day entry.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { memberStatusService } from '../../services/api';
import { useConfirm } from '../../contexts/ConfirmContext';
import type { MemberSupervisor, SupervisorCandidate } from '../../types/user';
import { formatDate, getTodayLocalDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

interface SupervisorSectionProps {
  userId: string;
  memberName: string;
  canEdit: boolean;
  tz: string;
}

export const SupervisorSection: React.FC<SupervisorSectionProps> = ({ userId, memberName, canEdit, tz }) => {
  const { confirm } = useConfirm();
  const today = getTodayLocalDate(tz);
  const [data, setData] = useState<MemberSupervisor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [candidates, setCandidates] = useState<SupervisorCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [supervisorId, setSupervisorId] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await memberStatusService.getSupervisor(userId));
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Unable to load the supervisor.'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setEditing(false);
    void load();
  }, [load]);

  const startEditing = async () => {
    setSupervisorId('');
    setStartsOn(today);
    setSaveError(null);
    setEditing(true);
    setCandidatesLoading(true);
    try {
      setCandidates(await memberStatusService.getSupervisorCandidates(userId));
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err, 'Unable to load members.'));
    } finally {
      setCandidatesLoading(false);
    }
  };

  const save = async () => {
    if (!supervisorId) {
      setSaveError('Choose a supervisor.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      setData(
        await memberStatusService.setSupervisor(userId, {
          supervisor_id: supervisorId,
          // Omitted means today on the department's calendar.
          starts_on: startsOn || undefined,
        })
      );
      setEditing(false);
      toast.success('Supervisor saved');
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err, 'Unable to save the supervisor.'));
    } finally {
      setSaving(false);
    }
  };

  const endAssignment = async () => {
    const current = data?.current;
    if (!current) return;
    const ok = await confirm({
      title: 'End supervisor assignment',
      message: `${memberName} will no longer report to ${current.supervisor_name ?? 'this supervisor'} after today. The assignment stays in the history.`,
      confirmLabel: 'End assignment',
      cancelLabel: 'Keep it',
      variant: 'warning',
    });
    if (!ok) return;
    setSaving(true);
    try {
      setData(await memberStatusService.endSupervisor(userId, {}));
      toast.success('Supervisor assignment ended');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to end the assignment.'));
    } finally {
      setSaving(false);
    }
  };

  const current = data?.current ?? null;
  const past = (data?.history ?? []).filter((h) => h.id !== current?.id);

  return (
    <div className="card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-theme-text-primary text-lg font-semibold">Reports To</h2>
        {canEdit && data && !editing && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startEditing()}
              disabled={saving}
              className="btn-secondary inline-flex items-center gap-1.5 text-sm"
            >
              <UserCheck className="h-3.5 w-3.5" />
              {current ? 'Change supervisor' : 'Set supervisor'}
            </button>
            {current && (
              <button
                type="button"
                onClick={() => void endAssignment()}
                disabled={saving}
                className="btn-secondary text-sm"
              >
                End assignment
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-4" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
        </div>
      ) : loadError || !data ? (
        <p className="text-sm text-red-700 dark:text-red-400">{loadError ?? 'Unable to load the supervisor.'}</p>
      ) : (
        <div className="space-y-4">
          {current ? (
            <p className="text-theme-text-primary text-sm">
              <span className="font-medium">{current.supervisor_name ?? 'A former member'}</span>
              <span className="text-theme-text-secondary"> since {formatDate(current.starts_on, tz)}</span>
            </p>
          ) : (
            <p className="text-theme-text-muted text-sm">No supervisor on record.</p>
          )}

          {editing && (
            <fieldset
              className="border-theme-surface-border m-0 min-w-0 space-y-3 rounded-lg border p-3"
              disabled={saving}
            >
              <legend className="text-theme-text-secondary px-1 text-xs font-medium uppercase">
                {current ? 'Change supervisor' : 'Set supervisor'}
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="supervisor-select" className="form-label">
                    Supervisor
                  </label>
                  <select
                    id="supervisor-select"
                    className="form-input"
                    value={supervisorId}
                    disabled={candidatesLoading}
                    onChange={(e) => setSupervisorId(e.target.value)}
                  >
                    <option value="">{candidatesLoading ? 'Loading members…' : 'Choose a member'}</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.membership_number ? `${c.name} (#${c.membership_number})` : c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="supervisor-starts-on" className="form-label">
                    Starting
                  </label>
                  <input
                    id="supervisor-starts-on"
                    type="date"
                    className="form-input"
                    max={today}
                    value={startsOn}
                    onChange={(e) => setStartsOn(e.target.value)}
                  />
                </div>
              </div>
              {current && (
                <p className="text-theme-text-muted text-xs">
                  The current assignment ends the day before. Choosing the day it began corrects it instead.
                </p>
              )}
              {saveError && (
                <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                  {saveError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(false)} className="btn-secondary">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save supervisor
                </button>
              </div>
            </fieldset>
          )}

          {past.length > 0 && (
            <div>
              <h3 className="text-theme-text-secondary mb-1 text-xs font-medium uppercase">Earlier</h3>
              <ul className="divide-theme-surface-border divide-y" aria-label="Earlier supervisors">
                {past.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-theme-text-primary">{h.supervisor_name ?? 'A former member'}</span>
                    <span className="text-theme-text-secondary">
                      {formatDate(h.starts_on, tz)} – {h.ends_on ? formatDate(h.ends_on, tz) : 'present'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SupervisorSection;
