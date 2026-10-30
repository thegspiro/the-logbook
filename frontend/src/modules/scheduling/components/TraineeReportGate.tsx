/**
 * Trainee reports still needed before a shift can be closed out.
 *
 * Owner decision 2026-10-29: when the department turns on "Require officer
 * shift completion report", each member in a training seat needs a report for
 * the shift before it can be finalized. A scheduling admin may close out
 * anyway with a reason, which the server audit-logs. Shown by both close-out
 * paths, the panel's checklist and the count-only wizard.
 *
 * Advisory, like the equipment-check block beside it: the server refuses the
 * finalize itself. When the requirement cannot be read, nothing is blocked
 * here, so an officer is never shut out of a close-out the server would allow.
 */

import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { schedulingService } from '../services/api';
import type { TraineeReportRequirement } from '../types';

export interface TraineeReportGateState {
  /** Close-out would be refused: reports are missing and not overridden. */
  blocked: boolean;
  /** Close out without the reports, with `reason`. */
  override: boolean;
  reason: string;
}

interface TraineeReportGateProps {
  shiftId: string;
  onChange: (state: TraineeReportGateState) => void;
}

export const TraineeReportGate: React.FC<TraineeReportGateProps> = ({ shiftId, onChange }) => {
  const [requirement, setRequirement] = useState<TraineeReportRequirement | null>(null);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    let active = true;
    schedulingService
      .getTraineeReportRequirement(shiftId)
      .then((value) => {
        if (active) setRequirement(value);
      })
      .catch(() => {
        if (active) setRequirement(null);
      });
    return () => {
      active = false;
    };
  }, [shiftId]);

  const outstanding = requirement?.required ? requirement.missing : [];
  const blocked = outstanding.length > 0 && !(override && reason.trim().length > 0);

  useEffect(() => {
    onChange({ blocked, override: outstanding.length > 0 && override, reason: reason.trim() });
  }, [blocked, override, reason, outstanding.length, onChange]);

  if (outstanding.length === 0) return null;

  return (
    <div className="space-y-2 rounded-md border border-red-500/20 bg-red-500/5 p-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300">
        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Your department requires a shift completion report for each trainee before close-out. Still needed:
      </p>
      <ul className="ml-5 list-disc text-xs text-red-700 dark:text-red-300">
        {outstanding.map((member) => (
          <li key={member.user_id}>{member.name}</li>
        ))}
      </ul>
      {requirement?.can_override ? (
        <>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-red-700 dark:text-red-300">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
              className="border-theme-surface-border rounded"
            />
            Close out anyway, without {outstanding.length === 1 ? 'this report' : 'these reports'}
          </label>
          {override && (
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are the reports missing?"
              aria-label="Reason for closing out without the trainee reports"
              maxLength={500}
              className="form-input px-2 py-1 text-sm"
            />
          )}
          <p className="text-xs text-red-600 dark:text-red-300">
            {override
              ? 'A reason is required — it goes on the shift’s record.'
              : 'File the reports, or check the box to override.'}
          </p>
        </>
      ) : (
        <p className="text-xs text-red-600 dark:text-red-300">
          File the reports first. A scheduling admin can close the shift out without them.
        </p>
      )}
    </div>
  );
};

export default TraineeReportGate;
