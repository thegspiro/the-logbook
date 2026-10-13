/**
 * Marks expense lines submitted after the department's substantiation
 * deadline (the backend's `substantiatedLate` / `lateLineCount`). Reimbursing
 * them falls outside the accountable plan, so approvers and the treasurer need
 * to see them wherever the report appears.
 */

import React from 'react';
import { Clock } from 'lucide-react';

interface LateLinesBadgeProps {
  /** How many lines are late; renders nothing at zero. Omit for a single line. */
  count?: number | undefined;
}

export const LateLinesBadge: React.FC<LateLinesBadgeProps> = ({ count }) => {
  if (count !== undefined && count <= 0) return null;
  const label = count === undefined ? 'Submitted late' : `${count} late ${count === 1 ? 'line' : 'lines'}`;
  return (
    <span className="badge inline-flex items-center gap-1 bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
      <Clock className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
};

export default LateLinesBadge;
