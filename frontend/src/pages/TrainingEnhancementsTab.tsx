/**
 * Training Enhancements Tab
 *
 * Admin interface for new training features:
 * - Recertification Pathways (NREMT renewal, NFPA recertification)
 * - Competency Tracking (Dreyfus model progression)
 * - Instructor Qualifications (NFPA 1041 compliance)
 * - Training Effectiveness (Kirkpatrick Model evaluation)
 * - Multi-Agency Training (NIMS/ICS joint exercises)
 * - Report Exports (compliance CSV/PDF, forecasting)
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  RefreshCw,
  Plus,
  Download,
  Users,
  Award,
  BookOpen,
  BarChart3,
  Globe,
  FileText,
  TrendingUp,
  Loader2,
} from 'lucide-react';
import {
  recertificationService,
  competencyService,
  instructorService,
  multiAgencyService,
  reportExportService,
} from '../services/trainingServices';
import type {
  RecertificationPathway,
  RenewalTask,
  CompetencyMatrix,
  InstructorQualification,
  MultiAgencyTraining,
  ComplianceForecast,
} from '../types/training';

// ==================== Section Components ====================

const RecertificationSection: React.FC = () => {
  const [pathways, setPathways] = useState<RecertificationPathway[]>([]);
  const [renewalTasks, setRenewalTasks] = useState<RenewalTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pathwaysData, tasksData] = await Promise.all([
        recertificationService.getPathways(),
        recertificationService.getMyRenewalTasks(),
      ]);
      setPathways(pathwaysData);
      setRenewalTasks(tasksData);
    } catch {
      // Service may not be configured yet
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateTasks = async () => {
    try {
      const result = await recertificationService.generateRenewalTasks();
      toast.success(`Generated ${result.tasks_created} renewal tasks`);
      void loadData();
    } catch {
      toast.error('Failed to generate renewal tasks');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-theme-text-primary">Recertification Pathways</h3>
          <p className="text-sm text-theme-text-muted">
            Define renewal requirements for expiring certifications (NREMT, ACLS, etc.)
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => { void handleGenerateTasks(); }}
            className="btn-secondary flex items-center gap-1 px-3 py-2 text-sm rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Generate Tasks</span>
          </button>
          <button className="btn-primary flex items-center gap-1 px-3 py-2 text-sm rounded-lg">
            <Plus className="w-4 h-4" />
            <span>Add Pathway</span>
          </button>
        </div>
      </div>

      {pathways.length === 0 ? (
        <div className="card-secondary p-8 text-center">
          <Award className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
          <p className="text-theme-text-muted">No recertification pathways configured yet.</p>
          <p className="text-sm text-theme-text-muted mt-1">
            Create pathways to define how members renew expiring certifications.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {pathways.map((pathway) => (
            <div key={pathway.id} className="card-secondary p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-medium text-theme-text-primary">{pathway.name}</h4>
                  {pathway.description && (
                    <p className="text-sm text-theme-text-muted mt-1">{pathway.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-theme-text-muted">
                    <span>Type: {pathway.renewal_type}</span>
                    {pathway.required_hours && <span>Hours: {pathway.required_hours}</span>}
                    <span>Window: {pathway.renewal_window_days} days</span>
                    {pathway.grace_period_days > 0 && (
                      <span>Grace: {pathway.grace_period_days} days</span>
                    )}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 text-xs rounded-sm ${
                    pathway.active
                      ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                      : 'bg-theme-surface-secondary text-theme-text-muted'
                  }`}
                >
                  {pathway.active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {renewalTasks.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-medium text-theme-text-primary mb-3">Active Renewal Tasks</h4>
          <div className="space-y-2">
            {renewalTasks.map((task) => (
              <div key={task.id} className="card-secondary p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm text-theme-text-primary">{task.pathway_name || 'Renewal'}</span>
                  <span className="text-xs text-theme-text-muted ml-2">
                    Expires: {task.certification_expiration_date}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="w-24 bg-theme-surface-secondary rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full"
                      style={{ width: `${task.progress_percentage}%` }}
                    />
                  </div>
                  <span className="text-xs text-theme-text-muted">{Math.round(task.progress_percentage)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const CompetencySection: React.FC = () => {
  const [matrices, setMatrices] = useState<CompetencyMatrix[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await competencyService.getMatrices();
      setMatrices(data);
    } catch {
      // Service may not be configured yet
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  const competencyLevels = [
    { level: 'novice', label: 'Novice', color: 'bg-theme-text-muted' },
    { level: 'advanced_beginner', label: 'Advanced Beginner', color: 'bg-blue-400' },
    { level: 'competent', label: 'Competent', color: 'bg-green-400' },
    { level: 'proficient', label: 'Proficient', color: 'bg-yellow-400' },
    { level: 'expert', label: 'Expert', color: 'bg-red-400' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-theme-text-primary">Competency Matrices</h3>
          <p className="text-sm text-theme-text-muted">
            Define required skill levels by position (Dreyfus model: novice to expert)
          </p>
        </div>
        <button className="btn-primary flex items-center space-x-1 px-3 py-2 text-sm rounded-lg">
          <Plus className="w-4 h-4" />
          <span>Add Matrix</span>
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {competencyLevels.map((l) => (
          <div key={l.level} className="flex items-center gap-1 text-xs text-theme-text-muted">
            <div className={`w-3 h-3 rounded-full ${l.color}`} />
            <span>{l.label}</span>
          </div>
        ))}
      </div>

      {matrices.length === 0 ? (
        <div className="card-secondary p-8 text-center">
          <TrendingUp className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
          <p className="text-theme-text-muted">No competency matrices configured.</p>
          <p className="text-sm text-theme-text-muted mt-1">
            Create matrices to map positions to required skill levels per NFPA 1021/1041.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {matrices.map((matrix) => (
            <div key={matrix.id} className="card-secondary p-4">
              <h4 className="font-medium text-theme-text-primary">{matrix.name}</h4>
              <p className="text-xs text-theme-text-muted mt-1">Position: {matrix.position}</p>
              <p className="text-xs text-theme-text-muted">
                Skills: {matrix.skill_requirements.length} requirements
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const InstructorsSection: React.FC = () => {
  const [qualifications, setQualifications] = useState<InstructorQualification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await instructorService.getQualifications();
      setQualifications(data);
    } catch {
      // Service may not be configured yet
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-theme-text-primary">Instructor Qualifications</h3>
          <p className="text-sm text-theme-text-muted">
            Track who is qualified to instruct and evaluate per NFPA 1041
          </p>
        </div>
        <button className="btn-primary flex items-center space-x-1 px-3 py-2 text-sm rounded-lg">
          <Plus className="w-4 h-4" />
          <span>Add Qualification</span>
        </button>
      </div>

      {qualifications.length === 0 ? (
        <div className="card-secondary p-8 text-center">
          <BookOpen className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
          <p className="text-theme-text-muted">No instructor qualifications recorded.</p>
          <p className="text-sm text-theme-text-muted mt-1">
            Add qualifications to track who can instruct which courses and evaluate which skills.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-theme-text-muted border-b border-theme-surface-border">
                <th className="pb-2 pr-4">Instructor</th>
                <th className="pb-2 pr-4">Type</th>
                <th className="pb-2 pr-4">Level</th>
                <th className="pb-2 pr-4">Cert #</th>
                <th className="pb-2 pr-4">Expires</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {qualifications.map((qual) => (
                <tr key={qual.id} className="border-b border-theme-surface-border/50">
                  <td className="py-2 pr-4 text-theme-text-primary">{qual.user_name || qual.user_id}</td>
                  <td className="py-2 pr-4 capitalize">{qual.qualification_type}</td>
                  <td className="py-2 pr-4">{qual.certification_level || '-'}</td>
                  <td className="py-2 pr-4">{qual.certification_number || '-'}</td>
                  <td className="py-2 pr-4">{qual.expiration_date || '-'}</td>
                  <td className="py-2">
                    <span
                      className={`px-2 py-0.5 text-xs rounded-sm ${
                        qual.verified
                          ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                          : 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                      }`}
                    >
                      {qual.verified ? 'Verified' : 'Pending'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const EffectivenessSection: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-theme-text-primary">Training Effectiveness</h3>
        <p className="text-sm text-theme-text-muted">
          Kirkpatrick Model evaluation: Reaction, Learning, Behavior, Results
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { level: 'Level 1: Reaction', desc: 'Post-training surveys', icon: FileText, color: 'text-blue-500' },
          { level: 'Level 2: Learning', desc: 'Pre/post assessments', icon: BookOpen, color: 'text-green-500' },
          { level: 'Level 3: Behavior', desc: 'On-the-job observation', icon: Users, color: 'text-yellow-500' },
          { level: 'Level 4: Results', desc: 'Organizational impact', icon: BarChart3, color: 'text-red-500' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.level} className="card-secondary p-4 text-center">
              <Icon className={`w-8 h-8 mx-auto mb-2 ${item.color}`} />
              <h4 className="text-sm font-medium text-theme-text-primary">{item.level}</h4>
              <p className="text-xs text-theme-text-muted mt-1">{item.desc}</p>
            </div>
          );
        })}
      </div>

      <div className="card-secondary p-6 text-center">
        <BarChart3 className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
        <p className="text-theme-text-muted">Effectiveness evaluations will appear here.</p>
        <p className="text-sm text-theme-text-muted mt-1">
          Members can submit post-training surveys. Pre/post assessments measure knowledge gain.
        </p>
      </div>
    </div>
  );
};

const MultiAgencySection: React.FC = () => {
  const [exercises, setExercises] = useState<MultiAgencyTraining[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await multiAgencyService.getExercises();
      setExercises(data);
    } catch {
      // Service may not be configured yet
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-theme-text-primary">Multi-Agency Training</h3>
          <p className="text-sm text-theme-text-muted">
            Joint exercises, mutual aid drills, and regional training per NFPA 1500 / NIMS
          </p>
        </div>
        <button className="btn-primary flex items-center space-x-1 px-3 py-2 text-sm rounded-lg">
          <Plus className="w-4 h-4" />
          <span>Add Exercise</span>
        </button>
      </div>

      {exercises.length === 0 ? (
        <div className="card-secondary p-8 text-center">
          <Globe className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
          <p className="text-theme-text-muted">No multi-agency exercises recorded.</p>
          <p className="text-sm text-theme-text-muted mt-1">
            Log joint training exercises with other departments, mutual aid drills, and regional exercises.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {exercises.map((exercise) => (
            <div key={exercise.id} className="card-secondary p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-medium text-theme-text-primary">{exercise.exercise_name}</h4>
                  <div className="flex items-center space-x-3 mt-1 text-xs text-theme-text-muted">
                    <span className="capitalize">{exercise.exercise_type.replace(/_/g, ' ')}</span>
                    <span>{exercise.exercise_date}</span>
                    {exercise.total_participants && (
                      <span>{exercise.total_participants} participants</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {exercise.participating_organizations.map((org, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 text-xs bg-theme-surface-secondary rounded-sm text-theme-text-muted"
                      >
                        {org.name} ({org.role})
                      </span>
                    ))}
                  </div>
                </div>
                {exercise.nims_compliant && (
                  <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-700 dark:text-green-400 rounded-sm">
                    NIMS Compliant
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ReportsSection: React.FC = () => {
  const [forecasts, setForecasts] = useState<ComplianceForecast[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async (reportType: string) => {
    setExporting(true);
    try {
      const blob = await reportExportService.exportReport({
        report_type: reportType as 'compliance' | 'department',
        format: 'csv',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `training_report_${reportType}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Report downloaded');
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setExporting(false);
    }
  };

  const handleLoadForecast = async () => {
    setLoading(true);
    try {
      const data = await reportExportService.getComplianceForecast();
      setForecasts(data);
    } catch {
      toast.error('Failed to load forecast');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-theme-text-primary">Reports & Analytics</h3>
        <p className="text-sm text-theme-text-muted">
          Export compliance reports, individual training records, and view predictive forecasts
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <button
          onClick={() => void handleExport('compliance')}
          disabled={exporting}
          className="card-secondary p-4 text-left hover:bg-theme-surface-hover transition-colors"
        >
          <Download className="w-6 h-6 text-blue-500 mb-2" />
          <h4 className="text-sm font-medium text-theme-text-primary">Compliance Report</h4>
          <p className="text-xs text-theme-text-muted mt-1">
            Department-wide compliance status for all members and requirements
          </p>
        </button>

        <button
          onClick={() => void handleExport('hours_summary')}
          disabled={exporting}
          className="card-secondary p-4 text-left hover:bg-theme-surface-hover transition-colors"
        >
          <Download className="w-6 h-6 text-green-500 mb-2" />
          <h4 className="text-sm font-medium text-theme-text-primary">Hours Summary</h4>
          <p className="text-xs text-theme-text-muted mt-1">
            Training hours by member, category, and type for state reporting
          </p>
        </button>

        <button
          onClick={() => void handleExport('certification')}
          disabled={exporting}
          className="card-secondary p-4 text-left hover:bg-theme-surface-hover transition-colors"
        >
          <Download className="w-6 h-6 text-yellow-500 mb-2" />
          <h4 className="text-sm font-medium text-theme-text-primary">Certification Report</h4>
          <p className="text-xs text-theme-text-muted mt-1">
            All certifications with expiration status and renewal tracking
          </p>
        </button>
      </div>

      <div className="border-t border-theme-surface-border pt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-medium text-theme-text-primary">Compliance Forecast</h4>
            <p className="text-xs text-theme-text-muted">
              Predictive 30/60/90 day compliance based on expiring certifications
            </p>
          </div>
          <button
            onClick={() => { void handleLoadForecast(); }}
            disabled={loading}
            className="btn-secondary flex items-center space-x-1 px-3 py-2 text-sm rounded-lg"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
            <span>Load Forecast</span>
          </button>
        </div>

        {forecasts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-theme-text-muted border-b border-theme-surface-border">
                  <th className="pb-2 pr-4">Member</th>
                  <th className="pb-2 pr-4">Current</th>
                  <th className="pb-2 pr-4">30 Days</th>
                  <th className="pb-2 pr-4">60 Days</th>
                  <th className="pb-2 pr-4">90 Days</th>
                  <th className="pb-2">At Risk</th>
                </tr>
              </thead>
              <tbody>
                {forecasts.map((f) => (
                  <tr key={f.user_id} className="border-b border-theme-surface-border/50">
                    <td className="py-2 pr-4 text-theme-text-primary">{f.user_name || f.user_id}</td>
                    <td className="py-2 pr-4">
                      <span className={f.current_compliance_percentage >= 80 ? 'text-green-600' : f.current_compliance_percentage >= 50 ? 'text-yellow-600' : 'text-red-600'}>
                        {f.current_compliance_percentage}%
                      </span>
                    </td>
                    <td className="py-2 pr-4">{f.forecast_30_days}%</td>
                    <td className="py-2 pr-4">{f.forecast_60_days}%</td>
                    <td className="py-2 pr-4">{f.forecast_90_days}%</td>
                    <td className="py-2">
                      {f.at_risk_requirements.length > 0 && (
                        <span className="text-xs text-red-500">
                          {f.at_risk_requirements.length} requirement{f.at_risk_requirements.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== Main Component ====================

interface TrainingEnhancementsTabProps {
  activeTab: string;
}

export const TrainingEnhancementsTab: React.FC<TrainingEnhancementsTabProps> = ({ activeTab }) => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {activeTab === 'recertification' && <RecertificationSection />}
      {activeTab === 'competency' && <CompetencySection />}
      {activeTab === 'instructors' && <InstructorsSection />}
      {activeTab === 'effectiveness' && <EffectivenessSection />}
      {activeTab === 'multi-agency' && <MultiAgencySection />}
      {activeTab === 'reports' && <ReportsSection />}
    </div>
  );
};

export default TrainingEnhancementsTab;
