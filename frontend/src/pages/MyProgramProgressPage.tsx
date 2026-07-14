/**
 * My Program Progress (member-facing, read-only)
 *
 * Lets a student see their progression and status in a training program:
 * current phase, overall completion, and every requirement grouped by phase
 * with its status. Reuses the enrollment-progress endpoint (members may read
 * their own enrollment) plus the program's phases/requirements for grouping.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Layers,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Flag,
  BadgeCheck,
} from 'lucide-react';
import { trainingProgramService } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';
import type {
  MemberProgramProgress,
  ProgramPhase,
  ProgramRequirement,
  RequirementProgressRecord,
  RequirementProgressStatus,
} from '../types/training';

const STATUS_META: Record<RequirementProgressStatus, { label: string; className: string }> = {
  not_started: { label: 'Not started', className: 'text-theme-text-muted' },
  in_progress: { label: 'In progress', className: 'text-blue-700 dark:text-blue-400' },
  completed: { label: 'Completed', className: 'text-green-700 dark:text-green-400' },
  verified: { label: 'Verified', className: 'text-green-700 dark:text-green-400' },
  waived: { label: 'Waived', className: 'text-yellow-700 dark:text-yellow-400' },
};

interface PhaseGroup {
  phase: ProgramPhase | null;
  records: RequirementProgressRecord[];
}

function groupByPhase(
  records: RequirementProgressRecord[],
  phases: ProgramPhase[],
  programReqs: ProgramRequirement[],
): PhaseGroup[] {
  const reqPhase = new Map<string, string | undefined>();
  programReqs.forEach((pr) => reqPhase.set(pr.requirement_id, pr.phase_id));
  const ordered = [...phases].sort((a, b) => a.phase_number - b.phase_number);
  const groups: PhaseGroup[] = ordered.map((phase) => ({
    phase,
    records: records.filter((r) => reqPhase.get(r.requirement_id) === phase.id),
  }));
  const programLevel = records.filter((r) => {
    const pid = reqPhase.get(r.requirement_id);
    return !pid || !ordered.some((p) => p.id === pid);
  });
  if (programLevel.length > 0) groups.push({ phase: null, records: programLevel });
  return groups.filter((g) => g.records.length > 0);
}

function isComplete(records: RequirementProgressRecord[]): boolean {
  return records.every((r) => r.progress_percentage >= 100);
}

const RequirementRow: React.FC<{ record: RequirementProgressRecord }> = ({ record }) => {
  const meta = STATUS_META[record.status];
  const done = record.status === 'completed' || record.status === 'verified';
  const score = record.progress_notes?.latest_score;
  return (
    <div className="flex items-start justify-between gap-3 bg-theme-surface-secondary rounded-lg p-3">
      <div className="flex items-start gap-2 min-w-0">
        {done ? (
          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
        ) : (
          <div className="w-4 h-4 rounded-full border border-theme-surface-border mt-0.5 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-sm text-theme-text-primary truncate">
            {record.requirement?.name || 'Requirement'}
          </p>
          <div className="flex items-center gap-2 text-xs mt-0.5">
            <span className={meta.className}>{meta.label}</span>
            {typeof score === 'number' && (
              <span className="text-theme-text-muted">· score {score}%</span>
            )}
            {record.verified_by && (
              <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                <BadgeCheck className="w-3 h-3" /> Verified
              </span>
            )}
          </div>
        </div>
      </div>
      <span className="text-xs text-theme-text-muted shrink-0">
        {Math.round(record.progress_percentage)}%
      </span>
    </div>
  );
};

const MyProgramProgressPage: React.FC = () => {
  const { enrollmentId } = useParams<{ enrollmentId: string }>();
  const navigate = useNavigate();
  const tz = useTimezone();

  const [data, setData] = useState<MemberProgramProgress | null>(null);
  const [phases, setPhases] = useState<ProgramPhase[]>([]);
  const [programReqs, setProgramReqs] = useState<ProgramRequirement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enrollmentId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const progress = await trainingProgramService.getEnrollmentProgress(enrollmentId);
        if (cancelled) return;
        setData(progress);
        const programId = progress.program.id;
        const [ph, reqs] = await Promise.all([
          trainingProgramService.getProgramPhases(programId),
          trainingProgramService.getProgramRequirements(programId),
        ]);
        if (cancelled) return;
        setPhases(ph);
        setProgramReqs(reqs);
      } catch {
        if (!cancelled) {
          toast.error('Unable to load your program progress');
          navigate('/training');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enrollmentId, navigate]);

  const groups = useMemo(
    () => (data ? groupByPhase(data.requirement_progress, phases, programReqs) : []),
    [data, phases, programReqs],
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
        <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-red-500" aria-hidden="true" />
      </div>
    );
  }

  if (!data) return null;

  const overall = Math.round(data.enrollment.progress_percentage);
  const currentPhaseId = data.enrollment.current_phase_id;

  return (
    <div className="min-h-screen">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-start gap-3 mb-6">
          <button
            onClick={() => navigate('/training')}
            className="mt-1 p-2 text-theme-text-muted hover:text-theme-text-primary rounded-lg hover:bg-theme-surface-hover"
            aria-label="Back to my training"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-theme-text-primary">{data.program.name}</h1>
            {data.current_phase && (
              <p className="text-sm text-theme-text-muted mt-1">
                Current phase:{' '}
                <span className="text-theme-text-secondary">
                  Phase {data.current_phase.phase_number} — {data.current_phase.name}
                </span>
              </p>
            )}
          </div>
        </div>

        {/* Overall progress */}
        <div className="bg-theme-surface rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-theme-text-secondary">
              {data.completed_requirements}/{data.total_requirements} requirements complete
            </span>
            <span className="text-sm font-semibold text-theme-text-primary">{overall}%</span>
          </div>
          <div className="w-full bg-theme-surface-secondary rounded-full h-2">
            <div className="bg-red-500 h-2 rounded-full transition-all" style={{ width: `${overall}%` }} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-theme-text-muted mt-3">
            <span>Enrolled: {formatDate(data.enrollment.enrolled_at, tz)}</span>
            {data.enrollment.target_completion_date && (
              <span>Target: {formatDate(data.enrollment.target_completion_date, tz)}</span>
            )}
            {typeof data.time_remaining_days === 'number' && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {data.time_remaining_days >= 0
                  ? `${data.time_remaining_days} days left`
                  : `${Math.abs(data.time_remaining_days)} days overdue`}
              </span>
            )}
            {data.is_behind_schedule && (
              <span className="flex items-center gap-1 text-yellow-700 dark:text-yellow-400">
                <AlertTriangle className="w-3.5 h-3.5" /> Behind schedule
              </span>
            )}
          </div>
        </div>

        {/* Next milestones */}
        {data.next_milestones.length > 0 && (
          <div className="bg-theme-surface rounded-lg p-4 mb-4">
            <h2 className="text-sm font-semibold text-theme-text-primary mb-2 flex items-center gap-2">
              <Flag className="w-4 h-4 text-yellow-600 dark:text-yellow-400" /> Next milestones
            </h2>
            <div className="space-y-1">
              {data.next_milestones.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-xs text-theme-text-secondary">
                  <span>{m.name}</span>
                  <span className="text-theme-text-muted">at {Math.round(m.completion_percentage_threshold)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Requirements grouped by phase */}
        {groups.length === 0 ? (
          <div className="text-center py-10 bg-theme-surface rounded-lg text-theme-text-muted text-sm">
            No requirements to track yet.
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => {
              const isCurrent = !!group.phase && currentPhaseId === group.phase.id;
              const complete = isComplete(group.records);
              return (
                <div key={group.phase?.id ?? 'program-level'} className="bg-theme-surface rounded-lg p-4">
                  <div className="flex items-center gap-2 flex-wrap mb-3">
                    <Layers className="w-4 h-4 text-theme-text-muted" />
                    <h2 className="text-sm font-semibold text-theme-text-primary">
                      {group.phase ? `Phase ${group.phase.phase_number}: ${group.phase.name}` : 'Program-level'}
                    </h2>
                    {isCurrent && (
                      <span className="px-2 py-0.5 bg-red-500/15 text-red-700 dark:text-red-400 text-xs rounded-sm">You are here</span>
                    )}
                    {complete && (
                      <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" aria-label="Phase complete" />
                    )}
                  </div>
                  <div className="space-y-2">
                    {group.records.map((record) => (
                      <RequirementRow key={record.id} record={record} />
                    ))}
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

export default MyProgramProgressPage;
