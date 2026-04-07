/**
 * Assignment action buttons (confirm/decline/remove) with inline confirmation dialogs.
 *
 * Extracted from ShiftDetailPanel to share between the standard assignment row
 * and the crew board slot views.
 */

import React, { useState } from 'react';
import { Check, XCircle, Loader2 } from 'lucide-react';
import { ASSIGNMENT_STATUS_COLORS, AssignmentStatus } from '../../constants/enums';

interface AssignmentActionsProps {
  assignmentId: string;
  effectiveStatus: string;
  isCurrentUser: boolean;
  canAssign: boolean;
  onConfirm: (id: string) => void;
  onDecline: (id: string) => void;
  onRemove: (id: string) => void;
  pendingConfirming: boolean;
  pendingDeclining: boolean;
  pendingRemoving: boolean;
}

export const AssignmentActions: React.FC<AssignmentActionsProps> = ({
  assignmentId,
  effectiveStatus,
  isCurrentUser,
  canAssign,
  onConfirm,
  onDecline,
  onRemove,
  pendingConfirming,
  pendingDeclining,
  pendingRemoving,
}) => {
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const statusColor = ASSIGNMENT_STATUS_COLORS[effectiveStatus] || ASSIGNMENT_STATUS_COLORS.assigned;
  const isAssigned = effectiveStatus === AssignmentStatus.ASSIGNED;

  return (
    <>
      <span className={`px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded-full capitalize ${statusColor}`}>
        {effectiveStatus}
      </span>
      {isCurrentUser && isAssigned && !confirmingDecline && (
        <>
          <button onClick={() => onConfirm(assignmentId)} disabled={pendingConfirming}
            className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-500/10 dark:hover:bg-green-500/20 rounded-sm transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center disabled:opacity-50" aria-label="Confirm assignment"
          >
            {pendingConfirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <button onClick={() => setConfirmingDecline(true)}
            className="p-1.5 text-red-500 dark:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-500/20 rounded-sm transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Decline assignment"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </>
      )}
      {confirmingDecline && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-red-500 dark:text-red-400">Decline?</span>
          <button onClick={() => { onDecline(assignmentId); setConfirmingDecline(false); }} disabled={pendingDeclining}
            className="btn-primary px-2 py-1 rounded-md text-xs" aria-label="Confirm decline"
          >{pendingDeclining ? '...' : 'Yes'}</button>
          <button onClick={() => setConfirmingDecline(false)}
            className="px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary" aria-label="Cancel decline"
          >No</button>
        </div>
      )}
      {canAssign && !isCurrentUser && !confirmingRemove && (
        <button onClick={() => setConfirmingRemove(true)}
          className="p-1.5 text-theme-text-muted hover:text-red-500 dark:hover:text-red-400 rounded-sm transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Remove assignment"
        >
          <XCircle className="w-4 h-4" />
        </button>
      )}
      {confirmingRemove && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-red-500 dark:text-red-400">Remove?</span>
          <button onClick={() => { onRemove(assignmentId); setConfirmingRemove(false); }} disabled={pendingRemoving}
            className="btn-primary px-2 py-1 rounded-md text-xs" aria-label="Confirm removal"
          >{pendingRemoving ? '...' : 'Yes'}</button>
          <button onClick={() => setConfirmingRemove(false)}
            className="px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary" aria-label="Cancel removal"
          >No</button>
        </div>
      )}
    </>
  );
};
