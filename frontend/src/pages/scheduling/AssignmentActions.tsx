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
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize sm:px-2 sm:text-xs ${statusColor}`}
      >
        {effectiveStatus}
      </span>
      {isCurrentUser && isAssigned && !confirmingDecline && (
        <>
          <button
            onClick={() => onConfirm(assignmentId)}
            disabled={pendingConfirming}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-1.5 text-green-600 transition-colors hover:bg-green-500/10 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-500/20"
            aria-label="Confirm assignment"
          >
            {pendingConfirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setConfirmingDecline(true)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-1.5 text-red-500 transition-colors hover:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
            aria-label="Decline assignment"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </>
      )}
      {confirmingDecline && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-red-500 dark:text-red-400">Decline?</span>
          <button
            onClick={() => {
              onDecline(assignmentId);
              setConfirmingDecline(false);
            }}
            disabled={pendingDeclining}
            className="btn-primary rounded-md px-2 py-1 text-xs"
            aria-label="Confirm decline"
          >
            {pendingDeclining ? '...' : 'Yes'}
          </button>
          <button
            onClick={() => setConfirmingDecline(false)}
            className="text-theme-text-muted hover:text-theme-text-primary px-2 py-1 text-xs"
            aria-label="Cancel decline"
          >
            No
          </button>
        </div>
      )}
      {canAssign && !isCurrentUser && !confirmingRemove && (
        <button
          onClick={() => setConfirmingRemove(true)}
          className="text-theme-text-muted flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-1.5 transition-colors hover:text-red-500 dark:hover:text-red-400"
          aria-label="Remove assignment"
        >
          <XCircle className="h-4 w-4" />
        </button>
      )}
      {confirmingRemove && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-red-500 dark:text-red-400">Remove?</span>
          <button
            onClick={() => {
              onRemove(assignmentId);
              setConfirmingRemove(false);
            }}
            disabled={pendingRemoving}
            className="btn-primary rounded-md px-2 py-1 text-xs"
            aria-label="Confirm removal"
          >
            {pendingRemoving ? '...' : 'Yes'}
          </button>
          <button
            onClick={() => setConfirmingRemove(false)}
            className="text-theme-text-muted hover:text-theme-text-primary px-2 py-1 text-xs"
            aria-label="Cancel removal"
          >
            No
          </button>
        </div>
      )}
    </>
  );
};
