/**
 * My Training Page
 *
 * Member-facing page showing their own training data. Content is controlled
 * by the organization's TrainingModuleConfig visibility settings.
 * Officers/admins always see everything.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Loader2,
  Shield,
  Send,
  BarChart3,
} from 'lucide-react';
import { trainingModuleConfigService } from '../services/api';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import type { MyTrainingSummary, TrainingModuleConfig as TMConfig, RequirementDetail } from '../types/training';

// ==================== Helpers ====================

const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed': return 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400';
    case 'approved': return 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400';
    case 'active': return 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400';
    case 'in_progress': return 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400';
    case 'pending_review': return 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400';
    case 'rejected': return 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400';
    case 'revision_requested': return 'bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400';
    default: return 'bg-gray-500/10 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400';
  }
};

// ==================== Stat Card ====================

const StatCard: React.FC<{ icon: React.ElementType; label: string; value: string | number; color?: string }> = ({
  icon: Icon, label, value, color = 'text-theme-text-primary',
}) => (
  <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-lg p-4">
    <div className="flex items-center space-x-2 mb-1">
      <Icon className="w-4 h-4 text-theme-text-muted" />
      <span className="text-xs text-theme-text-muted">{label}</span>
    </div>
    <p className={`text-xl font-bold ${color}`}>{value}</p>
  </div>
);

// ==================== Section Wrapper ====================

const Section: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean }> = ({
  title, icon: Icon, children, defaultOpen = true,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-theme-surface-hover transition-colors"
      >
        <div className="flex items-center space-x-3">
          <Icon className="w-5 h-5 text-red-500" />
          <h2 className="text-lg font-semibold text-theme-text-primary">{title}</h2>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-theme-text-muted" /> : <ChevronDown className="w-5 h-5 text-theme-text-muted" />}
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
  { key: 'show_training_history', label: 'Training History', description: 'Members can see their training record list', group: 'Training Records' },
  { key: 'show_training_hours', label: 'Training Hours Summary', description: 'Members can see their total hours', group: 'Training Records' },
  { key: 'show_certification_status', label: 'Certification Status', description: 'Members can see certification expiration dates', group: 'Training Records' },
  { key: 'show_pipeline_progress', label: 'Pipeline Progress', description: 'Members can see their program enrollment progress', group: 'Pipeline' },
  { key: 'show_requirement_details', label: 'Requirement Details', description: 'Members can see individual requirement progress', group: 'Pipeline' },
  { key: 'show_shift_reports', label: 'Shift Reports', description: 'Members can see their shift completion reports', group: 'Shift Reports' },
  { key: 'show_shift_stats', label: 'Shift Statistics', description: 'Members can see aggregate shift stats (hours, calls)', group: 'Shift Reports' },
  { key: 'show_performance_rating', label: 'Performance Rating', description: 'Members can see their 1-5 performance rating', group: 'Officer Observations' },
  { key: 'show_areas_of_strength', label: 'Areas of Strength', description: 'Members can see officer-noted strengths', group: 'Officer Observations' },
  { key: 'show_areas_for_improvement', label: 'Areas for Improvement', description: 'Members can see improvement notes', group: 'Officer Observations' },
  { key: 'show_skills_observed', label: 'Skills Observed', description: 'Members can see observed skill evaluations', group: 'Officer Observations' },
  { key: 'show_officer_narrative', label: 'Officer Narrative', description: 'Members can see officer written narratives (off by default)', group: 'Officer Observations' },
  { key: 'show_submission_history', label: 'Submission History', description: 'Members can see their self-reported submissions', group: 'Self-Reported' },
  { key: 'allow_member_report_export', label: 'Allow Report Export', description: 'Members can download their own training data', group: 'Reports' },
];

const ConfigEditor: React.FC<ConfigEditorProps> = ({ config, onSave }) => {
  const [draft, setDraft] = useState<Partial<TMConfig>>({});
  const [saving, setSaving] = useState(false);

  const groups = [...new Set(VISIBILITY_FIELDS.map((f) => f.group))];

  const getCurrentValue = (key: keyof TMConfig) => {
    return draft[key] !== undefined ? draft[key] as boolean : config[key] as boolean;
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

  return (
    <div className="space-y-6">
      <p className="text-sm text-theme-text-muted">
        Control what training data members can see on their personal training page.
        Officers and administrators always see the full dataset regardless of these settings.
      </p>

      {groups.map((group) => (
        <div key={group}>
          <h4 className="text-sm font-semibold text-theme-text-secondary mb-3">{group}</h4>
          <div className="space-y-2">
            {VISIBILITY_FIELDS.filter((f) => f.group === group).map((field) => (
              <label key={field.key} className="flex items-center justify-between bg-theme-surface rounded-lg p-3 cursor-pointer hover:bg-theme-surface-hover transition-colors">
                <div>
                  <p className="text-sm font-medium text-theme-text-primary">{field.label}</p>
                  <p className="text-xs text-theme-text-muted">{field.description}</p>
                </div>
                <input
                  type="checkbox"
                  checked={getCurrentValue(field.key)}
                  onChange={(e) => setDraft({ ...draft, [field.key]: e.target.checked })}
                  className="w-5 h-5 rounded bg-theme-input-bg border-theme-input-border text-red-600 focus:ring-red-500"
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      {Object.keys(draft).length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : `Save ${Object.keys(draft).length} Change${Object.keys(draft).length > 1 ? 's' : ''}`}
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
  const [data, setData] = useState<MyTrainingSummary | null>(null);
  const [config, setConfig] = useState<TMConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'settings'>('overview');
  const [isOfficer, setIsOfficer] = useState(false);

  useEffect(() => {
    loadData();
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
      setError(err instanceof Error ? err.message : 'Failed to load training data');
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

  const v = data?.visibility;

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-theme-text-primary flex items-center space-x-3">
              <GraduationCap className="w-8 h-8 text-red-500" />
              <span>My Training</span>
            </h1>
            <p className="text-theme-text-muted mt-1">
              Your training records, certifications, pipeline progress, and shift experience
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => navigate('/training/submit')}
              className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" />
              <span>Submit Training</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs (only show settings tab for officers) */}
      {isOfficer && (
        <div className="flex space-x-2 mb-6">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'overview' ? 'bg-red-600 text-white' : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
            }`}
          >
            My Training
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'settings' ? 'bg-red-600 text-white' : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
            }`}
          >
            <Settings className="w-4 h-4" />
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
          {/* Core Stats Row (always visible) */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard
              icon={GraduationCap}
              label="Completed Courses"
              value={data.hours_summary?.completed_courses ?? 0}
              color="text-green-400"
            />
            <StatCard
              icon={Clock}
              label="Completed Hours"
              value={data.hours_summary?.total_hours ?? 0}
              color="text-blue-400"
            />
            <StatCard
              icon={BarChart3}
              label="Requirements"
              value={
                data.requirements_summary?.avg_compliance != null
                  ? `${data.requirements_summary.avg_compliance}%`
                  : 'N/A'
              }
              color="text-yellow-400"
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
                    if (a.days_until_due != null && b.days_until_due != null) return a.days_until_due - b.days_until_due;
                    return 0;
                  })
                  .map((req: RequirementDetail) => {
                    const isOverdue = req.days_until_due != null && req.days_until_due < 0 && !req.is_met;
                    const isDueSoon = req.days_until_due != null && req.days_until_due <= 30 && req.days_until_due >= 0 && !req.is_met;

                    return (
                      <div
                        key={req.id}
                        className={`bg-theme-surface rounded-lg p-4 border ${
                          isOverdue ? 'border-red-500/40' :
                          isDueSoon ? 'border-yellow-500/30' :
                          req.is_met ? 'border-green-500/20' :
                          'border-theme-surface-border'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            {req.is_met ? (
                              <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
                            ) : isOverdue ? (
                              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
                            ) : (
                              <Clock className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                            )}
                            <div>
                              <p className="text-sm font-medium text-theme-text-primary">{req.name}</p>
                              {req.description && (
                                <p className="text-xs text-theme-text-muted mt-0.5">{req.description}</p>
                              )}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0 ml-4">
                            <span className={`text-sm font-bold ${
                              req.is_met ? 'text-green-400' :
                              isOverdue ? 'text-red-400' :
                              'text-theme-text-primary'
                            }`}>
                              {req.completed_hours}/{req.required_hours} hrs
                            </span>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 mb-2">
                          <div
                            className={`h-2 rounded-full transition-all ${
                              req.is_met ? 'bg-green-500' :
                              isOverdue ? 'bg-red-500' :
                              req.progress_percentage >= 50 ? 'bg-blue-500' :
                              'bg-yellow-500'
                            }`}
                            style={{ width: `${Math.min(req.progress_percentage, 100)}%` }}
                          />
                        </div>

                        {/* Waiver adjustment notice */}
                        {req.waived_months != null && req.waived_months > 0 && (
                          <div className="bg-blue-500/10 border border-blue-500/20 rounded px-2 py-1 mb-2">
                            <p className="text-xs text-blue-300">
                              Adjusted for {req.waived_months} waived month{req.waived_months > 1 ? 's' : ''} of leave
                              {req.original_required_hours != null && req.original_required_hours !== req.required_hours && (
                                <> (originally {req.original_required_hours} hrs, adjusted to {req.required_hours} hrs for {req.active_months} active month{req.active_months !== 1 ? 's' : ''})</>
                              )}
                            </p>
                          </div>
                        )}

                        <div className="flex items-center justify-between text-xs text-theme-text-muted">
                          <span className="capitalize">{req.frequency.replace('_', ' ')}{req.training_type ? ` (${req.training_type.replace('_', ' ')})` : ''}</span>
                          <div className="flex items-center space-x-2">
                            {req.is_met ? (
                              <span className="text-green-400">Complete</span>
                            ) : isOverdue ? (
                              <span className="text-red-400 font-medium">Overdue by {Math.abs(req.days_until_due!)} days</span>
                            ) : req.days_until_due != null ? (
                              <span className={isDueSoon ? 'text-yellow-400' : ''}>
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
                {data.certifications.map((c) => (
                  <div key={c.id} className="flex items-center justify-between bg-theme-surface rounded-lg p-3">
                    <div>
                      <p className="text-sm font-medium text-theme-text-primary">{c.course_name}</p>
                      {c.certification_number && (
                        <p className="text-xs text-theme-text-muted">#{c.certification_number}</p>
                      )}
                    </div>
                    <div className="text-right">
                      {c.is_expired ? (
                        <span className="flex items-center space-x-1 text-red-400 text-sm">
                          <AlertTriangle className="w-4 h-4" />
                          <span>Expired</span>
                        </span>
                      ) : c.days_until_expiry !== null && c.days_until_expiry <= 90 ? (
                        <span className="text-yellow-400 text-sm">
                          Expires in {c.days_until_expiry} days
                        </span>
                      ) : (
                        <span className="flex items-center space-x-1 text-green-400 text-sm">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Valid</span>
                        </span>
                      )}
                      <p className="text-xs text-theme-text-muted">{formatDate(c.expiration_date, tz)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Pipeline Progress */}
          {v?.show_pipeline_progress && data.enrollments && data.enrollments.length > 0 && (
            <Section title="Pipeline Progress" icon={TrendingUp}>
              <div className="space-y-4">
                {data.enrollments.map((e) => (
                  <div key={e.id} className="bg-theme-surface rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs px-2 py-1 rounded ${getStatusColor(e.status)}`}>
                        {e.status.replace('_', ' ')}
                      </span>
                      <span className="text-sm text-theme-text-primary font-semibold">{Math.round(e.progress_percentage)}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 mb-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          e.progress_percentage >= 75 ? 'bg-green-500' :
                          e.progress_percentage >= 50 ? 'bg-blue-500' :
                          e.progress_percentage >= 25 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${e.progress_percentage}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-theme-text-muted">
                      <span>Enrolled: {formatDate(e.enrolled_at, tz)}</span>
                      {e.target_completion_date && <span>Target: {formatDate(e.target_completion_date, tz)}</span>}
                    </div>
                    {v?.show_requirement_details && e.requirements && e.requirements.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {e.requirements.map((r) => (
                          <div key={r.id} className="flex items-center justify-between text-xs">
                            <div className="flex items-center space-x-2">
                              {r.status === 'completed' ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                              ) : (
                                <div className="w-3.5 h-3.5 rounded-full border border-theme-surface-border" />
                              )}
                              <span className="text-theme-text-secondary">{Math.round(r.progress_percentage)}%</span>
                            </div>
                            <span className={`px-1.5 py-0.5 rounded ${getStatusColor(r.status)}`}>
                              {r.status.replace('_', ' ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Training History */}
          {v?.show_training_history && data.training_records && data.training_records.length > 0 && (
            <Section title="Training History" icon={FileText} defaultOpen={false}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-theme-text-muted uppercase bg-theme-surface-secondary">
                    <tr>
                      <th className="px-4 py-2">Course</th>
                      <th className="px-4 py-2">Type</th>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Hours</th>
                      <th className="px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.training_records.map((r) => (
                      <tr key={r.id} className="text-theme-text-secondary">
                        <td className="px-4 py-2 whitespace-nowrap">{r.course_name}</td>
                        <td className="px-4 py-2 whitespace-nowrap capitalize">{r.training_type.replace('_', ' ')}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.completion_date, tz)}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{r.hours_completed}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-1 rounded ${getStatusColor(r.status)}`}>
                            {r.status.replace('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Shift Reports */}
          {v?.show_shift_reports && data.shift_reports && data.shift_reports.length > 0 && (
            <Section title="Shift Completion Reports" icon={ClipboardList} defaultOpen={false}>
              <div className="space-y-3">
                {data.shift_reports.map((sr) => (
                  <div key={sr.id} className="bg-theme-surface rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-theme-text-primary">{formatDate(sr.shift_date, tz)}</p>
                      <div className="flex items-center space-x-3 text-xs text-theme-text-muted">
                        <span>{sr.hours_on_shift}h</span>
                        <span>{sr.calls_responded} calls</span>
                        {v?.show_performance_rating && sr.performance_rating && (
                          <span className="flex items-center space-x-1">
                            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                            <span>{sr.performance_rating}/5</span>
                          </span>
                        )}
                      </div>
                    </div>
                    {v?.show_areas_of_strength && sr.areas_of_strength && (
                      <p className="text-xs text-green-400 mb-1"><span className="font-medium">Strengths:</span> {sr.areas_of_strength}</p>
                    )}
                    {v?.show_areas_for_improvement && sr.areas_for_improvement && (
                      <p className="text-xs text-yellow-400 mb-1"><span className="font-medium">Improvement:</span> {sr.areas_for_improvement}</p>
                    )}
                    {v?.show_officer_narrative && sr.officer_narrative && (
                      <p className="text-xs text-theme-text-secondary mb-1"><span className="font-medium">Narrative:</span> {sr.officer_narrative}</p>
                    )}
                    {v?.show_skills_observed && sr.skills_observed && (sr.skills_observed as Array<{ skill_name?: string; demonstrated?: boolean }>).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(sr.skills_observed as Array<{ skill_name?: string; demonstrated?: boolean }>).map((s, i) => (
                          <span key={i} className={`text-xs px-2 py-0.5 rounded ${s.demonstrated ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-theme-text-muted'}`}>
                            {s.skill_name}
                          </span>
                        ))}
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
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-theme-text-muted uppercase bg-theme-surface-secondary">
                    <tr>
                      <th className="px-4 py-2">Course</th>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Hours</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Submitted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.submissions.map((s) => (
                      <tr key={s.id} className="text-theme-text-secondary">
                        <td className="px-4 py-2 whitespace-nowrap">{s.course_name}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{formatDate(s.completion_date, tz)}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{s.hours_completed}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-1 rounded ${getStatusColor(s.status)}`}>
                            {s.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-xs text-theme-text-muted">{formatDate(s.submitted_at, tz)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Empty State (only for detailed sections, stats always show above) */}
          {!data.training_records?.length && !data.enrollments?.length && !data.shift_reports?.length && !data.submissions?.length && !data.certifications?.length && (
            <div className="text-center py-8 bg-theme-surface-secondary border border-theme-surface-border rounded-lg">
              <p className="text-theme-text-muted mb-4">
                No detailed training records yet. Submit external training to get started.
              </p>
              <button
                onClick={() => navigate('/training/submit')}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
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
