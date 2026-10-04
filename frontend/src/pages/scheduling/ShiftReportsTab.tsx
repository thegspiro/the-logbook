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
import { organizationService, userService } from '../../services/api';
import { schedulingService } from '../../modules/scheduling/services/api';
import { positionLabel } from '../../modules/scheduling/utils/positionLabels';
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
import { formatDateCustom, formatTime, getTodayLocalDate, toLocalDateString } from '../../utils/dateFormatting';
import { formatHours } from '../../utils/hoursFormatting';
import {
  DEFAULT_SKILLS,
  DEFAULT_COMPETENCY_LABELS,
  REVIEW_STATUS_STYLES,
  shiftHoursForOneMember,
} from '../../modules/scheduling/constants/shiftReportConstants';
import { ReportContentDisplay } from '../../modules/scheduling/components/ReportContentDisplay';
import { CallTypeChips } from '../../modules/scheduling/components/CallTypeChips';
import { labelCallTypeChoices, orgCallTypeChoices } from '../../modules/scheduling/components/callTypeChoices';
import { callTypesAreOrgSlugs, useOrgCallTypes } from '../../modules/scheduling/hooks/useCallTypeLabels';
import { getErrorMessage } from '../../utils/errorHandling';
import { saveDraft, loadDraft, deleteDraft } from '../../utils/shiftReportDrafts';
import {
  enqueueShiftReport,
  listPendingReports,
  dequeueShiftReport,
  pendingReportCount,
} from '../../utils/shiftReportOfflineQueue';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useOverlaySurface } from '../../hooks/useOverlaySurface';
import { EmptyState } from '../../components/ux/EmptyState';

type ViewMode = 'my-reports' | 'filed-by-me' | 'department' | 'create' | 'pending-review' | 'flagged' | 'drafts';

export const ShiftReportsTab: React.FC = () => {
  const { user, checkPermission } = useAuthStore();
  const userId = user?.id;
  const tz = useTimezone();
  const canManage = checkPermission('training.manage');
  // Department-wide totals are a leadership view. Every company officer holds
  // training.manage to file reports, so it cannot be what gates them.
  const canViewDepartment = canManage && checkPermission('training.view_analytics');
  const isOnline = useOnlineStatus();
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();

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
    // The server lists only the caller's own drafts to anyone without
    // training.manage, so the view is safe to open for an acting Shift
    // Officer arriving from a finalization notice.
    if (viewParam === 'drafts') return 'drafts';
    if (viewParam === 'department' && canViewDepartment) return 'department';
    return canManage ? 'filed-by-me' : 'my-reports';
  };

  const [viewMode, setViewMode] = useState<ViewMode>(initialView);

  // Mirror the selected view into ?view= so a refresh, a shared link or the
  // back button returns to the same list rather than the default one.
  useEffect(() => {
    if (searchParams.get('view') === viewMode) return;
    const next = new URLSearchParams(searchParams);
    next.set('view', viewMode);
    setSearchParams(next, { replace: true });
  }, [viewMode, searchParams, setSearchParams]);
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
  // Department rule: only each shift's assigned officer files its reports.
  // The server enforces it; this only keeps the form from offering shifts the
  // viewer would be refused on.
  const [officerOnly, setOfficerOnly] = useState(false);
  // Per-member calls the officer typed over the derived figure, as typed.
  const [memberCalls, setMemberCalls] = useState<Record<string, string>>({});
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

  // Takes the fixed mobile bottom bar off this overlay while it is open.
  useOverlaySurface(Boolean(ackReportId) || Boolean(reviewReportId));
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
  // A member without training.manage who is the Shift Officer of the linked
  // shift. The server lets exactly that officer file the shift's reports and
  // complete the drafts assigned to them, so the tab offers those two things
  // and nothing else.
  const [filesAsShiftOfficer, setFilesAsShiftOfficer] = useState(false);

  // Draft count badge. Without training.manage the server returns only the
  // caller's own drafts, which is what makes this safe to ask for everyone.
  useEffect(() => {
    shiftCompletionService
      .getDraftReports()
      .then((drafts) => setDraftBadgeCount(drafts.length))
      .catch(() => {});
  }, [viewMode]);

  useEffect(() => {
    if (canManage || !linkedShiftId) return;
    let cancelled = false;
    schedulingService
      .getShift(linkedShiftId)
      .then((shift) => {
        if (cancelled || !userId || String(shift.shift_officer_id ?? '') !== String(userId)) return;
        setFilesAsShiftOfficer(true);
        setViewMode('create');
      })
      .catch(() => {
        /* not this member's shift to file — they keep their own view */
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, linkedShiftId, userId]);

  // Shown the officer's switch only when there is something behind it.
  const showOfficerSwitch = !canManage && (filesAsShiftOfficer || draftBadgeCount > 0 || viewMode === 'drafts');

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
  const orgCallTypes = useOrgCallTypes();

  /**
   * Which vocabulary the draft editor offers for a given report.
   *
   * Both are the department's one list. A report filed against a count-only
   * shift stores its slugs; everything else stores text, so it is offered the
   * same types by label. Offering slugs to a text report is what let an edit
   * mix the two, leaving values unresolvable afterwards.
   */
  const draftCallTypeChoices = useCallback(
    (report: ShiftCompletionReport) =>
      callTypesAreOrgSlugs(report)
        ? orgCallTypeChoices(orgCallTypes, report.call_types || [])
        : labelCallTypeChoices(orgCallTypes, report.call_types || []),
    [orgCallTypes]
  );

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
  const loadCrewForShift = useCallback(
    async (shiftId: string) => {
      setLoadingCrew(true);
      setCrewLoadError(false);
      try {
        // The author is left off their own crew list: a report about yourself
        // is refused server-side, and offering the checkbox would only turn it
        // into a silently skipped row.
        const crew = (await shiftCompletionService.getShiftCrewStatus(shiftId)).filter((m) => m.user_id !== userId);
        setCrewMembers(crew);
        const eligible = crew.filter((m) => !m.has_existing_report);
        setSelectedCrewIds(new Set(eligible.map((m) => m.user_id)));
        setTraineeEvals({});
        setCrewRemarks({});
        setMemberCalls({});
        setExpandedTraineeId(null);
      } catch {
        setCrewLoadError(true);
        toast.error('Failed to load crew members');
      } finally {
        setLoadingCrew(false);
      }
    },
    [userId]
  );

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
      } else if (viewMode === 'department') {
        setReports([]);
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
    } else if ((viewMode === 'filed-by-me' && canManage) || (viewMode === 'department' && canViewDepartment)) {
      // Cleared first so one view never shows a frame of the other's figures.
      setOfficerAnalytics(null);
      shiftCompletionService
        .getOfficerAnalytics(viewMode === 'department' ? 'department' : 'mine')
        .then(setOfficerAnalytics)
        .catch(() => {
          /* analytics not critical */
        });
    }
  }, [viewMode, canManage, canViewDepartment]);

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

  useEffect(() => {
    if (!canManage) return;
    organizationService
      .getSettings()
      .then((settings) => {
        const block = (settings as Record<string, unknown>).shift_reports as { authorship?: unknown } | undefined;
        setOfficerOnly(block?.authorship === 'shift_officer');
      })
      .catch(() => {
        /* the server still enforces the rule */
      });
  }, [canManage]);

  const offeredShifts = officerOnly ? shiftList.filter((s) => s.shift_officer_id === userId) : shiftList;

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
      // A draft saved before the author was left off the list can still name
      // them.
      setSelectedCrewIds(new Set(draft.crewSelections.filter((id) => id !== userId)));
    }
    if (draft.crewRemarks && Object.keys(draft.crewRemarks).length > 0) {
      setCrewRemarks(draft.crewRemarks);
    }
    if (draft.formData.officer_narrative) {
      setForm((prev) => ({ ...prev, officer_narrative: draft.formData.officer_narrative as string }));
    }
  }, [form.shift_id, crewMembers.length, userId]);

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
      toast.error('Select a shift');
      return;
    }
    if (selectedCrewIds.size === 0) {
      toast.error('Select at least one crew member');
      return;
    }
    if (!form.hours_on_shift || form.hours_on_shift <= 0) {
      toast.error('Enter the hours on shift');
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

    // Only figures that differ from what the server would derive: an
    // unchanged member keeps the derived count and the call types with it.
    const callCorrections: Record<string, number> = {};
    for (const m of crewMembers) {
      const typed = memberCalls[m.user_id];
      if (!selectedCrewIds.has(m.user_id) || typed === undefined || typed.trim() === '') continue;
      const n = Number.parseInt(typed, 10);
      if (Number.isNaN(n) || n < 0) continue;
      if (n !== (m.calls_responded ?? 0)) callCorrections[m.user_id] = n;
    }

    const payload: BatchShiftReportCreate = {
      shift_id: form.shift_id || '',
      shift_date: form.shift_date || '',
      hours_on_shift: form.hours_on_shift || 0,
      // Read only for an unlinked batch; a linked shift derives each member's
      // calls server-side, with member_call_counts carrying corrections.
      calls_responded: 0,
      ...(form.officer_narrative?.trim() ? { officer_narrative: form.officer_narrative.trim() } : {}),
      crew_member_ids: Array.from(selectedCrewIds),
      ...(Object.keys(callCorrections).length > 0 ? { member_call_counts: callCorrections } : {}),
      ...(allEvaluations.length > 0 ? { trainee_evaluations: allEvaluations } : {}),
      save_as_draft: asDraft,
    };

    if (asDraft) setSavingDraft(true);
    else setSubmitting(true);

    try {
      if (!isOnline && !asDraft) {
        await enqueueShiftReport(payload);
        setPendingOfflineCount(await pendingReportCount());
        toast.success("You're offline — the report is saved and will be sent automatically when you're back online");
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
      setMemberCalls({});
      setCrewLoadError(false);
      setExpandedTraineeId(null);
      // "Written by me" is a training.manage view; an acting Shift Officer
      // returns to their own.
      setViewMode(asDraft ? 'drafts' : canManage ? 'filed-by-me' : 'my-reports');
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
      toast.error('Add a note saying why you are flagging this report');
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
      toast.error('Add a comment saying why you are flagging these reports');
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

  /**
   * The scale being used, in words.
   *
   * Ratings were shown against no published rubric anywhere they appear — a
   * column headed "Avg Rating" reading 3, and stars with nothing to say what
   * three of them means. The department configures this under Scheduling
   * Settings → Shift Reports → Rating Scale; this states whatever it chose.
   */
  const ratingScaleKey = useMemo(() => {
    if (ratingScaleType === 'stars') return 'Rated 1–5 stars, 5 being the strongest.';
    const levels = Object.keys(ratingScaleLabels)
      .map(Number)
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    if (levels.length === 0) return null;
    return levels.map((n) => `${n} = ${ratingScaleLabels[String(n)]}`).join(' · ');
  }, [ratingScaleType, ratingScaleLabels]);

  // "2026-07" → "Jul". The charts labelled their columns "07", "08".
  const monthLabel = (month: string) => formatDateCustom(`${month}-15T12:00:00`, { month: 'short' }, tz);

  const renderTraineeDashboard = () => {
    if (!traineeStats || traineeStats.total_reports === 0) return null;
    const maxHours = Math.max(...traineeStats.monthly.map((m) => m.hours), 1);
    return (
      <div className="card space-y-4 p-4 sm:p-5">
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
                {formatHours(traineeStats.total_hours)}
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
                  <span className="text-theme-text-muted text-xs">{monthLabel(m.month)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderOfficerDashboard = () => {
    if (!officerAnalytics) return null;
    const isDepartment = viewMode === 'department';
    if (officerAnalytics.total_reports === 0) {
      // "Written by me" has its list's own empty state beneath; the
      // department view has no list, so it has to say something itself.
      return isDepartment ? (
        <EmptyState
          icon={BarChart3}
          className="border-theme-surface-border rounded-xl border border-dashed"
          title="No reports filed yet"
          description="Department totals appear here once officers file shift reports."
        />
      ) : null;
    }
    const maxReports = Math.max(...officerAnalytics.monthly.map((m) => m.reports), 1);
    const draftCount = officerAnalytics?.status_counts?.['draft'] ?? 0;
    const pendingCount = officerAnalytics?.status_counts?.['pending_review'] ?? 0;
    // Literal class names: Tailwind only emits classes it can find verbatim
    // in the source, so a `sm:grid-cols-${n}` template would never be styled.
    // A fixed five-column grid left two empty cells whenever neither the
    // drafts nor the pending tile applied.
    const tileCount = 3 + (draftCount > 0 ? 1 : 0) + (pendingCount > 0 ? 1 : 0);
    const tileGrid = tileCount === 5 ? 'sm:grid-cols-5' : tileCount === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3';
    return (
      <div className="card space-y-4 p-4 sm:p-5">
        <h2 className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-violet-500" aria-hidden="true" />{' '}
          {isDepartment ? 'Department reporting summary' : 'Your reporting summary'}
        </h2>
        {isDepartment && (
          <p className="text-theme-text-muted -mt-2 text-xs">Every officer&apos;s reports, not only yours.</p>
        )}
        <div className={`grid grid-cols-2 gap-3 ${tileGrid}`}>
          <div className="rounded-lg border border-violet-500/15 bg-violet-500/5 p-3 text-center">
            <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">{officerAnalytics.total_reports}</p>
            <p className="text-theme-text-muted mt-0.5 text-xs">{isDepartment ? 'Reports filed' : 'Reports written'}</p>
          </div>
          <div className="rounded-lg border border-blue-500/15 bg-blue-500/5 p-3 text-center">
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {formatHours(officerAnalytics.total_hours)}
            </p>
            <p className="text-theme-text-muted mt-0.5 text-xs">Shift hours covered</p>
          </div>
          <div className="rounded-lg border border-green-500/15 bg-green-500/5 p-3 text-center">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{officerAnalytics.total_calls}</p>
            <p className="text-theme-text-muted mt-0.5 text-xs">Calls covered</p>
          </div>
          {/* These two lead somewhere, so they are buttons and say where. As
              clickable divs they were unreachable by keyboard and looked
              exactly like the three tiles beside them that do nothing. */}
          {draftCount > 0 && (
            <button
              type="button"
              className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-center transition-colors hover:bg-blue-500/10"
              onClick={() => setViewMode('drafts')}
            >
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{draftCount}</p>
              <p className="text-theme-text-muted mt-0.5 text-xs">
                {draftCount === 1 ? 'Draft' : 'Drafts'} to finish <span aria-hidden="true">→</span>
              </p>
            </button>
          )}
          {pendingCount > 0 && (
            <button
              type="button"
              className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-center transition-colors hover:bg-amber-500/10"
              onClick={() => setViewMode('pending-review')}
            >
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{pendingCount}</p>
              <p className="text-theme-text-muted mt-0.5 text-xs">
                Awaiting review <span aria-hidden="true">→</span>
              </p>
            </button>
          )}
        </div>

        {ratingScaleKey && (
          <p className="text-theme-text-muted mb-3 text-xs">
            <span className="font-medium">Rating scale:</span> {ratingScaleKey}
          </p>
        )}

        {/* Per-crew-member table */}
        {officerAnalytics.trainees.length > 0 && (
          <div>
            {/* "Trainee" is the wrong word for this list: a shift report covers
                everyone who worked the shift, and training evaluations are a
                separate opt-in per the scheduling settings. The API field names
                still say trainee. */}
            <p className="text-theme-text-secondary mb-2 flex items-center gap-1 text-xs font-medium">
              <Users className="h-3.5 w-3.5" /> Crew summary
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-theme-text-muted border-theme-surface-border border-b text-xs">
                    <th className="pb-2 text-left font-medium">Crew member</th>
                    <th className="pb-2 pl-4 text-center font-medium">Reports</th>
                    <th className="pb-2 pl-4 text-center font-medium">Hours</th>
                    <th className="pb-2 pl-4 text-center font-medium">Calls</th>
                    <th className="pb-2 pl-4 text-center font-medium" title={ratingScaleKey ?? undefined}>
                      Avg rating
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-theme-surface-border divide-y">
                  {officerAnalytics.trainees.map((t) => (
                    <tr key={t.trainee_id} className="text-theme-text-primary">
                      <td className="py-2 text-left font-medium">{t.name}</td>
                      <td className="py-2 pl-4 text-center">{t.reports}</td>
                      <td className="py-2 pl-4 text-center">{formatHours(t.hours)}</td>
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
            {/* The bars were sized by hours while the figure on each read the
                report count, so a tall bar could carry a small number. One
                measure, and the title says which. */}
            <p className="text-theme-text-secondary mb-2 text-xs font-medium">Reports written per month</p>
            <div className="flex h-24 items-end gap-1.5">
              {officerAnalytics.monthly.map((m) => (
                // See the trainee chart above: an auto-height column gives the
                // percentage-height bar nothing to resolve against.
                <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-theme-text-secondary text-xs font-medium">{m.reports}</span>
                  <div
                    className="w-full rounded-t bg-violet-500/20"
                    title={`${monthLabel(m.month)}: ${m.reports} ${m.reports === 1 ? 'report' : 'reports'}`}
                    style={{ height: `${Math.max((m.reports / maxReports) * 100, 4)}%` }}
                  />
                  <span className="text-theme-text-muted text-xs">{monthLabel(m.month)}</span>
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

    const badges = (
      <>
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
                {/* A bare "3d" beside the status badge did not say what had
                    been three days. */}
                Waiting {days} {days === 1 ? 'day' : 'days'}
              </span>
            );
          })()}
        {/* Review status badge, approved included. Suppressing it there made
                the most important state the *absence* of a badge: a finished
                report looked the same as one whose status had not loaded, and
                the reader had to know that blank meant approved. The style was
                already defined and never reachable. */}
        <span
          className={`px-2 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text} rounded-full border border-current/20`}
        >
          {statusStyle.label}
        </span>
        {isMyReport && !report.trainee_acknowledged && report.review_status === SubmissionStatus.APPROVED && (
          <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            Needs Acknowledgment
          </span>
        )}
        {/* The author's side of the acknowledgment: without it an approved
                report the member has not acknowledged looked finished. */}
        {viewMode === 'filed-by-me' &&
          !isMyReport &&
          !report.trainee_acknowledged &&
          report.review_status === SubmissionStatus.APPROVED && (
            <span className="text-theme-text-secondary border-theme-surface-border rounded-full border px-2 py-0.5 text-xs font-medium">
              Not acknowledged yet
            </span>
          )}
        {report.trainee_acknowledged && (
          <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
            Acknowledged
          </span>
        )}
      </>
    );

    return (
      <div key={report.id} className="card overflow-hidden">
        <button
          onClick={() => setExpandedId(isExpanded ? null : report.id)}
          className="hover:bg-theme-surface-hover grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 p-4 text-left transition-colors sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:p-5"
        >
          <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 sm:gap-4">
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
            <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 sm:flex">
              <FileText className="h-6 w-6 text-violet-500" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-theme-text-primary truncate text-sm font-semibold sm:text-base">
                {/* In "About me" the member is always the viewer. */}
                {report.trainee_name && viewMode !== 'my-reports' ? `${report.trainee_name} — ` : ''}
                {dateStr}
              </p>
              {/* Person and date alone told two reports from one day apart by
                  author, never by which shift they covered. The start time is
                  what separates a day shift from a night one on the same
                  apparatus — and it is all there is to go on for a shift with
                  no apparatus at all, like an event or a detail. */}
              {(report.shift_label || report.shift_start_time) && (
                <p className="text-theme-text-muted truncate text-xs">
                  {[report.shift_label, report.shift_start_time ? formatTime(report.shift_start_time, tz) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="text-theme-text-muted flex items-center gap-1 text-xs whitespace-nowrap">
                  {/* One decimal, like the summary table above. Raw, the same
                      record read 11.87h here and 11.9 up there. */}
                  <Clock className="h-3 w-3" /> {formatHours(Number(report.hours_on_shift))}h
                </span>
                <span className="text-theme-text-muted flex items-center gap-1 text-xs whitespace-nowrap">
                  <Phone className="h-3 w-3" /> {report.calls_responded} call{report.calls_responded === 1 ? '' : 's'}
                </span>
                {report.performance_rating && renderRating(report.performance_rating)}
                {/* In "Written by me" every report's author is the viewer. */}
                {report.officer_name && viewMode !== 'filed-by-me' && (
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
          {/* Beside the title from sm up; on its own row under it on a phone,
              where three pills in the same row crushed the member's name to
              "Al…". A grid rather than two copies, so each badge exists once. */}
          <div className="col-start-1 row-start-2 flex flex-wrap items-center gap-2 sm:col-start-2 sm:row-start-1 sm:flex-nowrap">
            {badges}
          </div>
          <div className="col-start-2 row-start-1 flex items-center sm:col-start-3">
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
              <ReportContentDisplay report={report} scoreLabels={ratingScaleLabels} />
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
                {/* The reviewer's own comment above already says why it was
                    flagged, in red; a second red box saying only that it was
                    flagged repeated it. Kept for a flag with no comment. */}
                {!report.reviewer_notes && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                    <p className="mb-1 flex items-center gap-1 text-xs font-semibold tracking-wider text-red-700 uppercase dark:text-red-400">
                      <AlertCircle className="h-3 w-3" /> Flagged for Review
                    </p>
                    <p className="text-theme-text-secondary text-sm">
                      This report is flagged. Review it again to approve it or add notes.
                    </p>
                  </div>
                )}
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
            {viewMode === 'drafts' &&
              report.review_status === 'draft' &&
              (canManage || report.officer_id === userId) &&
              editingDraftId !== report.id && (
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

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  <CallTypeChips
                    choices={draftCallTypeChoices(report)}
                    selected={draftForm.call_types || []}
                    onToggle={(value) => toggleCallType(setDraftForm, value)}
                  />
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

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    className="inline-flex items-center gap-1.5 rounded-lg bg-green-700 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-800 disabled:opacity-50"
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
      {/* A member without training.manage has exactly one view, and a
          segmented control with one segment is a button that does nothing —
          it read as a control with no information behind it. Say what the
          view is instead. */}
      {!canManage && (
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
            <FileText className="h-5 w-5 text-violet-700 dark:text-violet-300" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-theme-text-primary text-lg font-semibold">
              {viewMode === 'create'
                ? 'File this shift’s reports'
                : viewMode === 'drafts'
                  ? 'Reports to finish'
                  : 'Shift reports about you'}
            </h2>
            <p className="text-theme-text-muted text-sm">
              {viewMode === 'create' || viewMode === 'drafts'
                ? 'You were the Shift Officer, so the crew’s reports are yours to file.'
                : 'Feedback your officers write after shifts you worked. Open a report to read it and acknowledge it.'}
            </p>
          </div>
        </div>
      )}
      {showOfficerSwitch && viewMode !== 'create' && (
        <div className="segmented-group inline-flex items-center gap-1">
          {(
            [
              ['my-reports', 'About me'],
              ['drafts', 'Drafts'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                viewMode === mode
                  ? 'bg-violet-600 text-white'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              {label}
              {mode === 'drafts' && draftBadgeCount > 0 && viewMode !== 'drafts' && (
                <span className="ml-1 rounded-full bg-blue-600 px-1.5 py-0.5 text-xs leading-none font-bold text-white">
                  {draftBadgeCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* View Toggle */}
      {canManage && (
        <div className="flex items-center gap-2">
          <div className="segmented-group hscroll flex min-w-0 flex-1 items-center gap-1 sm:flex-none">
            <button
              onClick={() => setViewMode('my-reports')}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                viewMode === 'my-reports'
                  ? 'bg-violet-600 text-white'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
              title="Reports other people wrote about your shifts"
            >
              {/* "My Reports" and "Filed by Me" are reports *about* you and reports
                you *wrote* — a distinction neither label carried, and both
                readings fit both labels. */}
              About me
            </button>
            <button
              onClick={() => setViewMode('filed-by-me')}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                viewMode === 'filed-by-me'
                  ? 'bg-violet-600 text-white'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
              title="Reports you wrote about your crew"
            >
              Written by me
            </button>
            {canViewDepartment && (
              <button
                onClick={() => setViewMode('department')}
                className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  viewMode === 'department'
                    ? 'bg-violet-600 text-white'
                    : 'text-theme-text-secondary hover:text-theme-text-primary'
                }`}
                title="Every officer's reports, summed across the department"
              >
                <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" /> Department
              </button>
            )}
            {config?.report_review_required && (
              <button
                onClick={() => setViewMode('pending-review')}
                className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  viewMode === 'pending-review'
                    ? 'bg-violet-600 text-white'
                    : 'text-theme-text-secondary hover:text-theme-text-primary'
                }`}
              >
                <ClipboardCheck className="h-3.5 w-3.5" /> Review Queue
              </button>
            )}
            {config?.report_review_required && (
              <button
                onClick={() => setViewMode('flagged')}
                className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  viewMode === 'flagged'
                    ? 'bg-violet-600 text-white'
                    : 'text-theme-text-secondary hover:text-theme-text-primary'
                }`}
              >
                <AlertCircle className="h-3.5 w-3.5" /> Flagged
              </button>
            )}
            <button
              onClick={() => setViewMode('drafts')}
              className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                viewMode === 'drafts'
                  ? 'bg-violet-600 text-white'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <FileText className="h-3.5 w-3.5" /> Drafts
              {draftBadgeCount > 0 && viewMode !== 'drafts' && (
                <span className="ml-1 rounded-full bg-blue-600 px-1.5 py-0.5 text-xs leading-none font-bold text-white">
                  {draftBadgeCount}
                </span>
              )}
            </button>
          </div>
          {/* An action, not a list: as the last segment it read as a sixth
              filter, and on a phone it scrolled off the end of the strip. */}
          {viewMode !== 'create' && (
            <button
              onClick={() => setViewMode('create')}
              className="btn-primary inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> New report
            </button>
          )}
        </div>
      )}

      {/* Analytics dashboards */}
      {viewMode === 'my-reports' && renderTraineeDashboard()}
      {(viewMode === 'filed-by-me' || viewMode === 'department') && renderOfficerDashboard()}

      {/* Encryption notice for officers */}
      {canManage && viewMode === 'create' && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2 text-xs text-green-700 dark:text-green-400">
          <Shield className="h-3.5 w-3.5 shrink-0" />
          Narratives and evaluations are encrypted at rest (AES-256).
        </div>
      )}

      {/* Offline indicator */}
      {!isOnline && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          You&apos;re offline. Reports are saved on this device and sent automatically when you&apos;re back online.
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
        <div className="card space-y-5 p-4 sm:p-6">
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
                  {offeredShifts
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
                              {shift.total_hours ? ` · ${formatHours(shift.total_hours)}h` : ''}
                            </p>
                          </div>
                        </div>
                        <ChevronDown className="text-theme-text-muted h-4 w-4 -rotate-90" />
                      </button>
                    ))}
                  {offeredShifts.length === 0 && (
                    <p className="text-theme-text-muted py-6 text-center text-sm">
                      {officerOnly
                        ? 'No recent shifts where you were the Shift Officer. Your department has each shift’s reports filed by its officer.'
                        : 'No recent shifts found.'}
                    </p>
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
                <p className="text-theme-text-muted self-end text-xs">
                  Calls are counted per member below — from the shift&apos;s call log or its close-out.
                </p>
              </div>

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
                                <span className="text-theme-text-muted text-xs capitalize">
                                  {positionLabel(member.position)}
                                </span>
                                {isTrainee && (
                                  <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-400">
                                    Trainee — {member.program_name}
                                  </span>
                                )}
                              </div>
                            </div>
                            {isSelected && (
                              <label className="flex shrink-0 items-center gap-1.5 text-xs">
                                <span className="text-theme-text-muted">Calls</span>
                                <input
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  className="form-input w-16 px-2 py-1 text-right text-sm tabular-nums"
                                  aria-label={`Calls for ${member.user_name}`}
                                  value={memberCalls[member.user_id] ?? String(member.calls_responded ?? 0)}
                                  onChange={(e) =>
                                    setMemberCalls((prev) => ({ ...prev, [member.user_id]: e.target.value }))
                                  }
                                />
                                {memberCalls[member.user_id] === undefined && member.calls_source && (
                                  <span className="text-theme-text-muted hidden sm:inline">
                                    {member.calls_source === 'closeout' ? 'from close-out' : 'from call log'}
                                  </span>
                                )}
                              </label>
                            )}
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
                                                        ? 'border-violet-600 bg-violet-600 text-white'
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
              <div className="border-theme-surface-border flex flex-wrap items-center gap-3 border-t pt-2">
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

      {/* Reports List — the department view is totals only */}
      {viewMode !== 'create' && viewMode !== 'department' && (
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
          ) : reports.length === 0 && viewMode === 'my-reports' ? (
            <div className="border-theme-surface-border rounded-xl border border-dashed px-4 py-10 sm:px-8">
              <div className="mx-auto max-w-md text-center">
                <FileText className="text-theme-text-muted mx-auto mb-3 h-10 w-10" aria-hidden="true" />
                {/* Under the member heading above an h3; for an officer this is
                    the tab's own body, directly under the page h1. */}
                {React.createElement(
                  canManage ? 'h2' : 'h3',
                  { className: 'text-theme-text-primary mb-1 text-lg font-semibold' },
                  'No shift reports yet'
                )}
                <p className="text-theme-text-muted text-sm">
                  When an officer files a report for a shift you worked, it will show up here.
                  {config?.report_review_required &&
                    ' A training officer reviews each report before it is shared with you.'}
                </p>
              </div>
              <ul className="text-theme-text-secondary mx-auto mt-6 grid max-w-2xl gap-3 text-left text-sm sm:grid-cols-3">
                <li className="bg-theme-surface-secondary flex items-start gap-2 rounded-lg p-3">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />
                  <span>The shift itself — date, hours and calls run</span>
                </li>
                <li className="bg-theme-surface-secondary flex items-start gap-2 rounded-lg p-3">
                  <TrendingUp
                    className="mt-0.5 h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300"
                    aria-hidden="true"
                  />
                  <span>Your officer&apos;s feedback — skills observed, strengths, what to work on</span>
                </li>
                <li className="bg-theme-surface-secondary flex items-start gap-2 rounded-lg p-3">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />
                  <span>A place to acknowledge it once you&apos;ve read it</span>
                </li>
              </ul>
            </div>
          ) : reports.length === 0 ? (
            <EmptyState
              icon={FileText}
              className="border-theme-surface-border rounded-xl border border-dashed"
              title={
                viewMode === 'pending-review'
                  ? 'No reports pending review'
                  : viewMode === 'flagged'
                    ? 'No flagged reports'
                    : viewMode === 'drafts'
                      ? 'No draft reports'
                      : 'No reports filed yet'
              }
              description={
                viewMode === 'pending-review'
                  ? 'All reports have been reviewed.'
                  : viewMode === 'flagged'
                    ? 'No reports have been flagged for follow-up.'
                    : viewMode === 'drafts'
                      ? 'A draft report is created when a shift is finalized. Complete it to track trainee progress.'
                      : 'Submit a shift report to track trainee progress.'
              }
              actions={
                viewMode === 'filed-by-me'
                  ? [{ label: 'Write a report', icon: Plus, onClick: () => setViewMode('create') }]
                  : undefined
              }
            />
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
                    <div className="card mb-3 space-y-2 p-3">
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
                <div className="card mb-3 space-y-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
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
                      <div className="flex flex-wrap items-center gap-2">
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
              {viewMode === 'filed-by-me' && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h2 className="text-theme-text-primary text-base font-semibold">
                    Reports you&apos;ve written{' '}
                    <span className="text-theme-text-muted font-normal">({reports.length})</span>
                  </h2>
                  <p className="text-theme-text-muted text-xs">
                    Most recent shift first. Select a report to read it in full.
                  </p>
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
          className="modal-overlay z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Acknowledge Report"
        >
          <div className="card modal-panel-scroll w-full max-w-md space-y-4 p-5 sm:p-6">
            <h3 className="text-theme-text-primary text-lg font-semibold">Acknowledge Report</h3>
            <p className="text-theme-text-secondary text-sm">
              Acknowledging confirms you have reviewed this shift completion report.
            </p>
            <div>
              <label
                htmlFor="shift-report-ack-comments"
                className="text-theme-text-secondary mb-1 block text-sm font-medium"
              >
                Comments (optional)
              </label>
              <textarea
                id="shift-report-ack-comments"
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
              className="modal-overlay z-50 flex items-center justify-center p-4"
              role="dialog"
              aria-modal="true"
              aria-label="Review Report"
            >
              <div className="card max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto p-5 sm:p-6">
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
                        <Clock className="h-3.5 w-3.5" /> {formatHours(reviewReport.hours_on_shift)}h
                      </span>
                      <span className="text-theme-text-muted flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" /> {reviewReport.calls_responded} call
                        {reviewReport.calls_responded === 1 ? '' : 's'}
                      </span>
                      {reviewReport.performance_rating && renderRating(reviewReport.performance_rating)}
                    </div>
                    <ReportContentDisplay report={reviewReport} scoreLabels={ratingScaleLabels} />
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

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
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
                        toast.error('Add a comment saying why you are flagging this report');
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
