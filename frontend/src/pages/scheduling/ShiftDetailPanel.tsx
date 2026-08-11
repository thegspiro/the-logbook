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

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import {
  X,
  Users,
  Clock,
  MapPin,
  Truck,
  UserPlus,
  Check,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Pencil,
  Trash2,
  Save,
  Palette,
  FileText,
  ClipboardCheck,
  CheckCircle2,
  AlertTriangle,
  LogIn,
  LogOut,
  QrCode,
  UserMinus,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import { trainingProgramService } from '../../services/trainingServices';
import type { ShiftRecord, PlatoonRosterEntry } from '../../modules/scheduling/services/api';
import { useSchedulingStore } from '../../modules/scheduling/store/schedulingStore';
import type { Assignment } from '../../types/scheduling';
import type { ShiftCheckSummary } from '../../modules/scheduling/types/equipmentCheck';
import { useAuthStore } from '../../stores/authStore';
import { useTimezone } from '../../hooks/useTimezone';
import { formatTime, getTodayLocalDate, formatDateCustom, localToUTC } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { POSITION_LABELS, ASSIGNMENT_STATUS_COLORS, AssignmentStatus } from '../../constants/enums';
import { PositionListEditor } from '../../modules/scheduling/components/PositionListEditor';
import { BUILTIN_POSITIONS } from '../../modules/scheduling/types/shiftSettings';
import TimeQuarterHour from '../../components/ux/TimeQuarterHour';
import { AssignmentActions } from './AssignmentActions';
import { PositionEditor } from './PositionEditor';
import { CrewBoardSlot } from './CrewBoardSlot';
import { ShiftCallsSection } from './ShiftCallsSection';

interface ShiftDetailPanelProps {
  shift: ShiftRecord;
  onClose: () => void;
  onRefresh?: () => void;
}

export const ShiftDetailPanel: React.FC<ShiftDetailPanelProps> = ({ shift: initialShift, onClose, onRefresh }) => {
  const navigate = useNavigate();
  const { user, checkPermission } = useAuthStore();
  const tz = useTimezone();
  const canManage = checkPermission('scheduling.manage');
  const {
    apparatus: apparatusList,
    loadApparatus,
    members: memberOptions,
    loadMembers,
    platoonsEnabled,
    requireEndOfShiftChecks,
    loadSettings,
  } = useSchedulingStore();
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const [shift, setShift] = useState(initialShift);
  // The named on-duty officer of this shift may manage its crew, attendance,
  // calls, and closeout even without a department-wide scheduling grant
  // (mirrors the backend's per-shift authority). Editing/deleting the shift
  // record itself still requires scheduling.manage.
  const isShiftOfficer = !!(shift.shift_officer_id && user?.id && String(shift.shift_officer_id) === String(user.id));
  const canAssign = checkPermission('scheduling.assign') || canManage || isShiftOfficer;
  const canManageShift = canManage || isShiftOfficer;
  const isCancelled = shift.status === 'cancelled';
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEquipmentChecks, setShowEquipmentChecks] = useState(false);
  const assignFormRef = useRef<HTMLDivElement>(null);
  const [equipmentCheckSummaries, setEquipmentCheckSummaries] = useState<ShiftCheckSummary[]>([]);
  const [platoonRoster, setPlatoonRoster] = useState<PlatoonRosterEntry[]>([]);

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
      const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
      const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
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
    min_staffing: shift.min_staffing != null ? String(shift.min_staffing) : '',
  });
  // Async operation flags — grouped to reduce useState count
  const [pending, setPending] = useState({
    saving: false,
    deleting: false,
    finalizing: false,
    signingUp: false,
    withdrawing: false,
    confirming: false,
    declining: false,
    removing: false,
    updatingPosition: false,
    savingNotes: false,
    assigning: false,
    loadingMembers: false,
    bulkAssigning: false,
    assigningRoster: false,
  });
  const setPendingFlag = useCallback(
    (key: keyof typeof pending, value: boolean) => setPending((prev) => ({ ...prev, [key]: value })),
    []
  );

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

  // Manual hours for members without attendance (used during finalization)
  const [manualHours, setManualHours] = useState<Record<string, string>>({});

  // Close-out state — pass-down handoff and the incomplete-checks override.
  const [passDownNotes, setPassDownNotes] = useState('');
  const [overrideChecks, setOverrideChecks] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [handoff, setHandoff] = useState<{ shift_date: string | null; pass_down_notes: string } | null>(null);
  const [showReopenConfirm, setShowReopenConfirm] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

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
  const [assignForm, setAssignForm] = useState({
    user_id: '',
    position: '',
    is_training: false,
    training_program_id: '',
    training_evaluator_id: '',
  });
  const [memberSearch, setMemberSearch] = useState('');
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(new Set());

  // Cancel-shift state
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // Training programs for the training-slot dropdown (loaded lazily when the
  // assign form is opened with the training option in view).
  const [trainingPrograms, setTrainingPrograms] = useState<{ id: string; name: string }[]>([]);

  // Bulk assignment state — maps position name to selected user_id
  const [bulkAssignments, setBulkAssignments] = useState<Record<string, string>>({});

  const apparatusPositions = useMemo(() => shift.apparatus_positions ?? [], [shift.apparatus_positions]);
  const hasApparatusPositions = apparatusPositions.length > 0;

  // Determine available position options based on apparatus
  const positionOptions: [string, string][] = useMemo(
    () =>
      hasApparatusPositions
        ? apparatusPositions.map((p) => {
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
        const [assignData, checkData, attendanceData, allAttData, detail, handoffData] = await Promise.all([
          schedulingService.getShiftAssignments(shift.id),
          schedulingService.getShiftChecklists(shift.id).catch(() => [] as ShiftCheckSummary[]),
          schedulingService.getMyAttendance(shift.id),
          schedulingService.getShiftAttendance(shift.id).catch(() => []),
          schedulingService.getShift(shift.id).catch(() => null),
          schedulingService.getShiftHandoff(shift.id).catch(() => null),
        ]);
        if (!cancelled) {
          setAssignments(assignData);
          setEquipmentCheckSummaries(checkData);
          setMyAttendance(attendanceData);
          setAllAttendance(allAttData);
          setPlatoonRoster(detail?.platoon_roster ?? []);
          setHandoff(handoffData);
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
    return () => {
      cancelled = true;
    };
  }, [shift.id]);

  // Load members for the assign dropdown and shift officer edit. The member
  // roster comes from the shared store cache (loadMembers is idempotent), so
  // opening the form on multiple shifts doesn't re-download the user list.
  // Only the shift-scoped unavailable set is fetched here.
  useEffect(() => {
    if (!showAssignForm && !isEditing) return;
    void loadMembers();
    if (!showAssignForm) return;
    const loadUnavailable = async () => {
      setPendingFlag('loadingMembers', true);
      try {
        const unavailable = await schedulingService.getUnavailableMembers(shift.id);
        setUnavailableIds(new Set(unavailable));
      } catch {
        // Non-critical — fallback to manual ID entry
      } finally {
        setPendingFlag('loadingMembers', false);
      }
    };
    void loadUnavailable();
  }, [showAssignForm, isEditing, shift.id, setPendingFlag, loadMembers]);

  // Load apparatus list when editing
  useEffect(() => {
    if (isEditing) void loadApparatus();
  }, [isEditing, loadApparatus]);

  // Load active training programs once, when the assign form is first opened,
  // for the training-slot program dropdown.
  useEffect(() => {
    if (!showAssignForm || trainingPrograms.length > 0) return;
    const loadPrograms = async () => {
      try {
        const programs = await trainingProgramService.getPrograms();
        setTrainingPrograms(
          programs.filter((p) => p.active && !p.is_template).map((p) => ({ id: p.id, name: p.name }))
        );
      } catch {
        // Non-critical — training-slot program link is optional.
      }
    };
    void loadPrograms();
  }, [showAssignForm, trainingPrograms.length]);

  const filteredMembers = useMemo(() => {
    const available = memberOptions.filter((m) => !unavailableIds.has(m.id));
    if (!memberSearch) return available;
    const q = memberSearch.toLowerCase();
    return available.filter((m) => m.label.toLowerCase().includes(q));
  }, [memberSearch, memberOptions, unavailableIds]);

  const refreshAssignments = async () => {
    const [assignData, shiftData, unavailable] = await Promise.all([
      schedulingService.getShiftAssignments(shift.id),
      schedulingService.getShift(shift.id),
      schedulingService.getUnavailableMembers(shift.id),
    ]);
    setAssignments(assignData);
    setShift(shiftData);
    setPlatoonRoster(shiftData.platoon_roster ?? []);
    setUnavailableIds(new Set(unavailable));
  };

  // One-click fill-in / hold-over: assign an available platoon member to the
  // shift straight from the roster. Position defaults to firefighter and can
  // be adjusted afterward in the crew board.
  // Surface soft (non-blocking) warnings returned when creating an assignment
  // — EVOC driver eligibility and overtime/hours limits.
  const surfaceAssignmentWarnings = (res: { evoc_warnings?: { message: string }[]; overtime_warnings?: string[] }) => {
    const messages = [...(res.evoc_warnings ?? []).map((w) => w.message), ...(res.overtime_warnings ?? [])];
    if (messages.length > 0) toast(messages.join(' '), { icon: '⚠️' });
  };

  const handleAssignFromRoster = async (userId: string) => {
    setPendingFlag('assigningRoster', true);
    try {
      const res = await schedulingService.createAssignment(shift.id, {
        user_id: userId,
        position: 'firefighter',
      });
      toast.success('Member assigned to shift');
      surfaceAssignmentWarnings(res);
      await refreshAssignments();
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to assign member'));
    } finally {
      setPendingFlag('assigningRoster', false);
    }
  };

  const handleSignup = async (position?: string) => {
    const pos = position || signupPosition;
    setPendingFlag('signingUp', true);
    try {
      const res = await schedulingService.signupForShift(shift.id, { position: pos });
      toast.success('Signed up for shift');
      surfaceAssignmentWarnings(res);
      await refreshAssignments();
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to sign up for shift'));
    } finally {
      setPendingFlag('signingUp', false);
    }
  };

  const handleWithdraw = async () => {
    if (pending.withdrawing) return;
    setPendingFlag('withdrawing', true);
    try {
      await schedulingService.withdrawSignup(shift.id);
      toast.success('Withdrawn from shift');
      await refreshAssignments();
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to withdraw from shift'));
    } finally {
      setPendingFlag('withdrawing', false);
    }
  };

  const handleConfirm = async (assignmentId: string) => {
    if (pending.confirming) return;
    setPendingFlag('confirming', true);
    // Optimistic update — show confirmed immediately
    setAssignments((prev) =>
      prev.map((a) => (a.id === assignmentId ? { ...a, status: AssignmentStatus.CONFIRMED } : a))
    );
    try {
      await schedulingService.confirmAssignment(assignmentId);
      toast.success('Assignment confirmed');
      await refreshAssignments();
    } catch (err) {
      // Revert optimistic update
      setAssignments((prev) =>
        prev.map((a) => (a.id === assignmentId ? { ...a, status: AssignmentStatus.ASSIGNED } : a))
      );
      toast.error(getErrorMessage(err, 'Failed to confirm assignment'));
    } finally {
      setPendingFlag('confirming', false);
    }
  };

  const handleDecline = async (assignmentId: string) => {
    if (pending.declining) return;
    setPendingFlag('declining', true);
    // Optimistic update — show declined immediately
    setAssignments((prev) =>
      prev.map((a) => (a.id === assignmentId ? { ...a, status: AssignmentStatus.DECLINED } : a))
    );
    try {
      await schedulingService.updateAssignment(assignmentId, { assignment_status: 'declined' });
      toast.success('Assignment declined');
      await refreshAssignments();
    } catch (err) {
      // Revert optimistic update
      setAssignments((prev) =>
        prev.map((a) => (a.id === assignmentId ? { ...a, status: AssignmentStatus.ASSIGNED } : a))
      );
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
    setAssignForm({ user_id: '', position, is_training: false, training_program_id: '', training_evaluator_id: '' });
    setMemberSearch('');
    setShowBulkAssign(false);
    setShowAssignForm(true);
    window.setTimeout(() => assignFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const openBulkAssign = () => {
    setBulkAssignments({});
    setShowAssignForm(false);
    setShowBulkAssign(true);
  };

  const handleBulkAssign = async () => {
    const entries = Object.entries(bulkAssignments).filter((pair): pair is [string, string] => Boolean(pair[1]));
    if (entries.length === 0) {
      toast.error('Select at least one member');
      return;
    }
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
    if (!assignForm.user_id) {
      toast.error('Select a member');
      return;
    }
    setPendingFlag('assigning', true);
    try {
      const res = await schedulingService.createAssignment(shift.id, {
        user_id: assignForm.user_id,
        position: assignForm.position,
        is_training: assignForm.is_training,
        training_program_id: assignForm.is_training ? assignForm.training_program_id || undefined : undefined,
        training_evaluator_id: assignForm.is_training ? assignForm.training_evaluator_id || undefined : undefined,
      });
      toast.success('Member assigned');
      surfaceAssignmentWarnings(res);
      setShowAssignForm(false);
      setAssignForm({
        user_id: '',
        position: openPositions[0] ?? positionOptions[0]?.[0] ?? 'firefighter',
        is_training: false,
        training_program_id: '',
        training_evaluator_id: '',
      });
      setMemberSearch('');
      await refreshAssignments();
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to assign member'));
    } finally {
      setPendingFlag('assigning', false);
    }
  };

  // Cancel (not delete) the shift — preserves history and notifies crew.
  const handleCancel = async () => {
    setPendingFlag('deleting', true);
    try {
      const updated = await schedulingService.cancelShift(shift.id, cancelReason.trim() || undefined);
      setShift(updated);
      setShowCancelConfirm(false);
      setCancelReason('');
      toast.success('Shift cancelled');
      await refreshAssignments();
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to cancel shift'));
    } finally {
      setPendingFlag('deleting', false);
    }
  };

  // Edit shift
  const handleSaveEdit = async () => {
    setPendingFlag('saving', true);
    try {
      const trimmedStaffing = editForm.min_staffing.trim();
      const payload: Record<string, unknown> = {
        shift_date: editForm.shift_date,
        notes: editForm.notes || null,
        shift_officer_id: editForm.shift_officer_id || null,
        apparatus_id: editForm.apparatus_id || null,
        color: editForm.color || null,
        positions: editForm.positions.length > 0 ? editForm.positions : null,
        min_staffing: trimmedStaffing ? Number(trimmedStaffing) : null,
      };
      if (editForm.start_time) {
        payload.start_time = localToUTC(`${editForm.shift_date}T${editForm.start_time}`, tz);
      }
      if (editForm.end_time) {
        let end = localToUTC(`${editForm.shift_date}T${editForm.end_time}`, tz);
        // Overnight guard: roll the end to the next day when it falls on/before
        // the start (e.g. 19:00 → 07:00), so the backend accepts it.
        if (payload.start_time && new Date(end) <= new Date(payload.start_time as string)) {
          const rolled = new Date(end);
          rolled.setUTCDate(rolled.getUTCDate() + 1);
          end = rolled.toISOString();
        }
        payload.end_time = end;
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
      const entries = Object.entries(manualHours)
        .map(([uid, val]) => ({ user_id: uid, hours: parseFloat(val) }))
        .filter((e) => e.hours > 0 && !isNaN(e.hours));
      const opts: { override_incomplete_checks?: boolean; override_reason?: string; pass_down_notes?: string } = {};
      if (overrideChecks) {
        opts.override_incomplete_checks = true;
        if (overrideReason.trim()) opts.override_reason = overrideReason.trim();
      }
      if (passDownNotes.trim()) opts.pass_down_notes = passDownNotes.trim();
      const updated = await schedulingService.finalizeShift(shift.id, entries.length > 0 ? entries : undefined, opts);
      setShift(updated);
      setManualHours({});
      setPassDownNotes('');
      setOverrideChecks(false);
      setOverrideReason('');
      toast.success('Shift finalized');
      setShowFinalizeChecklist(false);
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to finalize shift'));
    } finally {
      setPendingFlag('finalizing', false);
    }
  };

  const handleReopen = async () => {
    setPendingFlag('finalizing', true);
    try {
      const updated = await schedulingService.reopenShift(shift.id, reopenReason.trim() || undefined);
      setShift(updated);
      setShowReopenConfirm(false);
      setReopenReason('');
      toast.success('Shift reopened');
      onRefresh?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to reopen shift'));
    } finally {
      setPendingFlag('finalizing', false);
    }
  };

  // Pre-finalization checklist data — only end-of-shift checks gate finalization
  const endOfShiftChecks = useMemo(() => {
    return equipmentCheckSummaries.filter((c) => c.checkTiming === 'end_of_shift');
  }, [equipmentCheckSummaries]);

  const hasIncompleteEquipmentChecks = useMemo(() => {
    return endOfShiftChecks.some((c) => !c.isCompleted);
  }, [endOfShiftChecks]);

  const completedEquipmentChecks = useMemo(() => {
    return endOfShiftChecks.filter((c) => c.isCompleted);
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
    () => assignments.filter((a) => activeStatuses.has(a.status || 'assigned')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignments]
  );
  const inactiveAssignments = useMemo(
    () => assignments.filter((a) => !activeStatuses.has(a.status || 'assigned')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignments]
  );

  const isUserAssigned = activeAssignments.some((a) => a.user_id === user?.id);

  const attendanceByUser = useMemo(() => {
    const map = new Map<string, (typeof allAttendance)[0]>();
    for (const att of allAttendance) {
      map.set(att.user_id, att);
    }
    return map;
  }, [allAttendance]);

  // Build crew board data: for each apparatus position, find the assignment(s) filling it
  const crewBoard = useMemo(() => {
    if (!hasApparatusPositions) return null;
    const usedIds = new Set<string>();
    return apparatusPositions.map((slot) => {
      const posName = typeof slot === 'string' ? slot : slot.position;
      const isRequired = typeof slot === 'string' ? true : slot.required;
      const filled = activeAssignments.find(
        (a) => a.position.toLowerCase() === posName.toLowerCase() && !usedIds.has(a.id)
      );
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
      const match = activeAssignments.find(
        (a) => a.position.toLowerCase() === posName.toLowerCase() && !boardFilledIds.has(a.id)
      );
      if (match) boardFilledIds.add(match.id);
    }
    return activeAssignments.filter((a) => !boardFilledIds.has(a.id));
  }, [hasApparatusPositions, apparatusPositions, activeAssignments]);

  const openPositions = useMemo(
    () => crewBoard?.filter((s) => !s.assignment).map((s) => s.position) || [],
    [crewBoard]
  );

  // Default the assign form to the first open position
  useEffect(() => {
    if (positionOptions.length > 0 && !assignForm.position) {
      const firstOpen = openPositions[0];
      const fallback = positionOptions[0];
      const defaultPos = firstOpen ?? fallback?.[0];
      if (defaultPos) setAssignForm((f) => ({ ...f, position: defaultPos }));
    }
  }, [positionOptions, assignForm.position, openPositions]);

  const inputCls =
    'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-violet-500';

  const renderAssignmentRow = (assignment: Assignment) => {
    const isCurrentUser = assignment.user_id === user?.id;
    return (
      <div
        key={assignment.id}
        className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 sm:p-3 ${isCurrentUser ? 'border-violet-500/30 bg-violet-500/5' : 'border-theme-surface-border bg-theme-surface-hover/30'}`}
      >
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="bg-theme-surface-hover text-theme-text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium">
            {(assignment.user_name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-theme-text-primary truncate text-sm font-medium">
              {assignment.user_name || 'Unknown'}{' '}
              {isCurrentUser && <span className="text-xs text-violet-500">(You)</span>}
            </p>
            <PositionEditor
              assignmentId={assignment.id}
              currentPosition={assignment.position}
              positionOptions={positionOptions}
              onSave={(id, newPos, curPos) => {
                void handlePositionChange(id, newPos, curPos);
              }}
              editable={canAssign && !isPast}
              updatingPosition={pending.updatingPosition}
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
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1 sm:gap-2">
          <AssignmentActions
            assignmentId={assignment.id}
            effectiveStatus={assignment.status || 'assigned'}
            isCurrentUser={isCurrentUser || false}
            canAssign={canAssign}
            onConfirm={(id) => {
              void handleConfirm(id);
            }}
            onDecline={(id) => {
              void handleDecline(id);
            }}
            onRemove={(id) => {
              void handleRemove(id);
            }}
            pendingConfirming={pending.confirming}
            pendingDeclining={pending.declining}
            pendingRemoving={pending.removing}
          />
          {canAssign && !isPast && editingNotesId !== assignment.id && (
            <button
              onClick={() => {
                setEditingNotesId(assignment.id);
                setEditingNotesValue(assignment.notes || '');
              }}
              className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-1.5 transition-colors ${assignment.notes ? 'text-violet-500 hover:bg-violet-500/10' : 'text-theme-text-muted hover:bg-violet-500/10 hover:text-violet-500'}`}
              aria-label="Edit notes"
              title={assignment.notes ? 'Edit notes' : 'Add notes'}
            >
              <FileText className="h-4 w-4" />
            </button>
          )}
        </div>
        {/* Assignment notes display */}
        {assignment.notes && editingNotesId !== assignment.id && (
          <p className="text-theme-text-muted mt-1.5 pl-11 text-xs">{assignment.notes}</p>
        )}
        {/* Inline notes editor */}
        {editingNotesId === assignment.id && (
          <div className="mt-2 flex items-center gap-2 pl-11">
            <input
              type="text"
              value={editingNotesValue}
              onChange={(e) => setEditingNotesValue(e.target.value)}
              placeholder="Assignment notes..."
              className="form-input-sm flex-1 text-xs"
              autoFocus
              aria-label="Assignment notes"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveAssignmentNotes(assignment.id);
                else if (e.key === 'Escape') setEditingNotesId(null);
              }}
            />
            <button
              onClick={() => {
                void handleSaveAssignmentNotes(assignment.id);
              }}
              disabled={pending.savingNotes}
              className="rounded-sm bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {pending.savingNotes ? '...' : 'Save'}
            </button>
            <button
              onClick={() => setEditingNotesId(null)}
              className="text-theme-text-muted hover:text-theme-text-primary px-2 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden="true" />

      {/* Panel — uses drawer-panel CSS class for mobile-responsive width */}
      <div className="drawer-panel overflow-y-auto overscroll-contain">
        {/* Header */}
        <div className="bg-theme-surface-modal border-theme-surface-border sticky top-0 z-10 border-b p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="min-w-0 pr-2">
              <h2 className="text-theme-text-primary text-lg font-bold sm:text-xl">Shift Details</h2>
              <p className="text-theme-text-secondary mt-1 truncate text-xs sm:text-sm">
                {formatDateCustom(shiftDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, tz)}
              </p>
              {platoonsEnabled && shift.platoon && (
                <span className="mt-1.5 inline-block rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                  Platoon {shift.platoon}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canManage && !isPast && !shift.is_finalized && !isCancelled && (
                <>
                  <button
                    onClick={() => {
                      setEditForm({
                        shift_date: shift.shift_date,
                        start_time: toTimeValue(shift.start_time),
                        end_time: toTimeValue(shift.end_time),
                        apparatus_id: shift.apparatus_id || '',
                        color: shift.color || '',
                        notes: shift.notes || '',
                        shift_officer_id: shift.shift_officer_id || '',
                        positions: shift.positions ?? [],
                        min_staffing: shift.min_staffing != null ? String(shift.min_staffing) : '',
                      });
                      setIsEditing(!isEditing);
                    }}
                    className="text-theme-text-muted flex min-h-[44px] items-center justify-center gap-1 rounded-lg px-2 text-xs transition-colors hover:bg-violet-500/10 hover:text-violet-500"
                    aria-label="Edit shift"
                  >
                    <Pencil className="h-4 w-4" />
                    <span>Edit</span>
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="text-theme-text-muted flex min-h-[44px] items-center justify-center gap-1 rounded-lg px-2 text-xs transition-colors hover:bg-red-500/10 hover:text-red-500"
                    aria-label="Delete shift"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Delete</span>
                  </button>
                </>
              )}
              {canManageShift && !isPast && !shift.is_finalized && !isCancelled && (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  className="text-theme-text-muted flex min-h-[44px] items-center justify-center gap-1 rounded-lg px-2 text-xs transition-colors hover:bg-amber-500/10 hover:text-amber-500"
                  aria-label="Cancel shift"
                >
                  <XCircle className="h-4 w-4" />
                  <span>Cancel</span>
                </button>
              )}
              {/* Hidden while the checklist is open: this button and the one at
                  the foot of that panel both finalise the shift, and showing
                  both at once read as two different commitments. */}
              {canManageShift && isPast && !shift.is_finalized && !isCancelled && !showFinalizeChecklist && (
                <button
                  onClick={() => setShowFinalizeChecklist(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700"
                  aria-label="Close out shift"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Close out shift
                </button>
              )}
              <button
                onClick={onClose}
                className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 transition-colors"
                aria-label="Close panel"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-4 sm:space-y-6 sm:p-6">
          {/* Handoff from the previous crew on this apparatus */}
          {handoff?.pass_down_notes && (
            <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2">
              <p className="mb-0.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
                Handoff from previous shift
                {handoff.shift_date
                  ? ` · ${formatDateCustom(new Date(`${handoff.shift_date}T12:00:00`), { month: 'short', day: 'numeric', year: 'numeric' }, tz)}`
                  : ''}
                {handoff.shift_date
                  ? ` · ${Math.max(0, Math.floor((shiftDate.getTime() - new Date(`${handoff.shift_date}T12:00:00`).getTime()) / 86400000))} days earlier`
                  : ''}
              </p>
              <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{handoff.pass_down_notes}</p>
            </div>
          )}

          {/* Readiness — present vs assigned, staffing, outstanding start checks */}
          {!shift.is_finalized &&
            !isCancelled &&
            !(!isPast && shift.shift_date > getTodayLocalDate(tz)) &&
            activeAssignments.length > 0 &&
            (() => {
              const checkedInIds = new Set(allAttendance.filter((a) => a.checked_in_at).map((a) => a.user_id));
              const presentCount = activeAssignments.filter((a) => checkedInIds.has(a.user_id)).length;
              const target = hasApparatusPositions ? apparatusPositions.length : (shift.min_staffing ?? 0);
              const understaffed = target > 0 && activeAssignments.length < target;
              const outstandingStartChecks = equipmentCheckSummaries.filter(
                (c) => c.checkTiming === 'start_of_shift' && !c.isCompleted
              ).length;
              return (
                <div className="bg-theme-surface border-theme-surface-border flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs">
                  <span className="text-theme-text-secondary font-semibold">Readiness</span>
                  <span className="text-theme-text-primary">
                    {presentCount}/{activeAssignments.length} checked in
                  </span>
                  {target > 0 && (
                    <span
                      className={
                        understaffed ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-theme-text-muted'
                      }
                    >
                      {activeAssignments.length}/{target} staffed{understaffed ? ' — understaffed' : ''}
                    </span>
                  )}
                  {outstandingStartChecks > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {outstandingStartChecks} start-of-shift check{outstandingStartChecks > 1 ? 's' : ''} pending
                    </span>
                  )}
                </div>
              );
            })()}

          {/* Delete Confirmation */}
          {showDeleteConfirm && (
            <div className="space-y-3 rounded-lg border border-red-500/20 bg-red-500/10 p-4">
              <p className="text-sm text-red-700 dark:text-red-300">
                Are you sure you want to delete this shift? This will remove all assignments and cannot be undone.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleDelete();
                  }}
                  disabled={pending.deleting}
                  className="btn-primary flex items-center gap-1 px-3 py-1.5 text-sm"
                >
                  {pending.deleting && <Loader2 className="h-3 w-3 animate-spin" />}
                  Delete Shift
                </button>
              </div>
            </div>
          )}

          {/* Cancel Confirmation */}
          {showCancelConfirm && (
            <div className="space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Cancel this shift? The record is kept, all assignments are marked cancelled, and the assigned crew is
                notified.
              </p>
              <div>
                <label htmlFor="cancel-reason" className="text-theme-text-secondary mb-1 block text-xs font-medium">
                  Reason (optional)
                </label>
                <input
                  id="cancel-reason"
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. station closed for weather"
                  className={inputCls}
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setShowCancelConfirm(false);
                    setCancelReason('');
                  }}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-sm"
                >
                  Keep Shift
                </button>
                <button
                  onClick={() => {
                    void handleCancel();
                  }}
                  disabled={pending.deleting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {pending.deleting && <Loader2 className="h-3 w-3 animate-spin" />}
                  Cancel Shift
                </button>
              </div>
            </div>
          )}

          {/* Cancelled banner */}
          {isCancelled && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="text-sm">
                <span className="font-medium text-amber-700 dark:text-amber-300">This shift is cancelled.</span>
                {shift.cancellation_reason && (
                  <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">{shift.cancellation_reason}</p>
                )}
              </div>
            </div>
          )}

          {/* Finalize Checklist */}
          {showFinalizeChecklist && (
            <div className="space-y-3 rounded-lg border border-green-500/20 bg-green-500/5 p-4">
              <h4 className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="h-4 w-4 text-green-600" /> Before you close this shift
              </h4>

              <div className="space-y-2 text-sm">
                {/* Equipment checks — blocks if incomplete */}
                {hasIncompleteEquipmentChecks ? (
                  <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 p-2">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div>
                      <span className="font-medium text-red-700 dark:text-red-400">
                        Must fix before close-out: end-of-shift equipment checks incomplete
                      </span>
                      <p className="mt-0.5 text-xs text-red-600 dark:text-red-300">
                        {endOfShiftChecks.filter((c) => !c.isCompleted).length} end-of-shift checklist
                        {endOfShiftChecks.filter((c) => !c.isCompleted).length !== 1 ? 's' : ''} still pending. These
                        must be completed before you can close the shift.
                      </p>
                    </div>
                  </div>
                ) : endOfShiftChecks.length > 0 ? (
                  <div className="flex items-center gap-2 rounded-md border border-green-500/20 bg-green-500/10 p-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                    <span className="text-green-700 dark:text-green-400">
                      {completedEquipmentChecks.length} equipment check
                      {completedEquipmentChecks.length !== 1 ? 's' : ''} completed
                    </span>
                  </div>
                ) : null}

                {/* Attendance check-in/out summary */}
                {(() => {
                  const checkedIn = allAttendance.filter((a) => a.checked_in_at);
                  const checkedOut = allAttendance.filter((a) => a.checked_out_at);
                  const totalAssigned = activeAssignments.length;
                  const allOut = checkedOut.length >= totalAssigned && totalAssigned > 0;
                  return (
                    <div
                      className={`flex items-start gap-2 rounded-md border p-2 ${
                        allOut
                          ? 'border-green-500/20 bg-green-500/10'
                          : checkedIn.length > 0
                            ? 'border-amber-500/20 bg-amber-500/10'
                            : 'bg-theme-surface border-theme-surface-border'
                      }`}
                    >
                      <Users
                        className={`mt-0.5 h-4 w-4 shrink-0 ${allOut ? 'text-green-600' : checkedIn.length > 0 ? 'text-amber-600' : 'text-theme-text-muted'}`}
                      />
                      <div>
                        {/* "N of M" only reads as sense while N <= M. Somebody
                            can check in to a shift they were never assigned to —
                            covering at short notice, which is normal — and the
                            officer then read "4 of 3 checked in". */}
                        <span className="text-theme-text-secondary text-sm">
                          {checkedIn.length > totalAssigned
                            ? `${checkedIn.length} checked in (${totalAssigned} assigned)`
                            : `${checkedIn.length} of ${totalAssigned} checked in`}
                          {checkedOut.length > 0 && `, ${checkedOut.length} checked out`}
                        </span>
                        {checkedIn.length < totalAssigned && totalAssigned > 0 && (
                          <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                            {totalAssigned - checkedIn.length} member
                            {totalAssigned - checkedIn.length !== 1 ? 's' : ''} never checked in
                          </p>
                        )}
                        {checkedIn.length > checkedOut.length && (
                          <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                            {checkedIn.length - checkedOut.length} member
                            {checkedIn.length - checkedOut.length !== 1 ? 's' : ''} still on shift &mdash; will be
                            checked out automatically at the shift end time
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Manual hours for unattended members */}
                {(() => {
                  const attendedIds = new Set(allAttendance.map((a) => a.user_id));
                  const unattended = activeAssignments.filter((a) => !attendedIds.has(a.user_id));
                  if (unattended.length === 0) return null;
                  return (
                    <div className="space-y-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-2">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        Add hours for members who didn&apos;t check in
                      </p>
                      <div className="space-y-1.5">
                        {unattended.map((a) => (
                          <div key={a.user_id} className="flex items-center gap-2">
                            <span className="text-theme-text-secondary flex-1 truncate text-sm">
                              {a.user_name || 'Unknown'}
                            </span>
                            <input
                              type="number"
                              min="0"
                              max="48"
                              step="0.5"
                              placeholder="hrs"
                              value={manualHours[a.user_id] ?? ''}
                              onChange={(e) =>
                                setManualHours((prev) => ({
                                  ...prev,
                                  [a.user_id]: e.target.value,
                                }))
                              }
                              className="border-theme-surface-border bg-theme-surface text-theme-text-primary w-20 rounded-md border px-2 py-1 text-right text-sm"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Call count */}
                {shift.call_count !== undefined && shift.call_count !== null && (
                  <div className="bg-theme-surface border-theme-surface-border flex items-center gap-2 rounded-md border p-2">
                    <FileText className="text-theme-text-muted h-4 w-4 shrink-0" />
                    <span className="text-theme-text-secondary">
                      {shift.call_count} call{shift.call_count !== 1 ? 's' : ''} recorded
                    </span>
                  </div>
                )}

                {/* Staffing advisory — noted so an understaffed shift is on the record */}
                {(() => {
                  const target = hasApparatusPositions ? apparatusPositions.length : (shift.min_staffing ?? 0);
                  if (!(target > 0 && activeAssignments.length < target)) return null;
                  return (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <span className="text-amber-700 dark:text-amber-400">
                        Recorded warning (does not block close-out): ran understaffed — {activeAssignments.length} of{' '}
                        {target} positions filled.
                      </span>
                    </div>
                  );
                })()}
              </div>

              {/* Pass-down handoff for the next crew */}
              <div>
                <label htmlFor="pass-down" className="text-theme-text-secondary mb-1 block text-xs font-medium">
                  Pass-down to next crew (optional)
                </label>
                <textarea
                  id="pass-down"
                  rows={2}
                  value={passDownNotes}
                  onChange={(e) => setPassDownNotes(e.target.value)}
                  placeholder="Apparatus issues, ongoing incidents, staffing notes…"
                  className={inputCls}
                />
              </div>

              {/* Enforcement ON: block, or override with a logged reason. */}
              {hasIncompleteEquipmentChecks && requireEndOfShiftChecks && (
                <div className="space-y-2 rounded-md border border-red-500/20 bg-red-500/5 p-2">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-red-700 dark:text-red-300">
                    <input
                      type="checkbox"
                      checked={overrideChecks}
                      onChange={(e) => setOverrideChecks(e.target.checked)}
                      className="border-theme-surface-border rounded"
                    />
                    Finalize anyway, with equipment checks outstanding
                  </label>
                  {overrideChecks && (
                    <input
                      type="text"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="Reason for override (logged)"
                      className={inputCls}
                    />
                  )}
                  {!overrideChecks && (
                    <p className="text-xs text-red-600 dark:text-red-300">
                      Complete the outstanding checks, or check the box above to override.
                    </p>
                  )}
                </div>
              )}

              {/* Enforcement OFF (default): allow, but surface the feature. */}
              {hasIncompleteEquipmentChecks && !requireEndOfShiftChecks && (
                <div className="space-y-1 rounded-md border border-sky-500/20 bg-sky-500/5 p-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Some end-of-shift equipment checks aren&apos;t complete.
                  </p>
                  <p className="text-theme-text-muted text-xs">
                    You can still finalize. Departments can{' '}
                    <strong>require end-of-shift checks before finalizing</strong> so every apparatus is verified ready
                    and accountability is documented
                    {canManage
                      ? ' — turn it on in Scheduling Settings → Close-out rules.'
                      : '. Ask an admin to enable it in Scheduling Settings.'}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => setShowFinalizeChecklist(false)}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleFinalize();
                  }}
                  disabled={
                    pending.finalizing || (requireEndOfShiftChecks && hasIncompleteEquipmentChecks && !overrideChecks)
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                >
                  {pending.finalizing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Close out shift
                </button>
              </div>
            </div>
          )}

          {/* Finalized badge */}
          {shift.is_finalized && (
            <div className="space-y-2 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                <span className="text-sm font-medium text-green-700 dark:text-green-400">
                  Shift finalized
                  {shift.finalized_at
                    ? ` on ${formatDateCustom(new Date(shift.finalized_at), { month: 'short', day: 'numeric', year: 'numeric' }, tz)}`
                    : ''}
                </span>
                {canManageShift && !showReopenConfirm && (
                  <button
                    onClick={() => setShowReopenConfirm(true)}
                    className="text-theme-text-muted hover:text-theme-text-primary ml-auto text-xs underline"
                  >
                    Reopen
                  </button>
                )}
              </div>
              {showReopenConfirm && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    placeholder="Reason for reopening (logged)"
                    className={inputCls}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => {
                        setShowReopenConfirm(false);
                        setReopenReason('');
                      }}
                      className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        void handleReopen();
                      }}
                      disabled={pending.finalizing}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      Reopen shift
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Pass-down from this shift */}
          {shift.pass_down_notes && (
            <div className="bg-theme-surface border-theme-surface-border rounded-lg border px-3 py-2">
              <p className="text-theme-text-secondary mb-0.5 text-xs font-semibold">Pass-down for next crew</p>
              <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{shift.pass_down_notes}</p>
            </div>
          )}

          {/* Edit Form */}
          {isEditing && (
            <div className="space-y-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-4">
              <h4 className="text-theme-text-primary flex items-center gap-2 text-sm font-medium">
                <Pencil className="h-3.5 w-3.5" /> Edit Shift
              </h4>
              <div>
                <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Shift Date</label>
                <input
                  type="date"
                  value={editForm.shift_date}
                  onChange={(e) => setEditForm((p) => ({ ...p, shift_date: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Start Time</label>
                  <TimeQuarterHour
                    value={editForm.start_time}
                    onChange={(e) => setEditForm((p) => ({ ...p, start_time: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-xs font-medium">End Time</label>
                  <TimeQuarterHour
                    value={editForm.end_time}
                    onChange={(e) => setEditForm((p) => ({ ...p, end_time: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>
              {apparatusList.length > 0 && (
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                    <span className="flex items-center gap-1">
                      <Truck className="h-3 w-3" /> Apparatus
                    </span>
                  </label>
                  <select
                    value={editForm.apparatus_id}
                    onChange={(e) => setEditForm((p) => ({ ...p, apparatus_id: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">No specific apparatus</option>
                    {apparatusList.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.unit_number} — {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="edit-min-staffing" className="text-theme-text-secondary mb-1 block text-xs font-medium">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> Minimum staffing
                  </span>
                </label>
                <input
                  id="edit-min-staffing"
                  type="number"
                  min="0"
                  max="99"
                  value={editForm.min_staffing}
                  onChange={(e) => setEditForm((p) => ({ ...p, min_staffing: e.target.value }))}
                  placeholder="Target crew size"
                  className={inputCls}
                />
                <p className="text-theme-text-muted mt-1 text-xs">
                  Overrides the template/apparatus target for this shift.
                </p>
              </div>
              <div>
                <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                  <span className="flex items-center gap-1">
                    <Palette className="h-3 w-3" /> Color
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={editForm.color || '#8b5cf6'}
                    onChange={(e) => setEditForm((p) => ({ ...p, color: e.target.value }))}
                    className="border-theme-input-border h-8 w-8 cursor-pointer rounded-sm border bg-transparent p-0"
                  />
                  <span className="text-theme-text-muted text-xs">{editForm.color || 'Default'}</span>
                  {editForm.color && (
                    <button
                      type="button"
                      onClick={() => setEditForm((p) => ({ ...p, color: '' }))}
                      className="text-theme-text-muted hover:text-theme-text-primary text-xs"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Notes</label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  placeholder="Shift notes"
                  className={inputCls + ' resize-none'}
                />
              </div>
              <div>
                <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Shift Officer</label>
                <select
                  value={editForm.shift_officer_id}
                  onChange={(e) => setEditForm((p) => ({ ...p, shift_officer_id: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">No shift officer</option>
                  {memberOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {memberOptions.length === 0 && pending.loadingMembers && (
                  <p className="text-theme-text-muted mt-1 text-xs">Loading members...</p>
                )}
              </div>
              <PositionListEditor
                structured
                positions={editForm.positions}
                onChangeStructured={(positions) => setEditForm((p) => ({ ...p, positions }))}
                availablePositions={BUILTIN_POSITIONS}
                label="Positions"
                addButtonLabel="Add position"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleSaveEdit();
                  }}
                  disabled={pending.saving}
                  className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {pending.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </button>
              </div>
            </div>
          )}

          {/* Time & Info */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="bg-theme-surface-hover/50 flex items-center gap-3 rounded-lg p-3">
              <Clock className="h-5 w-5 text-violet-500" />
              <div>
                <p className="text-theme-text-muted text-xs">Time</p>
                <p className="text-theme-text-primary text-sm font-medium">
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
                <div
                  className={`flex items-center gap-3 rounded-lg p-3 ${
                    isFull ? 'bg-green-500/10' : isShort ? 'bg-amber-500/10' : 'bg-theme-surface-hover/50'
                  }`}
                >
                  {isFull ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                  ) : isShort ? (
                    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <Users className="h-5 w-5 text-blue-500" />
                  )}
                  <div>
                    <p className="text-theme-text-muted text-xs">Crew</p>
                    <p className="text-theme-text-primary text-sm font-medium">
                      {filled} assigned
                      {target > 0 && <span className="text-theme-text-muted"> / {target} positions</span>}
                    </p>
                  </div>
                </div>
              );
            })()}
            {(shift.apparatus_name || shift.apparatus_unit_number) && (
              <div className="bg-theme-surface-hover/50 flex items-center gap-3 rounded-lg p-3">
                <Truck className="h-5 w-5 text-red-500" />
                <div>
                  <p className="text-theme-text-muted text-xs">Apparatus</p>
                  <p className="text-theme-text-primary text-sm font-medium">
                    {shift.apparatus_unit_number}
                    {shift.apparatus_name ? ` — ${shift.apparatus_name}` : ''}
                  </p>
                </div>
              </div>
            )}
            {shift.shift_officer_name && (
              <div className="bg-theme-surface-hover/50 flex items-center gap-3 rounded-lg p-3">
                <MapPin className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-theme-text-muted text-xs">Shift Officer</p>
                  <p className="text-theme-text-primary text-sm font-medium">{shift.shift_officer_name}</p>
                </div>
              </div>
            )}
          </div>

          {shift.notes && !isEditing && (
            <div className="bg-theme-surface-hover/50 rounded-lg p-3">
              <p className="text-theme-text-muted mb-1 text-xs">Notes</p>
              <p className="text-theme-text-primary text-sm">{shift.notes}</p>
            </div>
          )}

          {/* Crew Board (when apparatus has positions) */}
          {hasApparatusPositions && !loading && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-theme-text-primary flex items-center gap-2 text-base font-semibold">
                  <Truck className="h-4 w-4" /> Crew Board — {shift.apparatus_unit_number}
                </h3>
                {openPositions.length > 0 && (
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    {openPositions.length} open
                  </span>
                )}
              </div>
              {shift.apparatus_id && (
                <p className="text-theme-text-muted mb-2 text-[10px]">
                  Crew positions for {shift.apparatus_name || shift.apparatus_unit_number || 'this apparatus'}
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
                    onConfirm={(id) => {
                      void handleConfirm(id);
                    }}
                    onDecline={(id) => {
                      void handleDecline(id);
                    }}
                    onRemove={(id) => {
                      void handleRemove(id);
                    }}
                    onPositionChange={(id, newPos, curPos) => {
                      void handlePositionChange(id, newPos, curPos);
                    }}
                    onAssignToPosition={openAssignFormForPosition}
                    onSignup={(pos) => {
                      void handleSignup(pos);
                    }}
                  />
                ))}
              </div>

              {/* Extra assignments (not matching apparatus positions) */}
              {extraAssignments.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-theme-text-secondary mb-2 text-sm font-medium">Additional Crew</h4>
                  <div className="space-y-2">{extraAssignments.map(renderAssignmentRow)}</div>
                </div>
              )}
            </div>
          )}

          {/* Standard Crew Roster (no apparatus positions) */}
          {!hasApparatusPositions && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-theme-text-primary flex items-center gap-2 text-base font-semibold">
                  <Users className="h-4 w-4" /> Crew Roster
                </h3>
                {canAssign && !isPast && (
                  <button
                    onClick={() => setShowAssignForm(!showAssignForm)}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-violet-600 transition-colors hover:bg-violet-500/10 dark:text-violet-400"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Assign member
                  </button>
                )}
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
                  <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
                </div>
              ) : activeAssignments.length === 0 ? (
                <div className="border-theme-surface-border rounded-lg border border-dashed py-6 text-center">
                  <Users className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
                  <p className="text-theme-text-muted text-sm">No crew assigned yet</p>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    {canAssign ? 'Use the Assign button above to add members.' : 'Sign up below to join this shift.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">{activeAssignments.map(renderAssignmentRow)}</div>
              )}
            </div>
          )}

          {/* Admin Assign Form — with member search dropdown */}
          {canAssign && (showAssignForm || showBulkAssign || (hasApparatusPositions && !isPast)) && (
            <>
              {!showAssignForm && !showBulkAssign && hasApparatusPositions && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAssignForm(true)}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-violet-600 transition-colors hover:bg-violet-500/10 dark:text-violet-400"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Assign Member
                  </button>
                  {openPositions.length > 1 && (
                    <button
                      onClick={openBulkAssign}
                      className="flex items-center gap-1 rounded-lg border border-violet-500/20 px-2.5 py-1.5 text-xs text-violet-600 transition-colors hover:bg-violet-500/10 dark:text-violet-400"
                    >
                      <Users className="h-3.5 w-3.5" /> Fill All Open ({openPositions.length})
                    </button>
                  )}
                </div>
              )}
              {showAssignForm && (
                <div
                  ref={assignFormRef}
                  className="border-theme-surface-border bg-theme-surface-hover/30 scroll-mt-24 space-y-3 rounded-lg border p-4"
                >
                  <h4 className="text-theme-text-primary text-sm font-medium">Assign Member</h4>
                  {/* Step 1: Position selection */}
                  <div>
                    <label
                      htmlFor="assign-position"
                      className="text-theme-text-secondary mb-1 block text-xs font-medium"
                    >
                      Position
                    </label>
                    <select
                      id="assign-position"
                      value={assignForm.position}
                      onChange={(e) => setAssignForm((p) => ({ ...p, position: e.target.value }))}
                      className={inputCls}
                    >
                      {positionOptions.map(([val, label]) => {
                        const isOpen = openPositions.includes(val);
                        return (
                          <option key={val} value={val}>
                            {label}
                            {isOpen ? ' (open)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  {/* Step 2: Member search + select */}
                  <div>
                    <label
                      htmlFor="assign-member-search"
                      className="text-theme-text-secondary mb-1 block text-xs font-medium"
                    >
                      Member
                    </label>
                    <input
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      id="assign-member-search"
                      type="text"
                      aria-label="Search members"
                      placeholder="Search members..."
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      className={inputCls}
                    />
                    {pending.loadingMembers ? (
                      <div
                        className="text-theme-text-muted mt-2 flex items-center gap-2 text-xs"
                        role="status"
                        aria-live="polite"
                      >
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Loading members...
                      </div>
                    ) : (
                      <select
                        aria-label="Select a member"
                        value={assignForm.user_id}
                        onChange={(e) => setAssignForm((p) => ({ ...p, user_id: e.target.value }))}
                        className={inputCls + ' mt-2'}
                        size={Math.min(filteredMembers.length + 1, 6)}
                      >
                        <option value="">Select a member</option>
                        {filteredMembers.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {/* Step 3: Training slot (optional) */}
                  <div className="border-theme-surface-border/60 border-t pt-1">
                    <label className="text-theme-text-secondary flex cursor-pointer items-center gap-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        checked={assignForm.is_training}
                        onChange={(e) => setAssignForm((p) => ({ ...p, is_training: e.target.checked }))}
                        className="border-theme-surface-border rounded"
                      />
                      Training position (supervised rider)
                    </label>
                    {assignForm.is_training && (
                      <div className="mt-2 space-y-2 pl-6">
                        <div>
                          <label htmlFor="assign-training-program" className="text-theme-text-muted mb-1 block text-xs">
                            Program (optional)
                          </label>
                          <select
                            id="assign-training-program"
                            value={assignForm.training_program_id}
                            onChange={(e) => setAssignForm((p) => ({ ...p, training_program_id: e.target.value }))}
                            className={inputCls}
                          >
                            <option value="">— No program link —</option>
                            {trainingPrograms.map((prog) => (
                              <option key={prog.id} value={prog.id}>
                                {prog.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor="assign-training-evaluator"
                            className="text-theme-text-muted mb-1 block text-xs"
                          >
                            Evaluating officer (optional)
                          </label>
                          <select
                            id="assign-training-evaluator"
                            value={assignForm.training_evaluator_id}
                            onChange={(e) => setAssignForm((p) => ({ ...p, training_evaluator_id: e.target.value }))}
                            className={inputCls}
                          >
                            <option value="">— Finalizing officer —</option>
                            {memberOptions.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <p className="text-theme-text-muted text-xs">
                          A draft training report is created for this member when the shift is finalized.
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setShowAssignForm(false);
                        setMemberSearch('');
                      }}
                      className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        void handleAssign();
                      }}
                      disabled={pending.assigning || !assignForm.user_id}
                      className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      {pending.assigning ? 'Assigning...' : 'Assign'}
                    </button>
                  </div>
                </div>
              )}
              {/* Bulk Assignment Panel */}
              {showBulkAssign && (
                <div className="border-theme-surface-border bg-theme-surface-hover/30 space-y-3 rounded-lg border p-4">
                  <h4 className="text-theme-text-primary flex items-center gap-2 text-sm font-medium">
                    <Users className="h-4 w-4" /> Fill Open Positions
                  </h4>
                  <p className="text-theme-text-muted text-xs">Select a member for each open position.</p>
                  <div className="space-y-2">
                    {openPositions.map((pos) => {
                      const label = POSITION_LABELS[pos] ?? pos;
                      return (
                        <div key={pos} className="flex items-center gap-2">
                          <span className="text-theme-text-secondary w-24 shrink-0 text-xs font-medium capitalize">
                            {label}
                          </span>
                          <select
                            aria-label={`Member for ${label}`}
                            value={bulkAssignments[pos] ?? ''}
                            onChange={(e) => setBulkAssignments((prev) => ({ ...prev, [pos]: e.target.value }))}
                            className={inputCls + ' py-1.5 text-xs'}
                          >
                            <option value="">— skip —</option>
                            {memberOptions
                              .filter((m) => !unavailableIds.has(m.id))
                              .map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.label}
                                </option>
                              ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowBulkAssign(false)}
                      className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        void handleBulkAssign();
                      }}
                      disabled={pending.bulkAssigning || Object.values(bulkAssignments).every((v) => !v)}
                      className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      {pending.bulkAssigning
                        ? 'Assigning...'
                        : `Assign ${Object.values(bulkAssignments).filter(Boolean).length} Members`}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Sign Up (for members not yet assigned — non-apparatus mode) */}
          {!hasApparatusPositions && !isPast && !isUserAssigned && (
            <div className="rounded-lg border border-dashed border-violet-500/30 bg-violet-500/5 p-4">
              <h3 className="text-theme-text-primary mb-2 flex items-center gap-2 text-sm font-semibold">
                <UserPlus className="h-4 w-4 text-violet-500" /> Sign Up for This Shift
              </h3>
              <div className="flex items-center gap-2">
                <select
                  value={signupPosition}
                  onChange={(e) => setSignupPosition(e.target.value)}
                  className={'flex-1 ' + inputCls}
                >
                  {positionOptions.map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    void handleSignup();
                  }}
                  disabled={pending.signingUp}
                  className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {pending.signingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  Sign Up
                </button>
              </div>
            </div>
          )}

          {/* Sign Up confirmation for already-assigned members */}
          {isUserAssigned && (
            <div className="space-y-2 rounded-lg border border-green-500/20 bg-green-500/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <p className="text-sm text-green-700 dark:text-green-400">You are assigned to this shift</p>
                </div>
                {!isPast && !shift.is_finalized && (
                  <button
                    onClick={() => {
                      void handleWithdraw();
                    }}
                    disabled={pending.withdrawing}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                    title="Withdraw from this shift"
                    aria-label="Withdraw from this shift"
                  >
                    {pending.withdrawing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <UserMinus className="h-3.5 w-3.5" />
                    )}
                    Withdraw
                  </button>
                )}
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
                      className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                    >
                      {checkingIn ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <LogIn className="h-3.5 w-3.5" />
                      )}
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
                              toast.success(
                                `Checked out (${Math.round(((result.duration_minutes ?? 0) / 60) * 10) / 10} hrs)`
                              );
                            } catch {
                              toast.error('Failed to check out');
                            } finally {
                              setCheckingOut(false);
                            }
                          })();
                        }}
                        disabled={checkingOut}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                      >
                        {checkingOut ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <LogOut className="h-3.5 w-3.5" />
                        )}
                        Check Out
                      </button>
                    </>
                  ) : (
                    <span className="text-theme-text-muted text-xs">
                      {Math.round(((myAttendance.duration_minutes ?? 0) / 60) * 10) / 10} hrs recorded
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Platoon roster: who's on, on leave, or available to fill in */}
          {platoonsEnabled && shift.platoon && platoonRoster.length > 0 && (
            <div>
              <h3 className="text-theme-text-primary mb-2 text-sm font-semibold">Platoon {shift.platoon} Roster</h3>
              <div className="space-y-1.5">
                {platoonRoster.map((entry) => {
                  const badge =
                    entry.status === 'assigned'
                      ? {
                          label: 'On shift',
                          cls: 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20',
                        }
                      : entry.status === 'on_leave'
                        ? {
                            label: 'On leave',
                            cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
                          }
                        : {
                            label: 'Available',
                            cls: 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border',
                          };
                  const canFillIn = entry.status === 'available' && canAssign && !shift.is_finalized;
                  return (
                    <div
                      key={entry.user_id}
                      className="border-theme-surface-border flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5"
                    >
                      <span className="text-theme-text-primary truncate text-sm">{entry.user_name}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {canFillIn && (
                          <button
                            onClick={() => {
                              void handleAssignFromRoster(entry.user_id);
                            }}
                            disabled={pending.assigningRoster}
                            className="rounded-md bg-violet-600 px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
                          >
                            Assign
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-theme-text-muted mt-1.5 text-[11px]">
                Members on leave free up a spot — assign an available member or hold someone over to cover.
              </p>
            </div>
          )}

          {/* Calls / Runs logged during this shift */}
          <div className="pt-1">
            <ShiftCallsSection
              shiftId={shift.id}
              canManage={canManageShift && !shift.is_finalized}
              tz={tz}
              onChange={() => {
                void refreshAssignments();
                onRefresh?.();
              }}
            />
          </div>

          {/* QR Code for apparatus check-in (officers) */}
          {canAssign && shift.apparatus_id && (
            <div>
              <button
                onClick={() => setShowQR(!showQR)}
                className="text-theme-text-muted hover:text-theme-text-primary inline-flex items-center gap-1.5 text-xs transition-colors"
              >
                <QrCode className="h-3.5 w-3.5" />
                {showQR ? 'Hide' : 'Show'} Check-In QR Code
              </button>
              {showQR && (
                <div className="border-theme-surface-border mt-2 inline-block rounded-lg border bg-white p-4">
                  <QRCodeSVG
                    value={`${window.location.origin}/scheduling/checkin?apparatus=${shift.apparatus_id}`}
                    size={200}
                    level="M"
                    includeMargin
                  />
                  <p className="mt-2 text-center text-xs text-gray-500">
                    {shift.apparatus_name || shift.apparatus_unit_number || 'Apparatus'} &mdash; permanent code
                  </p>
                  <button
                    onClick={() => {
                      window.open(
                        `/scheduling/checkin/print?apparatus=${shift.apparatus_id}&name=${encodeURIComponent(shift.apparatus_name || shift.apparatus_unit_number || 'Apparatus')}&autoprint=1`,
                        '_blank'
                      );
                    }}
                    className="mt-2 w-full text-xs text-violet-600 hover:underline dark:text-violet-400"
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
              <h3 className="text-theme-text-muted mb-2 text-xs font-medium tracking-wide uppercase">
                Declined / Removed ({inactiveAssignments.length})
              </h3>
              <div className="space-y-1.5">
                {inactiveAssignments.map((a) => (
                  <div
                    key={a.id}
                    className="border-theme-surface-border bg-theme-surface-hover/20 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-sm"
                  >
                    <span className="text-theme-text-muted line-through">{a.user_name || 'Unknown'}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${ASSIGNMENT_STATUS_COLORS[a.status || 'declined'] || ASSIGNMENT_STATUS_COLORS.declined}`}
                    >
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
            const showChecklistLink = equipmentCheckSummaries.some((s) => !s.isCompleted);

            if (!showReportBtn && !showChecklistLink) return null;

            return (
              <div className="flex flex-wrap gap-2">
                {showChecklistLink && (
                  <button
                    onClick={() => {
                      onClose();
                      void navigate(`/scheduling?tab=equipment-checks&shift=${shift.id}`);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-500/20 dark:text-violet-400"
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" />
                    Complete Checklists
                  </button>
                )}
                {showReportBtn && (
                  <button
                    onClick={() => {
                      onClose();
                      void navigate(`/scheduling?tab=shift-reports&shift=${shift.id}`);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-500/20 dark:text-blue-400"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    File Shift Report
                  </button>
                )}
              </div>
            );
          })()}

          {/* Equipment Checks */}
          {equipmentCheckSummaries.length > 0 && (
            <div>
              <button
                onClick={() => setShowEquipmentChecks(!showEquipmentChecks)}
                className="flex w-full items-center justify-between py-2 text-left"
              >
                <h3 className="text-theme-text-primary flex items-center gap-2 text-base font-semibold">
                  <ClipboardCheck className="h-4 w-4" /> Equipment Checks
                  {/* Inline status summary — always visible */}
                  {(() => {
                    const passed = equipmentCheckSummaries.filter(
                      (s) => s.isCompleted && s.overallStatus === 'pass'
                    ).length;
                    const failed = equipmentCheckSummaries.filter(
                      (s) => s.isCompleted && s.overallStatus !== 'pass'
                    ).length;
                    const inProgress = equipmentCheckSummaries.filter(
                      (s) => !s.isCompleted && s.completedItems > 0
                    ).length;
                    const notStarted = equipmentCheckSummaries.filter(
                      (s) => !s.isCompleted && s.completedItems === 0
                    ).length;
                    return (
                      <span className="ml-1 flex items-center gap-1.5">
                        {passed > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                            {passed} pass
                          </span>
                        )}
                        {failed > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-900/30 dark:text-red-400">
                            {failed} fail
                          </span>
                        )}
                        {inProgress > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                            {inProgress} in progress
                          </span>
                        )}
                        {notStarted > 0 && (
                          <span className="bg-theme-surface-secondary text-theme-text-muted inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                            {notStarted} pending
                          </span>
                        )}
                      </span>
                    );
                  })()}
                </h3>
                {showEquipmentChecks ? (
                  <ChevronUp className="text-theme-text-muted h-4 w-4" />
                ) : (
                  <ChevronDown className="text-theme-text-muted h-4 w-4" />
                )}
              </button>
              {showEquipmentChecks && (
                <div className="mt-2 space-y-2">
                  {(['start_of_shift', 'end_of_shift'] as const).map((timing) => {
                    const checksForTiming = equipmentCheckSummaries.filter((s) => s.checkTiming === timing);
                    if (checksForTiming.length === 0) return null;
                    return (
                      <div key={timing}>
                        <p className="text-theme-text-muted mb-1 text-xs font-medium tracking-wide uppercase">
                          {timing === 'start_of_shift' ? 'Start of Shift' : 'End of Shift'}
                        </p>
                        {checksForTiming.map((summary) => (
                          <div
                            key={summary.templateId}
                            className="bg-theme-surface-hover/30 border-theme-surface-border mb-2 rounded-lg border p-3"
                          >
                            <div className="flex items-center justify-between">
                              <p className="text-theme-text-primary text-sm font-medium">{summary.templateName}</p>
                              {summary.isCompleted ? (
                                summary.overallStatus === 'pass' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                    <Check className="h-3 w-3" /> Pass
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                    <XCircle className="h-3 w-3" /> Fail ({summary.failedItems})
                                  </span>
                                )
                              ) : summary.completedItems > 0 ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                                  In Progress {summary.completedItems}/{summary.totalItems}
                                </span>
                              ) : (
                                <span className="bg-theme-surface-secondary text-theme-text-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
                                  Not Started
                                </span>
                              )}
                            </div>
                            {summary.checkedByName && (
                              <p className="text-theme-text-muted mt-1 text-xs">
                                Checked by {summary.checkedByName}
                                {summary.checkedAt ? ` at ${formatTime(summary.checkedAt, tz)}` : ''}
                              </p>
                            )}
                            {!summary.isCompleted && (
                              <p className="mt-1.5 text-xs font-medium text-violet-600 dark:text-violet-400">
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
