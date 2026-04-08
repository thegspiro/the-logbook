/**
 * Shift Reports Tab
 *
 * Officers can submit end-of-shift completion reports for trainees.
 * Trainees can view their own reports and acknowledge them.
 * Includes performance ratings, skills observed, tasks performed, and narratives.
 * Supports review workflow, visibility controls, and configurable rating scales.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FileText, Plus, Loader2, Star, Clock, Phone, ChevronDown,
  ChevronUp, Check, X, Search, User as UserIcon, AlertCircle,
  Shield, Eye, EyeOff, ClipboardCheck, Pencil, Printer,
  BarChart3, TrendingUp, Users, Save,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { shiftCompletionService, trainingModuleConfigService } from '../../services/api';
import { userService } from '../../services/api';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ShiftRecord } from '../../modules/scheduling/services/api';
import { useAuthStore } from '../../stores/authStore';
import { SubmissionStatus } from '../../constants/enums';
import type {
  BatchShiftReportCreate,
  CrewMemberEvaluation,
  ShiftCompletionReport,
  ShiftCompletionReportCreate,
  ShiftCrewMember,
  TaskPerformed,
  TrainingModuleConfig,
  TraineeShiftStats,
  OfficerShiftAnalytics,
} from '../../types/training';
import type { User } from '../../types/user';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateCustom, getTodayLocalDate } from '../../utils/dateFormatting';
import {
  DEFAULT_SKILLS,
  DEFAULT_CALL_TYPE_OPTIONS,
  DEFAULT_COMPETENCY_LABELS,
  REVIEW_STATUS_STYLES,
} from '../../modules/scheduling/components/shiftReportConstants';
import { ReportContentDisplay } from '../../modules/scheduling/components/ReportContentDisplay';
import { getErrorMessage } from '../../utils/errorHandling';
import { saveDraft, loadDraft, deleteDraft } from '../../utils/shiftReportDrafts';
import { enqueueShiftReport, listPendingReports, dequeueShiftReport, pendingReportCount } from '../../utils/shiftReportOfflineQueue';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

type ViewMode = 'my-reports' | 'filed-by-me' | 'create' | 'pending-review' | 'flagged' | 'drafts';

export const ShiftReportsTab: React.FC = () => {
  const { user, checkPermission } = useAuthStore();
  const tz = useTimezone();
  const canManage = checkPermission('training.manage');
  const isOnline = useOnlineStatus();
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [searchParams] = useSearchParams();

  const linkedShiftId = searchParams.get('shift') || undefined;

  const initialView = (): ViewMode => {
    if (linkedShiftId && canManage) return 'create';
    const viewParam = searchParams.get('view');
    if (viewParam === 'drafts' && canManage) return 'drafts';
    return canManage ? 'filed-by-me' : 'my-reports';
  };

  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [reports, setReports] = useState<ShiftCompletionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [config, setConfig] = useState<TrainingModuleConfig | null>(null);

  // Create form state
  const [members, setMembers] = useState<User[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [linkedShiftLabel, setLinkedShiftLabel] = useState<string | null>(null);
  const [shiftApparatusType, setShiftApparatusType] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<ShiftCompletionReportCreate>>({
    shift_id: linkedShiftId,
    shift_date: getTodayLocalDate(tz),
    hours_on_shift: 0,
    calls_responded: 0,
    call_types: [],
    performance_rating: undefined,
    areas_of_strength: '',
    areas_for_improvement: '',
    officer_narrative: '',
    skills_observed: [],
    tasks_performed: [],
    trainee_id: '',
  });

  // Batch create state
  const [crewMembers, setCrewMembers] = useState<ShiftCrewMember[]>([]);
  const [selectedCrewIds, setSelectedCrewIds] = useState<Set<string>>(new Set());
  const [traineeEvals, setTraineeEvals] = useState<Record<string, CrewMemberEvaluation>>({});
  const [expandedTraineeId, setExpandedTraineeId] = useState<string | null>(null);
  const [crewRemarks, setCrewRemarks] = useState<Record<string, string>>({});
  const [loadingCrew, setLoadingCrew] = useState(false);
  const [shiftList, setShiftList] = useState<ShiftRecord[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [shiftSearchQuery, setShiftSearchQuery] = useState('');

  // Acknowledge modal
  const [ackReportId, setAckReportId] = useState<string | null>(null);
  const [ackComments, setAckComments] = useState('');
  const [acknowledging, setAcknowledging] = useState(false);

  // Review modal
  const [reviewReportId, setReviewReportId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [redactFields, setRedactFields] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);

  // Batch review selection
  const [selectedReportIds, setSelectedReportIds] = useState<Set<string>>(new Set());
  const [batchReviewing, setBatchReviewing] = useState(false);
  const [batchReviewNotes, setBatchReviewNotes] = useState('');

  // Draft edit state
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftForm, setDraftForm] = useState<Partial<ShiftCompletionReportCreate>>({});
  const [savingDraft, setSavingDraft] = useState(false);

  // Analytics state
  const [traineeStats, setTraineeStats] = useState<TraineeShiftStats | null>(null);
  const [officerAnalytics, setOfficerAnalytics] = useState<OfficerShiftAnalytics | null>(null);
  const [draftBadgeCount, setDraftBadgeCount] = useState(0);

  // Load draft count badge for managers
  useEffect(() => {
    if (!canManage) return;
    shiftCompletionService.getDraftReports()
      .then((drafts) => setDraftBadgeCount(drafts.length))
      .catch(() => {});
  }, [canManage, viewMode]);

  // Load config for visibility and rating settings
  useEffect(() => {
    trainingModuleConfigService.getConfig()
      .then(setConfig)
      .catch(() => { /* non-officer: config not available */ });
  }, []);

  // Rating display helpers using config
  const ratingLabel = config?.rating_label || 'Performance Rating';
  const ratingScaleType = config?.rating_scale_type || 'stars';
  const ratingScaleLabels = config?.rating_scale_labels || DEFAULT_COMPETENCY_LABELS;
  const callTypeOptions = config?.shift_review_call_types?.length
    ? config.shift_review_call_types
    : DEFAULT_CALL_TYPE_OPTIONS;

  const skillOptions = useMemo(() => {
    if (shiftApparatusType && config?.apparatus_type_skills) {
      const typeSkills =
        config.apparatus_type_skills[shiftApparatusType];
      if (typeSkills?.length) return typeSkills;
    }
    return config?.shift_review_default_skills?.length
      ? config.shift_review_default_skills
      : DEFAULT_SKILLS;
  }, [config, shiftApparatusType]);

  const taskDefaults = useMemo(() => {
    if (shiftApparatusType && config?.apparatus_type_tasks) {
      const typeTasks =
        config.apparatus_type_tasks[shiftApparatusType];
      if (typeTasks?.length) return typeTasks;
    }
    return config?.shift_review_default_tasks ?? [];
  }, [config, shiftApparatusType]);

  // Load crew status when a shift is selected
  const loadCrewForShift = useCallback(async (shiftId: string) => {
    setLoadingCrew(true);
    try {
      const crew = await shiftCompletionService.getShiftCrewStatus(shiftId);
      setCrewMembers(crew);
      const eligible = crew.filter(m => !m.has_existing_report);
      setSelectedCrewIds(new Set(eligible.map(m => m.user_id)));
      setTraineeEvals({});
      setCrewRemarks({});
      setExpandedTraineeId(null);
    } catch {
      toast.error('Failed to load crew');
    } finally {
      setLoadingCrew(false);
    }
  }, []);

  // Pre-fill form when navigated with a linked shift ID
  useEffect(() => {
    if (!linkedShiftId || viewMode !== 'create') return;
    let cancelled = false;
    const prefill = async () => {
      try {
        const shift = await schedulingService.getShift(linkedShiftId);
        if (cancelled) return;
        const shiftDate = shift.shift_date ?? getTodayLocalDate(tz);
        setLinkedShiftLabel(
          `${shift.apparatus_name ? `${shift.apparatus_name} — ` : ''}${shiftDate}`,
        );
        setShiftApparatusType(shift.apparatus_type ?? null);
        let hours = 0;
        if (shift.total_hours && shift.total_hours > 0) {
          hours = Math.round(shift.total_hours * 100) / 100;
        } else if (shift.start_time && shift.end_time) {
          const start = new Date(shift.start_time).getTime();
          const end = new Date(shift.end_time).getTime();
          if (end > start) {
            hours = Math.round(
              ((end - start) / 3600000) * 100,
            ) / 100;
          }
        }
        setForm(prev => ({
          ...prev,
          shift_id: linkedShiftId,
          shift_date: shiftDate,
          hours_on_shift: hours,
          calls_responded: shift.call_count || prev.calls_responded,
        }));
        await loadCrewForShift(linkedShiftId);
      } catch {
        // Shift may not exist — continue with defaults
      }
    };
    void prefill();
    return () => { cancelled = true; };
  }, [linkedShiftId, viewMode, tz, loadCrewForShift]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      if (viewMode === 'my-reports') {
        const data = await shiftCompletionService.getMyReports();
        setReports(data);
      } else if (viewMode === 'filed-by-me') {
        const data = await shiftCompletionService.getReportsByOfficer();
        setReports(data);
      } else if (viewMode === 'pending-review') {
        const data = await shiftCompletionService.getPendingReviewReports();
        setReports(data);
      } else if (viewMode === 'flagged') {
        const data = await shiftCompletionService.getFlaggedReports();
        setReports(data);
      } else if (viewMode === 'drafts') {
        const data = await shiftCompletionService.getDraftReports();
        setReports(data);
      }
    } catch {
      toast.error('Failed to load shift reports');
    } finally {
      setLoading(false);
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'create') void loadReports();
    setSelectedReportIds(new Set());
  }, [loadReports, viewMode]);

  // Load analytics data for dashboard views
  useEffect(() => {
    if (viewMode === 'my-reports') {
      shiftCompletionService.getMyStats()
        .then(setTraineeStats)
        .catch(() => { /* stats not critical */ });
    } else if (viewMode === 'filed-by-me' && canManage) {
      shiftCompletionService.getOfficerAnalytics()
        .then(setOfficerAnalytics)
        .catch(() => { /* analytics not critical */ });
    }
  }, [viewMode, canManage]);

  // Load members for draft edit forms
  useEffect(() => {
    if (viewMode === 'create' && members.length === 0) {
      userService.getUsers()
        .then(setMembers)
        .catch(() => { /* members needed for draft edit */ });
    }
  }, [viewMode]); // eslint-disable-line react-hooks/exhaustive-deps -- only load once when entering create mode

  // Load recent shifts when entering create mode without a linked shift
  useEffect(() => {
    if (viewMode !== 'create' || linkedShiftId) return;
    setLoadingShifts(true);
    const today = new Date();
    const twoWeeksAgo = new Date(today);
    twoWeeksAgo.setDate(today.getDate() - 14);
    schedulingService.getShifts({
      start_date: twoWeeksAgo.toISOString().split('T')[0] ?? '',
      end_date: today.toISOString().split('T')[0] ?? '',
      limit: 50,
    })
      .then(res => setShiftList(res.shifts))
      .catch(() => { /* shifts not critical */ })
      .finally(() => setLoadingShifts(false));
  }, [viewMode, linkedShiftId]);

  // Auto-save draft to localStorage when form changes
  useEffect(() => {
    if (viewMode !== 'create' || !form.shift_id) return;
    const timer = setTimeout(() => {
      saveDraft({
        shiftId: form.shift_id ?? '',
        shiftLabel: linkedShiftLabel || '',
        formData: form as Record<string, unknown>,
        crewSelections: Array.from(selectedCrewIds),
        traineeEvals: traineeEvals as Record<string, unknown>,
        crewRemarks,
        savedAt: Date.now(),
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [viewMode, form, selectedCrewIds, traineeEvals, crewRemarks, linkedShiftLabel]);

  // Restore draft when a shift is loaded and a draft exists
  useEffect(() => {
    if (!form.shift_id || crewMembers.length === 0) return;
    const draft = loadDraft(form.shift_id);
    if (!draft) return;
    const age = Date.now() - draft.savedAt;
    if (age > 24 * 60 * 60 * 1000) {
      deleteDraft(form.shift_id);
      return;
    }
    if (draft.crewSelections.length > 0) {
      setSelectedCrewIds(new Set(draft.crewSelections));
    }
    if (draft.crewRemarks && Object.keys(draft.crewRemarks).length > 0) {
      setCrewRemarks(draft.crewRemarks);
    }
    if (draft.formData.officer_narrative) {
      setForm(prev => ({ ...prev, officer_narrative: draft.formData.officer_narrative as string }));
    }
  }, [form.shift_id, crewMembers.length]); // eslint-disable-line react-hooks/exhaustive-deps -- restore once when crew loads

  // Sync offline queue when connectivity returns
  useEffect(() => {
    if (!isOnline) return;
    const syncQueue = async () => {
      const pending = await listPendingReports();
      if (pending.length === 0) return;
      let synced = 0;
      for (const entry of pending) {
        try {
          await shiftCompletionService.batchCreateReports(entry.payload);
          await dequeueShiftReport(entry.id);
          synced++;
        } catch {
          // Will retry next time connectivity is restored
        }
      }
      if (synced > 0) {
        toast.success(`Synced ${synced} offline report${synced !== 1 ? 's' : ''}`);
        void loadReports();
      }
      setPendingOfflineCount(await pendingReportCount());
    };
    void syncQueue();
  }, [isOnline, loadReports]);

  // Track pending offline count
  useEffect(() => {
    void pendingReportCount().then(setPendingOfflineCount);
  }, []);

  const toggleCallType = (
    setter: React.Dispatch<React.SetStateAction<Partial<ShiftCompletionReportCreate>>>,
    type: string,
  ) => {
    setter(prev => {
      const types = prev.call_types || [];
      return {
        ...prev,
        call_types: types.includes(type) ? types.filter(t => t !== type) : [...types, type],
      };
    });
  };

  const toggleSkill = (
    setter: React.Dispatch<React.SetStateAction<Partial<ShiftCompletionReportCreate>>>,
    skillName: string,
  ) => {
    setter(prev => {
      const skills = prev.skills_observed || [];
      const existing = skills.find(s => s.skill_name === skillName);
      if (existing) {
        return { ...prev, skills_observed: skills.filter(s => s.skill_name !== skillName) };
      }
      return { ...prev, skills_observed: [...skills, { skill_name: skillName, demonstrated: true }] };
    });
  };

  const handleToggleCallType = (type: string) => toggleCallType(setForm, type);

  const resetNewForm = () => {
    setLinkedShiftLabel(null);
    setForm({
      shift_id: undefined,
      shift_date: getTodayLocalDate(tz),
      hours_on_shift: 0,
      calls_responded: 0,
      call_types: [],
      performance_rating: undefined,
      areas_of_strength: '',
      areas_for_improvement: '',
      officer_narrative: '',
      skills_observed: [],
      tasks_performed: [],
      trainee_id: '',
    });
  };

  // Batch workflow handlers
  const handleSelectShift = async (shift: ShiftRecord) => {
    setForm(prev => ({
      ...prev,
      shift_id: shift.id,
      shift_date: shift.shift_date,
      hours_on_shift: shift.total_hours || 0,
      calls_responded: shift.call_count || 0,
    }));
    setLinkedShiftLabel(
      `${shift.apparatus_name ? `${shift.apparatus_name} — ` : ''}${shift.shift_date}`,
    );
    setShiftApparatusType(shift.apparatus_type ?? null);
    await loadCrewForShift(shift.id);
  };

  const toggleCrewMember = (userId: string) => {
    setSelectedCrewIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const updateTraineeEval = (userId: string, field: keyof CrewMemberEvaluation, value: unknown) => {
    setTraineeEvals(prev => ({
      ...prev,
      [userId]: { ...prev[userId], user_id: userId, [field]: value } as CrewMemberEvaluation,
    }));
  };

  const handleBatchSubmit = async (asDraft: boolean) => {
    if (!form.shift_id) {
      toast.error('Please select a shift');
      return;
    }
    if (selectedCrewIds.size === 0) {
      toast.error('Please select at least one crew member');
      return;
    }
    if (!form.hours_on_shift || form.hours_on_shift <= 0) {
      toast.error('Please enter hours on shift');
      return;
    }

    const includeTraining = config?.shift_reports_include_training ?? true;
    const traineeIds = includeTraining
      ? crewMembers
          .filter(m => m.has_active_enrollment && selectedCrewIds.has(m.user_id))
          .map(m => m.user_id)
      : [];

    const evaluations: CrewMemberEvaluation[] = traineeIds
      .map(id => {
        const ev = traineeEvals[id];
        const entry: CrewMemberEvaluation = { user_id: id };
        if (ev?.performance_rating) entry.performance_rating = ev.performance_rating;
        if (ev?.areas_of_strength) entry.areas_of_strength = ev.areas_of_strength;
        if (ev?.areas_for_improvement) entry.areas_for_improvement = ev.areas_for_improvement;
        const remark = crewRemarks[id] || ev?.remarks;
        if (remark) entry.remarks = remark;
        if (ev?.skills_observed?.length) entry.skills_observed = ev.skills_observed;
        const filteredTasks = ev?.tasks_performed?.filter(t => t.task.trim());
        if (filteredTasks?.length) entry.tasks_performed = filteredTasks;
        const enrollId = crewMembers.find(m => m.user_id === id)?.enrollment_id;
        if (enrollId) entry.enrollment_id = enrollId;
        return entry;
      })
      .filter(ev =>
        ev.performance_rating || ev.areas_of_strength || ev.areas_for_improvement ||
        ev.remarks || ev.skills_observed || ev.tasks_performed
      );

    const nonTraineeRemarks = Array.from(selectedCrewIds)
      .filter(id => !traineeIds.includes(id) && crewRemarks[id])
      .map(id => ({
        user_id: id,
        remarks: crewRemarks[id],
      }));

    const allEvaluations = [...evaluations, ...nonTraineeRemarks.map(r => ({
      user_id: r.user_id,
      remarks: r.remarks,
    } as CrewMemberEvaluation))];

    const payload: BatchShiftReportCreate = {
      shift_id: form.shift_id ?? '',
      shift_date: form.shift_date ?? '',
      hours_on_shift: form.hours_on_shift ?? 0,
      calls_responded: form.calls_responded ?? 0,
      ...(form.call_types?.length ? { call_types: form.call_types } : {}),
      ...(form.officer_narrative ? { officer_narrative: form.officer_narrative } : {}),
      crew_member_ids: Array.from(selectedCrewIds),
      ...(allEvaluations.length > 0 ? { trainee_evaluations: allEvaluations } : {}),
      save_as_draft: asDraft,
    };

    if (asDraft) setSavingDraft(true);
    else setSubmitting(true);

    try {
      if (!isOnline && !asDraft) {
        await enqueueShiftReport(payload);
        setPendingOfflineCount(await pendingReportCount());
        toast.success('You\'re offline — report queued and will submit automatically when connectivity returns');
        if (form.shift_id) deleteDraft(form.shift_id);
      } else {
        const result = await shiftCompletionService.batchCreateReports(payload);
        const msg = asDraft
          ? `Saved ${result.created} draft${result.created !== 1 ? 's' : ''}`
          : `Submitted ${result.created} report${result.created !== 1 ? 's' : ''}`;
        toast.success(result.skipped > 0 ? `${msg} (${result.skipped} skipped — already reported)` : msg);
        if (form.shift_id) deleteDraft(form.shift_id);
      }
      resetNewForm();
      setCrewMembers([]);
      setSelectedCrewIds(new Set());
      setTraineeEvals({});
      setCrewRemarks({});
      setExpandedTraineeId(null);
      setViewMode(asDraft ? 'drafts' : 'filed-by-me');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, asDraft ? 'Failed to save drafts' : 'Failed to submit reports'));
    } finally {
      setSubmitting(false);
      setSavingDraft(false);
    }
  };

  const handleAcknowledge = async () => {
    if (!ackReportId) return;
    setAcknowledging(true);
    try {
      await shiftCompletionService.acknowledgeReport(ackReportId, ackComments || undefined);
      toast.success('Report acknowledged');
      setAckReportId(null);
      setAckComments('');
      void loadReports();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to acknowledge report'));
    } finally {
      setAcknowledging(false);
    }
  };

  const handleReview = async (action: typeof SubmissionStatus.APPROVED | 'flagged') => {
    if (!reviewReportId) return;
    setReviewing(true);
    try {
      await shiftCompletionService.reviewReport(reviewReportId, {
        review_status: action,
        reviewer_notes: reviewNotes || undefined,
        redact_fields: redactFields.length > 0 ? redactFields : undefined,
      });
      toast.success(action === SubmissionStatus.APPROVED ? 'Report approved' : 'Report flagged');
      setReviewReportId(null);
      setReviewNotes('');
      setRedactFields([]);
      void loadReports();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to review report'));
    } finally {
      setReviewing(false);
    }
  };

  const handleBatchReview = async (action: typeof SubmissionStatus.APPROVED | 'flagged') => {
    if (selectedReportIds.size === 0) return;
    if (action === 'flagged' && !batchReviewNotes.trim()) {
      toast.error('Please add a comment explaining why these reports are being flagged');
      return;
    }
    setBatchReviewing(true);
    try {
      const batchPayload: { report_ids: string[]; review_status: string; reviewer_notes?: string } = {
        report_ids: Array.from(selectedReportIds),
        review_status: action,
      };
      if (batchReviewNotes.trim()) batchPayload.reviewer_notes = batchReviewNotes.trim();
      const result = await shiftCompletionService.batchReviewReports(batchPayload);
      toast.success(`${result.reviewed} report${result.reviewed !== 1 ? 's' : ''} ${action === SubmissionStatus.APPROVED ? 'approved' : 'flagged'}`);
      setSelectedReportIds(new Set());
      setBatchReviewNotes('');
      void loadReports();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to batch review reports'));
    } finally {
      setBatchReviewing(false);
    }
  };

  const toggleReportSelection = (reportId: string) => {
    setSelectedReportIds(prev => {
      const next = new Set(prev);
      if (next.has(reportId)) {
        next.delete(reportId);
      } else {
        next.add(reportId);
      }
      return next;
    });
  };

  const toggleRedactField = (field: string) => {
    setRedactFields(prev =>
      prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
    );
  };

  const handleEditDraft = (report: ShiftCompletionReport) => {
    setEditingDraftId(report.id);
    setDraftForm({
      hours_on_shift: report.hours_on_shift,
      calls_responded: report.calls_responded,
      call_types: report.call_types || [],
      performance_rating: report.performance_rating ?? undefined,
      areas_of_strength: report.areas_of_strength || '',
      areas_for_improvement: report.areas_for_improvement || '',
      officer_narrative: report.officer_narrative || '',
      skills_observed: report.skills_observed || [],
      tasks_performed: report.tasks_performed || [],
    });
    setExpandedId(report.id);
  };

  const handleSaveDraft = async (submit: boolean) => {
    if (!editingDraftId) return;
    setSavingDraft(true);
    try {
      const payload: Record<string, unknown> = {
        ...draftForm,
        performance_rating: draftForm.performance_rating || undefined,
        areas_of_strength: draftForm.areas_of_strength || undefined,
        areas_for_improvement: draftForm.areas_for_improvement || undefined,
        officer_narrative: draftForm.officer_narrative || undefined,
        skills_observed: draftForm.skills_observed?.length ? draftForm.skills_observed : undefined,
        tasks_performed: draftForm.tasks_performed?.filter(t => t.task.trim()) || undefined,
      };
      if (submit) {
        payload.review_status = config?.report_review_required ? 'pending_review' : 'approved';
      }
      await shiftCompletionService.updateReport(editingDraftId, payload);
      toast.success(submit ? 'Report submitted' : 'Draft saved');
      setEditingDraftId(null);
      void loadReports();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save report'));
    } finally {
      setSavingDraft(false);
    }
  };

  // Configurable rating display
  const renderRating = (rating: number | undefined | null) => {
    if (!rating) return <span className="text-theme-text-muted text-xs">No rating</span>;

    if (ratingScaleType === 'stars') {
      return (
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map(i => (
            <Star key={i} className={`w-3.5 h-3.5 ${i <= rating ? 'fill-amber-400 text-amber-700 dark:text-amber-400' : 'text-theme-text-muted'}`} />
          ))}
        </div>
      );
    }

    // Competency or custom labels
    const label = ratingScaleLabels[String(rating)] || `Level ${rating}`;
    const colorMap: Record<number, string> = {
      1: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
      2: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
      3: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
      4: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
      5: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
    };

    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${colorMap[rating] || colorMap[3]}`}>
        {label}
      </span>
    );
  };

  // Rating input that adapts to scale type
  const ratingLevelCount = useMemo(() => {
    return Object.keys(ratingScaleLabels).length || 5;
  }, [ratingScaleLabels]);

  const renderTraineeDashboard = () => {
    if (!traineeStats || traineeStats.total_reports === 0) return null;
    const maxHours = Math.max(...traineeStats.monthly.map(m => m.hours), 1);
    return (
      <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-4 sm:p-5 space-y-4">
        <h3 className="text-sm font-semibold text-theme-text-primary flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-violet-500" /> My Shift Progress
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-violet-500/5 border border-violet-500/15 rounded-lg text-center">
            <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">{traineeStats.total_reports}</p>
            <p className="text-xs text-theme-text-muted mt-0.5">Reports</p>
          </div>
          {traineeStats.total_hours != null && (
            <div className="p-3 bg-blue-500/5 border border-blue-500/15 rounded-lg text-center">
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{traineeStats.total_hours.toFixed(1)}</p>
              <p className="text-xs text-theme-text-muted mt-0.5">Hours</p>
            </div>
          )}
          {traineeStats.total_calls != null && (
            <div className="p-3 bg-green-500/5 border border-green-500/15 rounded-lg text-center">
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{traineeStats.total_calls}</p>
              <p className="text-xs text-theme-text-muted mt-0.5">Calls</p>
            </div>
          )}
          {traineeStats.avg_rating != null && (
            <div className="p-3 bg-amber-500/5 border border-amber-500/15 rounded-lg text-center">
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{traineeStats.avg_rating}</p>
              <p className="text-xs text-theme-text-muted mt-0.5">Avg Rating</p>
            </div>
          )}
        </div>
        {traineeStats.monthly.length > 1 && (
          <div>
            <p className="text-xs font-medium text-theme-text-secondary mb-2">Monthly Hours</p>
            <div className="flex items-end gap-1 h-20">
              {traineeStats.monthly.map(m => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-violet-500/20 rounded-t"
                    style={{ height: `${Math.max((m.hours / maxHours) * 100, 4)}%` }}
                  />
                  <span className="text-[9px] text-theme-text-muted">{m.month.split('-')[1] ?? ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderOfficerDashboard = () => {
    if (!officerAnalytics || officerAnalytics.total_reports === 0) return null;
    const maxHours = Math.max(...officerAnalytics.monthly.map(m => m.hours), 1);
    const draftCount = officerAnalytics.status_counts['draft'] ?? 0;
    const pendingCount = officerAnalytics.status_counts['pending_review'] ?? 0;
    return (
      <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-4 sm:p-5 space-y-4">
        <h3 className="text-sm font-semibold text-theme-text-primary flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-violet-500" /> Shift Report Analytics
        </h3>
        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-3 bg-violet-500/5 border border-violet-500/15 rounded-lg text-center">
            <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">{officerAnalytics.total_reports}</p>
            <p className="text-xs text-theme-text-muted mt-0.5">Reports</p>
          </div>
          <div className="p-3 bg-blue-500/5 border border-blue-500/15 rounded-lg text-center">
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{officerAnalytics.total_hours.toFixed(1)}</p>
            <p className="text-xs text-theme-text-muted mt-0.5">Total Hours</p>
          </div>
          <div className="p-3 bg-green-500/5 border border-green-500/15 rounded-lg text-center">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{officerAnalytics.total_calls}</p>
            <p className="text-xs text-theme-text-muted mt-0.5">Total Calls</p>
          </div>
          {draftCount > 0 && (
            <div className="p-3 bg-blue-500/5 border border-blue-500/15 rounded-lg text-center cursor-pointer hover:bg-blue-500/10 transition-colors"
              onClick={() => setViewMode('drafts')}
            >
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{draftCount}</p>
              <p className="text-xs text-theme-text-muted mt-0.5">Drafts</p>
            </div>
          )}
          {pendingCount > 0 && (
            <div className="p-3 bg-amber-500/5 border border-amber-500/15 rounded-lg text-center cursor-pointer hover:bg-amber-500/10 transition-colors"
              onClick={() => setViewMode('pending-review')}
            >
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{pendingCount}</p>
              <p className="text-xs text-theme-text-muted mt-0.5">Pending Review</p>
            </div>
          )}
        </div>

        {/* Per-trainee table */}
        {officerAnalytics.trainees.length > 0 && (
          <div>
            <p className="text-xs font-medium text-theme-text-secondary mb-2 flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> Trainee Summary
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-theme-text-muted border-b border-theme-surface-border">
                    <th className="pb-2 font-medium text-left">Trainee</th>
                    <th className="pb-2 pl-4 font-medium text-center">Reports</th>
                    <th className="pb-2 pl-4 font-medium text-center">Hours</th>
                    <th className="pb-2 pl-4 font-medium text-center">Calls</th>
                    <th className="pb-2 pl-4 font-medium text-center">Avg Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-surface-border">
                  {officerAnalytics.trainees.map(t => (
                    <tr key={t.trainee_id} className="text-theme-text-primary">
                      <td className="py-2 font-medium text-left">{t.name}</td>
                      <td className="py-2 pl-4 text-center">{t.reports}</td>
                      <td className="py-2 pl-4 text-center">{t.hours.toFixed(1)}</td>
                      <td className="py-2 pl-4 text-center">{t.calls}</td>
                      <td className="py-2 pl-4 text-center">{t.avg_rating ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Monthly trend */}
        {officerAnalytics.monthly.length > 1 && (
          <div>
            <p className="text-xs font-medium text-theme-text-secondary mb-2">Monthly Trend</p>
            <div className="flex items-end gap-1.5 h-24">
              {officerAnalytics.monthly.map(m => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] font-medium text-theme-text-muted">{m.reports}</span>
                  <div
                    className="w-full bg-violet-500/20 rounded-t"
                    style={{ height: `${Math.max((m.hours / maxHours) * 100, 4)}%` }}
                  />
                  <span className="text-[9px] text-theme-text-muted">{m.month.split('-')[1] ?? ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderReportCard = (report: ShiftCompletionReport) => {
    const isExpanded = expandedId === report.id;
    const isMyReport = report.trainee_id === user?.id;
    const isReviewMode = viewMode === 'pending-review';
    const dateStr = formatDateCustom(report.shift_date + 'T12:00:00', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    }, tz);

    const statusStyle = REVIEW_STATUS_STYLES[report.review_status] ?? { bg: 'bg-green-500/10', text: 'text-green-700 dark:text-green-400', label: 'Approved' };

    return (
      <div key={report.id} className="bg-theme-surface border border-theme-surface-border rounded-xl overflow-hidden">
        <button
          onClick={() => setExpandedId(isExpanded ? null : report.id)}
          className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-theme-surface-hover transition-colors"
        >
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
            {(isReviewMode || viewMode === 'flagged') && (
              <input
                type="checkbox"
                checked={selectedReportIds.has(report.id)}
                onChange={(e) => { e.stopPropagation(); toggleReportSelection(report.id); }}
                onClick={(e) => e.stopPropagation()}
                className="form-checkbox shrink-0"
              />
            )}
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-violet-500" />
            </div>
            <div className="min-w-0">
              <p className="text-sm sm:text-base font-semibold text-theme-text-primary truncate">
                {report.trainee_name ? `${report.trainee_name} — ` : ''}{dateStr}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                <span className="flex items-center gap-1 text-xs text-theme-text-muted">
                  <Clock className="w-3 h-3" /> {report.hours_on_shift}h
                </span>
                <span className="flex items-center gap-1 text-xs text-theme-text-muted">
                  <Phone className="w-3 h-3" /> {report.calls_responded} calls
                </span>
                {report.performance_rating && renderRating(report.performance_rating)}
                {report.officer_name && (
                  <span className="flex items-center gap-1 text-xs text-theme-text-muted">
                    <UserIcon className="w-3 h-3" /> {report.officer_name}
                  </span>
                )}
                {report.reviewer_name && (
                  <span className="flex items-center gap-1 text-xs text-theme-text-muted">
                    <Shield className="w-3 h-3" /> Reviewed by {report.reviewer_name}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Aging indicator for pending/flagged */}
            {(report.review_status === 'pending_review' || report.review_status === 'flagged') && (() => {
              const days = Math.floor((Date.now() - new Date(report.created_at).getTime()) / 86400000);
              if (days < 1) return null;
              return (
                <span className={`text-xs font-medium ${
                  days >= 7 ? 'text-red-600 dark:text-red-400'
                    : days >= 3 ? 'text-amber-600 dark:text-amber-400'
                    : 'text-theme-text-muted'
                }`}>
                  {days}d
                </span>
              );
            })()}
            {/* Review status badge */}
            {report.review_status !== SubmissionStatus.APPROVED && (
              <span className={`px-2 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text} border border-current/20 rounded-full`}>
                {statusStyle.label}
              </span>
            )}
            {isMyReport && !report.trainee_acknowledged && report.review_status === SubmissionStatus.APPROVED && (
              <span className="px-2 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 rounded-full">
                Needs Acknowledgment
              </span>
            )}
            {report.trainee_acknowledged && (
              <span className="px-2 py-0.5 text-xs font-medium bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20 rounded-full">
                Acknowledged
              </span>
            )}
            {isExpanded ? <ChevronUp className="w-4 h-4 text-theme-text-muted" /> : <ChevronDown className="w-4 h-4 text-theme-text-muted" />}
          </div>
        </button>

        {isExpanded && (
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 border-t border-theme-surface-border space-y-4">
            <div className="pt-3">
              <ReportContentDisplay report={report} />
            </div>

            {/* Print button */}
            <div className="flex justify-end print:hidden">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const printContent = document.getElementById(`report-print-${report.id}`);
                  if (!printContent) return;
                  const printWindow = window.open('', '_blank');
                  if (!printWindow) return;
                  printWindow.document.write(`<!DOCTYPE html>
<html><head><title>Shift Report — ${report.trainee_name || 'Report'} — ${report.shift_date}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; font-size: 12pt; line-height: 1.5; margin: 1in; color: #111; }
  h1 { font-size: 16pt; margin-bottom: 4pt; }
  h2 { font-size: 13pt; margin-top: 16pt; margin-bottom: 4pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; }
  .meta { color: #666; font-size: 10pt; margin-bottom: 12pt; }
  .meta span { margin-right: 16pt; }
  .field-label { font-weight: 600; font-size: 10pt; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin-top: 10pt; }
  .field-value { margin-top: 2pt; margin-bottom: 8pt; }
  .skill-badge { display: inline-block; padding: 2px 8px; border: 1px solid #aaa; border-radius: 12px; font-size: 9pt; margin: 2px 4px 2px 0; }
  .footer { margin-top: 24pt; padding-top: 8pt; border-top: 1px solid #ccc; font-size: 9pt; color: #999; }
  @media print { body { margin: 0.5in; } }
</style></head><body>`);
                  printWindow.document.write(printContent.innerHTML);
                  printWindow.document.write(`<div class="footer">Generated from The Logbook on ${new Date().toLocaleDateString()}</div>`);
                  printWindow.document.write('</body></html>');
                  printWindow.document.close();
                  printWindow.focus();
                  printWindow.print();
                }}
                className="text-xs text-theme-text-muted hover:text-theme-text-primary inline-flex items-center gap-1 transition-colors"
              >
                <Printer className="w-3.5 h-3.5" /> Print Report
              </button>
            </div>

            {/* Hidden print-optimized content */}
            <div id={`report-print-${report.id}`} className="hidden">
              <h1>Shift Completion Report</h1>
              <div className="meta">
                <span><strong>Member:</strong> {report.trainee_name || 'Unknown'}</span>
                <span><strong>Date:</strong> {dateStr}</span>
                <span><strong>Hours:</strong> {report.hours_on_shift}h</span>
                <span><strong>Calls:</strong> {report.calls_responded}</span>
                {report.officer_name && <span><strong>Filed by:</strong> {report.officer_name}</span>}
                {report.reviewer_name && <span><strong>Reviewed by:</strong> {report.reviewer_name}</span>}
              </div>
              {report.performance_rating && (
                <><div className="field-label">Performance Rating</div>
                <div className="field-value">{report.performance_rating}/5 — {ratingScaleLabels[String(report.performance_rating)] || ''}</div></>
              )}
              {report.call_types && report.call_types.length > 0 && (
                <><div className="field-label">Call Types</div>
                <div className="field-value">{report.call_types.join(', ')}</div></>
              )}
              {report.areas_of_strength && (
                <><div className="field-label">Areas of Strength</div>
                <div className="field-value">{report.areas_of_strength}</div></>
              )}
              {report.areas_for_improvement && (
                <><div className="field-label">Areas for Improvement</div>
                <div className="field-value">{report.areas_for_improvement}</div></>
              )}
              {report.officer_narrative && (
                <><div className="field-label">Officer Narrative</div>
                <div className="field-value">{report.officer_narrative}</div></>
              )}
              {report.skills_observed && report.skills_observed.length > 0 && (
                <><div className="field-label">Skills Observed</div>
                <div className="field-value">
                  {report.skills_observed.map((s, i) => (
                    <span key={i} className="skill-badge">
                      {s.skill_name}{s.score ? ` — ${s.score}/5` : ''}
                    </span>
                  ))}
                </div></>
              )}
              {report.tasks_performed && report.tasks_performed.length > 0 && (
                <><div className="field-label">Tasks Performed</div>
                <div className="field-value">
                  {report.tasks_performed.map((t, i) => (
                    <div key={i}>{t.task}{t.description ? ` — ${t.description}` : ''}</div>
                  ))}
                </div></>
              )}
              {report.trainee_acknowledged && (
                <><div className="field-label">Acknowledgment</div>
                <div className="field-value">Acknowledged{report.trainee_comments ? `: ${report.trainee_comments}` : ''}</div></>
              )}
            </div>

            {/* Reviewer comment (visible to officers, not trainees) */}
            {canManage && report.reviewer_notes && (
              <div className={`p-3 rounded-lg ${
                report.review_status === 'flagged'
                  ? 'bg-red-500/5 border border-red-500/20'
                  : 'bg-amber-500/5 border border-amber-500/20'
              }`}>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-1 flex items-center gap-1 ${
                  report.review_status === 'flagged'
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}>
                  <Shield className="w-3 h-3" />
                  {report.review_status === 'flagged' ? 'Reviewer Comment — Flagged' : 'Reviewer Comment'}
                  {report.reviewer_name && (
                    <span className="normal-case font-normal ml-1">by {report.reviewer_name}</span>
                  )}
                </p>
                <p className="text-sm text-theme-text-primary">{report.reviewer_notes}</p>
              </div>
            )}

            {/* Review history timeline */}
            {canManage && report.review_history && report.review_history.length > 1 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Review History
                </p>
                <div className="space-y-1 pl-2 border-l-2 border-theme-surface-border">
                  {report.review_history.map((entry, i) => (
                    <div key={i} className="pl-3 py-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`font-medium capitalize ${
                          entry.status === 'approved' ? 'text-green-700 dark:text-green-400'
                            : entry.status === 'flagged' ? 'text-red-700 dark:text-red-400'
                            : 'text-theme-text-secondary'
                        }`}>
                          {entry.status === 'pending_review' ? 'Submitted' : entry.status}
                        </span>
                        {entry.reviewer_name && (
                          <span className="text-theme-text-muted">by {entry.reviewer_name}</span>
                        )}
                        <span className="text-theme-text-muted">
                          {formatDateCustom(entry.timestamp, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, tz)}
                        </span>
                      </div>
                      {entry.notes && (
                        <p className="text-xs text-theme-text-muted mt-0.5 italic">&quot;{entry.notes}&quot;</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Review actions for pending-review and flagged modes */}
            {(isReviewMode && report.review_status === SubmissionStatus.PENDING_REVIEW) && (
              <div className="pt-2 flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setReviewReportId(report.id); }}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1.5"
                >
                  <ClipboardCheck className="w-4 h-4" /> Review Report
                </button>
              </div>
            )}
            {canManage && report.review_status === 'flagged' && !isReviewMode && (
              <div className="pt-2 space-y-3">
                <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Flagged for Review
                  </p>
                  <p className="text-sm text-theme-text-secondary">
                    This report has been flagged and requires attention. You can re-review it to approve or add notes.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setReviewReportId(report.id); }}
                    className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1.5"
                  >
                    <ClipboardCheck className="w-4 h-4" /> Re-Review Report
                  </button>
                </div>
              </div>
            )}

            {/* Acknowledge button for trainee */}
            {isMyReport && !report.trainee_acknowledged && report.review_status === SubmissionStatus.APPROVED && (
              <div className="pt-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setAckReportId(report.id); }}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" /> Acknowledge Report
                </button>
              </div>
            )}

            {/* Draft edit actions */}
            {viewMode === 'drafts' && report.review_status === 'draft' && canManage && editingDraftId !== report.id && (
              <div className="pt-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleEditDraft(report); }}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1.5"
                >
                  <Pencil className="w-4 h-4" /> Complete Draft
                </button>
              </div>
            )}

            {/* Inline draft edit form */}
            {editingDraftId === report.id && (
              <div className="pt-3 space-y-4 border-t border-theme-surface-border" onClick={e => e.stopPropagation()}>
                <h4 className="text-sm font-semibold text-theme-text-primary">Complete Draft Report</h4>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-theme-text-secondary mb-1">Hours on Shift</label>
                    <input type="number" step="0.25" min="0" value={draftForm.hours_on_shift ?? 0}
                      onChange={e => setDraftForm(p => ({ ...p, hours_on_shift: parseFloat(e.target.value) || 0 }))}
                      className="form-input focus:ring-violet-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-theme-text-secondary mb-1">Calls Responded</label>
                    <input type="number" min="0" value={draftForm.calls_responded ?? 0}
                      onChange={e => setDraftForm(p => ({ ...p, calls_responded: parseInt(e.target.value) || 0 }))}
                      className="form-input focus:ring-violet-500 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-theme-text-secondary mb-1">Call Types</label>
                  <div className="flex flex-wrap gap-1.5">
                    {callTypeOptions.map(type => {
                      const isSelected = (draftForm.call_types || []).includes(type);
                      return (
                        <button key={type} type="button" onClick={() => toggleCallType(setDraftForm, type)}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                            isSelected
                              ? 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30'
                              : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-violet-500/30'
                          }`}
                        >
                          {type}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-theme-text-secondary mb-1">{ratingLabel}</label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map(val => (
                      <button key={val} type="button"
                        onClick={() => setDraftForm(p => ({ ...p, performance_rating: val }))}
                        className="p-1"
                      >
                        <Star className={`w-5 h-5 ${(draftForm.performance_rating ?? 0) >= val ? 'fill-amber-400 text-amber-400' : 'text-theme-text-muted'}`} />
                      </button>
                    ))}
                    {draftForm.performance_rating && ratingScaleType === 'competency' && (
                      <span className="ml-2 text-xs text-theme-text-muted">
                        {ratingScaleLabels[String(draftForm.performance_rating)] ?? ''}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-theme-text-secondary mb-1">Skills Observed</label>
                  <div className="flex flex-wrap gap-1.5">
                    {skillOptions.map(skill => {
                      const isSelected = (draftForm.skills_observed || []).some(s => s.skill_name === skill);
                      return (
                        <button key={skill} type="button" onClick={() => toggleSkill(setDraftForm, skill)}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                            isSelected
                              ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30'
                              : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-green-500/30'
                          }`}
                        >
                          {skill}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-theme-text-secondary mb-1">Officer Narrative</label>
                  <textarea rows={3} value={draftForm.officer_narrative || ''}
                    onChange={e => setDraftForm(p => ({ ...p, officer_narrative: e.target.value }))}
                    placeholder="Summary of trainee performance during this shift..."
                    className="form-input focus:ring-violet-500 resize-none text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-theme-text-secondary mb-1">Areas of Strength</label>
                    <textarea rows={2} value={draftForm.areas_of_strength || ''}
                      onChange={e => setDraftForm(p => ({ ...p, areas_of_strength: e.target.value }))}
                      className="form-input focus:ring-violet-500 resize-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-theme-text-secondary mb-1">Areas for Improvement</label>
                    <textarea rows={2} value={draftForm.areas_for_improvement || ''}
                      onChange={e => setDraftForm(p => ({ ...p, areas_for_improvement: e.target.value }))}
                      className="form-input focus:ring-violet-500 resize-none text-sm"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 justify-end pt-1">
                  <button onClick={() => setEditingDraftId(null)}
                    className="px-3 py-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary"
                  >
                    Cancel
                  </button>
                  <button onClick={() => { void handleSaveDraft(false); }} disabled={savingDraft}
                    className="px-3 py-1.5 text-sm border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
                  >
                    Save Draft
                  </button>
                  <button onClick={() => { void handleSaveDraft(true); }} disabled={savingDraft}
                    className="px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
                  >
                    {savingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Submit Report
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* View Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-1 bg-theme-surface border border-theme-surface-border rounded-lg p-1 flex-1 sm:flex-none">
          <button
            onClick={() => setViewMode('my-reports')}
            className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'my-reports' ? 'bg-violet-600 text-white' : 'text-theme-text-secondary hover:text-theme-text-primary'
            }`}
          >
            My Reports
          </button>
          {canManage && (
            <button
              onClick={() => setViewMode('filed-by-me')}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'filed-by-me' ? 'bg-violet-600 text-white' : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              Filed by Me
            </button>
          )}
          {canManage && config?.report_review_required && (
            <button
              onClick={() => setViewMode('pending-review')}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center justify-center gap-1 ${
                viewMode === 'pending-review' ? 'bg-violet-600 text-white' : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <ClipboardCheck className="w-3.5 h-3.5" /> Review Queue
            </button>
          )}
          {canManage && config?.report_review_required && (
            <button
              onClick={() => setViewMode('flagged')}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center justify-center gap-1 ${
                viewMode === 'flagged' ? 'bg-violet-600 text-white' : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5" /> Flagged
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setViewMode('drafts')}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center justify-center gap-1 ${
                viewMode === 'drafts' ? 'bg-violet-600 text-white' : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <FileText className="w-3.5 h-3.5" /> Drafts
              {draftBadgeCount > 0 && viewMode !== 'drafts' && (
                <span className="ml-1 px-1.5 py-0.5 text-xs font-bold rounded-full bg-blue-500 text-white leading-none">
                  {draftBadgeCount}
                </span>
              )}
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setViewMode('create')}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center justify-center gap-1 ${
                viewMode === 'create' ? 'bg-violet-600 text-white' : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <Plus className="w-4 h-4" /> New
            </button>
          )}
        </div>
      </div>

      {/* Analytics dashboards */}
      {viewMode === 'my-reports' && renderTraineeDashboard()}
      {viewMode === 'filed-by-me' && renderOfficerDashboard()}

      {/* Encryption notice for officers */}
      {canManage && viewMode === 'create' && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-500/5 border border-green-500/20 rounded-lg text-xs text-green-700 dark:text-green-400">
          <Shield className="w-3.5 h-3.5 shrink-0" />
          Narratives and evaluations are encrypted at rest (AES-256) to protect against data exfiltration.
        </div>
      )}

      {/* Offline indicator */}
      {!isOnline && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 border border-amber-500/20 rounded-lg text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          You&apos;re offline. Reports will be saved locally and submitted automatically when connectivity returns.
          {pendingOfflineCount > 0 && (
            <span className="font-medium ml-1">({pendingOfflineCount} pending)</span>
          )}
        </div>
      )}
      {isOnline && pendingOfflineCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/5 border border-blue-500/20 rounded-lg text-xs text-blue-700 dark:text-blue-400">
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
          Syncing {pendingOfflineCount} queued report{pendingOfflineCount !== 1 ? 's' : ''}...
        </div>
      )}

      {/* Create Form — Shift-first batch workflow */}
      {viewMode === 'create' && (
        <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-4 sm:p-6 space-y-5">
          <h3 className="text-lg font-semibold text-theme-text-primary">New Shift Completion Report</h3>

          {/* Step 1: Shift Selection */}
          {!form.shift_id ? (
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">Select a Shift *</label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
                <input
                  type="text"
                  placeholder="Search shifts by apparatus or date..."
                  value={shiftSearchQuery}
                  onChange={e => setShiftSearchQuery(e.target.value)}
                  className="form-input focus:ring-violet-500 pl-9 pr-3 text-sm"
                />
              </div>
              {loadingShifts ? (
                <div className="flex items-center gap-2 text-sm text-theme-text-muted py-4" role="status">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading recent shifts...
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {shiftList
                    .filter(s => {
                      if (!shiftSearchQuery) return true;
                      const q = shiftSearchQuery.toLowerCase();
                      return (s.apparatus_name ?? '').toLowerCase().includes(q)
                        || (s.shift_date ?? '').includes(q)
                        || (s.shift_officer_name ?? '').toLowerCase().includes(q);
                    })
                    .map(shift => (
                    <button
                      key={shift.id}
                      type="button"
                      onClick={() => { void handleSelectShift(shift); }}
                      className="w-full text-left px-4 py-3 rounded-lg text-sm hover:bg-theme-surface-hover transition-colors flex items-center justify-between border border-transparent hover:border-violet-500/20"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4 text-violet-500" />
                        </div>
                        <div>
                          <p className="font-medium text-theme-text-primary">
                            {shift.apparatus_name || 'Shift'} — {shift.shift_date}
                          </p>
                          <p className="text-xs text-theme-text-muted">
                            {shift.attendee_count} member{shift.attendee_count !== 1 ? 's' : ''}
                            {shift.call_count > 0 ? ` · ${shift.call_count} call${shift.call_count !== 1 ? 's' : ''}` : ''}
                            {shift.total_hours ? ` · ${shift.total_hours}h` : ''}
                          </p>
                        </div>
                      </div>
                      <ChevronDown className="w-4 h-4 text-theme-text-muted -rotate-90" />
                    </button>
                  ))}
                  {shiftList.length === 0 && (
                    <p className="text-sm text-theme-text-muted text-center py-6">No recent shifts found.</p>
                  )}
                </div>
              )}
              <div className="flex items-center gap-3 pt-4">
                <button onClick={() => setViewMode(canManage ? 'filed-by-me' : 'my-reports')}
                  className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary border border-theme-surface-border rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Selected shift banner */}
              <div className="flex items-center justify-between px-3 py-2 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400">
                  <FileText className="w-4 h-4 shrink-0" />
                  Shift: <span className="font-medium">{linkedShiftLabel}</span>
                </div>
                {!linkedShiftId && (
                  <button
                    type="button"
                    onClick={() => {
                      setForm(prev => ({ ...prev, shift_id: undefined }));
                      setLinkedShiftLabel(null);
                      setCrewMembers([]);
                      setSelectedCrewIds(new Set());
                    }}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Change shift
                  </button>
                )}
              </div>

              {/* Step 2: Shift-Level Data */}
              <div className="form-grid-3">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Shift Date</label>
                  <input type="date" value={form.shift_date || ''} readOnly
                    className="form-input text-sm bg-theme-surface-hover cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Hours on Shift *</label>
                  <input type="number" min="0.5" max="48" step="0.5" value={form.hours_on_shift || ''}
                    onChange={e => setForm(prev => ({ ...prev, hours_on_shift: parseFloat(e.target.value) || 0 }))}
                    className="form-input focus:ring-violet-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Calls Responded</label>
                  <input type="number" min="0" value={form.calls_responded || 0}
                    onChange={e => setForm(prev => ({ ...prev, calls_responded: parseInt(e.target.value) || 0 }))}
                    className="form-input focus:ring-violet-500 text-sm"
                  />
                </div>
              </div>

              {/* Call Types */}
              {(config?.form_show_call_types ?? true) && (form.calls_responded || 0) > 0 && (
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Call Types</label>
                  <div className="flex flex-wrap gap-2">
                    {callTypeOptions.map(type => (
                      <button key={type} type="button" onClick={() => handleToggleCallType(type)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          form.call_types?.includes(type)
                            ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30'
                            : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-blue-500/30'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Officer Narrative (shift-level) */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Overall Shift Narrative</label>
                <textarea rows={3} value={form.officer_narrative || ''}
                  onChange={e => setForm(prev => ({ ...prev, officer_narrative: e.target.value }))}
                  placeholder="General observations about the shift for leadership review..."
                  className="form-input focus:ring-violet-500 resize-none text-sm"
                />
              </div>

              {/* Step 3: Crew Members */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Crew Members
                  {crewMembers.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-theme-text-muted">
                      ({selectedCrewIds.size} of {crewMembers.filter(m => !m.has_existing_report).length} selected)
                    </span>
                  )}
                </label>
                {loadingCrew ? (
                  <div className="flex items-center gap-2 text-sm text-theme-text-muted py-4" role="status">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading crew...
                  </div>
                ) : crewMembers.length === 0 ? (
                  <p className="text-sm text-theme-text-muted py-4">No crew members assigned to this shift.</p>
                ) : (
                  <div className="space-y-2">
                    {crewMembers.map(member => {
                      const isTrainee = member.has_active_enrollment && (config?.shift_reports_include_training ?? true);
                      const isReported = member.has_existing_report;
                      const isSelected = selectedCrewIds.has(member.user_id);
                      const isExpanded = expandedTraineeId === member.user_id;
                      const eval_ = traineeEvals[member.user_id];

                      if (isReported) {
                        return (
                          <div key={member.user_id} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-theme-surface-hover opacity-60">
                            <Check className="w-4 h-4 text-green-600 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm text-theme-text-muted line-through">{member.user_name}</span>
                              <span className="text-xs text-theme-text-muted ml-2">Already reported</span>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={member.user_id} className={`border rounded-lg transition-colors ${
                          isSelected
                            ? isTrainee ? 'border-violet-500/30 bg-violet-500/5' : 'border-theme-surface-border bg-theme-surface'
                            : 'border-theme-surface-border bg-theme-surface opacity-60'
                        }`}>
                          {/* Member header row */}
                          <div className="flex items-center gap-3 px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleCrewMember(member.user_id)}
                              className="form-checkbox shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-theme-text-primary">{member.user_name}</span>
                                <span className="text-xs text-theme-text-muted capitalize">{member.position}</span>
                                {isTrainee && (
                                  <span className="px-2 py-0.5 text-xs font-medium bg-violet-500/10 text-violet-700 dark:text-violet-400 border border-violet-500/20 rounded-full">
                                    Trainee — {member.program_name}
                                  </span>
                                )}
                              </div>
                            </div>
                            {/* Remarks for non-trainees */}
                            {!isTrainee && isSelected && (
                              <input
                                type="text"
                                placeholder="Remarks (optional)"
                                value={crewRemarks[member.user_id] || ''}
                                onChange={e => setCrewRemarks(prev => ({ ...prev, [member.user_id]: e.target.value }))}
                                className="form-input focus:ring-violet-500 text-xs py-1.5 max-w-xs"
                              />
                            )}
                            {/* Expand/collapse for trainees */}
                            {isTrainee && isSelected && (
                              <button
                                type="button"
                                onClick={() => setExpandedTraineeId(isExpanded ? null : member.user_id)}
                                className="text-xs text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-1"
                              >
                                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                Evaluate
                              </button>
                            )}
                          </div>

                          {/* Trainee evaluation panel */}
                          {isTrainee && isSelected && isExpanded && (
                            <div className="px-4 pb-4 border-t border-theme-surface-border space-y-4 pt-3">
                              {/* Per-trainee remarks */}
                              <div>
                                <label className="block text-xs font-medium text-theme-text-secondary mb-1">Remarks for {member.user_name}</label>
                                <input
                                  type="text"
                                  placeholder="Individual remarks for this trainee..."
                                  value={crewRemarks[member.user_id] || ''}
                                  onChange={e => setCrewRemarks(prev => ({ ...prev, [member.user_id]: e.target.value }))}
                                  className="form-input focus:ring-violet-500 text-sm"
                                />
                              </div>

                              {/* Performance Rating */}
                              {(config?.form_show_performance_rating ?? true) && (
                                <div>
                                  <label className="block text-xs font-medium text-theme-text-secondary mb-1">{ratingLabel}</label>
                                  <div className="flex items-center gap-1">
                                    {Array.from({ length: ratingLevelCount }, (_, i) => i + 1).map(val => {
                                      const label = ratingScaleLabels[String(val)] || `Level ${val}`;
                                      const isActive = (eval_?.performance_rating ?? 0) >= val;
                                      return ratingScaleType === 'stars' ? (
                                        <button key={val} type="button"
                                          onClick={() => updateTraineeEval(member.user_id, 'performance_rating', val)}
                                          className="p-0.5"
                                          title={label}
                                        >
                                          <Star className={`w-5 h-5 ${isActive ? 'fill-amber-400 text-amber-400' : 'text-theme-text-muted hover:text-amber-300'}`} />
                                        </button>
                                      ) : (
                                        <button key={val} type="button"
                                          onClick={() => updateTraineeEval(member.user_id, 'performance_rating', eval_?.performance_rating === val ? undefined : val)}
                                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                                            eval_?.performance_rating === val
                                              ? 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30'
                                              : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-violet-500/30'
                                          }`}
                                        >
                                          {label}
                                        </button>
                                      );
                                    })}
                                    {eval_?.performance_rating && ratingScaleType === 'stars' && (
                                      <span className="text-xs text-theme-text-muted ml-1">
                                        {ratingScaleLabels[String(eval_.performance_rating)] || `Level ${eval_.performance_rating}`}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Narrative Fields */}
                              {((config?.form_show_areas_of_strength ?? true) || (config?.form_show_areas_for_improvement ?? true)) && (
                                <div className="form-grid-2">
                                  {(config?.form_show_areas_of_strength ?? true) && (
                                    <div>
                                      <label className="block text-xs font-medium text-theme-text-secondary mb-1">Areas of Strength</label>
                                      <textarea rows={2} value={eval_?.areas_of_strength || ''}
                                        onChange={e => updateTraineeEval(member.user_id, 'areas_of_strength', e.target.value)}
                                        placeholder="What did they do well?"
                                        className="form-input focus:ring-violet-500 resize-none text-sm"
                                      />
                                    </div>
                                  )}
                                  {(config?.form_show_areas_for_improvement ?? true) && (
                                    <div>
                                      <label className="block text-xs font-medium text-theme-text-secondary mb-1">Areas for Improvement</label>
                                      <textarea rows={2} value={eval_?.areas_for_improvement || ''}
                                        onChange={e => updateTraineeEval(member.user_id, 'areas_for_improvement', e.target.value)}
                                        placeholder="What should they work on?"
                                        className="form-input focus:ring-violet-500 resize-none text-sm"
                                      />
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Skills Observed */}
                              {(config?.form_show_skills_observed ?? true) && (
                                <div>
                                  <label className="block text-xs font-medium text-theme-text-secondary mb-1">Skills Observed</label>
                                  <div className="space-y-2">
                                    {skillOptions.map(skill => {
                                      const skills = eval_?.skills_observed || [];
                                      const selected = skills.find(s => s.skill_name === skill);
                                      return (
                                        <div key={skill}>
                                          <button type="button" onClick={() => {
                                            const current = eval_?.skills_observed || [];
                                            const exists = current.find(s => s.skill_name === skill);
                                            updateTraineeEval(member.user_id, 'skills_observed',
                                              exists ? current.filter(s => s.skill_name !== skill)
                                                : [...current, { skill_name: skill, demonstrated: true }]
                                            );
                                          }}
                                            className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                                              selected
                                                ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30'
                                                : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-green-500/30'
                                            }`}
                                          >
                                            {selected ? '\u2713 ' : ''}{skill}
                                          </button>
                                          {selected && (
                                            <div className="mt-1 ml-4 flex items-center gap-1.5">
                                              <span className="text-xs text-theme-text-muted">Score:</span>
                                              {([1, 2, 3, 4, 5] as const).map(n => {
                                                const tip = ratingScaleLabels[String(n)] || `Level ${n}`;
                                                return (
                                                  <button key={n} type="button" title={tip}
                                                    onClick={() => {
                                                      const updated = (eval_?.skills_observed || []).map(s =>
                                                        s.skill_name === skill ? { ...s, score: s.score === n ? undefined : n } : s
                                                      );
                                                      updateTraineeEval(member.user_id, 'skills_observed', updated);
                                                    }}
                                                    className={`w-5 h-5 rounded text-xs font-medium border transition-colors ${
                                                      selected.score === n
                                                        ? 'bg-violet-500 text-white border-violet-600'
                                                        : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-violet-400'
                                                    }`}
                                                  >
                                                    {n}
                                                  </button>
                                                );
                                              })}
                                              {selected.score && (
                                                <span className="text-xs text-violet-600 dark:text-violet-400 font-medium">
                                                  {ratingScaleLabels[String(selected.score)] || `Level ${selected.score}`}
                                                </span>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Tasks Performed */}
                              {(config?.form_show_tasks_performed ?? true) && (
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs font-medium text-theme-text-secondary">Tasks Performed</label>
                                    <button type="button" onClick={() => {
                                      const current = eval_?.tasks_performed || [];
                                      const addedNames = new Set(current.map(t => t.task.toLowerCase()));
                                      const nextDefault = taskDefaults.find(t => !addedNames.has(t.toLowerCase()));
                                      updateTraineeEval(member.user_id, 'tasks_performed', [...current, { task: nextDefault || '', description: '' }]);
                                    }}
                                      className="text-xs text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-0.5"
                                    >
                                      <Plus className="w-3 h-3" /> Add
                                    </button>
                                  </div>
                                  {(eval_?.tasks_performed || []).map((task, i) => (
                                    <div key={i} className="flex items-center gap-2 mb-1">
                                      <input type="text" placeholder="Task name" value={task.task}
                                        onChange={e => {
                                          const updated = [...(eval_?.tasks_performed || [])];
                                          updated[i] = { ...updated[i], task: e.target.value } as TaskPerformed;
                                          updateTraineeEval(member.user_id, 'tasks_performed', updated);
                                        }}
                                        className="form-input focus:ring-violet-500 text-xs flex-1 py-1.5"
                                      />
                                      <button type="button" onClick={() => {
                                        updateTraineeEval(member.user_id, 'tasks_performed',
                                          (eval_?.tasks_performed || []).filter((_, j) => j !== i));
                                      }} className="p-1 text-theme-text-muted hover:text-red-500">
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Submit */}
              <div className="flex items-center gap-3 pt-2 border-t border-theme-surface-border">
                <button onClick={() => { void handleBatchSubmit(true); }} disabled={savingDraft || submitting}
                  className="px-5 py-2.5 text-sm font-medium border border-theme-surface-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50 inline-flex items-center gap-2 transition-colors"
                >
                  {savingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save as Draft
                </button>
                <button onClick={() => { void handleBatchSubmit(false); }} disabled={submitting || savingDraft}
                  className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2 transition-colors"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Submit Report{selectedCrewIds.size > 1 ? `s (${selectedCrewIds.size})` : ''}
                </button>
                <button onClick={() => setViewMode(canManage ? 'filed-by-me' : 'my-reports')}
                  className="px-4 py-2.5 text-sm text-theme-text-muted hover:text-theme-text-primary border border-theme-surface-border rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Reports List */}
      {viewMode !== 'create' && (
        <>
          {viewMode === 'drafts' && !loading && reports.length > 0 && (
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-theme-text-muted">
                {reports.length} draft{reports.length !== 1 ? 's' : ''} pending
              </p>
              <button
                onClick={() => {
                  void (async () => {
                    try {
                      const result = await shiftCompletionService.submitAllDrafts();
                      toast.success(
                        `Submitted ${result.submitted} of ${result.total} drafts`,
                      );
                      void loadReports();
                      setDraftBadgeCount(0);
                    } catch (err: unknown) {
                      toast.error(getErrorMessage(err, 'Failed to submit drafts'));
                    }
                  })();
                }}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors"
              >
                <Check className="w-4 h-4" />
                Submit All Drafts
              </button>
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
              <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
            </div>
          ) : reports.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-theme-surface-border rounded-xl">
              <FileText className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
              <h3 className="text-lg font-medium text-theme-text-primary mb-1">
                {viewMode === 'my-reports' ? 'No reports for you yet' :
                 viewMode === 'pending-review' ? 'No reports pending review' :
                 viewMode === 'flagged' ? 'No flagged reports' :
                 viewMode === 'drafts' ? 'No draft reports' :
                 'No reports filed yet'}
              </h3>
              <p className="text-theme-text-muted text-sm">
                {viewMode === 'my-reports'
                  ? 'Shift completion reports from your officers will appear here.'
                  : viewMode === 'pending-review'
                  ? 'All reports have been reviewed.'
                  : viewMode === 'flagged'
                  ? 'No reports have been flagged for follow-up.'
                  : viewMode === 'drafts'
                  ? 'Draft reports are auto-created when shifts are finalized. Complete them to track trainee progress.'
                  : 'Submit a shift report to track trainee progress.'
                }
              </p>
            </div>
          ) : (
            <>
              {/* Review summary dashboard */}
              {(viewMode === 'pending-review' || viewMode === 'flagged') && reports.length > 0 && (() => {
                const byOfficer = new Map<string, number>();
                let oldestDays = 0;
                const now = Date.now();
                for (const r of reports) {
                  const name = r.officer_name || 'Unknown';
                  byOfficer.set(name, (byOfficer.get(name) ?? 0) + 1);
                  const age = Math.floor((now - new Date(r.created_at).getTime()) / 86400000);
                  if (age > oldestDays) oldestDays = age;
                }
                return (
                  <div className="p-3 bg-theme-surface border border-theme-surface-border rounded-lg mb-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-theme-text-primary flex items-center gap-1.5">
                        <BarChart3 className="w-4 h-4 text-violet-500" />
                        {viewMode === 'pending-review' ? 'Pending Review' : 'Flagged Reports'} — {reports.length} report{reports.length !== 1 ? 's' : ''}
                      </h4>
                      {oldestDays > 0 && (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          oldestDays >= 7 ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                            : oldestDays >= 3 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                            : 'bg-theme-surface-hover text-theme-text-muted'
                        }`}>
                          Oldest: {oldestDays}d ago
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Array.from(byOfficer.entries()).map(([name, count]) => (
                        <span key={name} className="text-xs bg-theme-surface-hover px-2 py-1 rounded-full text-theme-text-secondary">
                          {name}: {count}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Batch review toolbar */}
              {(viewMode === 'pending-review' || viewMode === 'flagged') && reports.length > 1 && (
                <div className="p-3 bg-theme-surface border border-theme-surface-border rounded-lg mb-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedReportIds.size === reports.length && reports.length > 0}
                        onChange={() => {
                          if (selectedReportIds.size === reports.length) {
                            setSelectedReportIds(new Set());
                          } else {
                            setSelectedReportIds(new Set(reports.map(r => r.id)));
                          }
                        }}
                        className="form-checkbox"
                      />
                      Select all ({reports.length})
                    </label>
                    {selectedReportIds.size > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-theme-text-muted">{selectedReportIds.size} selected</span>
                        {viewMode === 'flagged' && (
                          <button
                            onClick={() => { void handleBatchReview(SubmissionStatus.APPROVED); }}
                            disabled={batchReviewing}
                            className="btn-success text-xs font-medium px-3 py-1.5 inline-flex items-center gap-1"
                          >
                            {batchReviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            Approve Selected
                          </button>
                        )}
                        {viewMode === 'pending-review' && (
                          <>
                            <button
                              onClick={() => { void handleBatchReview('flagged'); }}
                              disabled={batchReviewing}
                              className="btn-primary text-xs font-medium px-3 py-1.5 inline-flex items-center gap-1"
                            >
                              <AlertCircle className="w-3 h-3" /> Flag Selected
                            </button>
                            <button
                              onClick={() => { void handleBatchReview(SubmissionStatus.APPROVED); }}
                              disabled={batchReviewing}
                              className="btn-success text-xs font-medium px-3 py-1.5 inline-flex items-center gap-1"
                            >
                              {batchReviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              Approve Selected
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {selectedReportIds.size > 0 && (
                    <input
                      type="text"
                      placeholder={viewMode === 'pending-review' ? 'Add a comment for all selected reports (required for flagging)...' : 'Add a comment (optional)...'}
                      value={batchReviewNotes}
                      onChange={e => setBatchReviewNotes(e.target.value)}
                      className="form-input focus:ring-violet-500 text-xs py-1.5"
                    />
                  )}
                </div>
              )}
              <div className="space-y-3">
                {reports.map(renderReportCard)}
              </div>
            </>
          )}
        </>
      )}

      {/* Acknowledge Modal */}
      {ackReportId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Acknowledge Report">
          <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5 sm:p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-theme-text-primary">Acknowledge Report</h3>
            <p className="text-sm text-theme-text-secondary">
              Acknowledging confirms you have reviewed this shift completion report.
            </p>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Comments (optional)</label>
              <textarea rows={3} value={ackComments}
                onChange={e => setAckComments(e.target.value)}
                placeholder="Any feedback or comments..."
                className="form-input focus:ring-violet-500 resize-none text-sm"
              />
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => { setAckReportId(null); setAckComments(''); }}
                className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary border border-theme-surface-border rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button onClick={() => { void handleAcknowledge(); }} disabled={acknowledging}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5 transition-colors"
              >
                {acknowledging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Acknowledge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewReportId && (() => {
        const reviewReport = reports.find(r => r.id === reviewReportId);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Review Report">
          <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5 sm:p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <h3 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-violet-500" /> Review Report
            </h3>
            <p className="text-sm text-theme-text-secondary">
              Review this report before it becomes visible to the trainee.
              You can redact specific fields if they contain improper content.
            </p>

            {/* Report content preview */}
            {reviewReport && (
              <div className="border border-theme-surface-border rounded-lg p-4 bg-theme-surface-hover space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  {reviewReport.trainee_name && (
                    <span className="flex items-center gap-1 font-medium text-theme-text-primary">
                      <UserIcon className="w-3.5 h-3.5" /> {reviewReport.trainee_name}
                    </span>
                  )}
                  <span className="text-theme-text-muted">
                    {formatDateCustom(reviewReport.shift_date + 'T12:00:00', {
                      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                    }, tz)}
                  </span>
                  {reviewReport.officer_name && (
                    <span className="flex items-center gap-1 text-theme-text-muted">
                      Filed by {reviewReport.officer_name}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="flex items-center gap-1 text-theme-text-muted">
                    <Clock className="w-3.5 h-3.5" /> {reviewReport.hours_on_shift}h
                  </span>
                  <span className="flex items-center gap-1 text-theme-text-muted">
                    <Phone className="w-3.5 h-3.5" /> {reviewReport.calls_responded} calls
                  </span>
                  {reviewReport.performance_rating && renderRating(reviewReport.performance_rating)}
                </div>
                <ReportContentDisplay report={reviewReport} />
              </div>
            )}

            {/* Redaction checkboxes */}
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                Redact Fields (clear before approving)
              </label>
              <div className="space-y-2">
                {[
                  { field: 'performance_rating', label: ratingLabel },
                  { field: 'areas_of_strength', label: 'Areas of Strength' },
                  { field: 'areas_for_improvement', label: 'Areas for Improvement' },
                  { field: 'officer_narrative', label: 'Officer Narrative' },
                  { field: 'skills_observed', label: 'Skills Observed' },
                ].map(({ field, label }) => (
                  <label key={field} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={redactFields.includes(field)}
                      onChange={() => toggleRedactField(field)}
                      className="form-checkbox"
                    />
                    <span className="text-sm text-theme-text-primary flex items-center gap-1">
                      {redactFields.includes(field) ? <EyeOff className="w-3.5 h-3.5 text-red-500" /> : <Eye className="w-3.5 h-3.5 text-theme-text-muted" />}
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Reviewer notes */}
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                Reviewer Comment
              </label>
              <textarea rows={3} value={reviewNotes}
                onChange={e => setReviewNotes(e.target.value)}
                placeholder="Add a comment about this report (visible to the filing officer)..."
                className="form-input focus:ring-violet-500 resize-none text-sm"
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Visible to the officer who filed the report. Not shown to the trainee.
              </p>
            </div>

            <div className="flex items-center gap-2 justify-end pt-2">
              <button onClick={() => { setReviewReportId(null); setReviewNotes(''); setRedactFields([]); }}
                className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary border border-theme-surface-border rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button onClick={() => {
                if (!reviewNotes.trim()) {
                  toast.error('Please add a comment explaining why this report is being flagged');
                  return;
                }
                void handleReview('flagged');
              }} disabled={reviewing}
                className="btn-primary font-medium gap-1.5 inline-flex items-center text-sm"
              >
                <AlertCircle className="w-3.5 h-3.5" /> Flag for Revision
              </button>
              <button onClick={() => { void handleReview(SubmissionStatus.APPROVED); }} disabled={reviewing}
                className="btn-success font-medium gap-1.5 inline-flex items-center text-sm"
              >
                {reviewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Approve
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
};

export default ShiftReportsTab;
