/**
 * Sign yourself up for a role on a community outreach signup sheet.
 *
 * An outreach sheet asks what job you will do (tour guide, educator), not which
 * seat you will ride, and the server refuses a signup that names no role. The
 * Open Shifts dialog asked; the shift detail panel offered a per-seat "Sign
 * myself up" that sent none and was refused with "Choose what you would like
 * to do". This is the one control both the panel and the event page use.
 */

import React, { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, UserPlus } from 'lucide-react';
import { schedulingService, type OutreachRoleSlot } from '../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';

interface OutreachRoleSignupProps {
  shiftId: string;
  /** The sheet's roles; only those with a seat left are offered. */
  roles: OutreachRoleSlot[];
  /** Called after the server accepts the signup, to re-read the sheet. */
  onSignedUp: () => void | Promise<void>;
}

const OutreachRoleSignup: React.FC<OutreachRoleSignupProps> = ({ shiftId, roles, onSignedUp }) => {
  const selectId = useId();
  // Essential roles first (owner decision, 2026-11-23): the default is a seat
  // the day cannot run without. Array.prototype.sort is stable.
  const open = roles
    .filter((r) => r.remaining > 0)
    .sort((a, b) => Number(a.essential === false) - Number(b.essential === false));
  const [role, setRole] = useState(open[0]?.role ?? '');
  const [busy, setBusy] = useState(false);

  if (open.length === 0) {
    return <p className="text-theme-text-muted text-sm">Every role on this sheet is filled.</p>;
  }

  // A role that filled while the sheet was open falls back to the first one left.
  const chosen = open.find((r) => r.role === role) ?? open[0];

  const signUp = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      await schedulingService.signupForShift(shiftId, { outreach_role: chosen.role });
      toast.success(`Signed up as ${chosen.label}.`);
      await onSignedUp();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not sign you up.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      {open.length > 1 && (
        <div className="min-w-0 flex-1">
          <label htmlFor={selectId} className="form-label">
            What would you like to do?
          </label>
          <select
            id={selectId}
            value={chosen?.role ?? ''}
            onChange={(e) => setRole(e.target.value)}
            className="form-input"
          >
            {open.map((r) => (
              <option key={r.role} value={r.role}>
                {r.label} ({r.essential === false ? `${r.remaining} open, optional` : `${r.remaining} needed`})
              </option>
            ))}
          </select>
        </div>
      )}
      <button
        type="button"
        onClick={() => void signUp()}
        disabled={busy}
        className="btn-primary inline-flex items-center gap-2"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <UserPlus className="h-4 w-4" aria-hidden="true" />
        )}
        {open.length > 1 ? 'Sign me up' : `Sign me up as ${chosen?.label ?? ''}`}
      </button>
    </div>
  );
};

export default OutreachRoleSignup;
