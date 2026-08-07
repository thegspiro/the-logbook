/**
 * My Training Page
 *
 * Member-facing page showing their own training data. Content is controlled
 * by the organization's TrainingModuleConfig visibility settings.
 * Officers/admins always see everything.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  GraduationCap,
  Clock,
  Award,
  TrendingUp,
  ClipboardList,
  FileText,
  Star,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Settings,
  Shield,
  Send,
  BarChart3,
  Download,
  ClipboardCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { trainingModuleConfigService } from '../services/api';
import { DateRangePicker } from '../components/ux/DateRangePicker';
import { formatDate, getTodayLocalDate, toLocalDateString } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { SubmissionStatus } from '../constants/enums';
import type { MyTrainingSummary, TrainingModuleConfig as TMConfig, RequirementDetail } from '../types/training';
import { getErrorMessage } from '../utils/errorHandling';
import { SkeletonPage } from '../components/ux/Skeleton';
import { MySkillTestsList } from '../components/training/MySkillTestsList';
import { useAuthStore } from '../stores/authStore';
import { getProgressBarColor, getPercentageBarColor } from '../utils/trainingColors';

// ==================== Helpers ====================

const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed':
      return 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400';
    case SubmissionStatus.APPROVED:
      return 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400';
    case 'active':
      return 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400';
    case 'in_progress':
      return 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400';
    case SubmissionStatus.PENDING_REVIEW:
      return 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400';
    case SubmissionStatus.REJECTED:
      return 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400';
    case SubmissionStatus.REVISION_REQUESTED:
      return 'bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400';
    default:
      return 'bg-theme-surface-secondary text-theme-text-secondary';
  }
};

// ==================== Stat Card ====================

const StatCard: React.FC<{ icon: React.ElementType; label: string; value: string | number; color?: string }> = ({
  icon: Icon,
  label,
  value,
  color = 'text-theme-text-primary',
}) => (
  <div className="card-secondary p-4">
    <div className="mb-1 flex items-center space-x-2">
      <Icon className="text-theme-text-muted h-4 w-4" />
      <span className="text-theme-text-muted text-xs">{label}</span>
    </div>
    <p className={`text-xl font-bold ${color}`}>{value}</p>
  </div>
);

// ==================== Section Wrapper ====================

const Section: React.FC<{
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}> = ({ title, icon: Icon, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card-secondary overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="hover:bg-theme-surface-hover flex w-full items-center justify-between px-5 py-4 text-left transition-colors"
      >
        <div className="flex items-center space-x-3">
          <Icon className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
          <h2 className="text-theme-text-primary text-lg font-semibold">{title}</h2>
        </div>
        {open ? (
          <ChevronUp className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
        ) : (
          <ChevronDown className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
        )}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
};

// ==================== Config Editor (Officers Only) ====================

interface ConfigEditorProps {
  config: TMConfig;
  onSave: (updates: Partial<TMConfig>) => Promise<void>;
}

const VISIBILITY_FIELDS: Array<{ key: keyof TMConfig; label: string; description: string; group: string }> = [
  {
    key: 'show_training_history',
    label: 'Training History',
    description: 'Members can see their training record list',
    group: 'Training Records',
  },
  {
    key: 'show_training_hours',
    label: 'Training Hours Summary',
    description: 'Members can see their total hours',
    group: 'Training Records',
  },
  {
    key: 'show_certification_status',
    label: 'Certification Status',
    description: 'Members can see certification expiration dates',
    group: 'Training Records',
  },
  {
    key: 'show_pipeline_progress',
    label: 'Pipeline Progress',
    description: 'Members can see their program enrollment progress',
    group: 'Pipeline',
  },
  {
    key: 'show_requirement_details',
    label: 'Requirement Details',
    description: 'Members can see individual requirement progress',
    group: 'Pipeline',
  },
  {
    key: 'show_shift_reports',
    label: 'Shift Reports',
    description: 'Members can see their shift completion reports',
    group: 'Shift Reports',
  },
  {
    key: 'show_shift_stats',
    label: 'Shift Statistics',
    description: 'Members can see aggregate shift stats (hours, calls)',
    group: 'Shift Reports',
  },
  {
    key: 'show_performance_rating',
    label: 'Performance Rating',
    description: 'Members can see their 1-5 performance rating',
    group: 'Officer Observations',
  },
  {
    key: 'show_areas_of_strength',
    label: 'Areas of Strength',
    description: 'Members can see officer-noted strengths',
    group: 'Officer Observations',
  },
  {
    key: 'show_areas_for_improvement',
    label: 'Areas for Improvement',
    description: 'Members can see improvement notes',
    group: 'Officer Observations',
  },
  {
    key: 'show_skills_observed',
    label: 'Skills Observed',
    description: 'Members can see observed skill evaluations',
    group: 'Officer Observations',
  },
  {
    key: 'show_officer_narrative',
    label: 'Officer Narrative',
    description: 'Members can see officer written narratives (off by default)',
    group: 'Officer Observations',
  },
  {
    key: 'show_submission_history',
    label: 'Submission History',
    description: 'Members can see their self-reported submissions',
    group: 'Self-Reported',
  },
  {
    key: 'allow_member_report_export',
    label: 'Allow Report Export',
    description: 'Members can download their own training data',
    group: 'Reports',
  },
];

const REVIEW_ROLE_OPTIONS = [
  { value: 'training_officer', label: 'Training Officer' },
  { value: 'captain', label: 'Captain' },
  { value: 'chief', label: 'Chief' },
];

const RATING_SCALE_OPTIONS = [
  { value: 'stars', label: 'Star Rating (1-5 stars)' },
  { value: 'competency', label: 'Competency Scale (Unsatisfactory → Exemplary)' },
  { value: 'custom', label: 'Custom Labels' },
];

const DEFAULT_COMPETENCY_LABELS: Record<string, string> = {
  '1': 'Unsatisfactory',
  '2': 'Developing',
  '3': 'Competent',
  '4': 'Proficient',
  '5': 'Exemplary',
};

const ConfigEditor: React.FC<ConfigEditorProps> = ({ config, onSave }) => {
  const [draft, setDraft] = useState<Partial<TMConfig>>({});
  const [saving, setSaving] = useState(false);

  const groups = [...new Set(VISIBILITY_FIELDS.map((f) => f.group))];

  const getCurrentValue = (key: keyof TMConfig) => {
    return draft[key] !== undefined ? (draft[key] as boolean) : (config[key] as boolean);
  };

  const getStringValue = (key: keyof TMConfig) => {
    return (draft[key] !== undefined ? draft[key] : config[key]) as string;
  };

  const getLabelsValue = (): Record<string, string> => {
    return draft.rating_scale_labels ?? config.rating_scale_labels ?? DEFAULT_COMPETENCY_LABELS;
  };

  const handleSave = async () => {
    if (Object.keys(draft).length === 0) return;
    setSaving(true);
    try {
      await onSave(draft);
      setDraft({});
    } finally {
      setSaving(false);
    }
  };

  const currentScaleType = getStringValue('rating_scale_type') || 'stars';

  return (
    <div className="space-y-6">
      <p className="text-theme-text-muted text-sm">
        Control what training data members can see on their personal training page. Officers and administrators always
        see the full dataset regardless of these settings.
      </p>

      {groups.map((group) => (
        <div key={group}>
          <h4 className="text-theme-text-secondary mb-3 text-sm font-semibold">{group}</h4>
          <div className="space-y-2">
            {VISIBILITY_FIELDS.filter((f) => f.group === group).map((field) => (
              <label
                key={field.key}
                className="bg-theme-surface hover:bg-theme-surface-hover flex cursor-pointer items-center justify-between rounded-lg p-3 transition-colors"
              >
                <div>
                  <p className="text-theme-text-primary text-sm font-medium">{field.label}</p>
                  <p className="text-theme-text-muted text-xs">{field.description}</p>
                </div>
                <input
                  type="checkbox"
                  checked={getCurrentValue(field.key)}
                  onChange={(e) => setDraft({ ...draft, [field.key]: e.target.checked })}
                  className="bg-theme-input-bg border-theme-input-border focus:ring-theme-focus-ring h-5 w-5 rounded-sm text-blue-600"
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      {/* Report Review Workflow */}
      <div>
        <h4 className="text-theme-text-secondary mb-3 text-sm font-semibold">Report Review Workflow</h4>
        <div className="space-y-3">
          <label className="bg-theme-surface hover:bg-theme-surface-hover flex cursor-pointer items-center justify-between rounded-lg p-3 transition-colors">
            <div>
              <p className="text-theme-text-primary text-sm font-medium">Require Review Before Visibility</p>
              <p className="text-theme-text-muted text-xs">
                Reports must be reviewed and approved before trainees can see them
              </p>
            </div>
            <input
              type="checkbox"
              checked={getCurrentValue('report_review_required')}
              onChange={(e) => setDraft({ ...draft, report_review_required: e.target.checked })}
              className="bg-theme-input-bg border-theme-input-border focus:ring-theme-focus-ring h-5 w-5 rounded-sm text-blue-600"
            />
          </label>

          {getCurrentValue('report_review_required') && (
            <div className="bg-theme-surface rounded-lg p-3">
              <p className="text-theme-text-primary mb-1 text-sm font-medium">Review Role</p>
              <p className="text-theme-text-muted mb-2 text-xs">
                Who should review reports before they are visible to trainees?
              </p>
              <select
                value={getStringValue('report_review_role') || 'training_officer'}
                onChange={(e) => setDraft({ ...draft, report_review_role: e.target.value })}
                className="form-input text-sm"
              >
                {REVIEW_ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Rating Scale Configuration */}
      <div>
        <h4 className="text-theme-text-secondary mb-3 text-sm font-semibold">Rating Scale</h4>
        <div className="space-y-3">
          <div className="bg-theme-surface rounded-lg p-3">
            <p className="text-theme-text-primary mb-1 text-sm font-medium">Rating Label</p>
            <p className="text-theme-text-muted mb-2 text-xs">
              How the rating field is labeled to officers (e.g. &quot;Performance Rating&quot;, &quot;Skills
              Assessment&quot;)
            </p>
            <input
              type="text"
              value={getStringValue('rating_label') || 'Performance Rating'}
              onChange={(e) => setDraft({ ...draft, rating_label: e.target.value })}
              placeholder="Performance Rating"
              className="form-input text-sm"
            />
          </div>

          <div className="bg-theme-surface rounded-lg p-3">
            <p className="text-theme-text-primary mb-1 text-sm font-medium">Scale Type</p>
            <p className="text-theme-text-muted mb-2 text-xs">How the rating is displayed</p>
            <select
              value={currentScaleType}
              onChange={(e) => {
                const newDraft: Partial<TMConfig> = { ...draft, rating_scale_type: e.target.value };
                // Set default labels when switching to competency
                if (e.target.value === 'competency') {
                  newDraft.rating_scale_labels = DEFAULT_COMPETENCY_LABELS;
                }
                setDraft(newDraft);
              }}
              className="form-input text-sm"
            >
              {RATING_SCALE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {(currentScaleType === 'competency' || currentScaleType === 'custom') && (
            <div className="bg-theme-surface rounded-lg p-3">
              <p className="text-theme-text-primary mb-1 text-sm font-medium">Scale Labels</p>
              <p className="text-theme-text-muted mb-2 text-xs">Define labels for each level (1-5)</p>
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((level) => {
                  const labels = getLabelsValue();
                  return (
                    <div key={level} className="flex items-center gap-2">
                      <span className="text-theme-text-muted w-6 text-center font-mono text-sm">{level}</span>
                      <input
                        type="text"
                        value={labels[String(level)] || ''}
                        onChange={(e) => {
                          const updated = { ...getLabelsValue(), [String(level)]: e.target.value };
                          setDraft({ ...draft, rating_scale_labels: updated });
                        }}
                        placeholder={DEFAULT_COMPETENCY_LABELS[String(level)]}
                        className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring flex-1 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:outline-hidden"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {Object.keys(draft).length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={() => {
              void handleSave();
            }}
            disabled={saving}
            className="btn-primary text-sm font-medium disabled:opacity-60"
          >
            {saving
              ? 'Saving...'
              : `Save ${Object.keys(draft).length} Change${Object.keys(draft).length > 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
};

// ==================== Main Component ====================

const MyTrainingPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const { user } = useAuthStore();
  const [data, setData] = useState<MyTrainingSummary | null>(null);
  const [config, setConfig] = useState<TMConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'settings'>('overview');
  const [isOfficer, setIsOfficer] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Training-history view defaults to the last 12 months; clearing the range
  // shows (and exports) the member's entire history.
  const [rangeStart, setRangeStart] = useState(() => {
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);
    return toLocalDateString(start, tz);
  });
  const [rangeEnd, setRangeEnd] = useState(() => getTodayLocalDate(tz));

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const trainingData = await trainingModuleConfigService.getMyTraining();
      setData(trainingData);

      // Try to load the full config (only works for officers)
      try {
        const cfg = await trainingModuleConfigService.getConfig();
        setConfig(cfg);
        setIsOfficer(true);
      } catch {
        setIsOfficer(false);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load training data'));
    } finally {
      setLoading(false);
    }
  };

  const handleConfigSave = async (updates: Partial<TMConfig>) => {
    const updated = await trainingModuleConfigService.updateConfig(updates);
    setConfig(updated);
    // Reload the data to reflect visibility changes
    const trainingData = await trainingModuleConfigService.getMyTraining();
    setData(trainingData);
  };

  const handleExport = async (format: 'csv' | 'pdf') => {
    try {
      setExporting(true);
      const blob = await trainingModuleConfigService.exportMyTraining(
        format,
        rangeStart || undefined,
        rangeEnd || undefined
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my_training_record.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to export training record'));
    } finally {
      setExporting(false);
    }
  };

  const v = data?.visibility;

  const allRecords = data?.training_records ?? [];
  const recordInRange = (completionDate?: string | null): boolean => {
    if (!completionDate) return !rangeStart && !rangeEnd;
    if (rangeStart && completionDate < rangeStart) return false;
    if (rangeEnd && completionDate > rangeEnd) return false;
    return true;
  };
  const filteredRecords = allRecords.filter((r) => recordInRange(r.completion_date));

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <SkeletonPage rows={5} showStats />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-red-700 dark:text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-theme-text-primary flex items-center space-x-3 text-3xl font-bold">
              <GraduationCap className="h-8 w-8 text-red-500" />
              <span>My Training</span>
            </h1>
            <p className="text-theme-text-muted mt-1">
              Your training records, certifications, pipeline progress, and shift experience
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => void navigate('/training/submit')}
              className="btn-primary flex items-center space-x-2 text-sm font-medium"
            >
              <Send className="h-4 w-4" />
              <span>Submit Training</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs (only show settings tab for officers) */}
      {isOfficer && (
        <div className="mb-6 flex space-x-2">
          <button
            onClick={() => setActiveTab('overview')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'overview'
                ? 'bg-red-600 text-white'
                : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
            }`}
          >
            My Training
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center space-x-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'settings'
                ? 'bg-red-600 text-white'
                : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
            }`}
          >
            <Settings className="h-4 w-4" />
            <span>Member Visibility Settings</span>
          </button>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && config && (
        <Section title="Member Visibility Settings" icon={Shield} defaultOpen>
          <ConfigEditor config={config} onSave={handleConfigSave} />
        </Section>
      )}

      {/* Overview Tab */}
      {activeTab === 'overview' && data && (
        <div className="space-y-6">
          {/* Records range + export toolbar */}
          {(v?.show_training_history || v?.allow_member_report_export) && (
            <div className="bg-theme-surface border-theme-surface-border flex flex-wrap items-end justify-between gap-4 rounded-lg border p-4">
              <div>
                <DateRangePicker
                  label="Training records date range"
                  startDate={rangeStart}
                  endDate={rangeEnd}
                  onChange={(s, e) => {
                    setRangeStart(s);
                    setRangeEnd(e);
                  }}
                />
                <p className="text-theme-text-muted mt-1 text-xs">
                  Showing the last 12 months by default. Clear the dates to see and export your entire history (e.g. for
                  an audit or new employer).
                </p>
              </div>
              {v?.allow_member_report_export && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleExport('csv')}
                    disabled={exporting}
                    className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover flex items-center space-x-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    <span>Export CSV</span>
                  </button>
                  <button
                    onClick={() => void handleExport('pdf')}
                    disabled={exporting}
                    className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover flex items-center space-x-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    <span>Export PDF</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Core Stats Row (always visible) */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <StatCard
              icon={GraduationCap}
              label="Completed Courses"
              value={data.hours_summary?.completed_courses ?? 0}
              color="text-green-700 dark:text-green-400"
            />
            <StatCard
              icon={Clock}
              label="Completed Hours"
              value={data.hours_summary?.total_hours ?? 0}
              color="text-blue-700 dark:text-blue-400"
            />
            <StatCard
              icon={BarChart3}
              label="Requirements"
              value={
                data.requirements_summary?.avg_compliance != null
                  ? `${data.requirements_summary.avg_compliance}%`
                  : 'N/A'
              }
              color="text-yellow-700 dark:text-yellow-400"
            />
          </div>

          {/* Outstanding Requirements */}
          {data.requirements_detail && data.requirements_detail.length > 0 && (
            <Section title="Training Requirements" icon={ClipboardList}>
              <div className="space-y-3">
                {/* Outstanding (not met) first, then met */}
                {[...data.requirements_detail]
                  .sort((a: RequirementDetail, b: RequirementDetail) => {
                    // Outstanding first, then by days until due (soonest first)
                    if (a.is_met !== b.is_met) return a.is_met ? 1 : -1;
                    if (a.days_until_due != null && b.days_until_due != null)
                      return a.days_until_due - b.days_until_due;
                    return 0;
                  })
                  .map((req: RequirementDetail) => {
                    const isOverdue = req.days_until_due != null && req.days_until_due < 0 && !req.is_met;
                    const isDueSoon =
                      req.days_until_due != null && req.days_until_due <= 30 && req.days_until_due >= 0 && !req.is_met;

                    return (
                      <div
                        key={req.id}
                        className={`bg-theme-surface rounded-lg border p-4 ${
                          isOverdue
                            ? 'border-red-500/40'
                            : isDueSoon
                              ? 'border-yellow-500/30'
                              : req.is_met
                                ? 'border-green-500/20'
                                : 'border-theme-surface-border'
                        }`}
                      >
                        <div className="mb-2 flex items-start justify-between">
                          <div className="flex items-center space-x-2">
                            {req.is_met ? (
                              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-700 dark:text-green-400" />
                            ) : isOverdue ? (
                              <AlertTriangle className="h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
                            ) : (
                              <Clock className="h-5 w-5 shrink-0 text-yellow-700 dark:text-yellow-400" />
                            )}
                            <div>
                              <p className="text-theme-text-primary text-sm font-medium">{req.name}</p>
                              {req.description && (
                                <p className="text-theme-text-muted mt-0.5 text-xs">{req.description}</p>
                              )}
                            </div>
                          </div>
                          <div className="ml-4 shrink-0 text-right">
                            <span
                              className={`text-sm font-bold ${
                                req.is_met
                                  ? 'text-green-700 dark:text-green-400'
                                  : isOverdue
                                    ? 'text-red-700 dark:text-red-400'
                                    : 'text-theme-text-primary'
                              }`}
                            >
                              {req.completed_hours}/{req.required_hours} hrs
                            </span>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="bg-theme-surface-hover mb-2 h-2 w-full rounded-full">
                          <div
                            className={`h-2 rounded-full transition-all ${getProgressBarColor(req.progress_percentage, req.is_met, isOverdue)}`}
                            style={{ width: `${Math.min(req.progress_percentage, 100)}%` }}
                          />
                        </div>

                        {/* Expired certification / blocks activity warning */}
                        {req.blocks_activity && (
                          <div className="mb-2 rounded-sm border border-red-500/30 bg-red-500/10 px-2 py-1.5">
                            <p className="text-xs font-medium text-red-700 dark:text-red-400">
                              Certification expired — renew ASAP. This may prevent you from signing up for shifts.
                            </p>
                          </div>
                        )}

                        {/* Waiver adjustment notice */}
                        {req.waived_months != null && req.waived_months > 0 && (
                          <div className="mb-2 rounded-sm border border-blue-500/20 bg-blue-500/10 px-2 py-1">
                            <p className="text-xs text-blue-700 dark:text-blue-300">
                              Adjusted for {req.waived_months} waived month{req.waived_months > 1 ? 's' : ''} of leave
                              {req.original_required_hours != null &&
                                req.original_required_hours !== req.required_hours && (
                                  <>
                                    {' '}
                                    (originally {req.original_required_hours} hrs, adjusted to {req.required_hours} hrs
                                    for {req.active_months} active month{req.active_months !== 1 ? 's' : ''})
                                  </>
                                )}
                            </p>
                          </div>
                        )}

                        <div className="text-theme-text-muted flex items-center justify-between text-xs">
                          <span className="capitalize">
                            {req.frequency.replace('_', ' ')}
                            {req.training_type ? ` (${req.training_type.replace('_', ' ')})` : ''}
                          </span>
                          <div className="flex items-center space-x-2">
                            {req.is_met ? (
                              <span className="text-green-700 dark:text-green-400">Complete</span>
                            ) : req.cert_expired ? (
                              <span className="font-medium text-red-700 dark:text-red-400">Expired — Renew ASAP</span>
                            ) : isOverdue ? (
                              <span className="font-medium text-red-700 dark:text-red-400">
                                Overdue by {Math.abs(req.days_until_due ?? 0)} days
                              </span>
                            ) : req.days_until_due != null ? (
                              <span className={isDueSoon ? 'text-yellow-700 dark:text-yellow-400' : ''}>
                                Due: {formatDate(req.due_date, tz)} ({req.days_until_due} days)
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </Section>
          )}

          {/* Certifications */}
          {v?.show_certification_status && data.certifications && data.certifications.length > 0 && (
            <Section title="Certifications" icon={Award}>
              <div className="space-y-2">
                {[...data.certifications]
                  .sort((a, b) => {
                    // Default sort: expired first, then soonest-expiring, then valid (no expiry).
                    // Cert expiry is the highest-priority data point on this page —
                    // a chief shouldn't have to hunt for what's about to lapse.
                    if (a.is_expired !== b.is_expired) return a.is_expired ? -1 : 1;
                    const aDays = a.days_until_expiry;
                    const bDays = b.days_until_expiry;
                    if (aDays === null && bDays === null) return 0;
                    if (aDays === null) return 1;
                    if (bDays === null) return -1;
                    return aDays - bDays;
                  })
                  .map((c) => (
                    <div key={c.id} className="bg-theme-surface flex items-center justify-between rounded-lg p-3">
                      <div>
                        <p className="text-theme-text-primary text-sm font-medium">{c.course_name}</p>
                        {c.certification_number && (
                          <p className="text-theme-text-muted text-xs">#{c.certification_number}</p>
                        )}
                      </div>
                      <div className="text-right">
                        {c.is_expired ? (
                          <span className="flex items-center space-x-1 text-sm text-red-700 dark:text-red-400">
                            <AlertTriangle className="h-4 w-4" />
                            <span>Expired</span>
                          </span>
                        ) : c.days_until_expiry !== null && c.days_until_expiry <= 90 ? (
                          <span className="text-sm text-yellow-700 dark:text-yellow-400">
                            Expires in {c.days_until_expiry} days
                          </span>
                        ) : (
                          <span className="flex items-center space-x-1 text-sm text-green-700 dark:text-green-400">
                            <CheckCircle2 className="h-4 w-4" />
                            <span>Valid</span>
                          </span>
                        )}
                        <p className="text-theme-text-muted text-xs">{formatDate(c.expiration_date, tz)}</p>
                      </div>
                    </div>
                  ))}
              </div>
            </Section>
          )}

          {/* Skills Tests — the member's own results, official and practice.
              Always rendered (not behind a show_* visibility flag): these are
              the member's own evaluations, and this page is the only place they
              can see them at all. */}
          {user?.id && (
            <Section title="Skills Tests" icon={ClipboardCheck} defaultOpen={false}>
              <MySkillTestsList userId={user.id} />
            </Section>
          )}

          {/* Pipeline Progress */}
          {v?.show_pipeline_progress && data.enrollments && data.enrollments.length > 0 && (
            <Section title="Pipeline Progress" icon={TrendingUp}>
              <div className="space-y-4">
                {data.enrollments.map((e) => (
                  <div key={e.id} className="bg-theme-surface rounded-lg p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className={`rounded-sm px-2 py-1 text-xs ${getStatusColor(e.status)}`}>
                        {e.status.replace('_', ' ')}
                      </span>
                      <span className="text-theme-text-primary text-sm font-semibold">
                        {Math.round(e.progress_percentage)}%
                      </span>
                    </div>
                    <div className="bg-theme-surface-hover mb-2 h-2 w-full rounded-full">
                      <div
                        className={`h-2 rounded-full transition-all ${getPercentageBarColor(e.progress_percentage)}`}
                        style={{ width: `${e.progress_percentage}%` }}
                      />
                    </div>
                    <div className="text-theme-text-muted flex items-center justify-between text-xs">
                      <span>Enrolled: {formatDate(e.enrolled_at, tz)}</span>
                      {e.target_completion_date && <span>Target: {formatDate(e.target_completion_date, tz)}</span>}
                    </div>
                    {v?.show_requirement_details && e.requirements && e.requirements.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {e.requirements.map((r) => (
                          <div key={r.id} className="flex items-center justify-between text-xs">
                            <div className="flex items-center space-x-2">
                              {r.status === 'completed' ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-700 dark:text-green-400" />
                              ) : (
                                <div className="border-theme-surface-border h-3.5 w-3.5 rounded-full border" />
                              )}
                              <span className="text-theme-text-secondary">{Math.round(r.progress_percentage)}%</span>
                            </div>
                            <span className={`rounded-sm px-1.5 py-0.5 ${getStatusColor(r.status)}`}>
                              {r.status.replace('_', ' ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void navigate(`/training/my-progress/${e.id}`)}
                      className="mt-3 text-xs text-red-700 hover:underline dark:text-red-400"
                    >
                      View full progress →
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Training History */}
          {v?.show_training_history && allRecords.length > 0 && (
            <Section title="Training History" icon={FileText} defaultOpen>
              {filteredRecords.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-theme-text-muted bg-theme-surface-secondary text-xs uppercase">
                      <tr>
                        <th scope="col" className="px-4 py-2">
                          Course
                        </th>
                        <th scope="col" className="px-4 py-2">
                          Type
                        </th>
                        <th scope="col" className="px-4 py-2">
                          Date
                        </th>
                        <th scope="col" className="px-4 py-2">
                          Hours
                        </th>
                        <th scope="col" className="px-4 py-2">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-theme-surface-border divide-y">
                      {filteredRecords.map((r) => (
                        <tr key={r.id} className="text-theme-text-secondary">
                          <td className="px-4 py-2 whitespace-nowrap">{r.course_name}</td>
                          <td className="px-4 py-2 whitespace-nowrap capitalize">
                            {r.training_type.replace('_', ' ')}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.completion_date, tz)}</td>
                          <td className="px-4 py-2 whitespace-nowrap">{r.hours_completed}</td>
                          <td className="px-4 py-2">
                            <span className={`rounded-sm px-2 py-1 text-xs ${getStatusColor(r.status)}`}>
                              {r.status.replace('_', ' ')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-theme-text-muted py-2 text-sm">
                  No training records in the selected date range. Adjust or clear the date range above to see more.
                </p>
              )}
            </Section>
          )}

          {/* Shift Reports */}
          {v?.show_shift_reports && data.shift_reports && data.shift_reports.length > 0 && (
            <Section title="Shift Completion Reports" icon={ClipboardList} defaultOpen={false}>
              <div className="space-y-3">
                {data.shift_reports.map((sr) => (
                  <div key={sr.id} className="bg-theme-surface rounded-lg p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-theme-text-primary text-sm font-medium">{formatDate(sr.shift_date, tz)}</p>
                      <div className="text-theme-text-muted flex items-center space-x-3 text-xs">
                        <span>{sr.hours_on_shift}h</span>
                        <span>{sr.calls_responded} calls</span>
                        {v?.show_performance_rating && sr.performance_rating && (
                          <span className="flex items-center space-x-1">
                            <Star className="h-3 w-3 fill-yellow-400 text-yellow-700 dark:text-yellow-400" />
                            <span>{sr.performance_rating}/5</span>
                          </span>
                        )}
                      </div>
                    </div>
                    {v?.show_areas_of_strength && sr.areas_of_strength && (
                      <p className="mb-1 text-xs text-green-700 dark:text-green-400">
                        <span className="font-medium">Strengths:</span> {sr.areas_of_strength}
                      </p>
                    )}
                    {v?.show_areas_for_improvement && sr.areas_for_improvement && (
                      <p className="mb-1 text-xs text-yellow-700 dark:text-yellow-400">
                        <span className="font-medium">Improvement:</span> {sr.areas_for_improvement}
                      </p>
                    )}
                    {v?.show_officer_narrative && sr.officer_narrative && (
                      <p className="text-theme-text-secondary mb-1 text-xs">
                        <span className="font-medium">Narrative:</span> {sr.officer_narrative}
                      </p>
                    )}
                    {v?.show_skills_observed &&
                      sr.skills_observed &&
                      (sr.skills_observed as Array<{ skill_name?: string; demonstrated?: boolean }>).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(sr.skills_observed as Array<{ skill_name?: string; demonstrated?: boolean }>).map(
                            (s, i) => (
                              <span
                                key={i}
                                className={`rounded-sm px-2 py-0.5 text-xs ${s.demonstrated ? 'bg-green-500/20 text-green-700 dark:text-green-400' : 'bg-theme-surface-secondary text-theme-text-muted'}`}
                              >
                                {s.skill_name}
                              </span>
                            )
                          )}
                        </div>
                      )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Submission History */}
          {v?.show_submission_history && data.submissions && data.submissions.length > 0 && (
            <Section title="Self-Reported Training" icon={Send} defaultOpen={false}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-theme-text-muted bg-theme-surface-secondary text-xs uppercase">
                    <tr>
                      <th scope="col" className="px-4 py-2">
                        Course
                      </th>
                      <th scope="col" className="px-4 py-2">
                        Date
                      </th>
                      <th scope="col" className="px-4 py-2">
                        Hours
                      </th>
                      <th scope="col" className="px-4 py-2">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-2">
                        Submitted
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-theme-surface-border divide-y">
                    {data.submissions.map((s) => (
                      <tr key={s.id} className="text-theme-text-secondary">
                        <td className="px-4 py-2 whitespace-nowrap">{s.course_name}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{formatDate(s.completion_date, tz)}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{s.hours_completed}</td>
                        <td className="px-4 py-2">
                          <span className={`rounded-sm px-2 py-1 text-xs ${getStatusColor(s.status)}`}>
                            {s.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="text-theme-text-muted px-4 py-2 text-xs whitespace-nowrap">
                          {formatDate(s.submitted_at, tz)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Empty State (only for detailed sections, stats always show above) */}
          {!data.training_records?.length &&
            !data.enrollments?.length &&
            !data.shift_reports?.length &&
            !data.submissions?.length &&
            !data.certifications?.length && (
              <div className="card-secondary py-8 text-center">
                <p className="text-theme-text-muted mb-4">
                  No detailed training records yet. Submit external training to get started.
                </p>
                <button onClick={() => void navigate('/training/submit')} className="btn-primary text-sm font-medium">
                  Submit External Training
                </button>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export default MyTrainingPage;
