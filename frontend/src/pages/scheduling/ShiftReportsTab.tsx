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
  Shield, Eye, EyeOff, MessageSquare, ClipboardCheck, Pencil,
  BarChart3, TrendingUp, Users, Save,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { shiftCompletionService, trainingModuleConfigService } from '../../services/api';
import { userService } from '../../services/api';
import { schedulingService } from '../../modules/scheduling/services/api';
import { useAuthStore } from '../../stores/authStore';
import { SubmissionStatus } from '../../constants/enums';
import type {
  ShiftCompletionReport,
  ShiftCompletionReportCreate,
  TaskPerformed,
  TrainingModuleConfig,
  TraineeShiftStats,
  OfficerShiftAnalytics,
} from '../../types/training';
import type { User } from '../../types/user';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateCustom, getTodayLocalDate } from '../../utils/dateFormatting';

type ViewMode = 'my-reports' | 'filed-by-me' | 'create' | 'pending-review' | 'drafts';

const DEFAULT_CALL_TYPE_OPTIONS = [
  'Structure Fire', 'Vehicle Fire', 'Brush/Wildland',
  'EMS/Medical', 'Motor Vehicle Accident', 'Hazmat',
  'Rescue/Extrication', 'Alarm Investigation', 'Public Assist', 'Other',
];

const DEFAULT_SKILLS = [
  'SCBA donning/doffing', 'Hose deployment', 'Ladder operations',
  'Search and rescue', 'Ventilation', 'Pump operations',
  'Patient assessment', 'CPR/AED', 'Vitals monitoring',
  'Radio communications', 'Scene size-up', 'Apparatus check-off',
];

const DEFAULT_COMPETENCY_LABELS: Record<string, string> = {
  '1': 'Unsatisfactory',
  '2': 'Developing',
  '3': 'Competent',
  '4': 'Proficient',
  '5': 'Exemplary',
};

const REVIEW_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', label: 'Draft' },
  pending_review: { bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', label: 'Pending Review' },
  approved: { bg: 'bg-green-500/10', text: 'text-green-700 dark:text-green-400', label: 'Approved' },
  flagged: { bg: 'bg-red-500/10', text: 'text-red-700 dark:text-red-400', label: 'Flagged' },
};

export const ShiftReportsTab: React.FC = () => {
  const { user, checkPermission } = useAuthStore();
  const tz = useTimezone();
  const canManage = checkPermission('training.manage');
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
  const [memberSearch, setMemberSearch] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [linkedShiftLabel, setLinkedShiftLabel] = useState<string | null>(null);
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

  // Acknowledge modal
  const [ackReportId, setAckReportId] = useState<string | null>(null);
  const [ackComments, setAckComments] = useState('');
  const [acknowledging, setAcknowledging] = useState(false);

  // Review modal
  const [reviewReportId, setReviewReportId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [redactFields, setRedactFields] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);

  // Draft edit state
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftForm, setDraftForm] = useState<Partial<ShiftCompletionReportCreate>>({});
  const [savingDraft, setSavingDraft] = useState(false);

  // Analytics state
  const [traineeStats, setTraineeStats] = useState<TraineeShiftStats | null>(null);
  const [officerAnalytics, setOfficerAnalytics] = useState<OfficerShiftAnalytics | null>(null);

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
  const skillOptions = config?.shift_review_default_skills?.length
    ? config.shift_review_default_skills
    : DEFAULT_SKILLS;
  const taskDefaults = config?.shift_review_default_tasks ?? [];

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
        setForm(prev => ({
          ...prev,
          shift_id: linkedShiftId,
          shift_date: shiftDate,
          calls_responded: shift.call_count || prev.calls_responded,
        }));
      } catch {
        // Shift may not exist — continue with defaults
      }
    };
    void prefill();
    return () => { cancelled = true; };
  }, [linkedShiftId, viewMode, tz]);

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

  // Load members when switching to create mode
  useEffect(() => {
    if (viewMode === 'create' && members.length === 0) {
      setLoadingMembers(true);
      userService.getUsers()
        .then(setMembers)
        .catch(() => toast.error('Failed to load members'))
        .finally(() => setLoadingMembers(false));
    }
  }, [viewMode, members.length]);

  const filteredMembers = useMemo(() => {
    if (!memberSearch) return members;
    const q = memberSearch.toLowerCase();
    return members.filter(m =>
      (m.full_name || `${m.first_name} ${m.last_name}`).toLowerCase().includes(q)
      || m.username.toLowerCase().includes(q)
    );
  }, [members, memberSearch]);

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
  const handleToggleSkill = (skillName: string) => toggleSkill(setForm, skillName);

  const handleUpdateSkillComment = (skillName: string, comment: string) => {
    setForm(prev => {
      const skills = (prev.skills_observed || []).map(s =>
        s.skill_name === skillName ? { ...s, comment: comment || undefined } : s
      );
      return { ...prev, skills_observed: skills };
    });
  };

  const handleAddTask = () => {
    setForm(prev => ({
      ...prev,
      tasks_performed: [...(prev.tasks_performed || []), { task: '', description: '' }],
    }));
  };

  const handleUpdateTask = (index: number, field: keyof TaskPerformed, value: string) => {
    setForm(prev => {
      const tasks = [...(prev.tasks_performed || [])];
      tasks[index] = { ...tasks[index], [field]: value } as TaskPerformed;
      return { ...prev, tasks_performed: tasks };
    });
  };

  const handleRemoveTask = (index: number) => {
    setForm(prev => ({
      ...prev,
      tasks_performed: (prev.tasks_performed || []).filter((_, i) => i !== index),
    }));
  };

  const buildNewPayload = (
    asDraft: boolean,
  ): ShiftCompletionReportCreate => ({
    shift_id: form.shift_id || undefined,
    trainee_id: form.trainee_id ?? '',
    shift_date: form.shift_date,
    hours_on_shift: form.hours_on_shift ?? 0,
    calls_responded: form.calls_responded || 0,
    call_types: form.call_types?.length
      ? form.call_types
      : undefined,
    performance_rating:
      form.performance_rating || undefined,
    areas_of_strength:
      form.areas_of_strength || undefined,
    areas_for_improvement:
      form.areas_for_improvement || undefined,
    officer_narrative:
      form.officer_narrative || undefined,
    skills_observed: form.skills_observed?.length
      ? form.skills_observed
      : undefined,
    tasks_performed:
      form.tasks_performed?.filter(
        (t) => t.task.trim(),
      ) || undefined,
    ...(asDraft ? { save_as_draft: true } : {}),
  });

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

  const validateNewForm = (): boolean => {
    if (!form.trainee_id) {
      toast.error('Please select a trainee');
      return false;
    }
    if (!form.shift_date) {
      toast.error('Please enter the shift date');
      return false;
    }
    if (!form.hours_on_shift || form.hours_on_shift <= 0) {
      toast.error('Please enter hours on shift');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateNewForm()) return;

    setSubmitting(true);
    try {
      await shiftCompletionService.createReport(
        buildNewPayload(false),
      );
      toast.success('Shift report submitted');
      resetNewForm();
      setViewMode('filed-by-me');
    } catch {
      toast.error('Failed to submit shift report');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveNewDraft = async () => {
    if (!validateNewForm()) return;

    setSavingDraft(true);
    try {
      await shiftCompletionService.createReport(
        buildNewPayload(true),
      );
      toast.success('Draft saved');
      resetNewForm();
      setViewMode('drafts');
    } catch {
      toast.error('Failed to save draft');
    } finally {
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
    } catch {
      toast.error('Failed to acknowledge report');
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
    } catch {
      toast.error('Failed to review report');
    } finally {
      setReviewing(false);
    }
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
    } catch {
      toast.error('Failed to save report');
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
  const renderRatingInput = () => {
    if (ratingScaleType === 'stars') {
      return (
        <div>
          <label className="block text-sm font-medium text-theme-text-secondary mb-2">{ratingLabel}</label>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map(i => (
              <button key={i} onClick={() => setForm(prev => ({ ...prev, performance_rating: i }))}
                className="p-1 transition-colors"
              >
                <Star className={`w-6 h-6 ${
                  i <= (form.performance_rating || 0)
                    ? 'fill-amber-400 text-amber-700 dark:text-amber-400'
                    : 'text-theme-text-muted hover:text-amber-800 dark:hover:text-amber-300'
                }`} />
              </button>
            ))}
            {form.performance_rating && (
              <button onClick={() => setForm(prev => ({ ...prev, performance_rating: undefined }))}
                className="ml-2 text-xs text-theme-text-muted hover:text-theme-text-primary"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      );
    }

    // Competency or custom: show labeled buttons
    return (
      <div>
        <label className="block text-sm font-medium text-theme-text-secondary mb-2">{ratingLabel}</label>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map(i => {
            const label = ratingScaleLabels[String(i)] || `Level ${i}`;
            const isSelected = form.performance_rating === i;
            return (
              <button
                key={i}
                onClick={() => setForm(prev => ({ ...prev, performance_rating: isSelected ? undefined : i }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  isSelected
                    ? 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30 ring-1 ring-violet-500/30'
                    : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-violet-500/30'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

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
                  <tr className="text-left text-xs text-theme-text-muted border-b border-theme-surface-border">
                    <th className="pb-2 font-medium">Trainee</th>
                    <th className="pb-2 font-medium text-right">Reports</th>
                    <th className="pb-2 font-medium text-right">Hours</th>
                    <th className="pb-2 font-medium text-right">Calls</th>
                    <th className="pb-2 font-medium text-right">Avg Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-surface-border">
                  {officerAnalytics.trainees.map(t => (
                    <tr key={t.trainee_id} className="text-theme-text-primary">
                      <td className="py-2 font-medium">{t.name}</td>
                      <td className="py-2 text-right">{t.reports}</td>
                      <td className="py-2 text-right">{t.hours.toFixed(1)}</td>
                      <td className="py-2 text-right">{t.calls}</td>
                      <td className="py-2 text-right">{t.avg_rating ?? '—'}</td>
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
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-violet-500" />
            </div>
            <div className="min-w-0">
              <p className="text-sm sm:text-base font-semibold text-theme-text-primary truncate">{dateStr}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                <span className="flex items-center gap-1 text-xs text-theme-text-muted">
                  <Clock className="w-3 h-3" /> {report.hours_on_shift}h
                </span>
                <span className="flex items-center gap-1 text-xs text-theme-text-muted">
                  <Phone className="w-3 h-3" /> {report.calls_responded} calls
                </span>
                {report.performance_rating && renderRating(report.performance_rating)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
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
            {/* Call Types */}
            {report.call_types && report.call_types.length > 0 && (
              <div className="pt-3">
                <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider mb-2">Call Types</p>
                <div className="flex flex-wrap gap-1.5">
                  {report.call_types.map(type => (
                    <span key={type} className="px-2 py-0.5 text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20 rounded-full">{type}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Narrative sections */}
            <div className="form-grid-2 pt-2">
              {report.areas_of_strength && (
                <div>
                  <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider mb-1">Strengths</p>
                  <p className="text-sm text-theme-text-primary whitespace-pre-wrap">{report.areas_of_strength}</p>
                </div>
              )}
              {report.areas_for_improvement && (
                <div>
                  <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider mb-1">Areas for Improvement</p>
                  <p className="text-sm text-theme-text-primary whitespace-pre-wrap">{report.areas_for_improvement}</p>
                </div>
              )}
            </div>

            {report.officer_narrative && (
              <div>
                <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider mb-1">Officer Narrative</p>
                <p className="text-sm text-theme-text-primary whitespace-pre-wrap">{report.officer_narrative}</p>
              </div>
            )}

            {/* Skills Observed */}
            {report.skills_observed && report.skills_observed.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider mb-2">Skills Observed</p>
                <div className="space-y-1.5">
                  {report.skills_observed.map((skill, i) => (
                    <div key={i}>
                      <span className={`inline-block px-2 py-0.5 text-xs rounded-full border ${skill.demonstrated
                        ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20'
                        : 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border'
                      }`}>
                        {skill.demonstrated ? '✓' : '○'} {skill.skill_name}
                      </span>
                      {skill.comment && (
                        <p className="mt-0.5 ml-2 text-xs text-theme-text-muted italic flex items-start gap-1">
                          <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                          {skill.comment}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tasks Performed */}
            {report.tasks_performed && report.tasks_performed.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider mb-2">Tasks Performed</p>
                <ul className="space-y-1.5">
                  {report.tasks_performed.map((task, i) => (
                    <li key={i} className="text-sm text-theme-text-primary">
                      <span className="font-medium">{task.task}</span>
                      {task.description && <span className="text-theme-text-muted"> — {task.description}</span>}
                      {task.comment && (
                        <p className="mt-0.5 ml-2 text-xs text-theme-text-muted italic flex items-start gap-1">
                          <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                          {task.comment}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Reviewer notes (only for officers viewing, never for trainees) */}
            {canManage && report.reviewer_notes && (
              <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Reviewer Notes (Internal)
                </p>
                <p className="text-sm text-theme-text-primary">{report.reviewer_notes}</p>
              </div>
            )}

            {/* Trainee comments */}
            {report.trainee_comments && (
              <div className="p-3 bg-theme-surface-hover rounded-lg">
                <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider mb-1">Trainee Comments</p>
                <p className="text-sm text-theme-text-primary">{report.trainee_comments}</p>
              </div>
            )}

            {/* Review actions for pending-review mode */}
            {isReviewMode && report.review_status === SubmissionStatus.PENDING_REVIEW && (
              <div className="pt-2 flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setReviewReportId(report.id); }}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1.5"
                >
                  <ClipboardCheck className="w-4 h-4" /> Review Report
                </button>
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
          {canManage && (
            <button
              onClick={() => setViewMode('drafts')}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center justify-center gap-1 ${
                viewMode === 'drafts' ? 'bg-violet-600 text-white' : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <FileText className="w-3.5 h-3.5" /> Drafts
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

      {/* Create Form */}
      {viewMode === 'create' && (
        <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-4 sm:p-6 space-y-5">
          <h3 className="text-lg font-semibold text-theme-text-primary">New Shift Completion Report</h3>

          {/* Linked shift banner */}
          {linkedShiftLabel && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/5 border border-blue-500/20 rounded-lg text-sm text-blue-700 dark:text-blue-400">
              <FileText className="w-4 h-4 shrink-0" />
              Filing report for shift: <span className="font-medium">{linkedShiftLabel}</span>
            </div>
          )}

          {/* Trainee Selection */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Trainee *</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
              <input
                type="text"
                aria-label="Search members..." placeholder="Search members..."
                value={memberSearch}
                onChange={e => setMemberSearch(e.target.value)}
                className="form-input focus:ring-violet-500 pl-9 pr-3 text-sm"
              />
            </div>
            {loadingMembers ? (
              <div className="flex items-center gap-2 mt-2 text-sm text-theme-text-muted" role="status" aria-live="polite">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading members...
              </div>
            ) : (
              <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                {filteredMembers.slice(0, 20).map(m => (
                  <button
                    key={m.id}
                    onClick={() => { setForm(prev => ({ ...prev, trainee_id: m.id })); setMemberSearch(m.full_name || `${m.first_name} ${m.last_name}`); }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                      form.trainee_id === m.id
                        ? 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border border-violet-500/20'
                        : 'hover:bg-theme-surface-hover text-theme-text-primary'
                    }`}
                  >
                    <UserIcon className="w-4 h-4 shrink-0" />
                    {m.full_name || `${m.first_name} ${m.last_name}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date and Hours */}
          <div className="form-grid-3">
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Shift Date *</label>
              <input type="date" value={form.shift_date || ''}
                onChange={e => setForm(prev => ({ ...prev, shift_date: e.target.value }))}
                className="form-input focus:ring-violet-500 text-sm"
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
                  <button key={type} onClick={() => handleToggleCallType(type)}
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

          {/* Performance Rating (configurable scale) */}
          {(config?.form_show_performance_rating ?? true) && renderRatingInput()}

          {/* Narrative Fields */}
          {((config?.form_show_areas_of_strength ?? true) || (config?.form_show_areas_for_improvement ?? true)) && (
          <div className="form-grid-2">
            {(config?.form_show_areas_of_strength ?? true) && (
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Areas of Strength</label>
              <textarea rows={3} value={form.areas_of_strength || ''}
                onChange={e => setForm(prev => ({ ...prev, areas_of_strength: e.target.value }))}
                placeholder="What did the trainee do well?"
                className="form-input focus:ring-violet-500 resize-none text-sm"
              />
            </div>
            )}
            {(config?.form_show_areas_for_improvement ?? true) && (
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Areas for Improvement</label>
              <textarea rows={3} value={form.areas_for_improvement || ''}
                onChange={e => setForm(prev => ({ ...prev, areas_for_improvement: e.target.value }))}
                placeholder="What should the trainee work on?"
                className="form-input focus:ring-violet-500 resize-none text-sm"
              />
            </div>
            )}
          </div>
          )}

          {(config?.form_show_officer_narrative ?? true) && (
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Officer Narrative</label>
            <textarea rows={4} value={form.officer_narrative || ''}
              onChange={e => setForm(prev => ({ ...prev, officer_narrative: e.target.value }))}
              placeholder="General observations, notes, and overall assessment..."
              className="form-input focus:ring-violet-500 resize-none text-sm"
            />
          </div>
          )}

          {/* Skills Observed with Comments */}
          {(config?.form_show_skills_observed ?? true) && (
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-2">Skills Observed</label>
            <div className="space-y-2">
              {skillOptions.map(skill => {
                const selected = form.skills_observed?.find(s => s.skill_name === skill);
                return (
                  <div key={skill}>
                    <button onClick={() => handleToggleSkill(skill)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        selected
                          ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30'
                          : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-green-500/30'
                      }`}
                    >
                      {selected ? '✓ ' : ''}{skill}
                    </button>
                    {selected && (
                      <div className="mt-1 ml-4">
                        <input
                          type="text"
                          placeholder="Add comment on this skill..."
                          value={selected.comment || ''}
                          onChange={e => handleUpdateSkillComment(skill, e.target.value)}
                          className="form-input focus:ring-violet-500 max-w-md py-1.5 text-xs"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {/* Tasks Performed with Comments */}
          {(config?.form_show_tasks_performed ?? true) && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-theme-text-secondary">Tasks Performed</label>
              <button onClick={handleAddTask}
                className="text-xs text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add Task
              </button>
            </div>
            {/* Quick-add from configured defaults */}
            {taskDefaults.length > 0 && (form.tasks_performed || []).length === 0 && (
              <div className="mb-2">
                <p className="text-xs text-theme-text-muted mb-1.5">Quick add from defaults:</p>
                <div className="flex flex-wrap gap-1.5">
                  {taskDefaults.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm(prev => ({
                        ...prev,
                        tasks_performed: [...(prev.tasks_performed || []), { task: t, description: '' }],
                      }))}
                      className="px-2 py-1 text-xs rounded-full border border-violet-500/20 bg-violet-500/5 text-violet-700 dark:text-violet-400 hover:bg-violet-500/15 transition-colors"
                    >
                      + {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-3">
              {(form.tasks_performed || []).map((task, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 form-grid-2">
                      <input type="text" placeholder="Task name" value={task.task}
                        onChange={e => handleUpdateTask(i, 'task', e.target.value)}
                        className="form-input focus:ring-violet-500 text-sm"
                      />
                      <input type="text" placeholder="Description (optional)" value={task.description || ''}
                        onChange={e => handleUpdateTask(i, 'description', e.target.value)}
                        className="form-input focus:ring-violet-500 text-sm"
                      />
                    </div>
                    <button onClick={() => handleRemoveTask(i)} className="p-2 text-theme-text-muted hover:text-red-500 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="ml-0">
                    <input type="text" placeholder="Officer comment on this task..."
                      value={task.comment || ''}
                      onChange={e => handleUpdateTask(i, 'comment', e.target.value)}
                      className="form-input focus:ring-violet-500 py-1.5 text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <button onClick={() => { void handleSaveNewDraft(); }} disabled={savingDraft || submitting}
              className="px-5 py-2.5 text-sm font-medium border border-theme-surface-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50 inline-flex items-center gap-2 transition-colors"
            >
              {savingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save as Draft
            </button>
            <button onClick={() => { void handleSubmit(); }} disabled={submitting || savingDraft}
              className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2 transition-colors"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Submit Report
            </button>
            <button onClick={() => setViewMode(canManage ? 'filed-by-me' : 'my-reports')}
              className="px-4 py-2.5 text-sm text-theme-text-muted hover:text-theme-text-primary border border-theme-surface-border rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Reports List */}
      {viewMode !== 'create' && (
        <>
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
                 viewMode === 'drafts' ? 'No draft reports' :
                 'No reports filed yet'}
              </h3>
              <p className="text-theme-text-muted text-sm">
                {viewMode === 'my-reports'
                  ? 'Shift completion reports from your officers will appear here.'
                  : viewMode === 'pending-review'
                  ? 'All reports have been reviewed.'
                  : viewMode === 'drafts'
                  ? 'Draft reports are auto-created when shifts are finalized. Complete them to track trainee progress.'
                  : 'Submit a shift report to track trainee progress.'
                }
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map(renderReportCard)}
            </div>
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
      {reviewReportId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Review Report">
          <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5 sm:p-6 w-full max-w-lg space-y-4">
            <h3 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-violet-500" /> Review Report
            </h3>
            <p className="text-sm text-theme-text-secondary">
              Review this report before it becomes visible to the trainee.
              You can redact specific fields if they contain improper content.
            </p>

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
                Internal Notes (never shown to trainee)
              </label>
              <textarea rows={3} value={reviewNotes}
                onChange={e => setReviewNotes(e.target.value)}
                placeholder="Notes about this review decision..."
                className="form-input focus:ring-violet-500 resize-none text-sm"
              />
            </div>

            <div className="flex items-center gap-2 justify-end pt-2">
              <button onClick={() => { setReviewReportId(null); setReviewNotes(''); setRedactFields([]); }}
                className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary border border-theme-surface-border rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button onClick={() => { void handleReview('flagged'); }} disabled={reviewing}
                className="btn-primary font-medium gap-1.5 inline-flex items-center text-sm"
              >
                <AlertCircle className="w-3.5 h-3.5" /> Flag
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
      )}
    </div>
  );
};

export default ShiftReportsTab;
