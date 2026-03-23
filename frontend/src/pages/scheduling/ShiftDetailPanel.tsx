/**
 * Shift Detail Panel
 *
 * Slide-out panel showing full details of a shift: crew roster,
 * open positions, attendance, and notes.
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
  Loader2, ChevronDown, ChevronUp, Pencil, Trash2, Save, Palette, FileText,
  ClipboardCheck, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { userService } from '../../services/api';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ShiftRecord } from '../../modules/scheduling/services/api';
import { useSchedulingStore } from '../../modules/scheduling/store/schedulingStore';
import type { Assignment } from '../../types/scheduling';
import type { ShiftCheckSummary } from '../../modules/scheduling/types/equipmentCheck';
import { useAuthStore } from '../../stores/authStore';
import { useTimezone } from '../../hooks/useTimezone';
import { formatTime, getTodayLocalDate, formatDateCustom, localToUTC } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { POSITION_LABELS, ASSIGNMENT_STATUS_COLORS, UserStatus, AssignmentStatus } from '../../constants/enums';
import { PositionListEditor } from '../../modules/scheduling/components/PositionListEditor';
import { BUILTIN_POSITIONS } from '../../modules/scheduling/types/shiftSettings';
import TimeQuarterHour from '../../components/ux/TimeQuarterHour';

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
  const canAssign = checkPermission('scheduling.assign') || canManage;
  const { apparatus: apparatusList, loadApparatus } = useSchedulingStore();

  const [shift, setShift] = useState(initialShift);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEquipmentChecks, setShowEquipmentChecks] = useState(false);
  const [equipmentCheckSummaries, setEquipmentCheckSummaries] = useState<ShiftCheckSummary[]>([]);

  /** Extract HH:MM from an ISO datetime or time string in the user's local timezone. */
  const toTimeValue = (v?: string): string => {
    if (!v) return '';
    // If it contains 'T', it's an ISO datetime — convert to local timezone
    if (v.includes('T')) {
      const date = new Date(v);
      if (isNaN(date.getTime())) return '';
      const parts = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        ...(tz ? { timeZone: tz } : {}),
      }).formatToParts(date);
      const hour = parts.find(p => p.type === 'hour')?.value ?? '00';
      const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
      return `${hour}:${minute}`;
    }
    // Already HH:MM or HH:MM:SS
    return v.slice(0, 5);
  };

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    shift_date: shift.shift_date,
    start_time: toTimeValue(shift.start_time),
    end_time: toTimeValue(shift.end_time),
    apparatus_id: shift.apparatus_id || '',
    color: shift.color || '',
    notes: shift.notes || '',
    shift_officer_id: shift.shift_officer_id || '',
    positions: shift.positions ?? [],
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
  const [confirming, setConfirming] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Inline position editing
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [updatingPosition, setUpdatingPosition] = useState(false);

  // Inline assignment notes editing
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [editingNotesValue, setEditingNotesValue] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Assign state (admin) — position-first flow with member search
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
      ? apparatusPositions.map(p => {
          const name = typeof p === 'string' ? p : p.position;
          return [name, POSITION_LABELS[name] || name.charAt(0).toUpperCase() + name.slice(1)] as [string, string];
        })
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
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [assignData, checkData] = await Promise.all([
          schedulingService.getShiftAssignments(shift.id),
          schedulingService.getShiftChecklists(shift.id).catch(() => [] as ShiftCheckSummary[]),
        ]);
        if (!cancelled) {
          setAssignments(assignData);
          setEquipmentCheckSummaries(checkData);
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
        const members = users.filter((m) => m.status === UserStatus.ACTIVE).map((m) => ({
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

  // Load apparatus list when editing
  useEffect(() => {
    if (isEditing) void loadApparatus();
  }, [isEditing, loadApparatus]);

  const filteredMembers = useMemo(() => {
    if (!memberSearch) return memberOptions;
    const q = memberSearch.toLowerCase();
    return memberOptions.filter(m => m.label.toLowerCase().includes(q));
  }, [memberSearch, memberOptions]);

  const refreshAssignments = async () => {
    const [assignData, shiftData] = await Promise.all([
      schedulingService.getShiftAssignments(shift.id),
      schedulingService.getShift(shift.id),
    ]);
    setAssignments(assignData);
    setShift(shiftData);
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
    if (confirming) return;
    setConfirming(true);
    try {
      await schedulingService.confirmAssignment(assignmentId);
      toast.success('Assignment confirmed');
      await refreshAssignments();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to confirm assignment'));
    } finally {
      setConfirming(false);
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

  const handlePositionChange = async (assignmentId: string, newPosition: string, currentPosition: string) => {
    if (newPosition === currentPosition) {
      setEditingPositionId(null);
      return;
    }
    setUpdatingPosition(true);
    try {
      await schedulingService.updateAssignment(assignmentId, { position: newPosition });
      toast.success('Position updated');
      await refreshAssignments();
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update position'));
    } finally {
      setUpdatingPosition(false);
      setEditingPositionId(null);
    }
  };

  const handleSaveAssignmentNotes = async (assignmentId: string) => {
    setSavingNotes(true);
    try {
      await schedulingService.updateAssignment(assignmentId, { notes: editingNotesValue ?? undefined });
      toast.success('Notes updated');
      setEditingNotesId(null);
      await refreshAssignments();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update notes'));
    } finally {
      setSavingNotes(false);
    }
  };

  const openAssignFormForPosition = (position: string) => {
    setAssignForm({ user_id: '', position });
    setMemberSearch('');
    setShowAssignForm(true);
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
      setAssignForm({ user_id: '', position: openPositions[0] ?? positionOptions[0]?.[0] ?? 'firefighter' });
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
      const payload: Record<string, unknown> = {
        shift_date: editForm.shift_date,
        notes: editForm.notes || null,
        shift_officer_id: editForm.shift_officer_id || null,
        apparatus_id: editForm.apparatus_id || null,
        color: editForm.color || null,
        positions: editForm.positions.length > 0 ? editForm.positions : null,
      };
      if (editForm.start_time) {
        payload.start_time = localToUTC(`${editForm.shift_date}T${editForm.start_time}`, tz);
      }
      if (editForm.end_time) {
        payload.end_time = localToUTC(`${editForm.shift_date}T${editForm.end_time}`, tz);
      }
      const updated = await schedulingService.updateShift(shift.id, payload);
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
        if (editingPositionId) setEditingPositionId(null);
        else if (editingNotesId) setEditingNotesId(null);
        else if (confirmingDecline) setConfirmingDecline(null);
        else if (confirmingRemove) setConfirmingRemove(null);
        else onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, editingPositionId, editingNotesId, confirmingDecline, confirmingRemove]);

  const shiftDate = new Date(shift.shift_date + 'T12:00:00');
  const isPast = shift.shift_date < getTodayLocalDate(tz);

  // Only active (assigned/confirmed) assignments fill crew board slots and
  // count toward staffing.  Declined, cancelled, and no-show members should
  // leave the slot open so it can be filled by someone else.
  const activeStatuses = new Set<string>([AssignmentStatus.ASSIGNED, AssignmentStatus.CONFIRMED]);
  const activeAssignments = useMemo(
    () => assignments.filter(a => activeStatuses.has(a.status || 'assigned')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignments],
  );
  const inactiveAssignments = useMemo(
    () => assignments.filter(a => !activeStatuses.has(a.status || 'assigned')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignments],
  );

  const isUserAssigned = activeAssignments.some(a => a.user_id === user?.id);

  // Build crew board data: for each apparatus position, find the assignment(s) filling it
  const crewBoard = useMemo(() => {
    if (!hasApparatusPositions) return null;
    const usedIds = new Set<string>();
    return apparatusPositions.map(slot => {
      const posName = typeof slot === 'string' ? slot : slot.position;
      const isRequired = typeof slot === 'string' ? true : slot.required;
      const filled = activeAssignments.find(a => a.position.toLowerCase() === posName.toLowerCase() && !usedIds.has(a.id));
      if (filled) usedIds.add(filled.id);
      return { position: posName, required: isRequired, assignment: filled || null };
    });
  }, [hasApparatusPositions, apparatusPositions, activeAssignments]);

  // Active assignments not matching any apparatus position (extra crew)
  const extraAssignments = useMemo(() => {
    if (!hasApparatusPositions) return activeAssignments;
    const boardFilledIds = new Set<string>();
    for (const slot of apparatusPositions) {
      const posName = typeof slot === 'string' ? slot : slot.position;
      const match = activeAssignments.find(a => a.position.toLowerCase() === posName.toLowerCase() && !boardFilledIds.has(a.id));
      if (match) boardFilledIds.add(match.id);
    }
    return activeAssignments.filter(a => !boardFilledIds.has(a.id));
  }, [hasApparatusPositions, apparatusPositions, activeAssignments]);

  const openPositions = crewBoard?.filter(s => !s.assignment).map(s => s.position) || [];

  // Default the assign form to the first open position
  useEffect(() => {
    if (positionOptions.length > 0 && !assignForm.position) {
      const firstOpen = openPositions[0];
      const fallback = positionOptions[0];
      const defaultPos = firstOpen ?? fallback?.[0];
      if (defaultPos) setAssignForm(f => ({ ...f, position: defaultPos }));
    }
  }, [positionOptions, assignForm.position, openPositions]);

  const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-violet-500';

  const renderAssignmentRow = (assignment: Assignment) => {
    const effectiveStatus = assignment.status || 'assigned';
    const statusColor = ASSIGNMENT_STATUS_COLORS[effectiveStatus] || ASSIGNMENT_STATUS_COLORS.assigned;
    const isCurrentUser = assignment.user_id === user?.id;
    const isAssigned = effectiveStatus === AssignmentStatus.ASSIGNED;
    return (
      <div key={assignment.id} className={`flex items-center justify-between gap-2 p-2.5 sm:p-3 rounded-lg border ${isCurrentUser ? 'border-violet-500/30 bg-violet-500/5' : 'border-theme-surface-border bg-theme-surface-hover/30'}`}>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-8 h-8 rounded-full bg-theme-surface-hover flex items-center justify-center text-sm font-medium text-theme-text-primary shrink-0">
            {(assignment.user_name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-theme-text-primary truncate">
              {assignment.user_name || 'Unknown'} {isCurrentUser && <span className="text-xs text-violet-500">(You)</span>}
            </p>
            {canAssign && !isPast && editingPositionId === assignment.id ? (
              <select
                value={assignment.position}
                onChange={e => { void handlePositionChange(assignment.id, e.target.value, assignment.position); }}
                onBlur={() => { if (!updatingPosition) setEditingPositionId(null); }}
                disabled={updatingPosition}
                className="text-xs bg-theme-input-bg border border-theme-input-border rounded-sm px-1 py-0.5 text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-violet-500"
                autoFocus
              >
                {positionOptions.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            ) : (
              <button
                type="button"
                className={`text-xs capitalize ${canAssign && !isPast ? 'text-theme-text-muted hover:text-violet-500 transition-colors inline-flex items-center gap-0.5' : 'text-theme-text-muted'}`}
                onClick={canAssign && !isPast ? () => setEditingPositionId(assignment.id) : undefined}
                disabled={!canAssign || isPast}
                title={canAssign && !isPast ? 'Click to change position' : undefined}
              >
                {POSITION_LABELS[assignment.position] || assignment.position}
                {canAssign && !isPast && <Pencil className="w-2.5 h-2.5 ml-0.5 opacity-50" />}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <span className={`px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded-full capitalize ${statusColor}`}>
            {effectiveStatus}
          </span>
          {isCurrentUser && isAssigned && confirmingDecline !== assignment.id && (
            <>
              <button onClick={() => { void handleConfirm(assignment.id); }} disabled={confirming}
                className="p-1.5 text-green-600 hover:bg-green-500/10 rounded-sm transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center disabled:opacity-50" aria-label="Confirm assignment"
              >
                {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
              <button onClick={() => setConfirmingDecline(assignment.id)}
                className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-sm transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" aria-label="Decline assignment"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </>
          )}
          {confirmingDecline === assignment.id && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-500">Decline?</span>
              <button onClick={() => { void handleDecline(assignment.id); }} disabled={declining}
                className="btn-primary px-2 py-1 rounded-md text-xs" aria-label="Confirm decline"
              >{declining ? '...' : 'Yes'}</button>
              <button onClick={() => setConfirmingDecline(null)}
                className="px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary" aria-label="Cancel decline"
              >No</button>
            </div>
          )}
          {canAssign && !isCurrentUser && confirmingRemove !== assignment.id && (
            <button onClick={() => setConfirmingRemove(assignment.id)}
              className="p-1.5 text-theme-text-muted hover:text-red-500 rounded-sm transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" aria-label="Remove assignment"
            >
              <XCircle className="w-4 h-4" />
            </button>
          )}
          {confirmingRemove === assignment.id && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-500">Remove?</span>
              <button onClick={() => { void handleRemove(assignment.id); }} disabled={removing}
                className="btn-primary px-2 py-1 rounded-md text-xs" aria-label="Confirm removal"
              >{removing ? '...' : 'Yes'}</button>
              <button onClick={() => setConfirmingRemove(null)}
                className="px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary" aria-label="Cancel removal"
              >No</button>
            </div>
          )}
          {canAssign && !isPast && editingNotesId !== assignment.id && (
            <button
              onClick={() => { setEditingNotesId(assignment.id); setEditingNotesValue(assignment.notes || ''); }}
              className={`p-1.5 rounded-sm transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center ${assignment.notes ? 'text-violet-500 hover:bg-violet-500/10' : 'text-theme-text-muted hover:text-violet-500 hover:bg-violet-500/10'}`}
              aria-label="Edit notes" title={assignment.notes ? 'Edit notes' : 'Add notes'}
            >
              <FileText className="w-4 h-4" />
            </button>
          )}
        </div>
        {/* Assignment notes display */}
        {assignment.notes && editingNotesId !== assignment.id && (
          <p className="text-xs text-theme-text-muted mt-1.5 pl-11">{assignment.notes}</p>
        )}
        {/* Inline notes editor */}
        {editingNotesId === assignment.id && (
          <div className="mt-2 pl-11 flex items-center gap-2">
            <input type="text" value={editingNotesValue}
              onChange={e => setEditingNotesValue(e.target.value)}
              placeholder="Assignment notes..."
              className="flex-1 text-xs bg-theme-input-bg border border-theme-input-border rounded-sm px-2 py-1 text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-violet-500"
              autoFocus
              aria-label="Assignment notes"
              onKeyDown={e => { if (e.key === 'Enter') void handleSaveAssignmentNotes(assignment.id); else if (e.key === 'Escape') setEditingNotesId(null); }}
            />
            <button onClick={() => { void handleSaveAssignmentNotes(assignment.id); }} disabled={savingNotes}
              className="px-2 py-1 text-xs bg-violet-600 text-white rounded-sm hover:bg-violet-700 disabled:opacity-50"
            >{savingNotes ? '...' : 'Save'}</button>
            <button onClick={() => setEditingNotesId(null)}
              className="px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary"
            >Cancel</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} aria-hidden="true" />

      {/* Panel — uses drawer-panel CSS class for mobile-responsive width */}
      <div className="drawer-panel overflow-y-auto overscroll-contain">
        {/* Header */}
        <div className="sticky top-0 bg-theme-surface-modal border-b border-theme-surface-border p-4 sm:p-6 z-10">
          <div className="flex items-center justify-between">
            <div className="min-w-0 pr-2">
              <h2 className="text-lg sm:text-xl font-bold text-theme-text-primary">Shift Details</h2>
              <p className="text-xs sm:text-sm text-theme-text-secondary mt-1 truncate">
                {formatDateCustom(shiftDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, tz)}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {canManage && !isPast && (
                <>
                  <button onClick={() => { setEditForm({ shift_date: shift.shift_date, start_time: toTimeValue(shift.start_time), end_time: toTimeValue(shift.end_time), apparatus_id: shift.apparatus_id || '', color: shift.color || '', notes: shift.notes || '', shift_officer_id: shift.shift_officer_id || '', positions: shift.positions ?? [] }); setIsEditing(!isEditing); }}
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
                  className="btn-primary flex gap-1 items-center px-3 py-1.5 text-sm"
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-theme-text-secondary mb-1">Start Time</label>
                  <TimeQuarterHour value={editForm.start_time}
                    onChange={e => setEditForm(p => ({...p, start_time: e.target.value}))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-theme-text-secondary mb-1">End Time</label>
                  <TimeQuarterHour value={editForm.end_time}
                    onChange={e => setEditForm(p => ({...p, end_time: e.target.value}))}
                    className={inputCls}
                  />
                </div>
              </div>
              {apparatusList.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-theme-text-secondary mb-1">
                    <span className="flex items-center gap-1"><Truck className="w-3 h-3" /> Apparatus</span>
                  </label>
                  <select
                    value={editForm.apparatus_id}
                    onChange={e => setEditForm(p => ({...p, apparatus_id: e.target.value}))}
                    className={inputCls}
                  >
                    <option value="">No specific apparatus</option>
                    {apparatusList.map(a => (
                      <option key={a.id} value={a.id}>{a.unit_number} — {a.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-theme-text-secondary mb-1">
                  <span className="flex items-center gap-1"><Palette className="w-3 h-3" /> Color</span>
                </label>
                <div className="flex items-center gap-2">
                  <input type="color" value={editForm.color || '#8b5cf6'}
                    onChange={e => setEditForm(p => ({...p, color: e.target.value}))}
                    className="w-8 h-8 rounded-sm border border-theme-input-border cursor-pointer bg-transparent p-0"
                  />
                  <span className="text-xs text-theme-text-muted">{editForm.color || 'Default'}</span>
                  {editForm.color && (
                    <button type="button" onClick={() => setEditForm(p => ({...p, color: ''}))}
                      className="text-xs text-theme-text-muted hover:text-theme-text-primary"
                    >Clear</button>
                  )}
                </div>
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
              <PositionListEditor
                structured
                positions={editForm.positions}
                onChangeStructured={positions => setEditForm(p => ({ ...p, positions }))}
                availablePositions={BUILTIN_POSITIONS}
                label="Positions"
                addButtonLabel="Add position"
              />
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
            {(() => {
              const target = hasApparatusPositions ? apparatusPositions.length : (shift.min_staffing ?? 0);
              const filled = activeAssignments.length;
              const isFull = target > 0 && filled >= target;
              const isShort = target > 0 && filled < target;
              return (
                <div className={`flex items-center gap-3 p-3 rounded-lg ${
                  isFull ? 'bg-green-500/10' : isShort ? 'bg-amber-500/10' : 'bg-theme-surface-hover/50'
                }`}>
                  {isFull ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                  ) : isShort ? (
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <Users className="w-5 h-5 text-blue-500" />
                  )}
                  <div>
                    <p className="text-xs text-theme-text-muted">Crew</p>
                    <p className="text-sm font-medium text-theme-text-primary">
                      {filled} assigned
                      {target > 0 && (
                        <span className="text-theme-text-muted"> / {target} positions</span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })()}
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
                {crewBoard?.map(({ position, required, assignment }, i) => (
                  <div key={i} className={`flex items-center justify-between gap-2 p-2.5 sm:p-3 rounded-lg border ${
                    assignment
                      ? (assignment.user_id === user?.id ? 'border-violet-500/30 bg-violet-500/5' : 'border-theme-surface-border bg-theme-surface-hover/30')
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
                              {assignment.user_id === user?.id && <span className="text-xs text-violet-500 ml-1">(You)</span>}
                            </p>
                            {canAssign && !isPast && editingPositionId === assignment.id ? (
                              <select
                                value={assignment.position}
                                onChange={e => { void handlePositionChange(assignment.id, e.target.value, assignment.position); }}
                                onBlur={() => { if (!updatingPosition) setEditingPositionId(null); }}
                                disabled={updatingPosition}
                                className="text-xs bg-theme-input-bg border border-theme-input-border rounded-sm px-1 py-0.5 text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-violet-500"
                                autoFocus
                              >
                                {positionOptions.map(([val, label]) => (
                                  <option key={val} value={val}>{label}</option>
                                ))}
                              </select>
                            ) : (
                              <button
                                type="button"
                                className={`text-xs capitalize ${canAssign && !isPast ? 'text-theme-text-muted hover:text-violet-500 transition-colors inline-flex items-center gap-0.5' : 'text-theme-text-muted'}`}
                                onClick={canAssign && !isPast ? () => setEditingPositionId(assignment.id) : undefined}
                                disabled={!canAssign || isPast}
                                title={canAssign && !isPast ? 'Click to change position' : undefined}
                              >
                                {POSITION_LABELS[position] || position}
                                {canAssign && !isPast && <Pencil className="w-2.5 h-2.5 ml-0.5 opacity-50" />}
                              </button>
                            )}
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
                    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                      {assignment ? (
                        <>
                          <span className={`px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded-full capitalize ${ASSIGNMENT_STATUS_COLORS[assignment.status || 'assigned'] || ASSIGNMENT_STATUS_COLORS.assigned}`}>
                            {assignment.status || 'assigned'}
                          </span>
                          {assignment.user_id === user?.id && assignment.status === AssignmentStatus.ASSIGNED && confirmingDecline !== assignment.id && (
                            <>
                              <button onClick={() => { void handleConfirm(assignment.id); }}
                                className="p-1.5 text-green-600 hover:bg-green-500/10 rounded-sm transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" aria-label="Confirm assignment"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button onClick={() => setConfirmingDecline(assignment.id)}
                                className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-sm transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" aria-label="Decline assignment"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {confirmingDecline === assignment.id && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-red-500">Decline?</span>
                              <button onClick={() => { void handleDecline(assignment.id); }}
                                className="btn-primary px-2 py-1 rounded-md text-xs" aria-label="Confirm decline"
                              >Yes</button>
                              <button onClick={() => setConfirmingDecline(null)}
                                className="px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary" aria-label="Cancel decline"
                              >No</button>
                            </div>
                          )}
                          {canAssign && assignment.user_id !== user?.id && confirmingRemove !== assignment.id && (
                            <button onClick={() => setConfirmingRemove(assignment.id)}
                              className="p-1.5 text-theme-text-muted hover:text-red-500 rounded-sm transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center" aria-label="Remove assignment"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                          {confirmingRemove === assignment.id && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-red-500">Remove?</span>
                              <button onClick={() => { void handleRemove(assignment.id); }}
                                className="btn-primary px-2 py-1 rounded-md text-xs" aria-label="Confirm removal"
                              >Yes</button>
                              <button onClick={() => setConfirmingRemove(null)}
                                className="px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary" aria-label="Cancel removal"
                              >No</button>
                            </div>
                          )}
                        </>
                      ) : !isPast && (
                        <div className="flex items-center gap-1.5">
                          {canAssign && (
                            <button
                              onClick={() => openAssignFormForPosition(position)}
                              className="px-2.5 sm:px-3 py-1.5 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 border border-violet-500/30 rounded-lg text-xs font-medium inline-flex items-center gap-1"
                            >
                              <UserPlus className="w-3 h-3" />
                              <span className="hidden sm:inline">Assign</span>
                            </button>
                          )}
                          {!isUserAssigned && (
                            <button
                              onClick={() => { void handleSignup(position); }}
                              disabled={signingUp}
                              className="px-2.5 sm:px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1"
                            >
                              {signingUp ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                              <span className="hidden sm:inline">Sign Up</span><span className="sm:hidden">Join</span>
                            </button>
                          )}
                        </div>
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
                {canAssign && !isPast && (
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
              ) : activeAssignments.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-theme-surface-border rounded-lg">
                  <Users className="w-8 h-8 text-theme-text-muted mx-auto mb-2" />
                  <p className="text-sm text-theme-text-muted">No crew assigned yet</p>
                  <p className="text-xs text-theme-text-muted mt-1">
                    {canAssign ? 'Use the Assign button above to add members.' : 'Sign up below to join this shift.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activeAssignments.map(renderAssignmentRow)}
                </div>
              )}
            </div>
          )}

          {/* Admin Assign Form — with member search dropdown */}
          {canAssign && (showAssignForm || (hasApparatusPositions && !isPast)) && (
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
                  {/* Step 1: Position selection */}
                  <div>
                    <label htmlFor="assign-position" className="block text-xs font-medium text-theme-text-secondary mb-1">Position</label>
                    <select id="assign-position" value={assignForm.position} onChange={e => setAssignForm(p => ({...p, position: e.target.value}))}
                      className={inputCls}
                    >
                      {positionOptions.map(([val, label]) => {
                        const isOpen = openPositions.includes(val);
                        return (
                          <option key={val} value={val}>
                            {label}{isOpen ? ' (open)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  {/* Step 2: Member search + select */}
                  <div>
                    <label htmlFor="assign-member-search" className="block text-xs font-medium text-theme-text-secondary mb-1">Member</label>
                    <input id="assign-member-search" type="text" aria-label="Search members" placeholder="Search members..."
                      value={memberSearch}
                      onChange={e => setMemberSearch(e.target.value)}
                      className={inputCls}
                    />
                    {loadingMembers ? (
                      <div className="flex items-center gap-2 mt-2 text-xs text-theme-text-muted">
                        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Loading members...
                      </div>
                    ) : (
                      <select
                        aria-label="Select a member"
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
          {!hasApparatusPositions && !isPast && !isUserAssigned && (
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

          {/* Declined / Removed Members (admin visibility) */}
          {canAssign && inactiveAssignments.length > 0 && (
            <div className="opacity-60">
              <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wide mb-2">
                Declined / Removed ({inactiveAssignments.length})
              </h3>
              <div className="space-y-1.5">
                {inactiveAssignments.map(a => (
                  <div key={a.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-theme-surface-border bg-theme-surface-hover/20 text-sm">
                    <span className="text-theme-text-muted line-through">{a.user_name || 'Unknown'}</span>
                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full capitalize ${ASSIGNMENT_STATUS_COLORS[a.status || 'declined'] || ASSIGNMENT_STATUS_COLORS.declined}`}>
                      {a.status || 'declined'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Equipment Checks */}
          {equipmentCheckSummaries.length > 0 && (
            <div>
              <button onClick={() => setShowEquipmentChecks(!showEquipmentChecks)}
                className="flex items-center justify-between w-full text-left py-2"
              >
                <h3 className="text-base font-semibold text-theme-text-primary flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4" /> Equipment Checks ({equipmentCheckSummaries.length})
                </h3>
                {showEquipmentChecks ? <ChevronUp className="w-4 h-4 text-theme-text-muted" /> : <ChevronDown className="w-4 h-4 text-theme-text-muted" />}
              </button>
              {showEquipmentChecks && (
                <div className="space-y-2 mt-2">
                  {(['start_of_shift', 'end_of_shift'] as const).map(timing => {
                    const checksForTiming = equipmentCheckSummaries.filter(s => s.checkTiming === timing);
                    if (checksForTiming.length === 0) return null;
                    return (
                      <div key={timing}>
                        <p className="text-xs font-medium text-theme-text-muted uppercase tracking-wide mb-1">
                          {timing === 'start_of_shift' ? 'Start of Shift' : 'End of Shift'}
                        </p>
                        {checksForTiming.map(summary => (
                          <div key={summary.templateId} className="p-3 bg-theme-surface-hover/30 rounded-lg border border-theme-surface-border mb-2">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium text-theme-text-primary">{summary.templateName}</p>
                              {summary.isCompleted ? (
                                summary.overallStatus === 'pass' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                    <Check className="w-3 h-3" /> Pass
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                    <XCircle className="w-3 h-3" /> Fail ({summary.failedItems})
                                  </span>
                                )
                              ) : (
                                summary.completedItems > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                                    In Progress {summary.completedItems}/{summary.totalItems}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-theme-surface-secondary text-theme-text-muted">
                                    Not Started
                                  </span>
                                )
                              )}
                            </div>
                            {summary.checkedByName && (
                              <p className="text-xs text-theme-text-muted mt-1">
                                Checked by {summary.checkedByName}{summary.checkedAt ? ` at ${formatTime(summary.checkedAt, tz)}` : ''}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ShiftDetailPanel;
