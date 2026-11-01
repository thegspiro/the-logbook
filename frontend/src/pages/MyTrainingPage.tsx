/**
 * My Training Page
 *
 * Member-facing page showing their own training data. Content is controlled
 * by the organization's TrainingModuleConfig visibility settings.
 * Officers/admins always see everything.
 */

import React, { useCallback, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
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
  History,
  ClipboardCheck,
  CalendarClock,
} from 'lucide-react';
import { shiftEvaluationService, skillsTestingService, trainingModuleConfigService } from '../services/api';
import { MyShiftEvaluationsList } from '../components/training/MyShiftEvaluationsList';
import { TrainingPageHeader } from '../components/training/TrainingPageHeader';
import { MyTrainingHistory } from '../components/training/MyTrainingHistory';
import { RequirementMonthlyHours } from '../components/training/RequirementMonthlyHours';
import { countingWindowLabel } from '../utils/requirementMonths';
import { UpcomingDueList } from '../components/training/UpcomingDueList';
import { formatCalendarDate, formatDate, getTodayLocalDate } from '../utils/dateFormatting';
import { formatHours } from '../utils/hoursFormatting';
import { TRAINING_TYPE_LABELS } from '../constants/enums';
import { useTimezone } from '../hooks/useTimezone';
import type {
  MyTrainingSummary,
  ShiftEvaluationDetail,
  TrainingModuleConfig as TMConfig,
  RequirementDetail,
} from '../types/training';
import { getErrorMessage } from '../utils/errorHandling';
import { SkeletonPage } from '../components/ux/Skeleton';
import { MySkillTestsList } from '../components/training/MySkillTestsList';
import { useAuthStore } from '../stores/authStore';
import { offersSkillsTesting, usePracticalSkillsMethod } from '../stores/practicalSkillsStore';
import { buildUpcomingItems, UPCOMING_WINDOW_DAYS } from '../utils/trainingUpcoming';
import {
  getProgressBarColor,
  getPercentageBarColor,
  getTrainingStatusColor,
  getTrainingStatusLabel,
} from '../utils/trainingColors';

// ==================== Helpers ====================

// ==================== Stat Card ====================

const StatCard: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string | number;
  color?: string;
  hint?: string;
}> = ({ icon: Icon, label, value, color = 'text-theme-text-primary', hint }) => (
  <div className="card-secondary p-4">
    <div className="mb-1 flex items-center space-x-2">
      <Icon className="text-theme-text-muted h-4 w-4" />
      <span className="text-theme-text-muted text-xs">{label}</span>
    </div>
    <p className={`text-xl font-bold ${color}`}>{value}</p>
    {hint && <p className="text-theme-text-muted mt-1 text-xs">{hint}</p>}
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
    // overflow-clip, not overflow-hidden: hidden makes this card a scroll
    // container, which pins the settings save bar to the card instead of the
    // viewport and so stops it sticking.
    <div className="card-secondary overflow-clip">
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

// ==================== Settings Card ====================

const SettingsCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-lg border">
    <h4 className="text-theme-text-primary border-theme-surface-border border-b px-4 py-2.5 text-sm font-semibold">
      {title}
    </h4>
    {children}
  </div>
);

// ==================== Config Editor (Officers Only) ====================

interface ConfigEditorProps {
  config: TMConfig;
  onSave: (updates: Partial<TMConfig>) => Promise<void>;
  /**
   * Whether the caller holds `training.manage`. The disclosure settings above
   * the divider answer to `training.configure`; everything below it — the
   * review workflow and the rating scale — configures the shift-report system
   * and the backend rejects it without `training.manage`. Offering controls
   * that can only 403 is worse than not offering them.
   */
  canManageTraining: boolean;
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

const RIGHT_COLUMN_GROUPS = new Set(['Officer Observations']);

const SKILLS_DISCLOSURE_OPTIONS = [
  { value: 'full', label: 'Full results — scores and examiner notes' },
  { value: 'scores', label: 'Scores only — pass/fail and points, no written notes' },
  { value: 'none', label: 'Nothing — results are never shown to the member' },
];

const SKILLS_RELEASE_OPTIONS = [
  { value: 'on_completion', label: 'As soon as the examiner submits' },
  { value: 'on_release', label: 'Only after an officer releases the result' },
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

const ConfigEditor: React.FC<ConfigEditorProps> = ({ config, onSave, canManageTraining }) => {
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

  const changeCount = Object.keys(draft).length;
  const leftGroups = groups.filter((g) => !RIGHT_COLUMN_GROUPS.has(g));
  const rightGroups = groups.filter((g) => RIGHT_COLUMN_GROUPS.has(g));

  const renderGroup = (group: string) => (
    <SettingsCard key={group} title={group}>
      <div className="divide-theme-surface-border divide-y">
        {VISIBILITY_FIELDS.filter((f) => f.group === group).map((field) => (
          <label
            key={field.key}
            className="hover:bg-theme-surface-hover flex cursor-pointer items-center justify-between gap-4 px-4 py-3 transition-colors"
          >
            <div className="min-w-0">
              <p className="text-theme-text-primary text-sm font-medium">{field.label}</p>
              <p className="text-theme-text-muted text-xs">{field.description}</p>
            </div>
            <input
              type="checkbox"
              checked={getCurrentValue(field.key)}
              onChange={(e) => setDraft({ ...draft, [field.key]: e.target.checked })}
              className="form-checkbox shrink-0"
            />
          </label>
        ))}
      </div>
    </SettingsCard>
  );

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h3 className="text-theme-text-primary text-sm font-semibold tracking-wide uppercase">
            What Members Can See
          </h3>
          <p className="text-theme-text-muted mt-1 max-w-3xl text-sm">
            Control what training data members can see on their personal training page. Officers and administrators
            always see the full dataset regardless of these settings. Withheld fields are left out of the API response,
            not merely hidden on screen, and the member export honours them too.
          </p>
        </div>

        {/* Two explicit stacks rather than a grid or CSS columns: the groups
            run from one setting to five, so a grid row stretches every card
            to its tallest neighbour and CSS columns balance unpredictably.
            Officer Observations and the skills-test card are the two tall
            ones, so they share a column and the short groups fill the other. */}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="space-y-4">{leftGroups.map(renderGroup)}</div>
          <div className="space-y-4">
            {rightGroups.map(renderGroup)}

            {/* Skills-test results — the department default. Individual templates and
              tests may override both settings; this is what applies when they
              don't. */}
            <SettingsCard title="Skills-Test Results">
              <div className="divide-theme-surface-border divide-y">
                <div className="px-4 py-3">
                  <p className="text-theme-text-primary mb-1 text-sm font-medium">What the member sees</p>
                  <p className="text-theme-text-muted mb-2 text-xs">
                    Examiner notes are often candid working notes for the training file rather than feedback written for
                    the member to read. Officers always see everything.
                  </p>
                  <select
                    value={getStringValue('skills_result_disclosure') || 'full'}
                    onChange={(e) => setDraft({ ...draft, skills_result_disclosure: e.target.value })}
                    className="form-input text-sm"
                  >
                    {SKILLS_DISCLOSURE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {getStringValue('skills_result_disclosure') !== 'none' && (
                  <div className="px-4 py-3">
                    <p className="text-theme-text-primary mb-1 text-sm font-medium">When they see it</p>
                    <p className="text-theme-text-muted mb-2 text-xs">
                      Requiring a release lets an officer review the scorecard, or deliver a failure in person, before
                      the member reads it. Practice attempts are never held back.
                    </p>
                    <select
                      value={getStringValue('skills_result_release') || 'on_completion'}
                      onChange={(e) => setDraft({ ...draft, skills_result_release: e.target.value })}
                      className="form-input text-sm"
                    >
                      {SKILLS_RELEASE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </SettingsCard>
          </div>
        </div>
      </section>

      {/* The shift-report half of this panel needs `training.manage`;
          `training.configure` alone is refused for these fields by the
          backend, so a Membership Coordinator is shown the disclosure
          settings they own and not controls that would only 403. */}
      {canManageTraining && (
        // These last two groups are not visibility settings — they configure
        // the officer's shift-report form and the review it goes through.
        // They stay here rather than moving wholesale to Scheduling →
        // Shift Reports because that screen is gated on `scheduling.manage`,
        // which a training officer need not hold; presenting them under their
        // own heading is what stops them reading as things members can see.
        <section className="border-theme-surface-border space-y-4 border-t pt-6">
          <div>
            <h3 className="text-theme-text-primary text-sm font-semibold tracking-wide uppercase">
              Shift Report Configuration
            </h3>
            <p className="text-theme-text-muted mt-1 max-w-3xl text-sm">
              These change the report form officers fill in and who signs it off — not what members see. The same
              settings appear under Scheduling → Shift Reports.
            </p>
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <SettingsCard title="Report Review Workflow">
              <div className="divide-theme-surface-border divide-y">
                <label className="hover:bg-theme-surface-hover flex cursor-pointer items-center justify-between gap-4 px-4 py-3 transition-colors">
                  <div className="min-w-0">
                    <p className="text-theme-text-primary text-sm font-medium">Require Review Before Visibility</p>
                    <p className="text-theme-text-muted text-xs">
                      Reports must be reviewed and approved before trainees can see them
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={getCurrentValue('report_review_required')}
                    onChange={(e) => setDraft({ ...draft, report_review_required: e.target.checked })}
                    className="form-checkbox shrink-0"
                  />
                </label>

                {getCurrentValue('report_review_required') && (
                  <div className="px-4 py-3">
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
                    <p className="text-theme-text-muted mt-1 text-xs">
                      Members holding this position or rank can review reports about other members, as can anyone who
                      manages training.
                    </p>
                  </div>
                )}
              </div>
            </SettingsCard>

            <SettingsCard title="Rating Scale">
              <div className="divide-theme-surface-border divide-y">
                <div className="px-4 py-3">
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

                <div className="px-4 py-3">
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
                  <div className="px-4 py-3">
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
                              className="form-input-sm flex-1"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </SettingsCard>
          </div>
        </section>
      )}

      {/* Sticky so a change made at the top of the panel can be saved without
          scrolling to the bottom to find out a button has appeared. The offset
          clears the mobile bottom nav, which would otherwise paint over it. */}
      {changeCount > 0 && (
        <div className="popover-panel sticky bottom-[calc(var(--bottom-nav-height,0px)+0.75rem)] z-10 flex items-center justify-between gap-3 px-4 py-3">
          <p className="text-theme-text-secondary text-sm" role="status">
            {changeCount} unsaved change{changeCount > 1 ? 's' : ''}
          </p>
          <button
            onClick={() => {
              void handleSave();
            }}
            disabled={saving}
            className="btn-primary text-sm font-medium disabled:opacity-60"
          >
            {saving ? 'Saving...' : `Save ${changeCount} Change${changeCount > 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
};

// ==================== Main Component ====================

const RECENT_RECORDS_SHOWN = 5;

const MyTrainingPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const { user } = useAuthStore();
  const practicalSkillsMethod = usePracticalSkillsMethod();
  const showsSkillsTesting = offersSkillsTesting(practicalSkillsMethod);
  // Under shift-report sign-offs the Skills Tests section is replaced by a
  // read-only one, drawn only for a member who has results on file: switching
  // deleted nothing, and this page is where a member reads their own results.
  const [hasPastSkillTests, setHasPastSkillTests] = useState(false);
  const [data, setData] = useState<MyTrainingSummary | null>(null);
  const [shiftEvaluations, setShiftEvaluations] = useState<ShiftEvaluationDetail[]>([]);
  const [config, setConfig] = useState<TMConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'settings'>('overview');
  // GET /config is open to every authenticated member — it has to be, the
  // member page reads the visibility flags out of it — so a 200 from it says
  // nothing about who may *edit* the settings. Gating the tab on that call
  // succeeding showed every firefighter the department's disclosure policy
  // and a Save button that could only 403. Ask the permission instead.
  const canManageTraining = useAuthStore((state) => state.checkPermission('training.manage'));
  const canConfigureDisclosure = useAuthStore((state) => state.checkPermission('training.configure'));
  const canConfigure = canConfigureDisclosure || canManageTraining;
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const trainingData = await trainingModuleConfigService.getMyTraining();
      setData(trainingData);

      // Caught on its own, like the settings below: an evaluation list that
      // fails to load must not replace the overview with a full-page error.
      try {
        setShiftEvaluations(await shiftEvaluationService.listMine());
      } catch {
        setShiftEvaluations([]);
      }

      if (canConfigure) {
        // Deliberately caught separately. This request only feeds the
        // settings tab; letting it reach the outer catch would replace a
        // member overview that has already loaded with a full-page error
        // because an editor-only fetch blipped.
        try {
          const cfg = await trainingModuleConfigService.getConfig();
          setConfig(cfg);
          setConfigError(null);
        } catch (cfgErr: unknown) {
          setConfig(null);
          setConfigError(getErrorMessage(cfgErr, 'Failed to load the visibility settings'));
        }
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load training data'));
    } finally {
      setLoading(false);
    }
  }, [canConfigure]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const userId = user?.id;
  useEffect(() => {
    if (showsSkillsTesting || !userId) return undefined;
    let cancelled = false;
    // candidate_id is required: for a training.manage holder the endpoint
    // otherwise answers for the whole department.
    skillsTestingService
      .getTests({ candidate_id: userId, include_practice: true, limit: 1 })
      .then((page) => {
        if (!cancelled) setHasPastSkillTests(page.total > 0);
      })
      .catch(() => {
        // Supplementary: a failed lookup leaves the section out rather than
        // putting an error on the member's training overview.
        if (!cancelled) setHasPastSkillTests(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showsSkillsTesting, userId]);

  const handleConfigSave = async (updates: Partial<TMConfig>) => {
    const updated = await trainingModuleConfigService.updateConfig(updates);
    setConfig(updated);
    // Reload the data to reflect visibility changes
    const trainingData = await trainingModuleConfigService.getMyTraining();
    setData(trainingData);
  };

  const v = data?.visibility;
  const canSeeHistory = Boolean(v?.show_training_history);
  // Falls back rather than trusting the stored tab: if the grant goes away
  // while the settings tab is open (or the department hides the history),
  // `activeTab` still names it and every branch below would decline to
  // render, leaving a blank page.
  const tab =
    activeTab === 'settings' && !canConfigure
      ? 'overview'
      : activeTab === 'history' && !canSeeHistory
        ? 'overview'
        : activeTab;
  const recentRecords = (data?.training_records ?? []).slice(0, RECENT_RECORDS_SHOWN);
  const today = getTodayLocalDate(tz);
  const upcoming = data ? buildUpcomingItems(data, today, showsSkillsTesting) : [];

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
      <TrainingPageHeader
        icon={GraduationCap}
        title="My Training"
        subtitle="Every class, certification and training hour the department has on record for you, and how you are doing against the training you are required to complete."
        actions={
          <button
            onClick={() => void navigate('/training/submit')}
            className="btn-primary flex items-center space-x-2 text-sm font-medium whitespace-nowrap"
          >
            <Send className="h-4 w-4 shrink-0" />
            <span>Submit Training</span>
          </button>
        }
      />

      {/* Tabs: History for anyone the department lets see it, settings only
          for those who may edit them. A lone "My Training" tab is not drawn. */}
      {(canConfigure || canSeeHistory) && (
        <div className="hscroll mb-6 flex gap-2">
          {(
            [
              { id: 'overview', label: 'My Training', icon: null, show: true },
              { id: 'history', label: 'History', icon: History, show: canSeeHistory },
              { id: 'settings', label: 'Member Visibility Settings', icon: Settings, show: canConfigure },
            ] as const
          )
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tab === t.id}
                onClick={() => setActiveTab(t.id)}
                className={`touch:min-h-[44px] flex items-center space-x-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-red-800 text-white'
                    : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
                }`}
              >
                {t.icon && <t.icon className="h-4 w-4" aria-hidden="true" />}
                <span>{t.label}</span>
              </button>
            ))}
        </div>
      )}

      {/* Settings Tab */}
      {tab === 'settings' && (
        <Section title="Member Visibility Settings" icon={Shield} defaultOpen>
          {config ? (
            <ConfigEditor config={config} onSave={handleConfigSave} canManageTraining={canManageTraining} />
          ) : (
            <div className="alert-danger" role="alert">
              {configError ?? 'Loading the visibility settings…'}
            </div>
          )}
        </Section>
      )}

      {/* History Tab */}
      {tab === 'history' && data && v && <MyTrainingHistory visibility={v} hoursSummary={data.hours_summary} />}

      {/* Overview Tab */}
      {tab === 'overview' && data && (
        <div className="space-y-6">
          {/* Core stats. The course count and the compliance percentage are
              always shown; the hours figure is the one `show_training_hours`
              names, and the backend withholds it too rather than sending a
              number the page merely declines to draw. */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <StatCard
              icon={GraduationCap}
              label={`Completed Courses · ${data.hours_summary?.year ?? 'this year'}`}
              value={data.hours_summary?.year_to_date_courses ?? data.hours_summary?.completed_courses ?? 0}
              color="text-green-700 dark:text-green-400"
            />
            {v?.show_training_hours && (
              <StatCard
                icon={Clock}
                label={`Completed Hours · ${data.hours_summary?.year ?? 'this year'}`}
                value={formatHours(data.hours_summary?.year_to_date_hours ?? data.hours_summary?.total_hours)}
                color="text-blue-700 dark:text-blue-400"
              />
            )}
            {/* avg_compliance is null exactly when no requirement applies to
                this member; "N/A" read as a fault rather than as "nothing is
                asked of you yet". */}
            <StatCard
              icon={BarChart3}
              label="Required Training"
              value={
                data.requirements_summary?.avg_compliance != null
                  ? `${data.requirements_summary.avg_compliance}%`
                  : 'None assigned'
              }
              color="text-yellow-700 dark:text-yellow-400"
              hint={
                data.requirements_summary?.avg_compliance != null
                  ? `${data.requirements_summary.met_requirements} of ${data.requirements_summary.total_requirements} requirements met`
                  : 'Your department has not assigned you any required training yet.'
              }
            />
          </div>

          {/* Upcoming expirations and due dates: what to act on in the next
              six months, drawn from the same requirement and certification
              data the sections below show, so they cannot disagree. */}
          {(v?.show_requirement_details || v?.show_certification_status) && (
            <Section title="Upcoming Expirations & Due Dates" icon={CalendarClock}>
              <p className="text-theme-text-muted mb-3 text-xs">
                Next {Math.round(UPCOMING_WINDOW_DAYS / 30.5)} months, soonest first.
              </p>
              <UpcomingDueList items={upcoming} />
            </Section>
          )}

          {/* Outstanding Requirements. Gated on `show_requirement_details`,
              which previously only reached the copy nested under Pipeline
              Progress while this list ignored it. */}
          {v?.show_requirement_details && data.requirements_detail && data.requirements_detail.length > 0 && (
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
                        className={`card p-4 ${isOverdue ? 'border-red-500/40' : isDueSoon ? 'border-yellow-500/30' : req.is_met ? 'border-green-500/20' : 'border-theme-surface-border'}`}
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

                        <RequirementMonthlyHours requirement={req} />

                        {/* Expired certification / blocks activity warning */}
                        {req.blocks_activity && (
                          <div className="mb-2 rounded-sm border border-red-500/30 bg-red-500/10 px-2 py-1.5">
                            <p className="text-xs font-medium text-red-700 dark:text-red-400">
                              Certification expired — renew ASAP. This may prevent you from signing up for shifts.
                            </p>
                          </div>
                        )}

                        {/* Existing member inside the requirement's catch-up period */}
                        {req.catch_up_deadline && !req.is_met && (
                          <div className="mb-2 rounded-sm border border-blue-500/20 bg-blue-500/10 px-2 py-1">
                            <p className="text-xs text-blue-700 dark:text-blue-300">
                              You joined before this requirement took effect. You have until{' '}
                              {formatCalendarDate(req.catch_up_deadline)} to complete it, and it won&rsquo;t count
                              against your compliance before then.
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
                            ) : req.catch_up_deadline ? (
                              <span>Due by {formatCalendarDate(req.catch_up_deadline)}</span>
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
                            ) : req.monthly_hours && req.monthly_hours.length > 0 ? (
                              <span>Counting {countingWindowLabel(req.monthly_hours)}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </Section>
          )}

          {/* Recent training: the newest few records. The full history, which
              the summary caps at the newest 100, lives on the History tab. */}
          {v?.show_training_history && recentRecords.length > 0 && (
            <Section title="Recent Training" icon={FileText}>
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Training records">
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
                      {v.show_training_hours && (
                        <th scope="col" className="px-4 py-2">
                          Hours
                        </th>
                      )}
                      <th scope="col" className="px-4 py-2">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-theme-surface-border divide-y">
                    {recentRecords.map((r) => (
                      <tr key={r.id} className="text-theme-text-secondary">
                        <td className="px-4 py-2">{r.course_name}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {TRAINING_TYPE_LABELS[r.training_type] ?? r.training_type.replace('_', ' ')}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.completion_date, tz)}</td>
                        {v.show_training_hours && (
                          <td className="px-4 py-2 whitespace-nowrap">{formatHours(r.hours_completed)}</td>
                        )}
                        <td className="px-4 py-2">
                          {r.voided_at ? (
                            <span className="w-fit rounded-sm bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                              voided
                            </span>
                          ) : (
                            <span className={`rounded-sm px-2 py-1 text-xs ${getTrainingStatusColor(r.status)}`}>
                              {getTrainingStatusLabel(r.status)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className="mobile-touch-target mt-3 text-sm text-red-800 hover:underline dark:text-red-300"
              >
                View full history →
              </button>
            </Section>
          )}

          {/* Certifications */}
          {v?.show_certification_status && data.certifications && data.certifications.length > 0 && (
            <Section title="Certifications" icon={Award} defaultOpen={false}>
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
              Not behind a show_* visibility flag: these are the member's own
              evaluations, and this page is the only place they can see them at
              all. A department that records skills on shift reports instead
              gets the read-only section below, and only when the member has
              results on file. */}
          {user?.id && showsSkillsTesting && (
            <Section title="Skills Tests" icon={ClipboardCheck} defaultOpen={false}>
              <MySkillTestsList userId={user.id} />
            </Section>
          )}
          {user?.id && !showsSkillsTesting && hasPastSkillTests && (
            <Section title="Past skills test results" icon={ClipboardCheck} defaultOpen={false}>
              <p className="text-theme-text-muted mb-3 text-sm">
                Your department now records practical skills as sign-offs on shift reports, so no new skills tests are
                taken. Results already on file stay on your record.
              </p>
              <MySkillTestsList userId={user.id} />
            </Section>
          )}

          {/* Pipeline Progress */}
          {v?.show_pipeline_progress && data.enrollments && data.enrollments.length > 0 && (
            <Section title="Pipeline Progress" icon={TrendingUp}>
              <div className="space-y-4">
                {data.enrollments.map((e) => (
                  <div key={e.id} className="bg-theme-surface rounded-lg p-4">
                    {e.program_name && (
                      <h3 className="text-theme-text-primary mb-2 text-sm font-semibold">{e.program_name}</h3>
                    )}
                    <div className="mb-2 flex items-center justify-between">
                      <span className={`rounded-sm px-2 py-1 text-xs ${getTrainingStatusColor(e.status)}`}>
                        {getTrainingStatusLabel(e.status)}
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
                              <span className="text-theme-text-secondary">
                                {r.requirement_name ? `${r.requirement_name} · ` : ''}
                                {Math.round(r.progress_percentage)}%
                              </span>
                            </div>
                            <span className={`rounded-sm px-1.5 py-0.5 ${getTrainingStatusColor(r.status)}`}>
                              {getTrainingStatusLabel(r.status)}
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

          {/* Shift Statistics. `show_shift_stats` had no reader at all: the
              endpoint gated and returned these figures, the page never drew
              them, and the setting's own description promised members could
              see them. */}
          {v?.show_shift_stats && data.shift_stats && data.shift_stats.shifts_completed > 0 && (
            <Section title="Shift Statistics" icon={BarChart3}>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard
                  icon={ClipboardList}
                  label="Shifts Completed"
                  value={data.shift_stats.shifts_completed}
                  color="text-blue-700 dark:text-blue-400"
                />
                <StatCard
                  icon={Clock}
                  label="Hours Reported"
                  value={formatHours(data.shift_stats.hours_reported)}
                  color="text-green-700 dark:text-green-400"
                />
                <StatCard icon={AlertTriangle} label="Calls Responded" value={data.shift_stats.total_calls} />
                {v?.show_performance_rating && data.shift_stats.avg_rating != null && (
                  <StatCard
                    icon={Star}
                    label="Average Rating"
                    value={`${data.shift_stats.avg_rating}/5`}
                    color="text-yellow-700 dark:text-yellow-400"
                  />
                )}
              </div>
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
                        <span>{formatHours(sr.hours_on_shift)}h</span>
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
                                className={`rounded-sm px-2 py-0.5 text-xs ${s.demonstrated ? 'bg-green-500/20 text-green-800 dark:text-green-400' : 'bg-theme-surface-secondary text-theme-text-muted'}`}
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

          {/* Shift Evaluations: behind the same switch as the shift reports,
              which they are filled out beside. */}
          {v?.show_shift_reports && shiftEvaluations.length > 0 && (
            <Section title="Shift Evaluations" icon={ClipboardCheck} defaultOpen={false}>
              <MyShiftEvaluationsList evaluations={shiftEvaluations} />
            </Section>
          )}

          {/* Submission History */}
          {v?.show_submission_history && data.submissions && data.submissions.length > 0 && (
            <Section title="Self-Reported Training" icon={Send} defaultOpen={false}>
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Training records">
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
                        <td className="px-4 py-2 whitespace-nowrap">{formatHours(s.hours_completed)}</td>
                        <td className="px-4 py-2">
                          <span className={`rounded-sm px-2 py-1 text-xs ${getTrainingStatusColor(s.status)}`}>
                            {getTrainingStatusLabel(s.status)}
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
            !shiftEvaluations.length &&
            !data.submissions?.length &&
            !data.certifications?.length && (
              <section className="card-secondary p-6" aria-labelledby="training-getting-started">
                <h2 id="training-getting-started" className="text-theme-text-primary text-lg font-semibold">
                  Nothing is on your training record yet
                </h2>
                <p className="text-theme-text-muted mt-1 text-sm">
                  That is normal for a new member. Training reaches this page in one of three ways:
                </p>
                <ol className="text-theme-text-secondary mt-4 list-decimal space-y-3 pl-5 text-sm">
                  <li>
                    <span className="text-theme-text-primary font-medium">Attend a department training.</span> Check in
                    at the class. Once a training officer approves the attendance, the hours are added here for you.
                  </li>
                  <li>
                    <span className="text-theme-text-primary font-medium">Submit training you did elsewhere.</span> A
                    class at another agency, an online course or a state certification only counts once you submit it
                    and a training officer approves it.
                  </li>
                  {showsSkillsTesting && (
                    <li>
                      <span className="text-theme-text-primary font-medium">Take a skills test.</span> When an examiner
                      tests you on a hands-on skill, the result appears under Skills Tests above.
                    </li>
                  )}
                </ol>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button onClick={() => void navigate('/training/submit')} className="btn-primary text-sm font-medium">
                    Submit External Training
                  </button>
                  <Link
                    to="/learning/training"
                    className="mobile-touch-target text-sm text-red-800 hover:underline dark:text-red-300"
                  >
                    Take the short walkthrough in the Learning Center
                  </Link>
                </div>
              </section>
            )}
        </div>
      )}
    </div>
  );
};

export default MyTrainingPage;
