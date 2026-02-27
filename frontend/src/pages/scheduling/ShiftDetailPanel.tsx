/**
 * Shift Detail Panel
 *
 * Slide-out panel showing full details of a shift: crew roster,
 * open positions, attendance, calls, and notes.
 *
 * When a shift is assigned to an apparatus with defined positions,
 * a "crew board" shows each position as a slot (filled or open)
 * so members can sign up for specific seats on the vehicle.
 *
 * Admins can edit shift details, delete shifts, and assign members
 * via a searchable member dropdown.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Users, Clock, MapPin, Truck, UserPlus, Check, XCircle,
  Loader2, Phone, ChevronDown, ChevronUp, Pencil, Trash2, Save,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService, userService } from '../../services/api';
import type { ShiftRecord } from '../../services/api';
import type { Assignment } from '../../types/scheduling';
import { useAuthStore } from '../../stores/authStore';
import { useTimezone } from '../../hooks/useTimezone';
import { formatTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { POSITION_LABELS, ASSIGNMENT_STATUS_COLORS } from '../../constants/enums';

interface ShiftDetailPanelProps {
  shift: ShiftRecord;
  onClose: () => void;
  onRefresh?: () => void;
}

interface MemberOption {
  id: string;
  label: string;
}

export const ShiftDetailPanel: React.FC<ShiftDetailPanelProps> = ({
  shift: initialShift,
  onClose,
  onRefresh,
}) => {
  const { user, checkPermission } = useAuthStore();
  const tz = useTimezone();
  const canManage = checkPermission('scheduling.manage');

  const [shift, setShift] = useState(initialShift);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [calls, setCalls] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCalls, setShowCalls] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    shift_date: shift.shift_date,
    notes: shift.notes || '',
    shift_officer_id: shift.shift_officer_id || '',
  });
  const [saving, setSaving] = useState(false);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Signup state
  const [signupPosition, setSignupPosition] = useState('');
  const [signingUp, setSigningUp] = useState(false);

  // Inline confirmation for decline/remove
  const [confirmingDecline, setConfirmingDecline] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Assign state (admin) — with member search
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignForm, setAssignForm] = useState({ user_id: '', position: '' });
  const [assigning, setAssigning] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const apparatusPositions = useMemo(() => shift.apparatus_positions ?? [], [shift.apparatus_positions]);
  const hasApparatusPositions = apparatusPositions.length > 0;

  // Determine available position options based on apparatus
  const positionOptions: [string, string][] = useMemo(() =>
    hasApparatusPositions
      ? apparatusPositions.map(p => [p, POSITION_LABELS[p] || p.charAt(0).toUpperCase() + p.slice(1)])
      : Object.entries(POSITION_LABELS),
    [hasApparatusPositions, apparatusPositions]
  );

  // Set default signup position
  useEffect(() => {
    if (positionOptions.length > 0 && !signupPosition) {
      const firstOption = positionOptions[0];
      if (firstOption) setSignupPosition(firstOption[0]);
    }
  }, [positionOptions, signupPosition]);

  useEffect(() => {
    if (positionOptions.length > 0 && !assignForm.position) {
      const firstOption = positionOptions[0];
      if (firstOption) setAssignForm(f => ({ ...f, position: firstOption[0] }));
    }
  }, [positionOptions, assignForm.position]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [assignData, callData] = await Promise.all([
          schedulingService.getShiftAssignments(shift.id),
          schedulingService.getShiftCalls(shift.id),
        ]);
        if (!cancelled) {
          setAssignments(assignData as unknown as Assignment[]);
          setCalls(callData);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(getErrorMessage(err, 'Failed to load shift details'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [shift.id]);

  // Load members for the assign dropdown and shift officer edit
  useEffect(() => {
    if (!showAssignForm && !isEditing) return;
    const loadMembers = async () => {
      setLoadingMembers(true);
      try {
        const users = await userService.getUsers();
        const members = users.filter((m) => m.status === 'active').map((m) => ({
          id: String(m.id),
          label: `${m.first_name || ''} ${m.last_name || ''}`.trim() || String(m.email || m.id),
        }));
        setMemberOptions(members);
      } catch {
        // Non-critical — fallback to manual ID entry
      } finally {
        setLoadingMembers(false);
      }
    };
    void loadMembers();
  }, [showAssignForm, isEditing]);

  const filteredMembers = useMemo(() => {
    if (!memberSearch) return memberOptions;
    const q = memberSearch.toLowerCase();
    return memberOptions.filter(m => m.label.toLowerCase().includes(q));
  }, [memberSearch, memberOptions]);

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
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to sign up for shift'));
    } finally {
      setSigningUp(false);
    }
  };

  const handleConfirm = async (assignmentId: string) => {
    try {
      await schedulingService.confirmAssignment(assignmentId);
      toast.success('Assignment confirmed');
      await refreshAssignments();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to confirm assignment'));
    }
  };

  const handleDecline = async (assignmentId: string) => {
    if (declining) return;
    setDeclining(true);
    try {
      await schedulingService.updateAssignment(assignmentId, { assignment_status: 'declined' });
      toast.success('Assignment declined');
      setConfirmingDecline(null);
      await refreshAssignments();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to decline assignment'));
    } finally {
      setDeclining(false);
    }
  };

  const handleRemove = async (assignmentId: string) => {
    if (removing) return;
    setRemoving(true);
    try {
      await schedulingService.deleteAssignment(assignmentId);
      toast.success('Assignment removed');
      setConfirmingRemove(null);
      await refreshAssignments();
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to remove assignment'));
    } finally {
      setRemoving(false);
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
      setMemberSearch('');
      await refreshAssignments();
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to assign member'));
    } finally {
      setAssigning(false);
    }
  };

  // Edit shift
  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const updated = await schedulingService.updateShift(shift.id, {
        shift_date: editForm.shift_date,
        notes: editForm.notes || null,
        shift_officer_id: editForm.shift_officer_id || null,
      });
      setShift(updated);
      setIsEditing(false);
      toast.success('Shift updated');
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update shift'));
    } finally {
      setSaving(false);
    }
  };

  // Delete shift
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await schedulingService.deleteShift(shift.id);
      toast.success('Shift deleted');
      onClose();
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete shift'));
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmingDecline) setConfirmingDecline(null);
        else if (confirmingRemove) setConfirmingRemove(null);
        else onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, confirmingDecline, confirmingRemove]);

  const isUserAssigned = assignments.some(a => a.user_id === user?.id);
  const shiftDate = new Date(shift.shift_date + 'T12:00:00');
  const isPast = shiftDate < new Date();

  // Build crew board data: for each apparatus position, find the assignment(s) filling it
  const crewBoard = useMemo(() => {
    if (!hasApparatusPositions) return null;
    return apparatusPositions.map(position => {
      const filled = assignments.find(a => a.position.toLowerCase() === position.toLowerCase());
      return { position, assignment: filled || null };
    });
  }, [hasApparatusPositions, apparatusPositions, assignments]);

  // Assignments not matching any apparatus position (extra crew)
  const extraAssignments = useMemo(() => {
    if (!hasApparatusPositions) return assignments;
    const boardFilledIds = new Set<string>();
    for (const pos of apparatusPositions) {
      const match = assignments.find(a => a.position.toLowerCase() === pos.toLowerCase() && !boardFilledIds.has(a.id));
      if (match) boardFilledIds.add(match.id);
    }
    return assignments.filter(a => !boardFilledIds.has(a.id));
  }, [hasApparatusPositions, apparatusPositions, assignments]);

  const openPositions = crewBoard?.filter(s => !s.assignment).map(s => s.position) || [];

  const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500';

  const renderAssignmentRow = (assignment: Assignment) => {
    const effectiveStatus = assignment.status || assignment.assignment_status || 'assigned';
    const statusColor = ASSIGNMENT_STATUS_COLORS[effectiveStatus] || ASSIGNMENT_STATUS_COLORS.assigned;
    const isCurrentUser = assignment.user_id === user?.id;
    const isAssigned = effectiveStatus === 'assigned';
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
            {effectiveStatus}
          </span>
          {isCurrentUser && isAssigned && confirmingDecline !== assignment.id && (
            <>
              <button onClick={() => { void handleConfirm(assignment.id); }}
                className="p-1.5 text-green-600 hover:bg-green-500/10 rounded transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" aria-label="Confirm assignment"
              >
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => setConfirmingDecline(assignment.id)}
                className="p-1.5 text-red-500 hover:bg-red-500/10 rounded transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" aria-label="Decline assignment"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </>
          )}
          {confirmingDecline === assignment.id && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-500">Decline?</span>
              <button onClick={() => { void handleDecline(assignment.id); }} disabled={declining}
                className="px-2 py-1 text-xs bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50" aria-label="Confirm decline"
              >{declining ? '...' : 'Yes'}</button>
              <button onClick={() => setConfirmingDecline(null)}
                className="px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary" aria-label="Cancel decline"
              >No</button>
            </div>
          )}
          {canManage && !isCurrentUser && confirmingRemove !== assignment.id && (
            <button onClick={() => setConfirmingRemove(assignment.id)}
              className="p-1.5 text-theme-text-muted hover:text-red-500 rounded transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" aria-label="Remove assignment"
            >
              <XCircle className="w-4 h-4" />
            </button>
          )}
          {confirmingRemove === assignment.id && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-500">Remove?</span>
              <button onClick={() => { void handleRemove(assignment.id); }} disabled={removing}
                className="px-2 py-1 text-xs bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50" aria-label="Confirm removal"
              >{removing ? '...' : 'Yes'}</button>
              <button onClick={() => setConfirmingRemove(null)}
                className="px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary" aria-label="Cancel removal"
              >No</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Panel — uses drawer-panel CSS class for mobile-responsive width */}
      <div className="drawer-panel overflow-y-auto overscroll-contain !bg-theme-surface">
        {/* Header */}
        <div className="sticky top-0 bg-theme-surface border-b border-theme-surface-border p-4 sm:p-6 z-10">
          <div className="flex items-center justify-between">
            <div className="min-w-0 pr-2">
              <h2 className="text-lg sm:text-xl font-bold text-theme-text-primary">Shift Details</h2>
              <p className="text-xs sm:text-sm text-theme-text-secondary mt-1 truncate">
                {shiftDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: tz })}
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {canManage && !isPast && (
                <>
                  <button onClick={() => { setEditForm({ shift_date: shift.shift_date, notes: shift.notes || '', shift_officer_id: shift.shift_officer_id || '' }); setIsEditing(!isEditing); }}
                    className="p-2 text-theme-text-muted hover:text-violet-500 hover:bg-violet-500/10 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Edit shift"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => setShowDeleteConfirm(true)}
                    className="p-2 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Delete shift"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
              <button onClick={onClose} className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Close panel">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
          {/* Delete Confirmation */}
          {showDeleteConfirm && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg space-y-3">
              <p className="text-sm text-red-700 dark:text-red-300">
                Are you sure you want to delete this shift? This will remove all assignments and cannot be undone.
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary">Cancel</button>
                <button onClick={() => { void handleDelete(); }} disabled={deleting}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
                >
                  {deleting && <Loader2 className="w-3 h-3 animate-spin" />}
                  Delete Shift
                </button>
              </div>
            </div>
          )}

          {/* Edit Form */}
          {isEditing && (
            <div className="p-4 border border-violet-500/20 rounded-lg bg-violet-500/5 space-y-3">
              <h4 className="text-sm font-medium text-theme-text-primary flex items-center gap-2">
                <Pencil className="w-3.5 h-3.5" /> Edit Shift
              </h4>
              <div>
                <label className="block text-xs font-medium text-theme-text-secondary mb-1">Shift Date</label>
                <input type="date" value={editForm.shift_date}
                  onChange={e => setEditForm(p => ({...p, shift_date: e.target.value}))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-text-secondary mb-1">Notes</label>
                <textarea value={editForm.notes}
                  onChange={e => setEditForm(p => ({...p, notes: e.target.value}))}
                  rows={2} placeholder="Shift notes" className={inputCls + ' resize-none'}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-text-secondary mb-1">Shift Officer</label>
                <select
                  value={editForm.shift_officer_id}
                  onChange={e => setEditForm(p => ({...p, shift_officer_id: e.target.value}))}
                  className={inputCls}
                >
                  <option value="">No shift officer</option>
                  {memberOptions.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                {memberOptions.length === 0 && loadingMembers && (
                  <p className="text-xs text-theme-text-muted mt-1">Loading members...</p>
                )}
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary">Cancel</button>
                <button onClick={() => { void handleSaveEdit(); }} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
              </div>
            </div>
          )}

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
                    <span className="text-theme-text-muted"> / {apparatusPositions.length} positions</span>
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

          {shift.notes && !isEditing && (
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
                {crewBoard?.map(({ position, assignment }, i) => (
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
                          <span className={`px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded-full capitalize ${ASSIGNMENT_STATUS_COLORS[assignment.status || assignment.assignment_status || 'assigned'] || ASSIGNMENT_STATUS_COLORS.assigned}`}>
                            {assignment.status || assignment.assignment_status || 'assigned'}
                          </span>
                          {assignment.user_id === user?.id && (assignment.status === 'assigned' || assignment.assignment_status === 'assigned') && confirmingDecline !== assignment.id && (
                            <>
                              <button onClick={() => { void handleConfirm(assignment.id); }}
                                className="p-1.5 text-green-600 hover:bg-green-500/10 rounded transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" aria-label="Confirm assignment"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button onClick={() => setConfirmingDecline(assignment.id)}
                                className="p-1.5 text-red-500 hover:bg-red-500/10 rounded transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" aria-label="Decline assignment"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {confirmingDecline === assignment.id && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-red-500">Decline?</span>
                              <button onClick={() => { void handleDecline(assignment.id); }}
                                className="px-2 py-1 text-xs bg-red-600 text-white rounded-md hover:bg-red-700" aria-label="Confirm decline"
                              >Yes</button>
                              <button onClick={() => setConfirmingDecline(null)}
                                className="px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary" aria-label="Cancel decline"
                              >No</button>
                            </div>
                          )}
                          {canManage && assignment.user_id !== user?.id && confirmingRemove !== assignment.id && (
                            <button onClick={() => setConfirmingRemove(assignment.id)}
                              className="p-1.5 text-theme-text-muted hover:text-red-500 rounded transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" aria-label="Remove assignment"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                          {confirmingRemove === assignment.id && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-red-500">Remove?</span>
                              <button onClick={() => { void handleRemove(assignment.id); }}
                                className="px-2 py-1 text-xs bg-red-600 text-white rounded-md hover:bg-red-700" aria-label="Confirm removal"
                              >Yes</button>
                              <button onClick={() => setConfirmingRemove(null)}
                                className="px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary" aria-label="Cancel removal"
                              >No</button>
                            </div>
                          )}
                        </>
                      ) : (
                        !isPast && !isUserAssigned && (
                          <button
                            onClick={() => { void handleSignup(position); }}
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
                  <p className="text-xs text-theme-text-muted mt-1">
                    {canManage ? 'Use the Assign button above to add members.' : 'Sign up below to join this shift.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {assignments.map(renderAssignmentRow)}
                </div>
              )}
            </div>
          )}

          {/* Admin Assign Form — with member search dropdown */}
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
                  {/* Member search + select */}
                  <div>
                    <input type="text" placeholder="Search members..."
                      value={memberSearch}
                      onChange={e => setMemberSearch(e.target.value)}
                      className={inputCls}
                    />
                    {loadingMembers ? (
                      <div className="flex items-center gap-2 mt-2 text-xs text-theme-text-muted">
                        <Loader2 className="w-3 h-3 animate-spin" /> Loading members...
                      </div>
                    ) : (
                      <select
                        value={assignForm.user_id}
                        onChange={e => setAssignForm(p => ({...p, user_id: e.target.value}))}
                        className={inputCls + ' mt-2'}
                        size={Math.min(filteredMembers.length + 1, 6)}
                      >
                        <option value="">Select a member</option>
                        {filteredMembers.map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <select value={assignForm.position} onChange={e => setAssignForm(p => ({...p, position: e.target.value}))}
                    className={inputCls}
                  >
                    {positionOptions.map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setShowAssignForm(false); setMemberSearch(''); }} className="px-3 py-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary">Cancel</button>
                    <button onClick={() => { void handleAssign(); }} disabled={assigning || !assignForm.user_id}
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
                  className={'flex-1 ' + inputCls}
                >
                  {positionOptions.map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                <button onClick={() => { void handleSignup(); }} disabled={signingUp}
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
                <p className="text-sm text-theme-text-muted py-3">
                  {isPast ? 'No calls were recorded for this shift.' : 'Calls will appear here once the shift is underway.'}
                </p>
              ) : (
                <div className="space-y-2 mt-2">
                  {calls.map((call, i) => (
                    <div key={i} className="p-3 bg-theme-surface-hover/30 rounded-lg border border-theme-surface-border">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-theme-text-primary capitalize">
                          {String((call.incident_type ?? 'Unknown') as string)}
                        </p>
                        {Boolean(call.incident_number) && (
                          <span className="text-xs text-theme-text-muted">#{String(call.incident_number)}</span>
                        )}
                      </div>
                      {Boolean(call.dispatched_at) && (
                        <p className="text-xs text-theme-text-muted mt-1">
                          Dispatched: {formatTime(String(call.dispatched_at), tz)}
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
