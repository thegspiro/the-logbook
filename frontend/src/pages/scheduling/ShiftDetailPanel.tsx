/**
 * Shift Detail Panel
 *
 * Slide-out panel showing full details of a shift: crew roster,
 * open positions, attendance, calls, and notes.
 *
 * When a shift is assigned to an apparatus with defined positions,
 * a "crew board" shows each position as a slot (filled or open)
 * so members can sign up for specific seats on the vehicle.
 */

import React, { useState, useEffect } from 'react';
import {
  X, Users, Clock, MapPin, Truck, UserPlus, Check, XCircle,
  Loader2, Phone, ChevronDown, ChevronUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../services/api';
import type { ShiftRecord } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useTimezone } from '../../hooks/useTimezone';
import { formatTime } from '../../utils/dateFormatting';

interface ShiftDetailPanelProps {
  shift: ShiftRecord;
  onClose: () => void;
  onRefresh?: () => void;
}

interface Assignment {
  id: string;
  user_id: string;
  user_name?: string;
  position: string;
  status: string;
  assignment_status?: string;
}

const POSITION_LABELS: Record<string, string> = {
  officer: 'Officer',
  driver: 'Driver/Operator',
  firefighter: 'Firefighter',
  EMS: 'EMS',
  ems: 'EMS',
  captain: 'Captain',
  lieutenant: 'Lieutenant',
  probationary: 'Probationary',
  volunteer: 'Volunteer',
  other: 'Other',
};

const STATUS_COLORS: Record<string, string> = {
  assigned: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  confirmed: 'bg-green-500/10 text-green-700 dark:text-green-400',
  declined: 'bg-red-500/10 text-red-700 dark:text-red-400',
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  no_show: 'bg-gray-500/10 text-gray-700 dark:text-gray-400',
};

export const ShiftDetailPanel: React.FC<ShiftDetailPanelProps> = ({
  shift,
  onClose,
  onRefresh,
}) => {
  const { user, checkPermission } = useAuthStore();
  const tz = useTimezone();
  const canManage = checkPermission('scheduling.manage');

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [calls, setCalls] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCalls, setShowCalls] = useState(false);

  // Signup state
  const [signupPosition, setSignupPosition] = useState('');
  const [signingUp, setSigningUp] = useState(false);

  // Assign state (admin)
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignForm, setAssignForm] = useState({ user_id: '', position: '' });
  const [assigning, setAssigning] = useState(false);

  const hasApparatusPositions = shift.apparatus_positions && shift.apparatus_positions.length > 0;

  // Determine available position options based on apparatus
  const positionOptions: [string, string][] = hasApparatusPositions
    ? shift.apparatus_positions!.map(p => [p, POSITION_LABELS[p] || p.charAt(0).toUpperCase() + p.slice(1)])
    : Object.entries(POSITION_LABELS);

  // Set default signup position
  useEffect(() => {
    if (positionOptions.length > 0 && !signupPosition) {
      setSignupPosition(positionOptions[0][0]);
    }
  }, [positionOptions.length]);

  useEffect(() => {
    if (positionOptions.length > 0 && !assignForm.position) {
      setAssignForm(f => ({ ...f, position: positionOptions[0][0] }));
    }
  }, [positionOptions.length]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [assignData, callData] = await Promise.all([
          schedulingService.getShiftAssignments(shift.id),
          schedulingService.getShiftCalls(shift.id),
        ]);
        setAssignments(assignData as unknown as Assignment[]);
        setCalls(callData);
      } catch {
        toast.error('Failed to load shift details');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [shift.id]);

  const refreshAssignments = async () => {
    const data = await schedulingService.getShiftAssignments(shift.id);
    setAssignments(data as unknown as Assignment[]);
  };

  const handleSignup = async (position?: string) => {
    const pos = position || signupPosition;
    setSigningUp(true);
    try {
      await schedulingService.signupForShift(shift.id, { position: pos });
      toast.success('Signed up for shift');
      await refreshAssignments();
      onRefresh?.();
    } catch {
      toast.error('Failed to sign up for shift');
    } finally {
      setSigningUp(false);
    }
  };

  const handleConfirm = async (assignmentId: string) => {
    try {
      await schedulingService.confirmAssignment(assignmentId);
      toast.success('Assignment confirmed');
      await refreshAssignments();
    } catch {
      toast.error('Failed to confirm assignment');
    }
  };

  const handleRemove = async (assignmentId: string) => {
    if (!window.confirm('Remove this assignment?')) return;
    try {
      await schedulingService.deleteAssignment(assignmentId);
      toast.success('Assignment removed');
      await refreshAssignments();
      onRefresh?.();
    } catch {
      toast.error('Failed to remove assignment');
    }
  };

  const handleAssign = async () => {
    if (!assignForm.user_id) { toast.error('Select a member'); return; }
    setAssigning(true);
    try {
      await schedulingService.createAssignment(shift.id, {
        user_id: assignForm.user_id,
        position: assignForm.position,
      });
      toast.success('Member assigned');
      setShowAssignForm(false);
      setAssignForm({ user_id: '', position: positionOptions[0]?.[0] || 'firefighter' });
      await refreshAssignments();
      onRefresh?.();
    } catch {
      toast.error('Failed to assign member');
    } finally {
      setAssigning(false);
    }
  };

  const isUserAssigned = assignments.some(a => a.user_id === user?.id);
  const shiftDate = new Date(shift.shift_date + 'T12:00:00');
  const isPast = shiftDate < new Date();

  // Build crew board data: for each apparatus position, find the assignment(s) filling it
  const getCrewBoard = () => {
    if (!hasApparatusPositions) return null;
    return shift.apparatus_positions!.map(position => {
      const filled = assignments.find(a => a.position.toLowerCase() === position.toLowerCase());
      return { position, assignment: filled || null };
    });
  };

  // Assignments not matching any apparatus position (extra crew)
  const getExtraAssignments = () => {
    if (!hasApparatusPositions) return assignments;
    const apparatusPositionsLower = shift.apparatus_positions!.map(p => p.toLowerCase());
    const boardFilledIds = new Set<string>();
    // Mark the first match for each apparatus position
    for (const pos of shift.apparatus_positions!) {
      const match = assignments.find(a => a.position.toLowerCase() === pos.toLowerCase() && !boardFilledIds.has(a.id));
      if (match) boardFilledIds.add(match.id);
    }
    return assignments.filter(a => !boardFilledIds.has(a.id));
  };

  const crewBoard = getCrewBoard();
  const extraAssignments = getExtraAssignments();

  // Open positions (apparatus positions with no one assigned)
  const openPositions = crewBoard?.filter(s => !s.assignment).map(s => s.position) || [];

  const renderAssignmentRow = (assignment: Assignment) => {
    const statusColor = STATUS_COLORS[assignment.status || assignment.assignment_status || 'assigned'] || STATUS_COLORS.assigned;
    const isCurrentUser = assignment.user_id === user?.id;
    return (
      <div key={assignment.id} className={`flex items-center justify-between gap-2 p-2.5 sm:p-3 rounded-lg border ${isCurrentUser ? 'border-violet-500/30 bg-violet-500/5' : 'border-theme-surface-border bg-theme-surface-hover/30'}`}>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-8 h-8 rounded-full bg-theme-surface-hover flex items-center justify-center text-sm font-medium text-theme-text-primary flex-shrink-0">
            {(assignment.user_name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-theme-text-primary truncate">
              {assignment.user_name || 'Unknown'} {isCurrentUser && <span className="text-xs text-violet-500">(You)</span>}
            </p>
            <p className="text-xs text-theme-text-muted capitalize">
              {POSITION_LABELS[assignment.position] || assignment.position}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <span className={`px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded-full capitalize ${statusColor}`}>
            {assignment.status || assignment.assignment_status || 'assigned'}
          </span>
          {isCurrentUser && (assignment.status === 'assigned' || assignment.assignment_status === 'assigned') && (
            <button onClick={() => handleConfirm(assignment.id)}
              className="p-1.5 text-green-600 hover:bg-green-500/10 rounded transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" title="Confirm"
            >
              <Check className="w-4 h-4" />
            </button>
          )}
          {canManage && (
            <button onClick={() => handleRemove(assignment.id)}
              className="p-1.5 text-theme-text-muted hover:text-red-500 rounded transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" title="Remove"
            >
              <XCircle className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-theme-surface border-l border-theme-surface-border z-50 overflow-y-auto shadow-2xl overscroll-contain">
        {/* Header */}
        <div className="sticky top-0 bg-theme-surface border-b border-theme-surface-border p-4 sm:p-6 z-10">
          <div className="flex items-center justify-between">
            <div className="min-w-0 pr-2">
              <h2 className="text-lg sm:text-xl font-bold text-theme-text-primary">Shift Details</h2>
              <p className="text-xs sm:text-sm text-theme-text-secondary mt-1 truncate">
                {shiftDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
            <button onClick={onClose} className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
          {/* Time & Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div className="flex items-center gap-3 p-3 bg-theme-surface-hover/50 rounded-lg">
              <Clock className="w-5 h-5 text-violet-500" />
              <div>
                <p className="text-xs text-theme-text-muted">Time</p>
                <p className="text-sm font-medium text-theme-text-primary">
                  {formatTime(shift.start_time, tz)}
                  {shift.end_time ? ` - ${formatTime(shift.end_time, tz)}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-theme-surface-hover/50 rounded-lg">
              <Users className="w-5 h-5 text-blue-500" />
              <div>
                <p className="text-xs text-theme-text-muted">Crew</p>
                <p className="text-sm font-medium text-theme-text-primary">
                  {assignments.length} assigned
                  {hasApparatusPositions && (
                    <span className="text-theme-text-muted"> / {shift.apparatus_positions!.length} positions</span>
                  )}
                </p>
              </div>
            </div>
            {(shift.apparatus_name || shift.apparatus_unit_number) && (
              <div className="flex items-center gap-3 p-3 bg-theme-surface-hover/50 rounded-lg">
                <Truck className="w-5 h-5 text-red-500" />
                <div>
                  <p className="text-xs text-theme-text-muted">Apparatus</p>
                  <p className="text-sm font-medium text-theme-text-primary">
                    {shift.apparatus_unit_number}{shift.apparatus_name ? ` — ${shift.apparatus_name}` : ''}
                  </p>
                </div>
              </div>
            )}
            {shift.shift_officer_name && (
              <div className="flex items-center gap-3 p-3 bg-theme-surface-hover/50 rounded-lg">
                <MapPin className="w-5 h-5 text-green-500" />
                <div>
                  <p className="text-xs text-theme-text-muted">Shift Officer</p>
                  <p className="text-sm font-medium text-theme-text-primary">{shift.shift_officer_name}</p>
                </div>
              </div>
            )}
          </div>

          {shift.notes && (
            <div className="p-3 bg-theme-surface-hover/50 rounded-lg">
              <p className="text-xs text-theme-text-muted mb-1">Notes</p>
              <p className="text-sm text-theme-text-primary">{shift.notes}</p>
            </div>
          )}

          {/* Crew Board (when apparatus has positions) */}
          {hasApparatusPositions && !loading && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-theme-text-primary flex items-center gap-2">
                  <Truck className="w-4 h-4" /> Crew Board — {shift.apparatus_unit_number}
                </h3>
                {openPositions.length > 0 && (
                  <span className="text-xs text-theme-text-muted">
                    {openPositions.length} open
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {crewBoard!.map(({ position, assignment }, i) => (
                  <div key={i} className={`flex items-center justify-between gap-2 p-2.5 sm:p-3 rounded-lg border ${
                    assignment
                      ? (assignment.user_id === user?.id ? 'border-violet-500/30 bg-violet-500/5' : 'border-theme-surface-border bg-theme-surface-hover/30')
                      : 'border-dashed border-theme-surface-border bg-theme-surface-hover/10'
                  }`}>
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      {assignment ? (
                        <>
                          <div className="w-8 h-8 rounded-full bg-theme-surface-hover flex items-center justify-center text-sm font-medium text-theme-text-primary flex-shrink-0">
                            {(assignment.user_name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-theme-text-primary truncate">
                              {assignment.user_name || 'Unknown'}
                              {assignment.user_id === user?.id && <span className="text-xs text-violet-500 ml-1">(You)</span>}
                            </p>
                            <p className="text-xs text-theme-text-muted capitalize">
                              {POSITION_LABELS[position] || position}
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-8 h-8 rounded-full border-2 border-dashed border-theme-surface-border flex items-center justify-center flex-shrink-0">
                            <UserPlus className="w-3.5 h-3.5 text-theme-text-muted" />
                          </div>
                          <div>
                            <p className="text-sm text-theme-text-muted capitalize">
                              {POSITION_LABELS[position] || position}
                            </p>
                            <p className="text-xs text-theme-text-muted">Open position</p>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                      {assignment ? (
                        <>
                          <span className={`px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded-full capitalize ${STATUS_COLORS[assignment.status || assignment.assignment_status || 'assigned'] || STATUS_COLORS.assigned}`}>
                            {assignment.status || assignment.assignment_status || 'assigned'}
                          </span>
                          {assignment.user_id === user?.id && (assignment.status === 'assigned' || assignment.assignment_status === 'assigned') && (
                            <button onClick={() => handleConfirm(assignment.id)}
                              className="p-1.5 text-green-600 hover:bg-green-500/10 rounded transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" title="Confirm"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          )}
                          {canManage && (
                            <button onClick={() => handleRemove(assignment.id)}
                              className="p-1.5 text-theme-text-muted hover:text-red-500 rounded transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" title="Remove"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      ) : (
                        !isPast && !isUserAssigned && (
                          <button
                            onClick={() => handleSignup(position)}
                            disabled={signingUp}
                            className="px-2.5 sm:px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1"
                          >
                            {signingUp ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                            <span className="hidden sm:inline">Sign Up</span><span className="sm:hidden">Join</span>
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Extra assignments (not matching apparatus positions) */}
              {extraAssignments.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-theme-text-secondary mb-2">Additional Crew</h4>
                  <div className="space-y-2">
                    {extraAssignments.map(renderAssignmentRow)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Standard Crew Roster (no apparatus positions) */}
          {!hasApparatusPositions && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-theme-text-primary flex items-center gap-2">
                  <Users className="w-4 h-4" /> Crew Roster
                </h3>
                {canManage && !isPast && (
                  <button onClick={() => setShowAssignForm(!showAssignForm)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Assign
                  </button>
                )}
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
                </div>
              ) : assignments.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-theme-surface-border rounded-lg">
                  <Users className="w-8 h-8 text-theme-text-muted mx-auto mb-2" />
                  <p className="text-sm text-theme-text-muted">No crew assigned yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {assignments.map(renderAssignmentRow)}
                </div>
              )}
            </div>
          )}

          {/* Admin Assign Form (works for both modes) */}
          {(showAssignForm || (hasApparatusPositions && canManage && !isPast)) && canManage && (
            <>
              {!showAssignForm && hasApparatusPositions && (
                <button onClick={() => setShowAssignForm(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Assign Member
                </button>
              )}
              {showAssignForm && (
                <div className="p-4 border border-theme-surface-border rounded-lg bg-theme-surface-hover/30 space-y-3">
                  <h4 className="text-sm font-medium text-theme-text-primary">Assign Member</h4>
                  <input type="text" placeholder="Enter member ID or name"
                    value={assignForm.user_id}
                    onChange={e => setAssignForm(p => ({...p, user_id: e.target.value}))}
                    className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                  <select value={assignForm.position} onChange={e => setAssignForm(p => ({...p, position: e.target.value}))}
                    className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    {positionOptions.map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowAssignForm(false)} className="px-3 py-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary">Cancel</button>
                    <button onClick={handleAssign} disabled={assigning}
                      className="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50"
                    >
                      {assigning ? 'Assigning...' : 'Assign'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Sign Up (for members not yet assigned — non-apparatus mode) */}
          {!hasApparatusPositions && !isPast && !isUserAssigned && !canManage && (
            <div className="p-4 border border-dashed border-violet-500/30 rounded-lg bg-violet-500/5">
              <h3 className="text-sm font-semibold text-theme-text-primary mb-2 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-violet-500" /> Sign Up for This Shift
              </h3>
              <div className="flex items-center gap-2">
                <select value={signupPosition} onChange={e => setSignupPosition(e.target.value)}
                  className="flex-1 bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {positionOptions.map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                <button onClick={() => handleSignup()} disabled={signingUp}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {signingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  Sign Up
                </button>
              </div>
            </div>
          )}

          {/* Sign Up confirmation for already-assigned members */}
          {!isPast && isUserAssigned && (
            <div className="p-3 bg-green-500/5 border border-green-500/20 rounded-lg flex items-center gap-2">
              <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
              <p className="text-sm text-green-700 dark:text-green-400">You are assigned to this shift</p>
            </div>
          )}

          {/* Calls / Incidents */}
          <div>
            <button onClick={() => setShowCalls(!showCalls)}
              className="flex items-center justify-between w-full text-left py-2"
            >
              <h3 className="text-base font-semibold text-theme-text-primary flex items-center gap-2">
                <Phone className="w-4 h-4" /> Calls / Incidents ({calls.length})
              </h3>
              {showCalls ? <ChevronUp className="w-4 h-4 text-theme-text-muted" /> : <ChevronDown className="w-4 h-4 text-theme-text-muted" />}
            </button>
            {showCalls && (
              calls.length === 0 ? (
                <p className="text-sm text-theme-text-muted py-3">No calls recorded for this shift</p>
              ) : (
                <div className="space-y-2 mt-2">
                  {calls.map((call, i) => (
                    <div key={i} className="p-3 bg-theme-surface-hover/30 rounded-lg border border-theme-surface-border">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-theme-text-primary capitalize">
                          {String(call.incident_type || 'Unknown')}
                        </p>
                        {Boolean(call.incident_number) && (
                          <span className="text-xs text-theme-text-muted">#{String(call.incident_number)}</span>
                        )}
                      </div>
                      {Boolean(call.dispatched_at) && (
                        <p className="text-xs text-theme-text-muted mt-1">
                          Dispatched: {new Date(String(call.dispatched_at)).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ShiftDetailPanel;
