import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  ClipboardList,
  Star,
  Clock,
  Phone,
  Calendar,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Plus,
  Trash2,
  Save,
  Send,
  FileText,
  TrendingUp,
  Link,
  Zap,
} from 'lucide-react';
import {
  shiftCompletionService, userService, trainingProgramService,
  trainingModuleConfigService,
} from '../services/api';
import { schedulingService } from '../modules/scheduling/services/api';
import type { ShiftRecord } from '../modules/scheduling/services/api';
import type { Assignment } from '../types/scheduling';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, formatTime, getTodayLocalDate } from '../utils/dateFormatting';
import type {
  ShiftCompletionReport,
  ShiftCompletionReportCreate,
  SkillObservation,
  TaskPerformed,
  TraineeShiftStats,
  ProgramEnrollment,
  TrainingModuleConfig,
} from '../types/training';

// ==================== Star Rating ====================

const StarRating: React.FC<{
  value: number;
  onChange: (val: number) => void;
  size?: 'sm' | 'md';
}> = ({ value, onChange, size = 'md' }) => {
  const sizeClass = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6';
  return (
    <div className="flex items-center space-x-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className="focus:outline-hidden"
        >
          <Star
            className={`${sizeClass} ${star <= value ? 'text-yellow-700 dark:text-yellow-400 fill-yellow-400' : 'text-theme-text-muted'}`}
          />
        </button>
      ))}
    </div>
  );
};

// ==================== Report Card ====================

const ReportCard: React.FC<{
  report: ShiftCompletionReport;
  memberMap: Record<string, string>;
}> = ({ report, memberMap }) => {
  const tz = useTimezone();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 hover:bg-theme-surface-hover transition-colors"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-1">
              <span className="text-theme-text-primary font-medium">
                {memberMap[report.trainee_id] || 'Unknown'}
              </span>
              {report.performance_rating && (
                <StarRating value={report.performance_rating} onChange={() => {}} size="sm" />
              )}
              {report.trainee_acknowledged && (
                <CheckCircle2 className="w-4 h-4 text-green-700 dark:text-green-400" />
              )}
            </div>
            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-theme-text-muted">
              <span className="flex items-center space-x-1">
                <Calendar className="w-3 h-3" />
                <span>{report.shift_date}</span>
              </span>
              <span className="flex items-center space-x-1">
                <Clock className="w-3 h-3" />
                <span>{report.hours_on_shift}h</span>
              </span>
              {report.calls_responded > 0 && (
                <span className="flex items-center space-x-1">
                  <Phone className="w-3 h-3" />
                  <span>{report.calls_responded} calls</span>
                </span>
              )}
            </div>
          </div>
          {expanded ? <ChevronUp className="w-5 h-5 text-theme-text-muted" /> : <ChevronDown className="w-5 h-5 text-theme-text-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-theme-surface-border pt-3 space-y-3">
          {report.officer_narrative && (
            <div>
              <span className="text-theme-text-muted text-xs">Officer Narrative</span>
              <p className="text-theme-text-secondary text-sm">{report.officer_narrative}</p>
            </div>
          )}
          {report.areas_of_strength && (
            <div>
              <span className="text-theme-text-muted text-xs">Strengths</span>
              <p className="text-green-700 dark:text-green-300 text-sm">{report.areas_of_strength}</p>
            </div>
          )}
          {report.areas_for_improvement && (
            <div>
              <span className="text-theme-text-muted text-xs">Areas for Improvement</span>
              <p className="text-orange-700 dark:text-orange-300 text-sm">{report.areas_for_improvement}</p>
            </div>
          )}
          {report.skills_observed && report.skills_observed.length > 0 && (
            <div>
              <span className="text-theme-text-muted text-xs">Skills Observed</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {report.skills_observed.map((s, i) => (
                  <span key={i} className={`text-xs px-2 py-0.5 rounded-sm ${s.demonstrated ? 'bg-green-500/20 text-green-700 dark:text-green-400' : 'bg-theme-surface-secondary text-theme-text-muted'}`}>
                    {s.skill_name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {report.tasks_performed && report.tasks_performed.length > 0 && (
            <div>
              <span className="text-theme-text-muted text-xs">Tasks Performed</span>
              <ul className="list-disc list-inside text-sm text-theme-text-secondary mt-1">
                {report.tasks_performed.map((t, i) => (
                  <li key={i}>{t.task}{t.description ? ` - ${t.description}` : ''}</li>
                ))}
              </ul>
            </div>
          )}
          {report.requirements_progressed && report.requirements_progressed.length > 0 && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-sm p-2 text-xs text-blue-700 dark:text-blue-300">
              Updated {report.requirements_progressed.length} pipeline requirement(s)
            </div>
          )}
          {report.trainee_comments && (
            <div className="bg-theme-surface-secondary rounded-sm p-2">
              <span className="text-theme-text-muted text-xs">Trainee Comments: </span>
              <span className="text-theme-text-secondary text-sm">{report.trainee_comments}</span>
            </div>
          )}
          <div className="text-xs text-theme-text-muted">
            Filed by: {memberMap[report.officer_id] || 'Unknown Officer'} on {formatDate(report.created_at, tz)}
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== Main Page ====================

interface SimpleUser {
  id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  username: string;
}

const ShiftReportPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [activeTab, setActiveTab] = useState<'new' | 'filed' | 'received'>('new');
  const [members, setMembers] = useState<SimpleUser[]>([]);
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [filedReports, setFiledReports] = useState<ShiftCompletionReport[]>([]);
  const [receivedReports, setReceivedReports] = useState<ShiftCompletionReport[]>([]);
  const [myStats, setMyStats] = useState<TraineeShiftStats | null>(null);
  const [moduleConfig, setModuleConfig] = useState<TrainingModuleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});

  // Form state
  const [traineeId, setTraineeId] = useState('');
  const [shiftDate, setShiftDate] = useState(() => getTodayLocalDate(tz));
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [availableShifts, setAvailableShifts] = useState<ShiftRecord[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [autoPopulated, setAutoPopulated] = useState<Record<string, boolean>>({});
  const [hoursOnShift, setHoursOnShift] = useState<number>(0);
  const [callsResponded, setCallsResponded] = useState<number>(0);
  const [callTypes, setCallTypes] = useState<string[]>([]);
  const [callTypeInput, setCallTypeInput] = useState('');
  const [rating, setRating] = useState<number>(0);
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');
  const [narrative, setNarrative] = useState('');
  const [skills, setSkills] = useState<SkillObservation[]>([]);
  const [tasks, setTasks] = useState<TaskPerformed[]>([]);
  const [enrollmentId, setEnrollmentId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [shiftAssignments, setShiftAssignments] = useState<Assignment[]>([]);
  const [showAllMembers, setShowAllMembers] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [membersData, filedData, receivedData, statsData, configData] = await Promise.all([
        userService.getUsers(),
        shiftCompletionService.getReportsByOfficer().catch(() => []),
        shiftCompletionService.getMyReports().catch(() => []),
        shiftCompletionService.getMyStats().catch(() => null),
        trainingModuleConfigService.getConfig().catch(() => null),
      ]);

      setModuleConfig(configData);
      setMembers(membersData as SimpleUser[]);
      const map: Record<string, string> = {};
      (membersData as SimpleUser[]).forEach((m) => {
        map[m.id] = m.full_name || `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.username;
      });
      setMemberMap(map);
      setFiledReports(filedData);
      setReceivedReports(receivedData);
      setMyStats(statsData);
    } catch (_error) {
      // Error silently handled - empty state shown
    } finally {
      setLoading(false);
    }
  };

  // Load shifts for the selected date
  useEffect(() => {
    if (!shiftDate) return;
    setLoadingShifts(true);
    schedulingService
      .getShifts({ start_date: shiftDate, end_date: shiftDate })
      .then((res) => setAvailableShifts(res.shifts))
      .catch(() => setAvailableShifts([]))
      .finally(() => setLoadingShifts(false));
  }, [shiftDate]);

  // Load shift assignments when a shift is selected
  useEffect(() => {
    if (!selectedShiftId) {
      setShiftAssignments([]);
      setShowAllMembers(false);
      return;
    }
    schedulingService
      .getShiftAssignments(selectedShiftId)
      .then(setShiftAssignments)
      .catch(() => setShiftAssignments([]));
  }, [selectedShiftId]);

  // Preview auto-populated data when shift + trainee selected
  useEffect(() => {
    if (!selectedShiftId || !traineeId) {
      setAutoPopulated({});
      return;
    }
    shiftCompletionService
      .previewShiftData(selectedShiftId, traineeId)
      .then((preview) => {
        const populated: Record<string, boolean> = {};
        if (preview.hours_on_shift && preview.hours_on_shift > 0) {
          setHoursOnShift(preview.hours_on_shift);
          populated['hours_on_shift'] = true;
        }
        if (preview.calls_responded > 0) {
          setCallsResponded(preview.calls_responded);
          populated['calls_responded'] = true;
        }
        if (preview.call_types.length > 0) {
          setCallTypes(preview.call_types);
          populated['call_types'] = true;
        }
        setAutoPopulated(populated);
      })
      .catch(() => setAutoPopulated({}));
  }, [selectedShiftId, traineeId]);

  // Load enrollments when trainee is selected
  useEffect(() => {
    if (traineeId) {
      trainingProgramService.getUserEnrollments(traineeId).then(setEnrollments).catch(() => setEnrollments([]));
    } else {
      setEnrollments([]);
    }
  }, [traineeId]);

  const addCallType = () => {
    if (callTypeInput.trim() && !callTypes.includes(callTypeInput.trim())) {
      setCallTypes([...callTypes, callTypeInput.trim()]);
      setCallTypeInput('');
    }
  };

  const addSkill = () => {
    setSkills([...skills, { skill_name: '', demonstrated: false }]);
  };

  const updateSkill = (index: number, updates: Partial<SkillObservation>) => {
    setSkills(skills.map((s, i) => i === index ? { ...s, ...updates } : s));
  };

  const removeSkill = (index: number) => {
    setSkills(skills.filter((_, i) => i !== index));
  };

  const addTask = () => {
    setTasks([...tasks, { task: '' }]);
  };

  const updateTask = (index: number, updates: Partial<TaskPerformed>) => {
    setTasks(tasks.map((t, i) => i === index ? { ...t, ...updates } : t));
  };

  const removeTask = (index: number) => {
    setTasks(tasks.filter((_, i) => i !== index));
  };

  const buildReportData = (
    asDraft: boolean,
  ): ShiftCompletionReportCreate => {
    const filteredSkills = skills.filter(
      (s) => s.skill_name.trim(),
    );
    const filteredTasks = tasks.filter((t) => t.task.trim());
    return {
      shift_date: shiftDate,
      trainee_id: traineeId,
      hours_on_shift: hoursOnShift,
      calls_responded: callsResponded,
      call_types:
        callTypes.length > 0 ? callTypes : undefined,
      performance_rating:
        rating > 0 ? rating : undefined,
      ...(selectedShiftId
        ? { shift_id: selectedShiftId }
        : {}),
      ...(strengths
        ? { areas_of_strength: strengths }
        : {}),
      ...(improvements
        ? { areas_for_improvement: improvements }
        : {}),
      ...(narrative
        ? { officer_narrative: narrative }
        : {}),
      skills_observed:
        filteredSkills.length > 0
          ? filteredSkills
          : undefined,
      tasks_performed:
        filteredTasks.length > 0
          ? filteredTasks
          : undefined,
      ...(enrollmentId
        ? { enrollment_id: enrollmentId }
        : {}),
      ...(asDraft ? { save_as_draft: true } : {}),
    };
  };

  const resetForm = () => {
    setTraineeId('');
    setSelectedShiftId('');
    setAutoPopulated({});
    setHoursOnShift(0);
    setCallsResponded(0);
    setCallTypes([]);
    setRating(0);
    setStrengths('');
    setImprovements('');
    setNarrative('');
    setSkills([]);
    setTasks([]);
    setEnrollmentId('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!traineeId || !hoursOnShift) {
      toast.error('Please select a trainee and enter hours');
      return;
    }

    setSubmitting(true);
    try {
      const result = await shiftCompletionService.createReport(
        buildReportData(false),
      );
      const progressCount =
        result.requirements_progressed?.length || 0;
      toast.success(
        progressCount > 0
          ? `Report filed! Updated ${progressCount} pipeline requirement(s).`
          : 'Shift completion report filed!',
      );
      resetForm();
      void loadData();
    } catch (err: unknown) {
      const msg =
        (
          err as {
            response?: { data?: { detail?: string } };
          }
        )?.response?.data?.detail ||
        'Failed to submit report';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!traineeId || !hoursOnShift) {
      toast.error('Please select a trainee and enter hours');
      return;
    }

    setSavingDraft(true);
    try {
      await shiftCompletionService.createReport(
        buildReportData(true),
      );
      toast.success('Draft saved');
      resetForm();
      void loadData();
    } catch (err: unknown) {
      const msg =
        (
          err as {
            response?: { data?: { detail?: string } };
          }
        )?.response?.data?.detail ||
        'Failed to save draft';
      toast.error(msg);
    } finally {
      setSavingDraft(false);
    }
  };

  const handleAcknowledge = async (reportId: string) => {
    try {
      await shiftCompletionService.acknowledgeReport(reportId);
      toast.success('Report acknowledged');
      void loadData();
    } catch {
      toast.error('Failed to acknowledge report');
    }
  };

  const DEFAULT_CALL_TYPES = [
    'Structure Fire', 'Vehicle Fire', 'Brush/Wildland',
    'EMS/Medical', 'Motor Vehicle Accident', 'Hazmat',
    'Rescue/Extrication', 'Alarm Investigation',
    'Public Assist', 'Other',
  ];
  const callTypeOptions = moduleConfig?.shift_review_call_types?.length
    ? moduleConfig.shift_review_call_types
    : DEFAULT_CALL_TYPES;

  const DEFAULT_SKILLS = [
    'SCBA donning/doffing', 'Hose deployment',
    'Ladder operations', 'Search and rescue',
    'Ventilation', 'Pump operations',
    'Patient assessment', 'CPR/AED',
    'Vitals monitoring', 'Radio communications',
    'Scene size-up', 'Apparatus check-off',
  ];

  const ratingLabel =
    moduleConfig?.rating_label || 'Performance Rating';
  const ratingScaleType =
    moduleConfig?.rating_scale_type || 'stars';
  const ratingScaleLabels: Record<string, string> =
    moduleConfig?.rating_scale_labels ?? {
      '1': 'Unsatisfactory',
      '2': 'Developing',
      '3': 'Competent',
      '4': 'Proficient',
      '5': 'Exemplary',
    };

  const selectedShift = availableShifts.find(
    (s) => s.id === selectedShiftId,
  );
  const shiftApparatusType =
    selectedShift?.apparatus_type ?? null;

  const skillOptions = useMemo(() => {
    if (
      shiftApparatusType &&
      moduleConfig?.apparatus_type_skills
    ) {
      const typeSkills =
        moduleConfig.apparatus_type_skills[
          shiftApparatusType
        ];
      if (typeSkills?.length) return typeSkills;
    }
    return moduleConfig?.shift_review_default_skills?.length
      ? moduleConfig.shift_review_default_skills
      : DEFAULT_SKILLS;
  }, [moduleConfig, shiftApparatusType]);

  const taskDefaults = useMemo(() => {
    if (
      shiftApparatusType &&
      moduleConfig?.apparatus_type_tasks
    ) {
      const typeTasks =
        moduleConfig.apparatus_type_tasks[
          shiftApparatusType
        ];
      if (typeTasks?.length) return typeTasks;
    }
    return moduleConfig?.shift_review_default_tasks ?? [];
  }, [moduleConfig, shiftApparatusType]);

  const filteredMembers = useMemo(() => {
    const assignedIds = new Set(
      shiftAssignments.map((a) => a.user_id),
    );
    if (
      selectedShiftId &&
      assignedIds.size > 0 &&
      !showAllMembers
    ) {
      return members.filter((m) => assignedIds.has(m.id));
    }
    return members;
  }, [
    members,
    shiftAssignments,
    selectedShiftId,
    showAllMembers,
  ]);

  return (
    <div className="min-h-screen">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center space-x-4 mb-6">
          <button
            onClick={() => navigate('/training/officer')}
            className="p-2 text-theme-text-muted hover:text-theme-text-primary rounded-lg hover:bg-theme-surface"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-theme-text-primary flex items-center space-x-2">
              <ClipboardList className="w-7 h-7 text-red-500" />
              <span>Shift Completion Reports</span>
            </h1>
            <p className="text-theme-text-muted text-sm">
              Document trainee performance and experiences during shifts
            </p>
          </div>
        </div>

        {/* Stats Bar */}
        {myStats && myStats.total_reports > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div className="bg-theme-surface rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-theme-text-primary">{myStats.total_reports}</div>
              <div className="text-xs text-theme-text-muted">Reports</div>
            </div>
            <div className="bg-theme-surface rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-theme-text-primary">{myStats.total_hours}</div>
              <div className="text-xs text-theme-text-muted">Shift Hours</div>
            </div>
            <div className="bg-theme-surface rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-theme-text-primary">{myStats.total_calls}</div>
              <div className="text-xs text-theme-text-muted">Calls</div>
            </div>
            <div className="bg-theme-surface rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-theme-text-primary">{myStats.avg_rating || '-'}</div>
              <div className="text-xs text-theme-text-muted">Avg Rating</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex space-x-1 bg-theme-surface p-1 rounded-lg mb-6">
          <button
            onClick={() => setActiveTab('new')}
            className={`flex-1 px-4 py-2 rounded-md font-medium text-sm transition-colors ${
              activeTab === 'new' ? 'bg-red-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <Plus className="w-4 h-4 inline mr-1" /> New Report
          </button>
          <button
            onClick={() => setActiveTab('filed')}
            className={`flex-1 px-4 py-2 rounded-md font-medium text-sm transition-colors ${
              activeTab === 'filed' ? 'bg-red-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <FileText className="w-4 h-4 inline mr-1" /> Filed ({filedReports.length})
          </button>
          <button
            onClick={() => setActiveTab('received')}
            className={`flex-1 px-4 py-2 rounded-md font-medium text-sm transition-colors ${
              activeTab === 'received' ? 'bg-red-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <TrendingUp className="w-4 h-4 inline mr-1" /> My Reports ({receivedReports.length})
          </button>
        </div>

        {/* New Report Form */}
        {activeTab === 'new' && (
          <form onSubmit={(e) => { void handleSubmit(e); }} className="bg-theme-surface rounded-lg border border-theme-surface-border p-6 space-y-5">
            <h2 className="text-lg font-semibold text-theme-text-primary">File Shift Completion Report</h2>

            {/* Trainee + Date */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-theme-text-secondary">Trainee <span className="text-red-700 dark:text-red-400">*</span></label>
                  {selectedShiftId && shiftAssignments.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllMembers(!showAllMembers)}
                      className="text-xs text-red-700 dark:text-red-400 hover:underline"
                    >
                      {showAllMembers
                        ? `Shift members only (${shiftAssignments.length})`
                        : 'Show all members'}
                    </button>
                  )}
                </div>
                <select
                  value={traineeId}
                  onChange={(e) => setTraineeId(e.target.value)}
                  className="form-input w-full"
                  required
                >
                  <option value="">
                    {selectedShiftId && shiftAssignments.length > 0 && !showAllMembers
                      ? `Select from shift members (${filteredMembers.length})...`
                      : 'Select a trainee...'}
                  </option>
                  {filteredMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name || `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.username}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Shift Date <span className="text-red-700 dark:text-red-400">*</span></label>
                <input
                  type="date"
                  value={shiftDate}
                  onChange={(e) => setShiftDate(e.target.value)}
                  className="form-input w-full"
                  required
                  max={getTodayLocalDate(tz)}
                />
              </div>
            </div>

            {/* Link to Shift */}
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                <Link className="w-3.5 h-3.5 inline mr-1" />
                Link to Shift (optional)
              </label>
              <select
                value={selectedShiftId}
                onChange={(e) => setSelectedShiftId(e.target.value)}
                className="form-input w-full"
                disabled={loadingShifts}
              >
                <option value="">
                  {loadingShifts ? 'Loading shifts...' : 'No shift linked — manual entry'}
                </option>
                {availableShifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.apparatus_name || s.apparatus_unit_number || 'Shift'} — {formatTime(s.start_time, tz)}
                    {s.end_time ? ` to ${formatTime(s.end_time, tz)}` : ''}
                    {s.shift_officer_name ? ` (${s.shift_officer_name})` : ''}
                  </option>
                ))}
              </select>
              {selectedShiftId && Object.keys(autoPopulated).length > 0 && (
                <div className="mt-1.5 flex items-center gap-1 text-xs text-blue-700 dark:text-blue-400">
                  <Zap className="w-3 h-3" />
                  <span>
                    Auto-filled from shift records:{' '}
                    {Object.keys(autoPopulated).map((k) => k.replace(/_/g, ' ')).join(', ')}
                  </span>
                </div>
              )}
            </div>

            {/* Hours + Calls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Hours on Shift <span className="text-red-700 dark:text-red-400">*</span>
                  {autoPopulated['hours_on_shift'] && (
                    <span className="ml-1.5 text-xs font-normal text-blue-700 dark:text-blue-400">(auto)</span>
                  )}
                </label>
                <input
                  type="number"
                  value={hoursOnShift || ''}
                  onChange={(e) => {
                    setHoursOnShift(parseFloat(e.target.value) || 0);
                    setAutoPopulated((prev) => {
                      const next = { ...prev };
                      delete next['hours_on_shift'];
                      return next;
                    });
                  }}
                  className="form-input w-full"
                  required
                  min={0.5}
                  max={48}
                  step={0.5}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Calls Responded
                  {autoPopulated['calls_responded'] && (
                    <span className="ml-1.5 text-xs font-normal text-blue-700 dark:text-blue-400">(auto)</span>
                  )}
                </label>
                <input
                  type="number"
                  value={callsResponded || ''}
                  onChange={(e) => {
                    setCallsResponded(parseInt(e.target.value) || 0);
                    setAutoPopulated((prev) => {
                      const next = { ...prev };
                      delete next['calls_responded'];
                      return next;
                    });
                  }}
                  className="form-input w-full"
                  min={0}
                />
              </div>
            </div>

            {/* Call Types */}
            {(moduleConfig?.form_show_call_types ?? true) && callsResponded > 0 && (
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Call Types</label>
                <div className="flex flex-wrap gap-1 mb-2">
                  {callTypeOptions.map((ct) => (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => {
                        if (callTypes.includes(ct)) {
                          setCallTypes(callTypes.filter((t) => t !== ct));
                        } else {
                          setCallTypes([...callTypes, ct]);
                        }
                      }}
                      className={`text-xs px-2 py-1 rounded transition-colors ${
                        callTypes.includes(ct)
                          ? 'bg-red-600 text-white'
                          : 'bg-theme-surface-hover text-theme-text-muted hover:bg-theme-surface-secondary'
                      }`}
                    >
                      {ct}
                    </button>
                  ))}
                </div>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={callTypeInput}
                    onChange={(e) => setCallTypeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCallType(); } }}
                    placeholder="Custom call type..."
                    className="form-input flex-1"
                  />
                  <button type="button" onClick={addCallType} className="px-3 py-1.5 bg-theme-surface-secondary text-theme-text-primary rounded-sm text-sm hover:bg-theme-surface-hover">
                    Add
                  </button>
                </div>
              </div>
            )}

            {/* Pipeline Enrollment */}
            {traineeId && enrollments.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Link to Pipeline (optional)</label>
                <select
                  value={enrollmentId}
                  onChange={(e) => setEnrollmentId(e.target.value)}
                  className="form-input w-full"
                >
                  <option value="">No specific pipeline</option>
                  {enrollments.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.program?.name || 'Program'} ({Math.round(e.progress_percentage || 0)}% complete)
                    </option>
                  ))}
                </select>
                <p className="text-xs text-theme-text-muted mt-1">
                  Shift hours and calls will automatically count toward pipeline requirements
                </p>
              </div>
            )}

            {/* Performance Rating */}
            {(moduleConfig?.form_show_performance_rating ?? true) && (
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">{ratingLabel}</label>
              {ratingScaleType === 'stars' ? (
                <StarRating value={rating} onChange={setRating} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Array.from(
                    { length: Object.keys(ratingScaleLabels).length || 5 },
                    (_, i) => i + 1,
                  ).map((i) => {
                    const label = ratingScaleLabels[String(i)] || `Level ${i}`;
                    const isSelected = rating === i;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setRating(isSelected ? 0 : i)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          isSelected
                            ? 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30 ring-1 ring-red-500/30'
                            : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-red-500/30'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            )}

            {/* Narrative Fields */}
            {(moduleConfig?.form_show_officer_narrative ?? true) && (
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Officer Narrative</label>
              <textarea
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                rows={3}
                placeholder="Describe the trainee's overall shift experience..."
                className="form-input w-full"
              />
            </div>
            )}

            {((moduleConfig?.form_show_areas_of_strength ?? true) || (moduleConfig?.form_show_areas_for_improvement ?? true)) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(moduleConfig?.form_show_areas_of_strength ?? true) && (
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Areas of Strength</label>
                <textarea
                  value={strengths}
                  onChange={(e) => setStrengths(e.target.value)}
                  rows={2}
                  placeholder="What did the trainee do well?"
                  className="form-input w-full"
                />
              </div>
              )}
              {(moduleConfig?.form_show_areas_for_improvement ?? true) && (
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Areas for Improvement</label>
                <textarea
                  value={improvements}
                  onChange={(e) => setImprovements(e.target.value)}
                  rows={2}
                  placeholder="Where can the trainee improve?"
                  className="form-input w-full"
                />
              </div>
              )}
            </div>
            )}

            {/* Skills Observed */}
            {(moduleConfig?.form_show_skills_observed ?? true) && (
            <div>
              <label className="text-sm font-medium text-theme-text-secondary block mb-2">Skills Observed</label>
              {shiftApparatusType && (
                <p className="text-xs text-theme-text-muted mb-2">
                  Showing skills for <span className="capitalize font-medium">{shiftApparatusType}</span>
                </p>
              )}
              <div className="space-y-2">
                {skillOptions.map((skillName) => {
                  const selected = skills.find(
                    (s) => s.skill_name === skillName,
                  );
                  return (
                    <div key={skillName}>
                      <button
                        type="button"
                        onClick={() => {
                          if (selected) {
                            setSkills(
                              skills.filter(
                                (s) =>
                                  s.skill_name !== skillName,
                              ),
                            );
                          } else {
                            setSkills([
                              ...skills,
                              {
                                skill_name: skillName,
                                demonstrated: true,
                              },
                            ]);
                          }
                        }}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          selected
                            ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30'
                            : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-green-500/30'
                        }`}
                      >
                        {selected ? '\u2713 ' : ''}{skillName}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            )}

            {/* Tasks Performed */}
            {(moduleConfig?.form_show_tasks_performed ?? true) && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-theme-text-secondary">Tasks Performed</label>
                <button type="button" onClick={addTask} className="text-xs text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 flex items-center space-x-1">
                  <Plus className="w-3 h-3" /><span>Add Task</span>
                </button>
              </div>
              {/* Quick-add from defaults */}
              {taskDefaults.length > 0 && tasks.length === 0 && (
                <div className="mb-2">
                  <p className="text-xs text-theme-text-muted mb-1.5">Quick add from defaults:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {taskDefaults.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTasks([...tasks, { task: t }])}
                        className="px-2 py-1 text-xs rounded-full border border-red-500/20 bg-red-500/5 text-red-700 dark:text-red-400 hover:bg-red-500/15 transition-colors"
                      >
                        + {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {tasks.map((task, i) => (
                <div key={i} className="flex items-center space-x-2 mb-2">
                  <input
                    type="text"
                    value={task.task}
                    onChange={(e) => updateTask(i, { task: e.target.value })}
                    placeholder="Task name"
                    className="form-input flex-1"
                  />
                  <input
                    type="text"
                    value={task.description || ''}
                    onChange={(e) => updateTask(i, { description: e.target.value || undefined })}
                    placeholder="Notes (optional)"
                    className="form-input flex-1"
                  />
                  <button type="button" onClick={() => removeTask(i)} className="text-theme-text-muted hover:text-red-800 dark:hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            )}

            {/* Submit */}
            <div className="flex items-center justify-between pt-4 border-t border-theme-surface-border">
              <p className="text-xs text-theme-text-muted">
                {enrollmentId
                  ? 'Hours and calls will automatically update pipeline requirements.'
                  : 'Will update any active pipeline requirements for this trainee.'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { void handleSaveDraft(); }}
                  disabled={savingDraft || submitting}
                  className="flex font-medium items-center px-4 py-2 space-x-2 text-sm border border-theme-surface-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  <span>{savingDraft ? 'Saving...' : 'Save as Draft'}</span>
                </button>
                <button
                  type="submit"
                  disabled={submitting || savingDraft}
                  className="btn-primary flex font-medium items-center px-5 space-x-2 text-sm"
                >
                  <Send className="w-4 h-4" />
                  <span>{submitting ? 'Filing...' : 'File Report'}</span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Filed Reports */}
        {activeTab === 'filed' && (
          <div className="space-y-3">
            {loading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-500" />
              </div>
            ) : filedReports.length === 0 ? (
              <div className="text-center py-12 bg-theme-surface rounded-lg">
                <ClipboardList className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
                <p className="text-theme-text-muted">No reports filed yet.</p>
              </div>
            ) : (
              filedReports.map((r) => (
                <ReportCard key={r.id} report={r} memberMap={memberMap} />
              ))
            )}
          </div>
        )}

        {/* Received Reports (trainee view) */}
        {activeTab === 'received' && (
          <div className="space-y-3">
            {loading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-500" />
              </div>
            ) : receivedReports.length === 0 ? (
              <div className="text-center py-12 bg-theme-surface rounded-lg">
                <TrendingUp className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
                <p className="text-theme-text-muted">No shift reports about you yet.</p>
              </div>
            ) : (
              receivedReports.map((r) => (
                <div key={r.id}>
                  <ReportCard report={r} memberMap={memberMap} />
                  {!r.trainee_acknowledged && (
                    <div className="mt-1 flex justify-end">
                      <button
                        onClick={() => { void handleAcknowledge(r.id); }}
                        className="btn-success rounded-sm px-3 py-1 text-xs"
                      >
                        Acknowledge
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default ShiftReportPage;
