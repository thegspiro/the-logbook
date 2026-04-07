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

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Users, Clock, MapPin, Truck, UserPlus, Check, XCircle,
  Loader2, ChevronDown, ChevronUp, Pencil, Trash2, Save, Palette, FileText,
  ClipboardCheck, CheckCircle2, AlertTriangle, LogIn, LogOut, QrCode,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
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
import { AssignmentActions } from './AssignmentActions';
import { PositionEditor } from './PositionEditor';
import { CrewBoardSlot } from './CrewBoardSlot';

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
  const navigate = useNavigate();
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
  // Async operation flags — grouped to reduce useState count
  const [pending, setPending] = useState({
    saving: false,
    deleting: false,
    finalizing: false,
    signingUp: false,
    confirming: false,
    declining: false,
    removing: false,
    updatingPosition: false,
    savingNotes: false,
    assigning: false,
    loadingMembers: false,
    bulkAssigning: false,
  });
  const setPendingFlag = useCallback((key: keyof typeof pending, value: boolean) =>
    setPending(prev => ({ ...prev, [key]: value })), []);

  // Attendance check-in/check-out state
  const [myAttendance, setMyAttendance] = useState<{
    checked_in_at?: string;
    checked_out_at?: string;
    duration_minutes?: number;
  } | null>(null);
  const [allAttendance, setAllAttendance] = useState<
    import('../../modules/scheduling/services/api').ShiftAttendanceRecord[]
  >([]);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [showQR, setShowQR] = useState(false);

  // UI visibility toggles
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFinalizeChecklist, setShowFinalizeChecklist] = useState(false);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [showBulkAssign, setShowBulkAssign] = useState(false);

  // Signup state
  const [signupPosition, setSignupPosition] = useState('');

  // Inline editing state
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [editingNotesValue, setEditingNotesValue] = useState('');

  // Assign state (admin) — position-first flow with member search
  const [assignForm, setAssignForm] = useState({ user_id: '', position: '' });
  const [memberSearch, setMemberSearch] = useState('');
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(new Set());

  // Bulk assignment state — maps position name to selected user_id
  const [bulkAssignments, setBulkAssignments] = useState<Record<string, string>>({});

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
        const [assignData, checkData, attendanceData, allAttData] = await Promise.all([
          schedulingService.getShiftAssignments(shift.id),
          schedulingService.getShiftChecklists(shift.id).catch(() => [] as ShiftCheckSummary[]),
          schedulingService.getMyAttendance(shift.id),
          schedulingService.getShiftAttendance(shift.id).catch(() => []),
        ]);
        if (!cancelled) {
          setAssignments(assignData);
          setEquipmentCheckSummaries(checkData);
          setMyAttendance(attendanceData);
          setAllAttendance(allAttData);
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
      setPendingFlag('loadingMembers', true);
      try {
        const [users, unavailable] = await Promise.all([
          userService.getUsers(),
          showAssignForm
            ? schedulingService.getUnavailableMembers(shift.id)
            : Promise.resolve([]),
        ]);
        const members = users.filter((m) => m.status === UserStatus.ACTIVE).map((m) => ({
          id: String(m.id),
          label: `${m.first_name || ''} ${m.last_name || ''}`.trim() || String(m.email || m.id),
        }));
        setMemberOptions(members);
        setUnavailableIds(new Set(unavailable));
      } catch {
        // Non-critical — fallback to manual ID entry
      } finally {
        setPendingFlag('loadingMembers', false);
      }
    };
    void loadMembers();
  }, [showAssignForm, isEditing, shift.id, setPendingFlag]);

  // Load apparatus list when editing
  useEffect(() => {
    if (isEditing) void loadApparatus();
  }, [isEditing, loadApparatus]);

  const filteredMembers = useMemo(() => {
    const available = memberOptions.filter(m => !unavailableIds.has(m.id));
    if (!memberSearch) return available;
    const q = memberSearch.toLowerCase();
    return available.filter(m => m.label.toLowerCase().includes(q));
  }, [memberSearch, memberOptions, unavailableIds]);

  const refreshAssignments = async () => {
    const [assignData, shiftData, unavailable] = await Promise.all([
      schedulingService.getShiftAssignments(shift.id),
      schedulingService.getShift(shift.id),
      schedulingService.getUnavailableMembers(shift.id),
    ]);
    setAssignments(assignData);
    setShift(shiftData);
    setUnavailableIds(new Set(unavailable));
  };

  const handleSignup = async (position?: string) => {
    const pos = position || signupPosition;
    setPendingFlag('signingUp', true);
    try {
      await schedulingService.signupForShift(shift.id, { position: pos });
      toast.success('Signed up for shift');
      await refreshAssignments();
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to sign up for shift'));
    } finally {
      setPendingFlag('signingUp', false);
    }
  };

  const handleConfirm = async (assignmentId: string) => {
    if (pending.confirming) return;
    setPendingFlag('confirming', true);
    // Optimistic update — show confirmed immediately
    setAssignments(prev => prev.map(a =>
      a.id === assignmentId ? { ...a, status: AssignmentStatus.CONFIRMED } : a
    ));
    try {
      await schedulingService.confirmAssignment(assignmentId);
      toast.success('Assignment confirmed');
      await refreshAssignments();
    } catch (err) {
      // Revert optimistic update
      setAssignments(prev => prev.map(a =>
        a.id === assignmentId ? { ...a, status: AssignmentStatus.ASSIGNED } : a
      ));
      toast.error(getErrorMessage(err, 'Failed to confirm assignment'));
    } finally {
      setPendingFlag('confirming', false);
    }
  };

  const handleDecline = async (assignmentId: string) => {
    if (pending.declining) return;
    setPendingFlag('declining', true);
    // Optimistic update — show declined immediately
    setAssignments(prev => prev.map(a =>
      a.id === assignmentId ? { ...a, status: AssignmentStatus.DECLINED } : a
    ));
    try {
      await schedulingService.updateAssignment(assignmentId, { assignment_status: 'declined' });
      toast.success('Assignment declined');
      await refreshAssignments();
    } catch (err) {
      // Revert optimistic update
      setAssignments(prev => prev.map(a =>
        a.id === assignmentId ? { ...a, status: AssignmentStatus.ASSIGNED } : a
      ));
      toast.error(getErrorMessage(err, 'Failed to decline assignment'));
    } finally {
      setPendingFlag('declining', false);
    }
  };

  const handleRemove = async (assignmentId: string) => {
    if (pending.removing) return;
    setPendingFlag('removing', true);
    try {
      await schedulingService.deleteAssignment(assignmentId);
      toast.success('Assignment removed');
      await refreshAssignments();
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to remove assignment'));
    } finally {
      setPendingFlag('removing', false);
    }
  };

  const handlePositionChange = async (assignmentId: string, newPosition: string, currentPosition: string) => {
    if (newPosition === currentPosition) return;
    setPendingFlag('updatingPosition', true);
    try {
      await schedulingService.updateAssignment(assignmentId, { position: newPosition });
      toast.success('Position updated');
      await refreshAssignments();
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update position'));
    } finally {
      setPendingFlag('updatingPosition', false);
    }
  };

  const handleSaveAssignmentNotes = async (assignmentId: string) => {
    setPendingFlag('savingNotes', true);
    try {
      await schedulingService.updateAssignment(assignmentId, { notes: editingNotesValue || undefined });
      toast.success('Notes updated');
      setEditingNotesId(null);
      await refreshAssignments();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update notes'));
    } finally {
      setPendingFlag('savingNotes', false);
    }
  };

  const openAssignFormForPosition = (position: string) => {
    setAssignForm({ user_id: '', position });
    setMemberSearch('');
    setShowBulkAssign(false);
    setShowAssignForm(true);
  };

  const openBulkAssign = () => {
    setBulkAssignments({});
    setShowAssignForm(false);
    setShowBulkAssign(true);
  };

  const handleBulkAssign = async () => {
    const entries = Object.entries(bulkAssignments).filter((pair): pair is [string, string] => Boolean(pair[1]));
    if (entries.length === 0) { toast.error('Select at least one member'); return; }
    setPendingFlag('bulkAssigning', true);
    let successCount = 0;
    for (const [position, userId] of entries) {
      try {
        await schedulingService.createAssignment(shift.id, {
          user_id: userId,
          position,
        });
        successCount++;
      } catch (err) {
        toast.error(`Failed to assign ${position}: ${getErrorMessage(err, 'Unknown error')}`);
      }
    }
    if (successCount > 0) {
      toast.success(`${successCount} member${successCount > 1 ? 's' : ''} assigned`);
      setShowBulkAssign(false);
      setBulkAssignments({});
      await refreshAssignments();
      onRefresh?.();
    }
    setPendingFlag('bulkAssigning', false);
  };

  const handleAssign = async () => {
    if (!assignForm.user_id) { toast.error('Select a member'); return; }
    setPendingFlag('assigning', true);
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
      setPendingFlag('assigning', false);
    }
  };

  // Edit shift
  const handleSaveEdit = async () => {
    setPendingFlag('saving', true);
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
      setPendingFlag('saving', false);
    }
  };

  // Delete shift
  const handleDelete = async () => {
    setPendingFlag('deleting', true);
    try {
      await schedulingService.deleteShift(shift.id);
      toast.success('Shift deleted');
      onClose();
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete shift'));
    } finally {
      setPendingFlag('deleting', false);
    }
  };

  const handleFinalize = async () => {
    setPendingFlag('finalizing', true);
    try {
      const updated = await schedulingService.finalizeShift(shift.id);
      setShift(updated);
      toast.success('Shift finalized');
      setShowFinalizeChecklist(false);
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to finalize shift'));
    } finally {
      setPendingFlag('finalizing', false);
    }
  };

  // Pre-finalization checklist data — only end-of-shift checks gate finalization
  const endOfShiftChecks = useMemo(() => {
    return equipmentCheckSummaries.filter(c => c.checkTiming === 'end_of_shift');
  }, [equipmentCheckSummaries]);

  const hasIncompleteEquipmentChecks = useMemo(() => {
    return endOfShiftChecks.some(c => !c.isCompleted);
  }, [endOfShiftChecks]);

  const completedEquipmentChecks = useMemo(() => {
    return endOfShiftChecks.filter(c => c.isCompleted);
  }, [endOfShiftChecks]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingNotesId) setEditingNotesId(null);
        else onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, editingNotesId]);

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

  const attendanceByUser = useMemo(() => {
    const map = new Map<string, typeof allAttendance[0]>();
    for (const att of allAttendance) {
      map.set(att.user_id, att);
    }
    return map;
  }, [allAttendance]);

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

  const openPositions = useMemo(() => crewBoard?.filter(s => !s.assignment).map(s => s.position) || [], [crewBoard]);

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
    const isCurrentUser = assignment.user_id === user?.id;
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
            <PositionEditor
              assignmentId={assignment.id}
              currentPosition={assignment.position}
              positionOptions={positionOptions}
              onSave={(id, newPos, curPos) => { void handlePositionChange(id, newPos, curPos); }}
              editable={canAssign && !isPast}
              updatingPosition={pending.updatingPosition}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:gap-2 shrink-0">
          <AssignmentActions
            assignmentId={assignment.id}
            effectiveStatus={assignment.status || 'assigned'}
            isCurrentUser={isCurrentUser || false}
            canAssign={canAssign}
            onConfirm={(id) => { void handleConfirm(id); }}
            onDecline={(id) => { void handleDecline(id); }}
            onRemove={(id) => { void handleRemove(id); }}
            pendingConfirming={pending.confirming}
            pendingDeclining={pending.declining}
            pendingRemoving={pending.removing}
          />
          {canAssign && !isPast && editingNotesId !== assignment.id && (
            <button
              onClick={() => { setEditingNotesId(assignment.id); setEditingNotesValue(assignment.notes || ''); }}
              className={`p-1.5 rounded-sm transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center ${assignment.notes ? 'text-violet-500 hover:bg-violet-500/10' : 'text-theme-text-muted hover:text-violet-500 hover:bg-violet-500/10'}`}
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
            <button onClick={() => { void handleSaveAssignmentNotes(assignment.id); }} disabled={pending.savingNotes}
              className="px-2 py-1 text-xs bg-violet-600 text-white rounded-sm hover:bg-violet-700 disabled:opacity-50"
            >{pending.savingNotes ? '...' : 'Save'}</button>
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
              {canManage && !isPast && !shift.is_finalized && (
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
              {canManage && isPast && !shift.is_finalized && (
                <button
                  onClick={() => setShowFinalizeChecklist(true)}
                  className="px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors inline-flex items-center gap-1.5"
                  aria-label="Finalize shift"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Finalize
                </button>
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
                <button onClick={() => { void handleDelete(); }} disabled={pending.deleting}
                  className="btn-primary flex gap-1 items-center px-3 py-1.5 text-sm"
                >
                  {pending.deleting && <Loader2 className="w-3 h-3 animate-spin" />}
                  Delete Shift
                </button>
              </div>
            </div>
          )}

          {/* Finalize Checklist */}
          {showFinalizeChecklist && (
            <div className="p-4 bg-green-500/5 border border-green-500/20 rounded-lg space-y-3">
              <h4 className="text-sm font-semibold text-theme-text-primary flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" /> Pre-Finalization Checklist
              </h4>

              <div className="space-y-2 text-sm">
                {/* Equipment checks — blocks if incomplete */}
                {hasIncompleteEquipmentChecks ? (
                  <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded-md">
                    <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium text-red-700 dark:text-red-400">End-of-shift equipment checks incomplete</span>
                      <p className="text-xs text-red-600 dark:text-red-300 mt-0.5">
                        {endOfShiftChecks.filter(c => !c.isCompleted).length} end-of-shift checklist(s) still pending. Equipment checks must be completed before finalizing.
                      </p>
                    </div>
                  </div>
                ) : endOfShiftChecks.length > 0 ? (
                  <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded-md">
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    <span className="text-green-700 dark:text-green-400">{completedEquipmentChecks.length} equipment check(s) completed</span>
                  </div>
                ) : null}

                {/* Attendance check-in/out summary */}
                {(() => {
                  const checkedIn = allAttendance.filter(a => a.checked_in_at);
                  const checkedOut = allAttendance.filter(a => a.checked_out_at);
                  const totalAssigned = activeAssignments.length;
                  const allOut = checkedOut.length >= totalAssigned && totalAssigned > 0;
                  return (
                    <div className={`flex items-start gap-2 p-2 rounded-md border ${
                      allOut
                        ? 'bg-green-500/10 border-green-500/20'
                        : checkedIn.length > 0
                        ? 'bg-amber-500/10 border-amber-500/20'
                        : 'bg-theme-surface border-theme-surface-border'
                    }`}>
                      <Users className={`w-4 h-4 mt-0.5 shrink-0 ${allOut ? 'text-green-600' : checkedIn.length > 0 ? 'text-amber-600' : 'text-theme-text-muted'}`} />
                      <div>
                        <span className="text-theme-text-secondary text-sm">
                          {checkedIn.length} of {totalAssigned} checked in
                          {checkedOut.length > 0 && `, ${checkedOut.length} checked out`}
                        </span>
                        {checkedIn.length < totalAssigned && totalAssigned > 0 && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                            {totalAssigned - checkedIn.length} member(s) have not checked in
                          </p>
                        )}
                        {checkedIn.length > checkedOut.length && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                            {checkedIn.length - checkedOut.length} member(s) still on shift
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Call count */}
                {shift.call_count !== undefined && shift.call_count !== null && (
                  <div className="flex items-center gap-2 p-2 bg-theme-surface border border-theme-surface-border rounded-md">
                    <FileText className="w-4 h-4 text-theme-text-muted shrink-0" />
                    <span className="text-theme-text-secondary">{shift.call_count} call(s) recorded</span>
                  </div>
                )}
              </div>

              {hasIncompleteEquipmentChecks && (
                <p className="text-xs text-red-600 dark:text-red-300">
                  Complete all equipment checks before finalizing this shift.
                </p>
              )}

              <div className="flex items-center gap-2 justify-end pt-1">
                <button
                  onClick={() => setShowFinalizeChecklist(false)}
                  className="px-3 py-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void handleFinalize(); }}
                  disabled={pending.finalizing || hasIncompleteEquipmentChecks}
                  className="px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
                >
                  {pending.finalizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Finalize Shift
                </button>
              </div>
            </div>
          )}

          {/* Finalized badge */}
          {shift.is_finalized && (
            <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
              <span className="text-sm font-medium text-green-700 dark:text-green-400">
                Shift finalized{shift.finalized_at ? ` on ${formatDateCustom(new Date(shift.finalized_at), { month: 'short', day: 'numeric', year: 'numeric' }, tz)}` : ''}
              </span>
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
                {memberOptions.length === 0 && pending.loadingMembers && (
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
                <button onClick={() => { void handleSaveEdit(); }} disabled={pending.saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50"
                >
                  {pending.saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
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
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    {openPositions.length} open
                  </span>
                )}
              </div>
              {shift.apparatus_id && (
                <p className="text-[10px] text-theme-text-muted mb-2">
                  Positions from {shift.apparatus_unit_number ?? 'apparatus'}
                  {shift.positions && shift.positions.length > 0 ? ' + shift customizations' : ''}
                </p>
              )}
              <div className="space-y-2">
                {crewBoard?.map(({ position, required, assignment }, i) => (
                  <CrewBoardSlot
                    key={i}
                    position={position}
                    required={required}
                    assignment={assignment}
                    currentUserId={user?.id}
                    canAssign={canAssign}
                    isPast={isPast}
                    isUserAssigned={isUserAssigned}
                    positionOptions={positionOptions}
                    attendanceRecord={assignment ? attendanceByUser.get(assignment.user_id) : undefined}
                    tz={tz}
                    pendingStates={{
                      confirming: pending.confirming,
                      declining: pending.declining,
                      removing: pending.removing,
                      updatingPosition: pending.updatingPosition,
                      signingUp: pending.signingUp,
                    }}
                    onConfirm={(id) => { void handleConfirm(id); }}
                    onDecline={(id) => { void handleDecline(id); }}
                    onRemove={(id) => { void handleRemove(id); }}
                    onPositionChange={(id, newPos, curPos) => { void handlePositionChange(id, newPos, curPos); }}
                    onAssignToPosition={openAssignFormForPosition}
                    onSignup={(pos) => { void handleSignup(pos); }}
                  />
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
                <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
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
          {canAssign && (showAssignForm || showBulkAssign || (hasApparatusPositions && !isPast)) && (
            <>
              {!showAssignForm && !showBulkAssign && hasApparatusPositions && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowAssignForm(true)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Assign Member
                  </button>
                  {openPositions.length > 1 && (
                    <button onClick={openBulkAssign}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors border border-violet-500/20"
                    >
                      <Users className="w-3.5 h-3.5" /> Fill All Open ({openPositions.length})
                    </button>
                  )}
                </div>
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
                    {pending.loadingMembers ? (
                      <div className="flex items-center gap-2 mt-2 text-xs text-theme-text-muted" role="status" aria-live="polite">
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
                    <button onClick={() => { void handleAssign(); }} disabled={pending.assigning || !assignForm.user_id}
                      className="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50"
                    >
                      {pending.assigning ? 'Assigning...' : 'Assign'}
                    </button>
                  </div>
                </div>
              )}
              {/* Bulk Assignment Panel */}
              {showBulkAssign && (
                <div className="p-4 border border-theme-surface-border rounded-lg bg-theme-surface-hover/30 space-y-3">
                  <h4 className="text-sm font-medium text-theme-text-primary flex items-center gap-2">
                    <Users className="w-4 h-4" /> Fill Open Positions
                  </h4>
                  <p className="text-xs text-theme-text-muted">Select a member for each open position.</p>
                  <div className="space-y-2">
                    {openPositions.map(pos => {
                      const label = POSITION_LABELS[pos] ?? pos;
                      return (
                        <div key={pos} className="flex items-center gap-2">
                          <span className="text-xs font-medium text-theme-text-secondary capitalize w-24 shrink-0">{label}</span>
                          <select
                            aria-label={`Member for ${label}`}
                            value={bulkAssignments[pos] ?? ''}
                            onChange={e => setBulkAssignments(prev => ({ ...prev, [pos]: e.target.value }))}
                            className={inputCls + ' text-xs py-1.5'}
                          >
                            <option value="">— skip —</option>
                            {memberOptions.filter(m => !unavailableIds.has(m.id)).map(m => (
                              <option key={m.id} value={m.id}>{m.label}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowBulkAssign(false)} className="px-3 py-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary">Cancel</button>
                    <button onClick={() => { void handleBulkAssign(); }} disabled={pending.bulkAssigning || Object.values(bulkAssignments).every(v => !v)}
                      className="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50"
                    >
                      {pending.bulkAssigning ? 'Assigning...' : `Assign ${Object.values(bulkAssignments).filter(Boolean).length} Members`}
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
                <button onClick={() => { void handleSignup(); }} disabled={pending.signingUp}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {pending.signingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  Sign Up
                </button>
              </div>
            </div>
          )}

          {/* Sign Up confirmation for already-assigned members */}
          {isUserAssigned && (
            <div className="p-3 bg-green-500/5 border border-green-500/20 rounded-lg space-y-2">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                <p className="text-sm text-green-700 dark:text-green-400">You are assigned to this shift</p>
              </div>

              {/* Check-in / Check-out buttons */}
              {!shift.is_finalized && (
                <div className="flex items-center gap-2 pt-1">
                  {!myAttendance?.checked_in_at ? (
                    <button
                      onClick={() => {
                        void (async () => {
                          setCheckingIn(true);
                          try {
                            const result = await schedulingService.checkIn(shift.id);
                            setMyAttendance(result);
                            toast.success('Checked in');
                          } catch {
                            toast.error('Failed to check in');
                          } finally {
                            setCheckingIn(false);
                          }
                        })();
                      }}
                      disabled={checkingIn}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      {checkingIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                      Check In
                    </button>
                  ) : !myAttendance?.checked_out_at ? (
                    <>
                      <span className="text-xs text-green-700 dark:text-green-400">
                        Checked in at {formatTime(myAttendance.checked_in_at, tz)}
                      </span>
                      <button
                        onClick={() => {
                          void (async () => {
                            setCheckingOut(true);
                            try {
                              const result = await schedulingService.checkOut(shift.id);
                              setMyAttendance(result);
                              toast.success(`Checked out (${Math.round((result.duration_minutes ?? 0) / 60 * 10) / 10} hrs)`);
                            } catch {
                              toast.error('Failed to check out');
                            } finally {
                              setCheckingOut(false);
                            }
                          })();
                        }}
                        disabled={checkingOut}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        {checkingOut ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                        Check Out
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-theme-text-muted">
                      {Math.round((myAttendance.duration_minutes ?? 0) / 60 * 10) / 10} hrs recorded
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* QR Code for apparatus check-in (officers) */}
          {canAssign && shift.apparatus_id && (
            <div>
              <button
                onClick={() => setShowQR(!showQR)}
                className="inline-flex items-center gap-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors"
              >
                <QrCode className="w-3.5 h-3.5" />
                {showQR ? 'Hide' : 'Show'} Check-In QR Code
              </button>
              {showQR && (
                <div className="mt-2 p-4 bg-white rounded-lg border border-theme-surface-border inline-block">
                  <QRCodeSVG
                    value={`${window.location.origin}/scheduling/checkin?apparatus=${shift.apparatus_id}`}
                    size={160}
                    level="M"
                  />
                  <p className="text-xs text-center text-gray-500 mt-2">
                    {shift.apparatus_name || shift.apparatus_unit_number || 'Apparatus'} &mdash; permanent code
                  </p>
                  <button
                    onClick={() => {
                      window.open(
                        `/scheduling/checkin/print?apparatus=${shift.apparatus_id}&name=${encodeURIComponent(shift.apparatus_name || shift.apparatus_unit_number || 'Apparatus')}`,
                        '_blank',
                      );
                    }}
                    className="mt-2 w-full text-xs text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    Print QR Card
                  </button>
                </div>
              )}
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

          {/* Quick Actions — checklists and shift report */}
          {(() => {
            const shiftEnded = shift.end_time && new Date(shift.end_time).getTime() <= Date.now();
            const isOfficer = user?.id === shift.shift_officer_id;
            const showReportBtn = shiftEnded && (isOfficer || canManage);
            const showChecklistLink = equipmentCheckSummaries.some(s => !s.isCompleted);

            if (!showReportBtn && !showChecklistLink) return null;

            return (
              <div className="flex flex-wrap gap-2">
                {showChecklistLink && (
                  <button
                    onClick={() => {
                      onClose();
                      navigate(`/scheduling?tab=equipment-checks&shift=${shift.id}`);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-700 dark:text-violet-400 hover:bg-violet-500/20 transition-colors"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" />
                    Complete Checklists
                  </button>
                )}
                {showReportBtn && (
                  <button
                    onClick={() => {
                      onClose();
                      navigate(`/scheduling?tab=shift-reports&shift=${shift.id}`);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    File Shift Report
                  </button>
                )}
              </div>
            );
          })()}

          {/* Equipment Checks */}
          {equipmentCheckSummaries.length > 0 && (
            <div>
              <button onClick={() => setShowEquipmentChecks(!showEquipmentChecks)}
                className="flex items-center justify-between w-full text-left py-2"
              >
                <h3 className="text-base font-semibold text-theme-text-primary flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4" /> Equipment Checks
                  {/* Inline status summary — always visible */}
                  {(() => {
                    const passed = equipmentCheckSummaries.filter(s => s.isCompleted && s.overallStatus === 'pass').length;
                    const failed = equipmentCheckSummaries.filter(s => s.isCompleted && s.overallStatus !== 'pass').length;
                    const inProgress = equipmentCheckSummaries.filter(s => !s.isCompleted && s.completedItems > 0).length;
                    const notStarted = equipmentCheckSummaries.filter(s => !s.isCompleted && s.completedItems === 0).length;
                    return (
                      <span className="flex items-center gap-1.5 ml-1">
                        {passed > 0 && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">{passed} pass</span>}
                        {failed > 0 && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">{failed} fail</span>}
                        {inProgress > 0 && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">{inProgress} in progress</span>}
                        {notStarted > 0 && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-theme-surface-secondary text-theme-text-muted">{notStarted} pending</span>}
                      </span>
                    );
                  })()}
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
                            {!summary.isCompleted && (
                              <p className="text-xs text-violet-600 dark:text-violet-400 mt-1.5 font-medium">
                                {summary.completedItems > 0
                                  ? `Continue check \u2192 ${summary.totalItems - summary.completedItems} items remaining`
                                  : 'Start check \u2192 Go to Checklists tab'}
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
