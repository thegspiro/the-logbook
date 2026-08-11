/**
 * Shift Reports Tab
 *
 * Officers can submit end-of-shift completion reports for trainees.
 * Trainees can view their own reports and acknowledge them.
 * Includes performance ratings, skills observed, tasks performed, and narratives.
 * Supports review workflow, visibility controls, and configurable rating scales.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  FileText,
  Plus,
  Loader2,
  Clock,
  Phone,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Search,
  User as UserIcon,
  AlertCircle,
  Shield,
  Eye,
  EyeOff,
  ClipboardCheck,
  Pencil,
  Printer,
  BarChart3,
  TrendingUp,
  Users,
  Save,
} from 'lucide-react';
import toast from 'react-hot-toast';
import StarRating from '../../modules/scheduling/components/StarRating';
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
  TrainingModuleConfig,
  TraineeShiftStats,
  OfficerShiftAnalytics,
} from '../../types/training';
import type { User } from '../../types/user';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateCustom, getTodayLocalDate, toLocalDateString } from '../../utils/dateFormatting';
import {
  DEFAULT_SKILLS,
  DEFAULT_CALL_TYPE_OPTIONS,
  DEFAULT_COMPETENCY_LABELS,
  REVIEW_STATUS_STYLES,
  shiftHoursForOneMember,
} from '../../modules/scheduling/constants/shiftReportConstants';
import { ReportContentDisplay } from '../../modules/scheduling/components/ReportContentDisplay';
import { getErrorMessage } from '../../utils/errorHandling';
import { saveDraft, loadDraft, deleteDraft } from '../../utils/shiftReportDrafts';
import {
  enqueueShiftReport,
  listPendingReports,
  dequeueShiftReport,
  pendingReportCount,
} from '../../utils/shiftReportOfflineQueue';
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
  const linkedReportId = searchParams.get('report') || undefined;

  // Views an officer may be sent straight to. `create` is how the training
  // module hands off — its "Go to Shift Reports" button links to
  // ?tab=shift-reports&view=create — and only `drafts` was ever honoured, so
  // that hand-off landed on the list of reports already filed.
  const OFFICER_VIEWS: ViewMode[] = ['create', 'drafts', 'filed-by-me', 'pending-review', 'flagged'];

  const initialView = (): ViewMode => {
    if (linkedShiftId && canManage) return 'create';
    const viewParam = searchParams.get('view') as ViewMode | null;
    if (viewParam === 'my-reports') return 'my-reports';
    if (viewParam && canManage && OFFICER_VIEWS.includes(viewParam)) return viewParam;
    return canManage ? 'filed-by-me' : 'my-reports';
  };

  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [reports, setReports] = useState<ShiftCompletionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(linkedReportId ?? null);
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
  const [crewLoadError, setCrewLoadError] = useState(false);
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
    shiftCompletionService
      .getDraftReports()
      .then((drafts) => setDraftBadgeCount(drafts.length))
      .catch(() => {});
  }, [canManage, viewMode]);

  // Load config for visibility and rating settings
  useEffect(() => {
    trainingModuleConfigService
      .getConfig()
      .then(setConfig)
      .catch(() => {
        /* non-officer: config not available */
      });
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
      const typeSkills = config.apparatus_type_skills[shiftApparatusType];
      if (typeSkills?.length) return typeSkills;
    }
    return config?.shift_review_default_skills?.length ? config.shift_review_default_skills : DEFAULT_SKILLS;
  }, [config, shiftApparatusType]);

  const taskDefaults = useMemo(() => {
    if (shiftApparatusType && config?.apparatus_type_tasks) {
      const typeTasks = config.apparatus_type_tasks[shiftApparatusType];
      if (typeTasks?.length) return typeTasks;
    }
    return config?.shift_review_default_tasks ?? [];
  }, [config, shiftApparatusType]);

  // Load crew status when a shift is selected
  const loadCrewForShift = useCallback(async (shiftId: string) => {
    setLoadingCrew(true);
    setCrewLoadError(false);
    try {
      const crew = await shiftCompletionService.getShiftCrewStatus(shiftId);
      setCrewMembers(crew);
      const eligible = crew.filter((m) => !m.has_existing_report);
      setSelectedCrewIds(new Set(eligible.map((m) => m.user_id)));
      setTraineeEvals({});
      setCrewRemarks({});
      setExpandedTraineeId(null);
    } catch {
      setCrewLoadError(true);
      toast.error('Failed to load crew members');
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
        setLinkedShiftLabel(`${shift.apparatus_name ? `${shift.apparatus_name} — ` : ''}${shiftDate}`);
        setShiftApparatusType(shift.apparatus_type ?? null);
        const hours = shiftHoursForOneMember(shift);
        setForm((prev) => ({
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
    return () => {
      cancelled = true;
    };
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
      shiftCompletionService
        .getMyStats()
        .then(setTraineeStats)
        .catch(() => {
          /* stats not critical */
        });
    } else if (viewMode === 'filed-by-me' && canManage) {
      shiftCompletionService
        .getOfficerAnalytics()
        .then(setOfficerAnalytics)
        .catch(() => {
          /* analytics not critical */
        });
    }
  }, [viewMode, canManage]);

  // Load members for draft edit forms
  useEffect(() => {
    if (viewMode === 'create' && members.length === 0) {
      userService
        .getUsers()
        .then(setMembers)
        .catch(() => {
          /* members needed for draft edit */
        });
    }
  }, [viewMode]); // eslint-disable-line react-hooks/exhaustive-deps -- only load once when entering create mode

  // Load recent shifts when entering create mode without a linked shift
  useEffect(() => {
    if (viewMode !== 'create' || linkedShiftId) return;
    setLoadingShifts(true);
    const now = new Date();
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(now.getDate() - 14);
    schedulingService
      .getShifts({
        start_date: toLocalDateString(twoWeeksAgo, tz),
        end_date: getTodayLocalDate(tz),
        limit: 50,
      })
      .then((res) => setShiftList(res.shifts ?? []))
      .catch(() => {
        /* shifts not critical */
      })
      .finally(() => setLoadingShifts(false));
  }, [viewMode, linkedShiftId, tz]);

  // Auto-save draft to localStorage when form changes
  useEffect(() => {
    if (viewMode !== 'create' || !form.shift_id) return;
    const timer = setTimeout(() => {
      saveDraft({
        shiftId: form.shift_id || '',
        shiftLabel: linkedShiftLabel || '',
        formData: form,
        crewSelections: Array.from(selectedCrewIds),
        traineeEvals: traineeEvals,
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
      setForm((prev) => ({ ...prev, officer_narrative: draft.formData.officer_narrative as string }));
    }
  }, [form.shift_id, crewMembers.length]);

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
    type: string
  ) => {
    setter((prev) => {
      const types = prev.call_types || [];
      return {
        ...prev,
        call_types: types.includes(type) ? types.filter((t) => t !== type) : [...types, type],
      };
    });
  };

  const toggleSkill = (
    setter: React.Dispatch<React.SetStateAction<Partial<ShiftCompletionReportCreate>>>,
    skillName: string
  ) => {
    setter((prev) => {
      const skills = prev.skills_observed || [];
      const existing = skills.find((s) => s.skill_name === skillName);
      if (existing) {
        return { ...prev, skills_observed: skills.filter((s) => s.skill_name !== skillName) };
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
    setForm((prev) => ({
      ...prev,
      shift_id: shift.id,
      shift_date: shift.shift_date,
      hours_on_shift: shiftHoursForOneMember(shift),
      calls_responded: shift.call_count || 0,
    }));
    setLinkedShiftLabel(`${shift.apparatus_name ? `${shift.apparatus_name} — ` : ''}${shift.shift_date}`);
    setShiftApparatusType(shift.apparatus_type ?? null);
    await loadCrewForShift(shift.id);
  };

  const toggleCrewMember = (userId: string) => {
    setSelectedCrewIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const updateTraineeEval = (userId: string, field: keyof CrewMemberEvaluation, value: unknown) => {
    setTraineeEvals((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], user_id: userId, [field]: value },
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
      ? crewMembers.filter((m) => m.has_active_enrollment && selectedCrewIds.has(m.user_id)).map((m) => m.user_id)
      : [];

    const evaluations: CrewMemberEvaluation[] = traineeIds
      .map((id) => {
        const ev = traineeEvals[id];
        const entry: CrewMemberEvaluation = { user_id: id };
        if (ev?.performance_rating) entry.performance_rating = ev.performance_rating;
        if (ev?.areas_of_strength) entry.areas_of_strength = ev.areas_of_strength;
        if (ev?.areas_for_improvement) entry.areas_for_improvement = ev.areas_for_improvement;
        const remark = crewRemarks[id] || ev?.remarks;
        if (remark) entry.remarks = remark;
        if (ev?.skills_observed?.length) entry.skills_observed = ev.skills_observed;
        const filteredTasks = ev?.tasks_performed?.filter((t) => t.task.trim());
        if (filteredTasks?.length) entry.tasks_performed = filteredTasks;
        const enrollId = crewMembers.find((m) => m.user_id === id)?.enrollment_id;
        if (enrollId) entry.enrollment_id = enrollId;
        return entry;
      })
      .filter(
        (ev) =>
          ev.performance_rating ||
          ev.areas_of_strength ||
          ev.areas_for_improvement ||
          ev.remarks ||
          ev.skills_observed ||
          ev.tasks_performed
      );

    const nonTraineeRemarks = Array.from(selectedCrewIds)
      .filter((id) => !traineeIds.includes(id) && crewRemarks[id])
      .map((id) => ({
        user_id: id,
        remarks: crewRemarks[id],
      }));

    const allEvaluations = [
      ...evaluations,
      ...nonTraineeRemarks.map(
        (r) =>
          ({
            user_id: r.user_id,
            remarks: r.remarks,
          }) as CrewMemberEvaluation
      ),
    ];

    const payload: BatchShiftReportCreate = {
      shift_id: form.shift_id || '',
      shift_date: form.shift_date || '',
      hours_on_shift: form.hours_on_shift || 0,
      calls_responded: form.calls_responded || 0,
      ...(form.call_types?.length ? { call_types: form.call_types } : {}),
      ...(form.officer_narrative?.trim() ? { officer_narrative: form.officer_narrative.trim() } : {}),
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
        toast.success("You're offline — report queued and will submit automatically when connectivity returns");
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
      setCrewLoadError(false);
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
    if (action === 'flagged' && !reviewNotes.trim()) {
      toast.error('Please add notes when flagging a report');
      return;
    }
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
      toast.success(
        `${result.reviewed} report${result.reviewed !== 1 ? 's' : ''} ${action === SubmissionStatus.APPROVED ? 'approved' : 'flagged'}`
      );
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
    setSelectedReportIds((prev) => {
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
    setRedactFields((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]));
  };

  const handleEditDraft = (report: ShiftCompletionReport) => {
    setEditingDraftId(report.id);
    setDraftForm({
      shift_id: report.shift_id,
      shift_date: report.shift_date,
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
        tasks_performed: draftForm.tasks_performed?.filter((t) => t.task.trim()) || undefined,
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
      return <StarRating value={rating} size="sm" label={`Rating: ${rating} out of 5`} />;
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
      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${colorMap[rating] || colorMap[3]}`}>
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
    const maxHours = Math.max(...traineeStats.monthly.map((m) => m.hours), 1);
    return (
      <div className="bg-theme-surface border-theme-surface-border space-y-4 rounded-xl border p-4 sm:p-5">
        <h3 className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-violet-500" /> My Shift Progress
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-violet-500/15 bg-violet-500/5 p-3 text-center">
            <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">{traineeStats.total_reports}</p>
            <p className="text-theme-text-muted mt-0.5 text-xs">Reports</p>
          </div>
          {traineeStats.total_hours != null && (
            <div className="rounded-lg border border-blue-500/15 bg-blue-500/5 p-3 text-center">
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {traineeStats.total_hours.toFixed(1)}
              </p>
              <p className="text-theme-text-muted mt-0.5 text-xs">Hours</p>
            </div>
          )}
          {traineeStats.total_calls != null && (
            <div className="rounded-lg border border-green-500/15 bg-green-500/5 p-3 text-center">
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{traineeStats.total_calls}</p>
              <p className="text-theme-text-muted mt-0.5 text-xs">Calls</p>
            </div>
          )}
          {traineeStats.avg_rating != null && (
            <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 p-3 text-center">
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{traineeStats.avg_rating}</p>
              <p className="text-theme-text-muted mt-0.5 text-xs">Avg Rating</p>
            </div>
          )}
        </div>
        {traineeStats.monthly.length > 1 && (
          <div>
            <p className="text-theme-text-secondary mb-2 text-xs font-medium">Monthly Hours</p>
            <div className="flex h-20 items-end gap-1">
              {traineeStats.monthly.map((m) => (
                // h-full, not auto: the bar's height is a percentage, and a
                // percentage resolves against nothing on an auto-height parent,
                // so the column rendered its month label with an invisible
                // zero-height bar above it.
                <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <div
                    className="w-full rounded-t bg-violet-500/20"
                    style={{ height: `${Math.max((m.hours / maxHours) * 100, 4)}%` }}
                  />
                  <span className="text-theme-text-muted text-[9px]">{m.month.split('-')[1] ?? ''}</span>
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
    const maxHours = Math.max(...officerAnalytics.monthly.map((m) => m.hours), 1);
    const draftCount = officerAnalytics?.status_counts?.['draft'] ?? 0;
    const pendingCount = officerAnalytics?.status_counts?.['pending_review'] ?? 0;
    return (
      <div className="bg-theme-surface border-theme-surface-border space-y-4 rounded-xl border p-4 sm:p-5">
        <h3 className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-violet-500" /> Shift Report Analytics
        </h3>
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-lg border border-violet-500/15 bg-violet-500/5 p-3 text-center">
            <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">{officerAnalytics.total_reports}</p>
            <p className="text-theme-text-muted mt-0.5 text-xs">Reports</p>
          </div>
          <div className="rounded-lg border border-blue-500/15 bg-blue-500/5 p-3 text-center">
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {officerAnalytics.total_hours.toFixed(1)}
            </p>
            <p className="text-theme-text-muted mt-0.5 text-xs">Total Hours</p>
          </div>
          <div className="rounded-lg border border-green-500/15 bg-green-500/5 p-3 text-center">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{officerAnalytics.total_calls}</p>
            <p className="text-theme-text-muted mt-0.5 text-xs">Total Calls</p>
          </div>
          {draftCount > 0 && (
            <div
              className="cursor-pointer rounded-lg border border-blue-500/15 bg-blue-500/5 p-3 text-center transition-colors hover:bg-blue-500/10"
              onClick={() => setViewMode('drafts')}
            >
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{draftCount}</p>
              <p className="text-theme-text-muted mt-0.5 text-xs">Drafts</p>
            </div>
          )}
          {pendingCount > 0 && (
            <div
              className="cursor-pointer rounded-lg border border-amber-500/15 bg-amber-500/5 p-3 text-center transition-colors hover:bg-amber-500/10"
              onClick={() => setViewMode('pending-review')}
            >
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{pendingCount}</p>
              <p className="text-theme-text-muted mt-0.5 text-xs">Pending Review</p>
            </div>
          )}
        </div>

        {/* Per-trainee table */}
        {officerAnalytics.trainees.length > 0 && (
          <div>
            <p className="text-theme-text-secondary mb-2 flex items-center gap-1 text-xs font-medium">
              <Users className="h-3.5 w-3.5" /> Trainee Summary
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-theme-text-muted border-theme-surface-border border-b text-xs">
                    <th className="pb-2 text-left font-medium">Trainee</th>
                    <th className="pb-2 pl-4 text-center font-medium">Reports</th>
                    <th className="pb-2 pl-4 text-center font-medium">Hours</th>
                    <th className="pb-2 pl-4 text-center font-medium">Calls</th>
                    <th className="pb-2 pl-4 text-center font-medium">Avg Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-theme-surface-border divide-y">
                  {officerAnalytics.trainees.map((t) => (
                    <tr key={t.trainee_id} className="text-theme-text-primary">
                      <td className="py-2 text-left font-medium">{t.name}</td>
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
            <p className="text-theme-text-secondary mb-2 text-xs font-medium">Monthly Trend</p>
            <div className="flex h-24 items-end gap-1.5">
              {officerAnalytics.monthly.map((m) => (
                // See the trainee chart above: an auto-height column gives the
                // percentage-height bar nothing to resolve against.
                <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-theme-text-muted text-[9px] font-medium">{m.reports}</span>
                  <div
                    className="w-full rounded-t bg-violet-500/20"
                    style={{ height: `${Math.max((m.hours / maxHours) * 100, 4)}%` }}
                  />
                  <span className="text-theme-text-muted text-[9px]">{m.month.split('-')[1] ?? ''}</span>
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
    const dateStr = formatDateCustom(
      report.shift_date + 'T12:00:00',
      {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      },
      tz
    );

    const statusStyle = REVIEW_STATUS_STYLES[report.review_status] ?? {
      bg: 'bg-green-500/10',
      text: 'text-green-700 dark:text-green-400',
      label: 'Approved',
    };

    return (
      <div key={report.id} className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-xl border">
        <button
          onClick={() => setExpandedId(isExpanded ? null : report.id)}
          className="hover:bg-theme-surface-hover flex w-full items-center justify-between p-4 text-left transition-colors sm:p-5"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
            {(isReviewMode || viewMode === 'flagged') && (
              <input
                type="checkbox"
                checked={selectedReportIds.has(report.id)}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleReportSelection(report.id);
                }}
                onClick={(e) => e.stopPropagation()}
                className="form-checkbox shrink-0"
              />
            )}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 sm:h-12 sm:w-12">
              <FileText className="h-5 w-5 text-violet-500 sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-theme-text-primary truncate text-sm font-semibold sm:text-base">
                {report.trainee_name ? `${report.trainee_name} — ` : ''}
                {dateStr}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="text-theme-text-muted flex items-center gap-1 text-xs">
                  <Clock className="h-3 w-3" /> {report.hours_on_shift}h
                </span>
                <span className="text-theme-text-muted flex items-center gap-1 text-xs">
                  <Phone className="h-3 w-3" /> {report.calls_responded} call{report.calls_responded === 1 ? '' : 's'}
                </span>
                {report.performance_rating && renderRating(report.performance_rating)}
                {report.officer_name && (
                  <span className="text-theme-text-muted flex items-center gap-1 text-xs">
                    <UserIcon className="h-3 w-3" /> {report.officer_name}
                  </span>
                )}
                {report.reviewer_name && (
                  <span className="text-theme-text-muted flex items-center gap-1 text-xs">
                    <Shield className="h-3 w-3" /> Reviewed by {report.reviewer_name}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Aging indicator for pending/flagged */}
            {(report.review_status === 'pending_review' || report.review_status === 'flagged') &&
              (() => {
                const days = Math.floor((Date.now() - new Date(report.created_at).getTime()) / 86400000);
                if (days < 1) return null;
                return (
                  <span
                    className={`text-xs font-medium ${
                      days >= 7
                        ? 'text-red-600 dark:text-red-400'
                        : days >= 3
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-theme-text-muted'
                    }`}
                  >
                    {days}d
                  </span>
                );
              })()}
            {/* Review status badge */}
            {report.review_status !== SubmissionStatus.APPROVED && (
              <span
                className={`px-2 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text} rounded-full border border-current/20`}
              >
                {statusStyle.label}
              </span>
            )}
            {isMyReport && !report.trainee_acknowledged && report.review_status === SubmissionStatus.APPROVED && (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                Needs Acknowledgment
              </span>
            )}
            {report.trainee_acknowledged && (
              <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                Acknowledged
              </span>
            )}
            {isExpanded ? (
              <ChevronUp className="text-theme-text-muted h-4 w-4" />
            ) : (
              <ChevronDown className="text-theme-text-muted h-4 w-4" />
            )}
          </div>
        </button>

        {isExpanded && (
          <div className="border-theme-surface-border space-y-4 border-t px-4 pb-4 sm:px-5 sm:pb-5">
            <div className="pt-3">
              <ReportContentDisplay report={report} />
            </div>

            {/* Print button */}
            <div className="flex justify-end print:hidden">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  window.print();
                }}
                className="text-theme-text-muted hover:text-theme-text-primary inline-flex items-center gap-1 text-xs transition-colors"
              >
                <Printer className="h-3.5 w-3.5" /> Print Report
              </button>
            </div>

            {/* Reviewer comment (visible to officers, not trainees) */}
            {canManage && report.reviewer_notes && (
              <div
                className={`rounded-lg p-3 ${
                  report.review_status === 'flagged'
                    ? 'border border-red-500/20 bg-red-500/5'
                    : 'border border-amber-500/20 bg-amber-500/5'
                }`}
              >
                <p
                  className={`mb-1 flex items-center gap-1 text-xs font-semibold tracking-wider uppercase ${
                    report.review_status === 'flagged'
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  <Shield className="h-3 w-3" />
                  {report.review_status === 'flagged' ? 'Reviewer Comment — Flagged' : 'Reviewer Comment'}
                  {report.reviewer_name && (
                    <span className="ml-1 font-normal normal-case">by {report.reviewer_name}</span>
                  )}
                </p>
                <p className="text-theme-text-primary text-sm">{report.reviewer_notes}</p>
              </div>
            )}

            {/* Review history timeline */}
            {canManage && report.review_history && report.review_history.length > 1 && (
              <div className="space-y-1">
                <p className="text-theme-text-secondary flex items-center gap-1 text-xs font-semibold tracking-wider uppercase">
                  <Clock className="h-3 w-3" /> Review History
                </p>
                <div className="border-theme-surface-border space-y-1 border-l-2 pl-2">
                  {report.review_history.map((entry, i) => (
                    <div key={i} className="py-1 pl-3">
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={`font-medium capitalize ${
                            entry.status === 'approved'
                              ? 'text-green-700 dark:text-green-400'
                              : entry.status === 'flagged'
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-theme-text-secondary'
                          }`}
                        >
                          {entry.status === 'pending_review' ? 'Submitted' : entry.status}
                        </span>
                        {entry.reviewer_name && <span className="text-theme-text-muted">by {entry.reviewer_name}</span>}
                        <span className="text-theme-text-muted">
                          {formatDateCustom(
                            entry.timestamp,
                            { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
                            tz
                          )}
                        </span>
                      </div>
                      {entry.notes && (
                        <p className="text-theme-text-muted mt-0.5 text-xs italic">&quot;{entry.notes}&quot;</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Review actions for pending-review and flagged modes */}
            {isReviewMode && report.review_status === SubmissionStatus.PENDING_REVIEW && (
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setReviewReportId(report.id);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
                >
                  <ClipboardCheck className="h-4 w-4" /> Review Report
                </button>
              </div>
            )}
            {canManage && report.review_status === 'flagged' && !isReviewMode && (
              <div className="space-y-3 pt-2">
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <p className="mb-1 flex items-center gap-1 text-xs font-semibold tracking-wider text-red-700 uppercase dark:text-red-400">
                    <AlertCircle className="h-3 w-3" /> Flagged for Review
                  </p>
                  <p className="text-theme-text-secondary text-sm">
                    This report has been flagged and requires attention. You can re-review it to approve or add notes.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setReviewReportId(report.id);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
                  >
                    <ClipboardCheck className="h-4 w-4" /> Re-Review Report
                  </button>
                </div>
              </div>
            )}

            {/* Acknowledge button for trainee */}
            {isMyReport && !report.trainee_acknowledged && report.review_status === SubmissionStatus.APPROVED && (
              <div className="pt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setAckReportId(report.id);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
                >
                  <Check className="h-4 w-4" /> Acknowledge Report
                </button>
              </div>
            )}

            {/* Draft edit actions */}
            {viewMode === 'drafts' && report.review_status === 'draft' && canManage && editingDraftId !== report.id && (
              <div className="pt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditDraft(report);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
                >
                  <Pencil className="h-4 w-4" /> Complete Draft
                </button>
              </div>
            )}

            {/* Inline draft edit form */}
            {editingDraftId === report.id && (
              <div className="border-theme-surface-border space-y-4 border-t pt-3" onClick={(e) => e.stopPropagation()}>
                <h4 className="text-theme-text-primary text-sm font-semibold">Complete Draft Report</h4>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Hours on Shift</label>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      value={draftForm.hours_on_shift ?? 0}
                      onChange={(e) => setDraftForm((p) => ({ ...p, hours_on_shift: parseFloat(e.target.value) || 0 }))}
                      className="form-input text-sm focus:ring-violet-500"
                    />
                  </div>
                  <div>
                    <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Calls Responded</label>
                    <input
                      type="number"
                      min="0"
                      value={draftForm.calls_responded ?? 0}
                      onChange={(e) => setDraftForm((p) => ({ ...p, calls_responded: parseInt(e.target.value) || 0 }))}
                      className="form-input text-sm focus:ring-violet-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Call Types</label>
                  <div className="flex flex-wrap gap-1.5">
                    {callTypeOptions.map((type) => {
                      const isSelected = (draftForm.call_types || []).includes(type);
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => toggleCallType(setDraftForm, type)}
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            isSelected
                              ? 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400'
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
                  <label className="text-theme-text-secondary mb-1 block text-xs font-medium">{ratingLabel}</label>
                  <div className="flex items-center gap-1">
                    <StarRating
                      value={draftForm.performance_rating ?? 0}
                      onChange={(val) => setDraftForm((p) => ({ ...p, performance_rating: val }))}
                      label={ratingLabel}
                    />
                    {draftForm.performance_rating && ratingScaleType === 'competency' && (
                      <span className="text-theme-text-muted ml-2 text-xs">
                        {ratingScaleLabels[String(draftForm.performance_rating)] ?? ''}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Skills Observed</label>
                  <div className="flex flex-wrap gap-1.5">
                    {skillOptions.map((skill) => {
                      const isSelected = (draftForm.skills_observed || []).some((s) => s.skill_name === skill);
                      return (
                        <button
                          key={skill}
                          type="button"
                          onClick={() => toggleSkill(setDraftForm, skill)}
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            isSelected
                              ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400'
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
                  <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Officer Narrative</label>
                  <textarea
                    rows={3}
                    value={draftForm.officer_narrative || ''}
                    onChange={(e) => setDraftForm((p) => ({ ...p, officer_narrative: e.target.value }))}
                    placeholder="Summary of trainee performance during this shift..."
                    className="form-input resize-none text-sm focus:ring-violet-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                      Areas of Strength
                    </label>
                    <textarea
                      rows={2}
                      value={draftForm.areas_of_strength || ''}
                      onChange={(e) => setDraftForm((p) => ({ ...p, areas_of_strength: e.target.value }))}
                      className="form-input resize-none text-sm focus:ring-violet-500"
                    />
                  </div>
                  <div>
                    <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                      Areas for Improvement
                    </label>
                    <textarea
                      rows={2}
                      value={draftForm.areas_for_improvement || ''}
                      onChange={(e) => setDraftForm((p) => ({ ...p, areas_for_improvement: e.target.value }))}
                      className="form-input resize-none text-sm focus:ring-violet-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => setEditingDraftId(null)}
                    className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      void handleSaveDraft(false);
                    }}
                    disabled={savingDraft}
                    className="border-theme-surface-border hover:bg-theme-surface-hover rounded-lg border px-3 py-1.5 text-sm transition-colors"
                  >
                    Save Draft
                  </button>
                  <button
                    onClick={() => {
                      void handleSaveDraft(true);
                    }}
                    disabled={savingDraft}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                  >
                    {savingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="bg-theme-surface border-theme-surface-border flex flex-1 items-center gap-1 rounded-lg border p-1 sm:flex-none">
          <button
            onClick={() => setViewMode('my-reports')}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none ${
              viewMode === 'my-reports'
                ? 'bg-violet-600 text-white'
                : 'text-theme-text-secondary hover:text-theme-text-primary'
            }`}
          >
            My Reports
          </button>
          {canManage && (
            <button
              onClick={() => setViewMode('filed-by-me')}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none ${
                viewMode === 'filed-by-me'
                  ? 'bg-violet-600 text-white'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              Filed by Me
            </button>
          )}
          {canManage && config?.report_review_required && (
            <button
              onClick={() => setViewMode('pending-review')}
              className={`inline-flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none ${
                viewMode === 'pending-review'
                  ? 'bg-violet-600 text-white'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <ClipboardCheck className="h-3.5 w-3.5" /> Review Queue
            </button>
          )}
          {canManage && config?.report_review_required && (
            <button
              onClick={() => setViewMode('flagged')}
              className={`inline-flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none ${
                viewMode === 'flagged'
                  ? 'bg-violet-600 text-white'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <AlertCircle className="h-3.5 w-3.5" /> Flagged
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setViewMode('drafts')}
              className={`inline-flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none ${
                viewMode === 'drafts'
                  ? 'bg-violet-600 text-white'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <FileText className="h-3.5 w-3.5" /> Drafts
              {draftBadgeCount > 0 && viewMode !== 'drafts' && (
                <span className="ml-1 rounded-full bg-blue-500 px-1.5 py-0.5 text-xs leading-none font-bold text-white">
                  {draftBadgeCount}
                </span>
              )}
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setViewMode('create')}
              className={`inline-flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none ${
                viewMode === 'create'
                  ? 'bg-violet-600 text-white'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <Plus className="h-4 w-4" /> New
            </button>
          )}
        </div>
      </div>

      {/* Analytics dashboards */}
      {viewMode === 'my-reports' && renderTraineeDashboard()}
      {viewMode === 'filed-by-me' && renderOfficerDashboard()}

      {/* Encryption notice for officers */}
      {canManage && viewMode === 'create' && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2 text-xs text-green-700 dark:text-green-400">
          <Shield className="h-3.5 w-3.5 shrink-0" />
          Narratives and evaluations are encrypted at rest (AES-256) to protect against data exfiltration.
        </div>
      )}

      {/* Offline indicator */}
      {!isOnline && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          You&apos;re offline. Reports will be saved locally and submitted automatically when connectivity returns.
          {pendingOfflineCount > 0 && <span className="ml-1 font-medium">({pendingOfflineCount} pending)</span>}
        </div>
      )}
      {isOnline && pendingOfflineCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-blue-700 dark:text-blue-400">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          Syncing {pendingOfflineCount} queued report{pendingOfflineCount !== 1 ? 's' : ''}...
        </div>
      )}

      {/* Create Form — Shift-first batch workflow */}
      {viewMode === 'create' && (
        <div className="bg-theme-surface border-theme-surface-border space-y-5 rounded-xl border p-4 sm:p-6">
          <h3 className="text-theme-text-primary text-lg font-semibold">New Shift Completion Report</h3>

          {/* Step 1: Shift Selection */}
          {!form.shift_id ? (
            <div>
              <label className="text-theme-text-secondary mb-2 block text-sm font-medium">Select a Shift *</label>
              <div className="relative mb-2">
                <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  type="text"
                  placeholder="Search shifts by apparatus or date..."
                  value={shiftSearchQuery}
                  onChange={(e) => setShiftSearchQuery(e.target.value)}
                  className="form-input pr-3 pl-9 text-sm focus:ring-violet-500"
                />
              </div>
              {loadingShifts ? (
                <div className="text-theme-text-muted flex items-center gap-2 py-4 text-sm" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading recent shifts...
                </div>
              ) : (
                <div className="max-h-60 space-y-1 overflow-y-auto">
                  {shiftList
                    .filter((s) => {
                      if (!shiftSearchQuery) return true;
                      const q = shiftSearchQuery.toLowerCase();
                      return (
                        (s.apparatus_name ?? '').toLowerCase().includes(q) ||
                        (s.shift_date ?? '').includes(q) ||
                        (s.shift_officer_name ?? '').toLowerCase().includes(q)
                      );
                    })
                    .map((shift) => (
                      <button
                        key={shift.id}
                        type="button"
                        onClick={() => {
                          void handleSelectShift(shift);
                        }}
                        className="hover:bg-theme-surface-hover flex w-full items-center justify-between rounded-lg border border-transparent px-4 py-3 text-left text-sm transition-colors hover:border-violet-500/20"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
                            <FileText className="h-4 w-4 text-violet-500" />
                          </div>
                          <div>
                            <p className="text-theme-text-primary font-medium">
                              {shift.apparatus_name || 'Shift'} — {shift.shift_date}
                            </p>
                            <p className="text-theme-text-muted text-xs">
                              {shift.attendee_count} member{shift.attendee_count !== 1 ? 's' : ''}
                              {shift.call_count > 0
                                ? ` · ${shift.call_count} call${shift.call_count !== 1 ? 's' : ''}`
                                : ''}
                              {shift.total_hours ? ` · ${shift.total_hours}h` : ''}
                            </p>
                          </div>
                        </div>
                        <ChevronDown className="text-theme-text-muted h-4 w-4 -rotate-90" />
                      </button>
                    ))}
                  {shiftList.length === 0 && (
                    <p className="text-theme-text-muted py-6 text-center text-sm">No recent shifts found.</p>
                  )}
                </div>
              )}
              <div className="flex items-center gap-3 pt-4">
                <button
                  onClick={() => setViewMode(canManage ? 'filed-by-me' : 'my-reports')}
                  className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border rounded-lg border px-4 py-2 text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Selected shift banner */}
              <div className="flex items-center justify-between rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400">
                  <FileText className="h-4 w-4 shrink-0" />
                  Shift: <span className="font-medium">{linkedShiftLabel}</span>
                </div>
                {!linkedShiftId && (
                  <button
                    type="button"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, shift_id: undefined }));
                      setLinkedShiftLabel(null);
                      setCrewMembers([]);
                      setSelectedCrewIds(new Set());
                      setCrewLoadError(false);
                    }}
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Change shift
                  </button>
                )}
              </div>

              {/* Step 2: Shift-Level Data */}
              <div className="form-grid-3">
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Shift Date</label>
                  <input
                    type="date"
                    value={form.shift_date || ''}
                    readOnly
                    className="form-input bg-theme-surface-hover cursor-not-allowed text-sm"
                  />
                </div>
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Hours on Shift *</label>
                  <input
                    type="number"
                    min="0.5"
                    max="48"
                    step="0.5"
                    value={form.hours_on_shift || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, hours_on_shift: parseFloat(e.target.value) || 0 }))}
                    className="form-input text-sm focus:ring-violet-500"
                  />
                </div>
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Calls Responded</label>
                  <input
                    type="number"
                    min="0"
                    value={form.calls_responded || 0}
                    onChange={(e) => setForm((prev) => ({ ...prev, calls_responded: parseInt(e.target.value) || 0 }))}
                    className="form-input text-sm focus:ring-violet-500"
                  />
                </div>
              </div>

              {/* Call Types */}
              {(config?.form_show_call_types ?? true) && (form.calls_responded || 0) > 0 && (
                <div>
                  <label className="text-theme-text-secondary mb-2 block text-sm font-medium">Call Types</label>
                  <div className="flex flex-wrap gap-2">
                    {callTypeOptions.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => handleToggleCallType(type)}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                          form.call_types?.includes(type)
                            ? 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400'
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
                <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
                  Overall Shift Narrative
                </label>
                <textarea
                  rows={3}
                  value={form.officer_narrative || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, officer_narrative: e.target.value }))}
                  placeholder="General observations about the shift for leadership review..."
                  className="form-input resize-none text-sm focus:ring-violet-500"
                />
              </div>

              {/* Step 3: Crew Members */}
              <div>
                <label className="text-theme-text-secondary mb-2 block text-sm font-medium">
                  Crew Members
                  {crewMembers.length > 0 && (
                    <span className="text-theme-text-muted ml-2 text-xs font-normal">
                      ({selectedCrewIds.size} of {crewMembers.filter((m) => !m.has_existing_report).length} selected)
                    </span>
                  )}
                </label>
                {loadingCrew ? (
                  <div className="text-theme-text-muted flex items-center gap-2 py-4 text-sm" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading crew...
                  </div>
                ) : crewLoadError ? (
                  <div className="flex items-center gap-3 py-4 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                    <span className="text-theme-text-muted">Failed to load crew members.</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (form.shift_id) void loadCrewForShift(form.shift_id);
                      }}
                      className="text-sm font-medium text-violet-600 hover:underline dark:text-violet-400"
                    >
                      Retry
                    </button>
                  </div>
                ) : crewMembers.length === 0 ? (
                  <div className="flex items-center gap-3 py-4 text-sm">
                    <span className="text-theme-text-muted">No active crew members found for this shift.</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (form.shift_id) void loadCrewForShift(form.shift_id);
                      }}
                      className="text-sm font-medium text-violet-600 hover:underline dark:text-violet-400"
                    >
                      Refresh
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {crewMembers.map((member) => {
                      const isTrainee =
                        member.has_active_enrollment && (config?.shift_reports_include_training ?? true);
                      const isReported = member.has_existing_report;
                      const isSelected = selectedCrewIds.has(member.user_id);
                      const isExpanded = expandedTraineeId === member.user_id;
                      const eval_ = traineeEvals[member.user_id];

                      if (isReported) {
                        return (
                          <div
                            key={member.user_id}
                            className="bg-theme-surface-hover flex items-center gap-3 rounded-lg px-4 py-3 opacity-60"
                          >
                            <Check className="h-4 w-4 shrink-0 text-green-600" />
                            <div className="min-w-0 flex-1">
                              <span className="text-theme-text-muted text-sm line-through">{member.user_name}</span>
                              <span className="text-theme-text-muted ml-2 text-xs">Already reported</span>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={member.user_id}
                          className={`rounded-lg border transition-colors ${
                            isSelected
                              ? isTrainee
                                ? 'border-violet-500/30 bg-violet-500/5'
                                : 'border-theme-surface-border bg-theme-surface'
                              : 'border-theme-surface-border bg-theme-surface opacity-60'
                          }`}
                        >
                          {/* Member header row */}
                          <div className="flex items-center gap-3 px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleCrewMember(member.user_id)}
                              className="form-checkbox shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-theme-text-primary text-sm font-medium">{member.user_name}</span>
                                <span className="text-theme-text-muted text-xs capitalize">{member.position}</span>
                                {isTrainee && (
                                  <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-400">
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
                                onChange={(e) =>
                                  setCrewRemarks((prev) => ({ ...prev, [member.user_id]: e.target.value }))
                                }
                                className="form-input max-w-xs py-1.5 text-xs focus:ring-violet-500"
                              />
                            )}
                            {/* Expand/collapse for trainees */}
                            {isTrainee && isSelected && (
                              <button
                                type="button"
                                onClick={() => setExpandedTraineeId(isExpanded ? null : member.user_id)}
                                className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline dark:text-violet-400"
                              >
                                {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                Evaluate
                              </button>
                            )}
                          </div>

                          {/* Trainee evaluation panel */}
                          {isTrainee && isSelected && isExpanded && (
                            <div className="border-theme-surface-border space-y-4 border-t px-4 pt-3 pb-4">
                              {/* Per-trainee remarks */}
                              <div>
                                <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                                  Remarks for {member.user_name}
                                </label>
                                <input
                                  type="text"
                                  placeholder="Individual remarks for this trainee..."
                                  value={crewRemarks[member.user_id] || ''}
                                  onChange={(e) =>
                                    setCrewRemarks((prev) => ({ ...prev, [member.user_id]: e.target.value }))
                                  }
                                  className="form-input text-sm focus:ring-violet-500"
                                />
                              </div>

                              {/* Performance Rating */}
                              {(config?.form_show_performance_rating ?? true) && (
                                <div>
                                  <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                                    {ratingLabel}
                                  </label>
                                  <div className="flex items-center gap-1">
                                    {ratingScaleType === 'stars' ? (
                                      <StarRating
                                        value={eval_?.performance_rating ?? 0}
                                        onChange={(val) => updateTraineeEval(member.user_id, 'performance_rating', val)}
                                        max={ratingLevelCount}
                                        label={ratingLabel}
                                      />
                                    ) : (
                                      Array.from({ length: ratingLevelCount }, (_, i) => i + 1).map((val) => {
                                        const label = ratingScaleLabels[String(val)] || `Level ${val}`;
                                        return (
                                          <button
                                            key={val}
                                            type="button"
                                            onClick={() =>
                                              updateTraineeEval(
                                                member.user_id,
                                                'performance_rating',
                                                eval_?.performance_rating === val ? undefined : val
                                              )
                                            }
                                            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                                              eval_?.performance_rating === val
                                                ? 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400'
                                                : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-violet-500/30'
                                            }`}
                                          >
                                            {label}
                                          </button>
                                        );
                                      })
                                    )}
                                    {eval_?.performance_rating && ratingScaleType === 'stars' && (
                                      <span className="text-theme-text-muted ml-1 text-xs">
                                        {ratingScaleLabels[String(eval_.performance_rating)] ||
                                          `Level ${eval_.performance_rating}`}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Narrative Fields */}
                              {((config?.form_show_areas_of_strength ?? true) ||
                                (config?.form_show_areas_for_improvement ?? true)) && (
                                <div className="form-grid-2">
                                  {(config?.form_show_areas_of_strength ?? true) && (
                                    <div>
                                      <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                                        Areas of Strength
                                      </label>
                                      <textarea
                                        rows={2}
                                        value={eval_?.areas_of_strength || ''}
                                        onChange={(e) =>
                                          updateTraineeEval(member.user_id, 'areas_of_strength', e.target.value)
                                        }
                                        placeholder="What did they do well?"
                                        className="form-input resize-none text-sm focus:ring-violet-500"
                                      />
                                    </div>
                                  )}
                                  {(config?.form_show_areas_for_improvement ?? true) && (
                                    <div>
                                      <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                                        Areas for Improvement
                                      </label>
                                      <textarea
                                        rows={2}
                                        value={eval_?.areas_for_improvement || ''}
                                        onChange={(e) =>
                                          updateTraineeEval(member.user_id, 'areas_for_improvement', e.target.value)
                                        }
                                        placeholder="What should they work on?"
                                        className="form-input resize-none text-sm focus:ring-violet-500"
                                      />
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Skills Observed */}
                              {(config?.form_show_skills_observed ?? true) && (
                                <div>
                                  <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                                    Skills Observed
                                  </label>
                                  <div className="space-y-2">
                                    {skillOptions.map((skill) => {
                                      const skills = eval_?.skills_observed || [];
                                      const selected = skills.find((s) => s.skill_name === skill);
                                      return (
                                        <div key={skill}>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const current = eval_?.skills_observed || [];
                                              const exists = current.find((s) => s.skill_name === skill);
                                              updateTraineeEval(
                                                member.user_id,
                                                'skills_observed',
                                                exists
                                                  ? current.filter((s) => s.skill_name !== skill)
                                                  : [...current, { skill_name: skill, demonstrated: true }]
                                              );
                                            }}
                                            className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
                                              selected
                                                ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400'
                                                : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-green-500/30'
                                            }`}
                                          >
                                            {selected ? '\u2713 ' : ''}
                                            {skill}
                                          </button>
                                          {selected && (
                                            <div className="mt-1 ml-4 flex items-center gap-1.5">
                                              <span className="text-theme-text-muted text-xs">Score:</span>
                                              {([1, 2, 3, 4, 5] as const).map((n) => {
                                                const tip = ratingScaleLabels[String(n)] || `Level ${n}`;
                                                return (
                                                  <button
                                                    key={n}
                                                    type="button"
                                                    title={tip}
                                                    onClick={() => {
                                                      const updated = (eval_?.skills_observed || []).map((s) =>
                                                        s.skill_name === skill
                                                          ? { ...s, score: s.score === n ? undefined : n }
                                                          : s
                                                      );
                                                      updateTraineeEval(member.user_id, 'skills_observed', updated);
                                                    }}
                                                    className={`h-5 w-5 rounded border text-xs font-medium transition-colors ${
                                                      selected.score === n
                                                        ? 'border-violet-600 bg-violet-500 text-white'
                                                        : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-violet-400'
                                                    }`}
                                                  >
                                                    {n}
                                                  </button>
                                                );
                                              })}
                                              {selected.score && (
                                                <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
                                                  {ratingScaleLabels[String(selected.score)] ||
                                                    `Level ${selected.score}`}
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
                                  <div className="mb-1 flex items-center justify-between">
                                    <label className="text-theme-text-secondary text-xs font-medium">
                                      Tasks Performed
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const current = eval_?.tasks_performed || [];
                                        const addedNames = new Set(current.map((t) => t.task.toLowerCase()));
                                        const nextDefault = taskDefaults.find((t) => !addedNames.has(t.toLowerCase()));
                                        updateTraineeEval(member.user_id, 'tasks_performed', [
                                          ...current,
                                          { task: nextDefault || '', description: '' },
                                        ]);
                                      }}
                                      className="inline-flex items-center gap-0.5 text-xs text-violet-600 hover:underline dark:text-violet-400"
                                    >
                                      <Plus className="h-3 w-3" /> Add
                                    </button>
                                  </div>
                                  {(eval_?.tasks_performed || []).map((task, i) => (
                                    <div key={i} className="mb-1 flex items-center gap-2">
                                      <input
                                        type="text"
                                        placeholder="Task name"
                                        value={task.task}
                                        onChange={(e) => {
                                          const updated = [...(eval_?.tasks_performed || [])];
                                          updated[i] = { ...updated[i], task: e.target.value };
                                          updateTraineeEval(member.user_id, 'tasks_performed', updated);
                                        }}
                                        className="form-input flex-1 py-1.5 text-xs focus:ring-violet-500"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => {
                                          updateTraineeEval(
                                            member.user_id,
                                            'tasks_performed',
                                            (eval_?.tasks_performed || []).filter((_, j) => j !== i)
                                          );
                                        }}
                                        className="text-theme-text-muted p-1 hover:text-red-500"
                                      >
                                        <X className="h-3 w-3" />
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
              <div className="border-theme-surface-border flex items-center gap-3 border-t pt-2">
                <button
                  onClick={() => {
                    void handleBatchSubmit(true);
                  }}
                  disabled={savingDraft || submitting}
                  className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save as Draft
                </button>
                <button
                  onClick={() => {
                    void handleBatchSubmit(false);
                  }}
                  disabled={submitting || savingDraft}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Submit Report{selectedCrewIds.size > 1 ? `s (${selectedCrewIds.size})` : ''}
                </button>
                <button
                  onClick={() => setViewMode(canManage ? 'filed-by-me' : 'my-reports')}
                  className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border rounded-lg border px-4 py-2.5 text-sm transition-colors"
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
            <div className="mb-3 flex items-center justify-between">
              <p className="text-theme-text-muted text-sm">
                {reports.length} draft{reports.length !== 1 ? 's' : ''} pending
              </p>
              <button
                onClick={() => {
                  void (async () => {
                    try {
                      const result = await shiftCompletionService.submitAllDrafts();
                      toast.success(`Submitted ${result.submitted} of ${result.total} drafts`);
                      void loadReports();
                      setDraftBadgeCount(0);
                    } catch (err: unknown) {
                      toast.error(getErrorMessage(err, 'Failed to submit drafts'));
                    }
                  })();
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
              >
                <Check className="h-4 w-4" />
                Submit All Drafts
              </button>
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
              <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
            </div>
          ) : reports.length === 0 ? (
            <div className="border-theme-surface-border rounded-xl border border-dashed py-16 text-center">
              <FileText className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
              <h3 className="text-theme-text-primary mb-1 text-lg font-medium">
                {viewMode === 'my-reports'
                  ? 'No reports for you yet'
                  : viewMode === 'pending-review'
                    ? 'No reports pending review'
                    : viewMode === 'flagged'
                      ? 'No flagged reports'
                      : viewMode === 'drafts'
                        ? 'No draft reports'
                        : 'No reports filed yet'}
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
                        : 'Submit a shift report to track trainee progress.'}
              </p>
            </div>
          ) : (
            <>
              {/* Review summary dashboard */}
              {(viewMode === 'pending-review' || viewMode === 'flagged') &&
                reports.length > 0 &&
                (() => {
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
                    <div className="bg-theme-surface border-theme-surface-border mb-3 space-y-2 rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-theme-text-primary flex items-center gap-1.5 text-sm font-semibold">
                          <BarChart3 className="h-4 w-4 text-violet-500" />
                          {viewMode === 'pending-review' ? 'Pending Review' : 'Flagged Reports'} — {reports.length}{' '}
                          report{reports.length !== 1 ? 's' : ''}
                        </h4>
                        {oldestDays > 0 && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              oldestDays >= 7
                                ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                                : oldestDays >= 3
                                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                  : 'bg-theme-surface-hover text-theme-text-muted'
                            }`}
                          >
                            Oldest: {oldestDays}d ago
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {Array.from(byOfficer.entries()).map(([name, count]) => (
                          <span
                            key={name}
                            className="bg-theme-surface-hover text-theme-text-secondary rounded-full px-2 py-1 text-xs"
                          >
                            {name}: {count}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

              {/* Batch review toolbar */}
              {(viewMode === 'pending-review' || viewMode === 'flagged') && reports.length > 1 && (
                <div className="bg-theme-surface border-theme-surface-border mb-3 space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <label className="text-theme-text-secondary flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedReportIds.size === reports.length && reports.length > 0}
                        onChange={() => {
                          if (selectedReportIds.size === reports.length) {
                            setSelectedReportIds(new Set());
                          } else {
                            setSelectedReportIds(new Set(reports.map((r) => r.id)));
                          }
                        }}
                        className="form-checkbox"
                      />
                      Select all ({reports.length})
                    </label>
                    {selectedReportIds.size > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-theme-text-muted text-xs">{selectedReportIds.size} selected</span>
                        {viewMode === 'flagged' && (
                          <button
                            onClick={() => {
                              void handleBatchReview(SubmissionStatus.APPROVED);
                            }}
                            disabled={batchReviewing}
                            className="btn-success inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium"
                          >
                            {batchReviewing ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                            Approve Selected
                          </button>
                        )}
                        {viewMode === 'pending-review' && (
                          <>
                            <button
                              onClick={() => {
                                void handleBatchReview('flagged');
                              }}
                              disabled={batchReviewing}
                              className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium"
                            >
                              <AlertCircle className="h-3 w-3" /> Flag Selected
                            </button>
                            <button
                              onClick={() => {
                                void handleBatchReview(SubmissionStatus.APPROVED);
                              }}
                              disabled={batchReviewing}
                              className="btn-success inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium"
                            >
                              {batchReviewing ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
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
                      placeholder={
                        viewMode === 'pending-review'
                          ? 'Add a comment for all selected reports (required for flagging)...'
                          : 'Add a comment (optional)...'
                      }
                      value={batchReviewNotes}
                      onChange={(e) => setBatchReviewNotes(e.target.value)}
                      className="form-input py-1.5 text-xs focus:ring-violet-500"
                    />
                  )}
                </div>
              )}
              <div className="space-y-3">{reports.map(renderReportCard)}</div>
            </>
          )}
        </>
      )}

      {/* Acknowledge Modal */}
      {ackReportId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Acknowledge Report"
        >
          <div className="bg-theme-surface border-theme-surface-border w-full max-w-md space-y-4 rounded-xl border p-5 sm:p-6">
            <h3 className="text-theme-text-primary text-lg font-semibold">Acknowledge Report</h3>
            <p className="text-theme-text-secondary text-sm">
              Acknowledging confirms you have reviewed this shift completion report.
            </p>
            <div>
              <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Comments (optional)</label>
              <textarea
                rows={3}
                value={ackComments}
                onChange={(e) => setAckComments(e.target.value)}
                placeholder="Any feedback or comments..."
                className="form-input resize-none text-sm focus:ring-violet-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setAckReportId(null);
                  setAckComments('');
                }}
                className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border rounded-lg border px-4 py-2 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleAcknowledge();
                }}
                disabled={acknowledging}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
              >
                {acknowledging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Acknowledge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewReportId &&
        (() => {
          const reviewReport = reports.find((r) => r.id === reviewReportId);
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              role="dialog"
              aria-modal="true"
              aria-label="Review Report"
            >
              <div className="bg-theme-surface border-theme-surface-border max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border p-5 sm:p-6">
                <h3 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
                  <ClipboardCheck className="h-5 w-5 text-violet-500" /> Review Report
                </h3>
                <p className="text-theme-text-secondary text-sm">
                  Review this report before it becomes visible to the trainee. You can redact specific fields if they
                  contain improper content.
                </p>

                {/* Report content preview */}
                {reviewReport && (
                  <div className="border-theme-surface-border bg-theme-surface-hover space-y-3 rounded-lg border p-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      {reviewReport.trainee_name && (
                        <span className="text-theme-text-primary flex items-center gap-1 font-medium">
                          <UserIcon className="h-3.5 w-3.5" /> {reviewReport.trainee_name}
                        </span>
                      )}
                      <span className="text-theme-text-muted">
                        {formatDateCustom(
                          reviewReport.shift_date + 'T12:00:00',
                          {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          },
                          tz
                        )}
                      </span>
                      {reviewReport.officer_name && (
                        <span className="text-theme-text-muted flex items-center gap-1">
                          Filed by {reviewReport.officer_name}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="text-theme-text-muted flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" /> {reviewReport.hours_on_shift}h
                      </span>
                      <span className="text-theme-text-muted flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" /> {reviewReport.calls_responded} call
                        {reviewReport.calls_responded === 1 ? '' : 's'}
                      </span>
                      {reviewReport.performance_rating && renderRating(reviewReport.performance_rating)}
                    </div>
                    <ReportContentDisplay report={reviewReport} />
                  </div>
                )}

                {/* Redaction checkboxes */}
                <div>
                  <label className="text-theme-text-secondary mb-2 block text-sm font-medium">
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
                      <label key={field} className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={redactFields.includes(field)}
                          onChange={() => toggleRedactField(field)}
                          className="form-checkbox"
                        />
                        <span className="text-theme-text-primary flex items-center gap-1 text-sm">
                          {redactFields.includes(field) ? (
                            <EyeOff className="h-3.5 w-3.5 text-red-500" />
                          ) : (
                            <Eye className="text-theme-text-muted h-3.5 w-3.5" />
                          )}
                          {label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Reviewer notes */}
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Reviewer Comment</label>
                  <textarea
                    rows={3}
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Add a comment about this report (visible to the filing officer)..."
                    className="form-input resize-none text-sm focus:ring-violet-500"
                  />
                  <p className="text-theme-text-muted mt-1 text-xs">
                    Visible to the officer who filed the report. Not shown to the trainee.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => {
                      setReviewReportId(null);
                      setReviewNotes('');
                      setRedactFields([]);
                    }}
                    className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border rounded-lg border px-4 py-2 text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (!reviewNotes.trim()) {
                        toast.error('Please add a comment explaining why this report is being flagged');
                        return;
                      }
                      void handleReview('flagged');
                    }}
                    disabled={reviewing}
                    className="btn-primary inline-flex items-center gap-1.5 text-sm font-medium"
                  >
                    <AlertCircle className="h-3.5 w-3.5" /> Flag for Revision
                  </button>
                  <button
                    onClick={() => {
                      void handleReview(SubmissionStatus.APPROVED);
                    }}
                    disabled={reviewing}
                    className="btn-success inline-flex items-center gap-1.5 text-sm font-medium"
                  >
                    {reviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
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
