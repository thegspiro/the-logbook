/**
 * Trainee reports still needed before a shift can be closed out.
 *
 * Owner decision 2026-10-29: when the department turns on "Require officer
 * shift completion report", each member in a training seat needs a report for
 * the shift before it can be finalized. A scheduling admin may close out
 * anyway with a reason, which the server audit-logs. Shown by both close-out
 * paths, the panel's checklist and the count-only wizard.
 *
 * Shift evaluations join the same list (2026-11-01): a member enrolled in a
 * program whose program names an evaluation form needs a submitted evaluation
 * before close-out, whether or not the report setting is on, and the same
 * override covers both.
 *
 * Advisory, like the equipment-check block beside it: the server refuses the
 * finalize itself. When the requirement cannot be read, nothing is blocked
 * here, so an officer is never shut out of a close-out the server would allow.
 */

import React, { useEffect, useState } from 'react';
import { ClipboardCheck, FileText } from 'lucide-react';
import { Link } from 'react-router';
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
  const evaluations = requirement?.missing_evaluations ?? [];
  const anything = outstanding.length + evaluations.length;
  const blocked = anything > 0 && !(override && reason.trim().length > 0);

  useEffect(() => {
    onChange({ blocked, override: anything > 0 && override, reason: reason.trim() });
  }, [blocked, override, reason, anything, onChange]);

  if (anything === 0) return null;

  // Name what is missing: the original report wording when only reports are,
  // so the override reads exactly as it did before evaluations existed.
  let missingNoun: string;
  if (evaluations.length === 0) {
    missingNoun = outstanding.length === 1 ? 'this report' : 'these reports';
  } else if (outstanding.length === 0) {
    missingNoun = evaluations.length === 1 ? 'this evaluation' : 'these evaluations';
  } else {
    missingNoun = 'these reports and evaluations';
  }
  const missingWhat = evaluations.length === 0 ? 'the reports' : outstanding.length === 0 ? 'the evaluations' : 'they';

  return (
    <div className="space-y-2 rounded-md border border-red-500/20 bg-red-500/5 p-2">
      {outstanding.length > 0 && (
        <>
          <p className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300">
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Your department requires a shift completion report for each trainee before close-out. Still needed:
          </p>
          <ul className="ml-5 list-disc text-xs text-red-700 dark:text-red-300">
            {outstanding.map((member) => (
              <li key={member.user_id}>{member.name}</li>
            ))}
          </ul>
        </>
      )}
      {evaluations.length > 0 && (
        <>
          <p className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300">
            <ClipboardCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />A shift evaluation is still needed
            for:
          </p>
          <ul className="ml-5 list-disc text-xs text-red-700 dark:text-red-300">
            {evaluations.map((member) => (
              <li key={`${member.user_id}-${member.name}`}>{member.name}</li>
            ))}
          </ul>
          <Link
            to={`/scheduling?tab=shift-reports&shift=${encodeURIComponent(shiftId)}&view=create`}
            className="inline-block text-xs font-semibold text-red-800 underline dark:text-red-300"
          >
            Open the shift report to fill them in
          </Link>
        </>
      )}
      {requirement?.can_override ? (
        <>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-red-700 dark:text-red-300">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
              className="border-theme-surface-border rounded"
            />
            Close out anyway, without {missingNoun}
          </label>
          {override && (
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={missingWhat === 'they' ? 'Why are they missing?' : `Why are ${missingWhat} missing?`}
              aria-label={
                evaluations.length === 0
                  ? 'Reason for closing out without the trainee reports'
                  : outstanding.length === 0
                    ? 'Reason for closing out without the shift evaluations'
                    : 'Reason for closing out without the trainee reports and shift evaluations'
              }
              maxLength={500}
              className="form-input px-2 py-1 text-sm"
            />
          )}
          <p className="text-xs text-red-600 dark:text-red-300">
            {override
              ? 'A reason is required — it goes on the shift’s record.'
              : evaluations.length === 0
                ? 'File the reports, or check the box to override.'
                : 'Fill them in, or check the box to override.'}
          </p>
        </>
      ) : (
        <p className="text-xs text-red-600 dark:text-red-300">
          {evaluations.length === 0 ? 'File the reports first.' : 'Fill them in first.'} A scheduling admin can close
          the shift out without them.
        </p>
      )}
    </div>
  );
};

export default TraineeReportGate;
