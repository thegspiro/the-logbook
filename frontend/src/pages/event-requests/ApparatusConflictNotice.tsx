/**
 * The apparatus conflicts the server reported for a request's crew, with the
 * checkbox that lets the coordinator go ahead anyway.
 *
 * A conflict is a warning, never a block (see "Apparatus Events" in
 * docs/KNOWN_LIMITATIONS.md): the server answers 409 with the conflicts
 * listed, and the same request sent again with `acknowledge_conflicts` goes
 * through (`conflictsFrom` in ./apparatusConflicts reads that answer).
 * Shared by adding a crew and by moving a request that has one.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ApparatusConflict } from '../../types/apparatusEvent';

interface ApparatusConflictNoticeProps {
  conflicts: ApparatusConflict[];
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  /** The checkbox's words: what going ahead does. */
  confirmLabel: string;
}

export const ApparatusConflictNotice: React.FC<ApparatusConflictNoticeProps> = ({
  conflicts,
  acknowledged,
  onAcknowledge,
  confirmLabel,
}) => {
  if (conflicts.length === 0) return null;
  return (
    <div className="alert-warning space-y-2 text-sm" role="status">
      <ul className="space-y-1">
        {conflicts.map((c, i) => (
          <li key={`${c.apparatus_id}-${i}`} className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {c.reason}
          </li>
        ))}
      </ul>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="form-checkbox mt-0.5"
          checked={acknowledged}
          onChange={(e) => onAcknowledge(e.target.checked)}
        />
        {confirmLabel}
      </label>
    </div>
  );
};

export default ApparatusConflictNotice;
