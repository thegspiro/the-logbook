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
    <div
      className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 sm:p-3 ${
        assignment
          ? isCurrentUser
            ? 'border-violet-500/30 bg-violet-500/5'
            : 'border-theme-surface-border bg-theme-surface-hover/30'
          : 'border-theme-surface-border bg-theme-surface-hover/10 border-dashed'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {assignment ? (
          <>
            <div className="bg-theme-surface-hover text-theme-text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium">
              {(assignment.user_name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-theme-text-primary truncate text-sm font-medium">
                {assignment.user_name || 'Unknown'}
                {isCurrentUser && <span className="ml-1 text-xs text-violet-500">(You)</span>}
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
              {assignment.is_training && (
                <span
                  className="mt-0.5 inline-block rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300"
                  title={
                    assignment.training_program_name
                      ? `Training slot — ${assignment.training_program_name}`
                      : 'Training slot'
                  }
                >
                  Training
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="border-theme-surface-border flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed">
              <UserPlus className="text-theme-text-muted h-3.5 w-3.5" />
            </div>
            <div>
              <p className="text-theme-text-muted text-sm capitalize">
                {POSITION_LABELS[position] || position}
                {!required && <span className="text-theme-text-muted ml-1 text-[10px]">(optional)</span>}
              </p>
              <p className="text-theme-text-muted text-xs">{required ? 'Open position' : 'Optional position'}</p>
            </div>
          </>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 sm:gap-2">
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
        ) : (
          !isPast && (
            /* "Assign" and "Sign Up" side by side never said which was which —
               and on a phone the first collapsed to a bare icon. The labels
               carry the difference: one puts somebody else in the seat, the
               other puts you in it. */
            <div className="flex items-center gap-1.5">
              {canAssign && (
                <button
                  onClick={() => onAssignToPosition(position)}
                  className="inline-flex items-center gap-1 rounded-lg border border-violet-500/30 px-2.5 py-1.5 text-xs font-medium text-violet-600 hover:bg-violet-500/10 sm:px-3 dark:text-violet-400"
                >
                  <UserPlus className="h-3 w-3" aria-hidden="true" />
                  <span className="hidden sm:inline">Assign someone</span>
                  <span className="sm:hidden">Assign</span>
                </button>
              )}
              {!isUserAssigned && (
                <button
                  onClick={() => onSignup(position)}
                  disabled={pendingStates.signingUp}
                  className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 sm:px-3"
                >
                  {pendingStates.signingUp ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <UserPlus className="h-3 w-3" />
                  )}
                  <span className="hidden sm:inline">Sign myself up</span>
                  <span className="sm:hidden">Sign up</span>
                </button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
};

/**
 * Attendance badge shown on filled crew board slots.
 *
 * A bare "12h" beside a name could be the hours they are scheduled for, the
 * hours they will be credited, or the hours they actually worked — three
 * numbers that differ in practice, and this one is the third: check-in to
 * check-out. The chip says which, rather than leaving it to a hover a phone
 * cannot perform.
 */
const AttendanceBadge: React.FC<{ record: ShiftAttendanceRecord | undefined; tz: string }> = ({ record, tz }) => {
  if (!record) return null;
  if (record.checked_out_at) {
    const hrs = Math.round(((record.duration_minutes ?? 0) / 60) * 10) / 10;
    return (
      <span
        className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-green-700 dark:text-green-400"
        title={`In: ${formatTime(record.checked_in_at, tz)} Out: ${formatTime(record.checked_out_at, tz)}`}
      >
        {hrs}h worked
      </span>
    );
  }
  if (record.checked_in_at) {
    return (
      <span
        className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-blue-700 dark:text-blue-400"
        title={`Checked in at ${formatTime(record.checked_in_at, tz)}`}
      >
        <LogIn className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
        In {formatTime(record.checked_in_at, tz)}
      </span>
    );
  }
  return null;
};
