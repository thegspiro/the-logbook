import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { trainingService } from '../../services/api';
import type { RequirementOverride } from '../../types/training';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

interface ChiefOverrideControlProps {
  requirementId: string;
  memberId: string;
  memberName: string;
  /** The requirement's current period, which the form starts from. */
  windowStart?: string | null | undefined;
  windowEnd?: string | null | undefined;
  /** Called after a grant or a revoke, so the screen can grade again. */
  onChanged: () => void;
}

/**
 * The Chief's override of one member's session-attendance requirement.
 *
 * Rendered only where the backend says the viewer may override
 * (`can_override` on the matrix requirement): holding a Chief position is the
 * gate, and the screen does not decide it. The Chief picks the dates the
 * override covers, starting from the requirement's current period, and must
 * give a reason. Excusing one missed drill is a training waiver, not this.
 */
const ChiefOverrideControl: React.FC<ChiefOverrideControlProps> = ({
  requirementId,
  memberId,
  memberName,
  windowStart,
  windowEnd,
  onChanged,
}) => {
  const tz = useTimezone();
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<RequirementOverride[]>([]);
  const [startDate, setStartDate] = useState(windowStart ?? '');
  const [endDate, setEndDate] = useState(windowEnd ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const all = await trainingService.listRequirementOverrides(requirementId);
    setOverrides(all.filter((o) => o.user_id === memberId && !o.revoked_at));
  }, [requirementId, memberId]);

  useEffect(() => {
    if (!open) return;
    load().catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load overrides')));
  }, [open, load]);

  const grant = async () => {
    setBusy(true);
    setError(null);
    try {
      await trainingService.grantRequirementOverride(requirementId, {
        user_id: memberId,
        start_date: startDate,
        end_date: endDate,
        reason: reason.trim(),
      });
      toast.success(`Override recorded for ${memberName}`);
      setReason('');
      await load();
      onChanged();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to record the override'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (overrideId: string) => {
    setBusy(true);
    setError(null);
    try {
      await trainingService.revokeRequirementOverride(requirementId, overrideId);
      toast.success('Override revoked');
      await load();
      onChanged();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to revoke the override'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary btn-sm mt-2 inline-flex items-center gap-1.5"
      >
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Chief override
      </button>
    );
  }

  const canSave = Boolean(startDate && endDate && reason.trim()) && !busy;

  return (
    <div className="border-theme-surface-border bg-theme-surface-hover mt-2 rounded-lg border p-3">
      <p className="text-theme-text-primary text-sm font-medium">Chief override for {memberName}</p>
      <p className="text-theme-text-muted mt-0.5 text-xs">
        Counts {memberName} as meeting this requirement whenever it is graded on a date in the range below, however many
        sessions they attended. To excuse a single missed session, record a training waiver instead.
      </p>
      {error && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}
      {overrides.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {overrides.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-theme-text-secondary">
                {formatDate(o.start_date, tz)} – {formatDate(o.end_date, tz)}: {o.reason}
              </span>
              <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void revoke(o.id)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`override-start-${memberId}`} className="form-label">
            From
          </label>
          <input
            id={`override-start-${memberId}`}
            type="date"
            className="form-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`override-end-${memberId}`} className="form-label">
            To
          </label>
          <input
            id={`override-end-${memberId}`}
            type="date"
            className="form-input"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3">
        <label htmlFor={`override-reason-${memberId}`} className="form-label">
          Reason
        </label>
        <textarea
          id={`override-reason-${memberId}`}
          className="form-input"
          rows={2}
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => setOpen(false)}>
          Close
        </button>
        <button type="button" className="btn-primary btn-sm" disabled={!canSave} onClick={() => void grant()}>
          {busy ? 'Saving...' : 'Record override'}
        </button>
      </div>
    </div>
  );
};

export default ChiefOverrideControl;
