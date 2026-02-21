import React, { useState, useEffect } from 'react';
import {
  GraduationCap,
  TrendingUp,
  Target,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Award,
  ChevronRight,
  Play,
  Circle,
} from 'lucide-react';
import { trainingProgramService } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';
import type {
  ProgramEnrollment,
  MemberProgramProgress,
  RequirementProgressStatus,
} from '../types/training';

const getStatusColor = (status: RequirementProgressStatus) => {
  switch (status) {
    case 'completed':
      return 'text-green-700 dark:text-green-400 bg-green-500/10';
    case 'in_progress':
      return 'text-blue-700 dark:text-blue-400 bg-blue-500/10';
    case 'waived':
      return 'text-gray-700 dark:text-gray-400 bg-gray-500/10';
    default:
      return 'text-gray-700 dark:text-gray-400 bg-gray-500/10';
  }
};

const getStatusIcon = (status: RequirementProgressStatus) => {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-5 h-5 text-green-400" />;
    case 'in_progress':
      return <Play className="w-5 h-5 text-blue-400" />;
    default:
      return <Circle className="w-5 h-5 text-gray-700 dark:text-gray-400" />;
  }
};

interface ProgressCardProps {
  progress: MemberProgramProgress;
  onClick: () => void;
}

const ProgressCard: React.FC<ProgressCardProps> = ({ progress, onClick }) => {
  const { enrollment, program, completed_requirements, total_requirements, time_remaining_days, is_behind_schedule } = progress;

  const getProgressColor = (percentage: number) => {
    if (percentage >= 75) return 'bg-green-500';
    if (percentage >= 50) return 'bg-blue-500';
    if (percentage >= 25) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div
      onClick={onClick}
      className="bg-theme-surface rounded-lg p-6 hover:bg-theme-surface-hover cursor-pointer transition-colors"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-2">
            <h3 className="text-xl font-semibold text-theme-text-primary">{program.name}</h3>
            <span className={`px-2 py-1 text-xs rounded ${
              enrollment.status === 'active' ? 'bg-green-500/20 text-green-400' :
              enrollment.status === 'completed' ? 'bg-blue-500/20 text-blue-400' :
              'bg-gray-500/20 text-gray-400'
            }`}>
              {enrollment.status}
            </span>
          </div>
          {program.description && (
            <p className="text-theme-text-muted text-sm">{program.description}</p>
          )}
        </div>
        <ChevronRight className="w-5 h-5 text-theme-text-muted flex-shrink-0" />
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-theme-text-muted">Overall Progress</span>
          <span className="text-theme-text-primary font-semibold">{Math.round(enrollment.progress_percentage)}%</span>
        </div>
        <div className="w-full bg-theme-surface-secondary rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${getProgressColor(enrollment.progress_percentage)}`}
            style={{ width: `${enrollment.progress_percentage}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-theme-surface-secondary rounded-lg p-3">
          <div className="flex items-center space-x-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <span className="text-xs text-theme-text-muted">Completed</span>
          </div>
          <p className="text-lg font-bold text-theme-text-primary">{completed_requirements}/{total_requirements}</p>
        </div>

        {time_remaining_days !== null && time_remaining_days !== undefined && (
          <div className="bg-theme-surface-secondary rounded-lg p-3">
            <div className="flex items-center space-x-2 mb-1">
              <Calendar className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-theme-text-muted">Days Left</span>
            </div>
            <p className={`text-lg font-bold ${
              time_remaining_days < 30 ? 'text-red-400' :
              time_remaining_days < 90 ? 'text-yellow-400' :
              'text-theme-text-primary'
            }`}>
              {time_remaining_days}
            </p>
          </div>
        )}

        {progress.current_phase && (
          <div className="bg-theme-surface-secondary rounded-lg p-3">
            <div className="flex items-center space-x-2 mb-1">
              <Target className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-theme-text-muted">Current Phase</span>
            </div>
            <p className="text-sm font-semibold text-theme-text-primary truncate">{progress.current_phase.name}</p>
          </div>
        )}

        {is_behind_schedule && (
          <div className="bg-red-500/10 rounded-lg p-3 border border-red-500/20">
            <div className="flex items-center space-x-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-xs text-red-400">Behind Schedule</span>
            </div>
            <p className="text-sm font-semibold text-red-400">Action Needed</p>
          </div>
        )}
      </div>

      {/* Next Milestones */}
      {progress.next_milestones.length > 0 && (
        <div className="mt-4 pt-4 border-t border-theme-surface-border">
          <div className="flex items-center space-x-2 mb-2">
            <Award className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-medium text-theme-text-secondary">Next Milestone</span>
          </div>
          <div className="bg-theme-surface-secondary rounded p-2">
            <p className="text-sm text-theme-text-primary font-medium">{progress.next_milestones[0].name}</p>
            <p className="text-xs text-theme-text-muted mt-1">
              At {progress.next_milestones[0].completion_percentage_threshold}% completion
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

interface DetailedProgressViewProps {
  progress: MemberProgramProgress;
  onBack: () => void;
}

const DetailedProgressView: React.FC<DetailedProgressViewProps> = ({ progress, onBack }) => {
  const tz = useTimezone();
  const { enrollment, program, requirement_progress, next_milestones } = progress;

  const requirementsByPhase = requirement_progress.reduce((acc, rp) => {
    const phase = rp.requirement?.required_positions?.[0] || 'General';
    if (!acc[phase]) acc[phase] = [];
    acc[phase].push(rp);
    return acc;
  }, {} as Record<string, typeof requirement_progress>);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-theme-surface rounded-lg p-6">
        <button
          onClick={onBack}
          className="text-theme-text-muted hover:text-theme-text-primary mb-4 flex items-center space-x-2"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
          <span>Back to Programs</span>
        </button>

        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-theme-text-primary mb-2">{program.name}</h2>
            {program.description && (
              <p className="text-theme-text-muted">{program.description}</p>
            )}
          </div>
          <span className={`px-3 py-1 text-sm rounded ${
            enrollment.status === 'active' ? 'bg-green-500/20 text-green-400' :
            enrollment.status === 'completed' ? 'bg-blue-500/20 text-blue-400' :
            'bg-gray-500/20 text-gray-400'
          }`}>
            {enrollment.status}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-theme-text-secondary">Overall Progress</span>
            <span className="text-lg font-bold text-theme-text-primary">{Math.round(enrollment.progress_percentage)}%</span>
          </div>
          <div className="w-full bg-theme-surface-secondary rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${
                enrollment.progress_percentage >= 75 ? 'bg-green-500' :
                enrollment.progress_percentage >= 50 ? 'bg-blue-500' :
                enrollment.progress_percentage >= 25 ? 'bg-yellow-500' :
                'bg-red-500'
              }`}
              style={{ width: `${enrollment.progress_percentage}%` }}
            />
          </div>
        </div>

        {/* Key Dates */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
          <div>
            <p className="text-xs text-theme-text-muted mb-1">Enrolled</p>
            <p className="text-sm font-medium text-theme-text-primary">
              {formatDate(enrollment.enrolled_at, tz)}
            </p>
          </div>
          {enrollment.target_completion_date && (
            <div>
              <p className="text-xs text-theme-text-muted mb-1">Target Completion</p>
              <p className="text-sm font-medium text-theme-text-primary">
                {formatDate(enrollment.target_completion_date, tz)}
              </p>
            </div>
          )}
          {enrollment.completed_at && (
            <div>
              <p className="text-xs text-theme-text-muted mb-1">Completed</p>
              <p className="text-sm font-medium text-green-400">
                {formatDate(enrollment.completed_at, tz)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Milestones */}
      {next_milestones.length > 0 && (
        <div className="bg-theme-surface rounded-lg p-6">
          <h3 className="text-lg font-semibold text-theme-text-primary mb-4 flex items-center space-x-2">
            <Award className="w-5 h-5 text-yellow-400" />
            <span>Upcoming Milestones</span>
          </h3>
          <div className="space-y-3">
            {next_milestones.map((milestone, _index) => (
              <div key={milestone.id} className="bg-theme-surface-secondary rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-theme-text-primary">{milestone.name}</h4>
                  <span className="text-sm text-theme-text-muted">
                    {milestone.completion_percentage_threshold}%
                  </span>
                </div>
                {milestone.description && (
                  <p className="text-sm text-theme-text-muted">{milestone.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Requirements */}
      <div className="bg-theme-surface rounded-lg p-6">
        <h3 className="text-lg font-semibold text-theme-text-primary mb-4">Requirements</h3>
        <div className="space-y-6">
          {Object.entries(requirementsByPhase).map(([phase, requirements]) => (
            <div key={phase}>
              <h4 className="text-sm font-medium text-theme-text-secondary mb-3">{phase}</h4>
              <div className="space-y-2">
                {requirements.map((rp) => (
                  <div
                    key={rp.id}
                    className="bg-theme-surface-secondary rounded-lg p-4 flex items-start space-x-4"
                  >
                    <div className="flex-shrink-0 mt-1">
                      {getStatusIcon(rp.status)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h5 className="font-medium text-theme-text-primary truncate">
                          {rp.requirement?.name || 'Requirement'}
                        </h5>
                        <span className={`px-2 py-1 text-xs rounded ml-2 ${getStatusColor(rp.status)}`}>
                          {rp.status.replace('_', ' ')}
                        </span>
                      </div>
                      {rp.requirement?.description && (
                        <p className="text-sm text-theme-text-muted mb-2">{rp.requirement.description}</p>
                      )}

                      {/* Progress bar for this requirement */}
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-theme-text-muted">
                            {rp.requirement?.requirement_type === 'hours' && rp.requirement.required_hours && (
                              `${rp.progress_value} / ${rp.requirement.required_hours} hours`
                            )}
                            {rp.requirement?.requirement_type === 'shifts' && rp.requirement.required_shifts && (
                              `${rp.progress_value} / ${rp.requirement.required_shifts} shifts`
                            )}
                            {rp.requirement?.requirement_type === 'calls' && rp.requirement.required_calls && (
                              `${rp.progress_value} / ${rp.requirement.required_calls} calls`
                            )}
                          </span>
                          <span className="text-theme-text-primary font-medium">{Math.round(rp.progress_percentage)}%</span>
                        </div>
                        <div className="w-full bg-theme-surface-secondary rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${
                              rp.progress_percentage >= 100 ? 'bg-green-500' :
                              rp.progress_percentage >= 50 ? 'bg-blue-500' :
                              'bg-yellow-500'
                            }`}
                            style={{ width: `${Math.min(100, rp.progress_percentage)}%` }}
                          />
                        </div>
                      </div>

                      {rp.completed_at && (
                        <p className="text-xs text-green-400 mt-2">
                          Completed on {formatDate(rp.completed_at, tz)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const MemberProgressPage: React.FC = () => {
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [progressDetails, setProgressDetails] = useState<Map<string, MemberProgramProgress>>(new Map());
  const [selectedEnrollment, setSelectedEnrollment] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('active');

  useEffect(() => {
    loadEnrollments();
  }, [filter]);

  const loadEnrollments = async () => {
    setLoading(true);
    try {
      const status = filter === 'all' ? undefined : filter;
      const data = await trainingProgramService.getMyEnrollments(status);
      setEnrollments(data);

      // Load detailed progress for each enrollment
      const details = new Map<string, MemberProgramProgress>();
      for (const enrollment of data) {
        const progress = await trainingProgramService.getEnrollmentProgress(enrollment.id);
        details.set(enrollment.id, progress);
      }
      setProgressDetails(details);
    } catch (_error) {
      // Error silently handled - empty enrollments shown
    } finally {
      setLoading(false);
    }
  };

  const selectedProgress = selectedEnrollment ? progressDetails.get(selectedEnrollment) : null;

  if (selectedProgress) {
    return (
      <div className="min-h-screen">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <DetailedProgressView
            progress={selectedProgress}
            onBack={() => setSelectedEnrollment(null)}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-theme-text-primary flex items-center space-x-3 mb-2">
            <TrendingUp className="w-8 h-8 text-red-500" />
            <span>My Training Progress</span>
          </h1>
          <p className="text-theme-text-muted">
            Track your progress through training programs and requirements
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex space-x-2 mb-6">
          {(['all', 'active', 'completed'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors capitalize ${
                filter === status
                  ? 'bg-red-600 text-white'
                  : 'bg-theme-surface text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
            <p className="text-theme-text-muted mt-4">Loading your programs...</p>
          </div>
        ) : enrollments.length === 0 ? (
          <div className="text-center py-12 bg-theme-surface rounded-lg">
            <GraduationCap className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
            <p className="text-theme-text-muted">No {filter !== 'all' && filter} programs found</p>
            <p className="text-theme-text-muted mt-2 text-sm">
              Contact your training officer to enroll in a program
            </p>
          </div>
        ) : (
          <div className="grid gap-6">
            {enrollments.map((enrollment) => {
              const progress = progressDetails.get(enrollment.id);
              return progress ? (
                <ProgressCard
                  key={enrollment.id}
                  progress={progress}
                  onClick={() => setSelectedEnrollment(enrollment.id)}
                />
              ) : (
                <div key={enrollment.id} className="bg-theme-surface rounded-lg p-6">
                  <div className="animate-pulse">
                    <div className="h-6 bg-theme-surface-secondary rounded w-1/3 mb-4"></div>
                    <div className="h-4 bg-theme-surface-secondary rounded w-full mb-2"></div>
                    <div className="h-4 bg-theme-surface-secondary rounded w-2/3"></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default MemberProgressPage;
