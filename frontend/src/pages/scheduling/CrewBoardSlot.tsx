/**
 * A single crew board position slot.
 *
 * Handles both filled (with member avatar, name, position editor, action buttons,
 * and attendance badge) and empty (with sign-up/assign buttons) states.
 *
 * Extracted from ShiftDetailPanel to reduce duplication and improve readability.
 */

import React from 'react';
import { UserPlus, Loader2, LogIn } from 'lucide-react';
import { POSITION_LABELS } from '../../constants/enums';
import { formatTime } from '../../utils/dateFormatting';
import type { Assignment } from '../../types/scheduling';
import type { ShiftAttendanceRecord } from '../../modules/scheduling/services/api';
import { AssignmentActions } from './AssignmentActions';
import { PositionEditor } from './PositionEditor';

interface CrewBoardSlotProps {
  position: string;
  required: boolean;
  assignment: Assignment | null;
  currentUserId: string | undefined;
  canAssign: boolean;
  isPast: boolean;
  isUserAssigned: boolean;
  positionOptions: [string, string][];
  attendanceRecord: ShiftAttendanceRecord | undefined;
  tz: string;
  pendingStates: {
    confirming: boolean;
    declining: boolean;
    removing: boolean;
    updatingPosition: boolean;
    signingUp: boolean;
  };
  onConfirm: (id: string) => void;
  onDecline: (id: string) => void;
  onRemove: (id: string) => void;
  onPositionChange: (id: string, newPosition: string, currentPosition: string) => void;
  onAssignToPosition: (position: string) => void;
  onSignup: (position: string) => void;
}

export const CrewBoardSlot: React.FC<CrewBoardSlotProps> = ({
  position,
  required,
  assignment,
  currentUserId,
  canAssign,
  isPast,
  isUserAssigned,
  positionOptions,
  attendanceRecord,
  tz,
  pendingStates,
  onConfirm,
  onDecline,
  onRemove,
  onPositionChange,
  onAssignToPosition,
  onSignup,
}) => {
  const isCurrentUser = assignment?.user_id === currentUserId;

  return (
    <div className={`flex items-center justify-between gap-2 p-2.5 sm:p-3 rounded-lg border ${
      assignment
        ? (isCurrentUser ? 'border-violet-500/30 bg-violet-500/5' : 'border-theme-surface-border bg-theme-surface-hover/30')
        : 'border-dashed border-theme-surface-border bg-theme-surface-hover/10'
    }`}>
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {assignment ? (
          <>
            <div className="w-8 h-8 rounded-full bg-theme-surface-hover flex items-center justify-center text-sm font-medium text-theme-text-primary shrink-0">
              {(assignment.user_name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-theme-text-primary truncate">
                {assignment.user_name || 'Unknown'}
                {isCurrentUser && <span className="text-xs text-violet-500 ml-1">(You)</span>}
              </p>
              <PositionEditor
                assignmentId={assignment.id}
                currentPosition={assignment.position}
                displayLabel={POSITION_LABELS[position] || position}
                positionOptions={positionOptions}
                onSave={onPositionChange}
                editable={canAssign && !isPast}
                updatingPosition={pendingStates.updatingPosition}
              />
            </div>
          </>
        ) : (
          <>
            <div className="w-8 h-8 rounded-full border-2 border-dashed border-theme-surface-border flex items-center justify-center shrink-0">
              <UserPlus className="w-3.5 h-3.5 text-theme-text-muted" />
            </div>
            <div>
              <p className="text-sm text-theme-text-muted capitalize">
                {POSITION_LABELS[position] || position}
                {!required && <span className="text-[10px] text-theme-text-muted ml-1">(optional)</span>}
              </p>
              <p className="text-xs text-theme-text-muted">{required ? 'Open position' : 'Optional position'}</p>
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1 sm:gap-2 shrink-0">
        {assignment ? (
          <>
            <AttendanceBadge record={attendanceRecord} tz={tz} />
            <AssignmentActions
              assignmentId={assignment.id}
              effectiveStatus={assignment.status || 'assigned'}
              isCurrentUser={isCurrentUser || false}
              canAssign={canAssign}
              onConfirm={onConfirm}
              onDecline={onDecline}
              onRemove={onRemove}
              pendingConfirming={pendingStates.confirming}
              pendingDeclining={pendingStates.declining}
              pendingRemoving={pendingStates.removing}
            />
          </>
        ) : !isPast && (
          <div className="flex items-center gap-1.5">
            {canAssign && (
              <button
                onClick={() => onAssignToPosition(position)}
                className="px-2.5 sm:px-3 py-1.5 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 border border-violet-500/30 rounded-lg text-xs font-medium inline-flex items-center gap-1"
              >
                <UserPlus className="w-3 h-3" />
                <span className="hidden sm:inline">Assign</span>
              </button>
            )}
            {!isUserAssigned && (
              <button
                onClick={() => onSignup(position)}
                disabled={pendingStates.signingUp}
                className="px-2.5 sm:px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1"
              >
                {pendingStates.signingUp ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                <span className="hidden sm:inline">Sign Up</span><span className="sm:hidden">Join</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** Attendance badge shown on filled crew board slots (hours worked or check-in indicator). */
const AttendanceBadge: React.FC<{ record: ShiftAttendanceRecord | undefined; tz: string }> = ({ record, tz }) => {
  if (!record) return null;
  if (record.checked_out_at) {
    const hrs = Math.round(((record.duration_minutes ?? 0) / 60) * 10) / 10;
    return (
      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-green-500/10 text-green-700 dark:text-green-400" title={`In: ${formatTime(record.checked_in_at, tz)} Out: ${formatTime(record.checked_out_at, tz)}`}>
        {hrs}h
      </span>
    );
  }
  if (record.checked_in_at) {
    return (
      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400" title={`Checked in at ${formatTime(record.checked_in_at, tz)}`}>
        <LogIn className="w-3 h-3 inline" />
      </span>
    );
  }
  return null;
};
