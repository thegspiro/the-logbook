import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Users,
  Layers,
  ListChecks,
  Calendar,
  Copy,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  AlertTriangle,
  UserPlus,
  Printer,
  Search,
  X,
  Loader2,
  Circle,
  BadgeCheck,
  Save,
  ArrowUpRight,
  Pencil,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  Flag,
} from 'lucide-react';
import { trainingProgramService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { Breadcrumbs } from '../components/ux/Breadcrumbs';
import { ConfirmDialog } from '../components/ux/ConfirmDialog';
import {
  EditProgramModal,
  PhaseFormModal,
  RequirementFormModal,
  MilestoneFormModal,
} from './PipelineEditModals';
import { getErrorMessage } from '../utils/errorHandling';
import { STATUS_META, groupRecordsByPhase, isPhaseGroupComplete } from '../utils/pipelineProgress';
import type {
  TrainingProgram,
  ProgramPhase,
  ProgramRequirement,
  ProgramMilestone,
  ProgramEnrollmentWithUser,
  TrainingRequirementEnhanced,
  ProgramStructureType,
  MemberProgramProgress,
  MemberEligibility,
  EligibilityStatus,
  RequirementProgressRecord,
  RequirementProgressUpdate,
} from '../types/training';

// Label + colour for each eligibility status; drives the picker badges.
const ELIGIBILITY_META: Record<EligibilityStatus, { label: string; className: string }> = {
  eligible: { label: 'Eligible', className: 'text-green-700 dark:text-green-400' },
  enrolled: { label: 'Enrolled', className: 'text-theme-text-muted' },
  prerequisite: { label: 'Prerequisite', className: 'text-yellow-700 dark:text-yellow-400' },
  concurrent: { label: 'In another program', className: 'text-yellow-700 dark:text-yellow-400' },
};

function eligibilityName(m: MemberEligibility): string {
  return `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || 'Unknown member';
}

// ==================== Types ====================

interface ProgramDetails extends TrainingProgram {
  phases?: ProgramPhase[];
  requirements?: (ProgramRequirement | TrainingRequirementEnhanced)[];
  milestones?: ProgramMilestone[];
  total_requirements?: number;
  total_required?: number;
}

type DetailTab = 'overview' | 'phases' | 'enrollments';

// ==================== Helper Components ====================

const StructureBadge: React.FC<{ type: ProgramStructureType }> = ({ type }) => {
  const colors: Record<ProgramStructureType, string> = {
    phases: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
    sequential: 'bg-purple-500/10 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400',
    flexible: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  };

  return (
    <span className={`px-2 py-1 text-xs rounded-sm ${colors[type]}`}>
      {type === 'phases' ? 'Phase-based' : type === 'sequential' ? 'Sequential' : 'Flexible'}
    </span>
  );
};

const PositionBadge: React.FC<{ position: string }> = ({ position }) => {
  const labels: Record<string, string> = {
    probationary: 'Probationary',
    firefighter: 'Firefighter',
    driver_candidate: 'Driver Candidate',
    driver: 'Driver',
    officer: 'Officer',
    aic: 'AIC',
  };

  return (
    <span className="px-2 py-1 bg-red-500/20 text-red-700 dark:text-red-400 text-xs rounded-sm">
      {labels[position] || position}
    </span>
  );
};

const ReqTypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const colors: Record<string, string> = {
    hours: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
    courses: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
    skills_evaluation: 'bg-purple-500/10 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400',
    checklist: 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
    certification: 'bg-pink-500/10 text-pink-700 dark:bg-pink-500/20 dark:text-pink-400',
    shifts: 'bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
    calls: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  };

  const labels: Record<string, string> = {
    hours: 'Hours',
    courses: 'Courses',
    skills_evaluation: 'Skills',
    checklist: 'Checklist',
    certification: 'Certification',
    shifts: 'Shifts',
    calls: 'Calls',
  };

  return (
    <span className={`px-2 py-0.5 text-xs rounded-sm ${colors[type] || 'bg-theme-surface-secondary text-theme-text-muted'}`}>
      {labels[type] || type}
    </span>
  );
};

// ==================== Enroll Modal ====================

const EnrollModal: React.FC<{
  isOpen: boolean;
  programId: string;
  programName: string;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ isOpen, programId, programName, onClose, onSuccess }) => {
  const [members, setMembers] = useState<MemberEligibility[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [eligibleOnly, setEligibleOnly] = useState(true);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [targetDate, setTargetDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load eligibility each time the modal opens; reset transient state.
  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      setSelected(new Map());
      setTargetDate('');
      setMembersError(null);
      setEligibleOnly(true);
      return undefined;
    }
    let cancelled = false;
    setLoadingMembers(true);
    setMembersError(null);
    void (async () => {
      try {
        const data = await trainingProgramService.getEnrollmentEligibility(programId);
        if (!cancelled) setMembers(data);
      } catch (err: unknown) {
        if (!cancelled) setMembersError(getErrorMessage(err, 'Unable to load members.'));
      } finally {
        if (!cancelled) setLoadingMembers(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, programId]);

  const eligibleCount = useMemo(() => members.filter((m) => m.eligible).length, [members]);

  // The API already returns eligible-first, alphabetical — just filter here.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (eligibleOnly && !m.eligible) return false;
      if (!q) return true;
      return (
        eligibilityName(m).toLowerCase().includes(q) ||
        (m.membership_number ?? '').toLowerCase().includes(q)
      );
    });
  }, [members, search, eligibleOnly]);

  const toggle = (m: MemberEligibility) => {
    if (!m.eligible) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(m.user_id)) next.delete(m.user_id);
      else next.set(m.user_id, eligibilityName(m));
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.size === 0) {
      toast.error('Select at least one member');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await trainingProgramService.bulkEnrollMembers(programId, {
        user_ids: Array.from(selected.keys()),
        target_completion_date: targetDate || undefined,
      });
      if (result.success_count > 0) {
        toast.success(`Enrolled ${result.success_count} member(s) in ${programName}`);
      }
      // Eligibility is prechecked, but surface any residual per-member failures
      // (e.g. a race where state changed since the picker loaded).
      result.errors.forEach((msg) => toast.error(msg));
      onSuccess();
      if (result.success_count > 0) onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to enroll members'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-lg w-full max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-theme-surface-border">
          <h2 className="text-xl font-bold text-theme-text-primary">Enroll Members</h2>
          <p className="text-theme-text-muted text-sm mt-1">Enroll members into {programName}</p>
        </div>
        <form onSubmit={(e) => { void handleSubmit(e); }} className="p-6 space-y-4 overflow-y-auto">
          {/* Selected chips */}
          {selected.size > 0 && (
            <div className="flex flex-wrap gap-2">
              {Array.from(selected.entries()).map(([id, name]) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-red-500/15 text-red-700 dark:text-red-400 rounded-md text-xs"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => setSelected((prev) => { const n = new Map(prev); n.delete(id); return n; })}
                    aria-label={`Remove ${name}`}
                    className="hover:text-red-900 dark:hover:text-red-200"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members by name or number..."
              className="form-input pl-9 text-sm"
              aria-label="Search members"
              autoComplete="off"
            />
          </div>

          {/* Eligibility filter */}
          {!loadingMembers && !membersError && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-theme-text-muted">
                {eligibleCount} of {members.length} eligible
              </span>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none text-theme-text-secondary">
                <input
                  type="checkbox"
                  checked={eligibleOnly}
                  onChange={(e) => setEligibleOnly(e.target.checked)}
                  className="rounded-sm"
                />
                Show eligible only
              </label>
            </div>
          )}

          {/* Member list */}
          <div className="border border-theme-surface-border rounded-lg max-h-64 overflow-y-auto">
            {loadingMembers ? (
              <div className="flex items-center justify-center py-8 text-theme-text-muted" role="status" aria-live="polite">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <span className="text-sm">Loading members...</span>
              </div>
            ) : membersError ? (
              <div className="p-3 text-sm text-red-600 dark:text-red-400">{membersError}</div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center text-theme-text-muted text-sm px-4">
                {search
                  ? 'No members match your search.'
                  : eligibleOnly && members.length > 0
                  ? 'No eligible members. Turn off “Show eligible only” to see who’s blocked and why.'
                  : 'No members found.'}
              </div>
            ) : (
              filtered.map((m) => {
                const isSelected = selected.has(m.user_id);
                const meta = ELIGIBILITY_META[m.status];
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => toggle(m)}
                    disabled={!m.eligible}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm border-b border-theme-surface-border last:border-b-0 transition-colors ${
                      !m.eligible
                        ? 'cursor-not-allowed'
                        : isSelected
                        ? 'bg-red-500/10'
                        : 'hover:bg-theme-surface-hover'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className={`truncate ${m.eligible ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}>
                        {eligibilityName(m)}
                        {m.membership_number && (
                          <span className="text-theme-text-muted ml-2 text-xs">#{m.membership_number}</span>
                        )}
                      </span>
                      {!m.eligible && m.reason && (
                        <p className="text-theme-text-muted text-xs mt-0.5">{m.reason}</p>
                      )}
                    </div>
                    {m.eligible ? (
                      isSelected ? (
                        <CheckCircle2 className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-theme-text-muted shrink-0" />
                      )
                    ) : (
                      <span className={`text-xs shrink-0 ${meta.className}`}>{meta.label}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div>
            <label htmlFor="enroll-target-date" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Target Completion Date
            </label>
            <input
              id="enroll-target-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="form-input text-sm"
            />
          </div>

          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-theme-surface text-theme-text-primary rounded-lg hover:bg-theme-surface-hover text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary text-sm"
              disabled={isSubmitting || selected.size === 0}
            >
              {isSubmitting ? 'Enrolling...' : `Enroll ${selected.size || ''} Member${selected.size === 1 ? '' : 's'}`.trim()}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ==================== Enrollment Progress Modal ====================

// Requirement types whose progress is a numeric accrual (log a value); all
// other types (courses, certification, checklist, knowledge test, skills) are
// completed by setting status.
const NUMERIC_TYPES = new Set(['hours', 'shifts', 'calls', 'courses']);

// Requirement types an officer scores by entering a percentage; pass/fail is
// derived from the requirement's passing_score. Groundwork for a fuller
// knowledge-test feature later.
const SCORED_TYPES = new Set(['knowledge_test']);

function requirementTarget(
  req?: TrainingRequirementEnhanced,
): { value: number; label: string } | null {
  if (!req) return null;
  if (req.requirement_type === 'hours' && req.required_hours) return { value: req.required_hours, label: 'hours' };
  if (req.requirement_type === 'shifts' && req.required_shifts) return { value: req.required_shifts, label: 'shifts' };
  if (req.requirement_type === 'calls' && req.required_calls) return { value: req.required_calls, label: 'calls' };
  if (req.requirement_type === 'courses' && req.required_courses?.length)
    return { value: req.required_courses.length, label: 'courses' };
  return null;
}

const RequirementProgressRow: React.FC<{
  record: RequirementProgressRecord;
  onUpdate: (progressId: string, updates: RequirementProgressUpdate) => Promise<void>;
  saving: boolean;
}> = ({ record, onUpdate, saving }) => {
  const req = record.requirement;
  const numeric = req ? NUMERIC_TYPES.has(req.requirement_type) : false;
  const scored = req ? SCORED_TYPES.has(req.requirement_type) : false;
  const target = requirementTarget(req);
  const [value, setValue] = useState<string>(record.progress_value ? String(record.progress_value) : '');
  const [score, setScore] = useState<string>('');

  // Re-sync the input when the record is refreshed after a save.
  useEffect(() => {
    setValue(record.progress_value ? String(record.progress_value) : '');
  }, [record.progress_value]);

  const isDone = record.status === 'completed' || record.status === 'verified';
  const statusMeta = STATUS_META[record.status];
  const passThreshold = req?.passing_score ?? 70;
  const latestScore = record.progress_notes?.latest_score;
  const latestPassed = record.progress_notes?.passed;
  const attemptsUsed = record.progress_notes?.test_attempts?.length ?? 0;
  const maxAttempts = req?.max_attempts;
  const attemptsExhausted = !!maxAttempts && attemptsUsed >= maxAttempts && !isDone;

  const recordScore = () => {
    const parsed = score ? parseFloat(score) : NaN;
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
      toast.error('Enter a score between 0 and 100');
      return;
    }
    void onUpdate(record.id, { test_score: parsed }).then(() => setScore(''));
  };

  return (
    <div className="bg-theme-surface-secondary rounded-lg p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-theme-text-primary">{req?.name || 'Requirement'}</span>
          {req?.requirement_type && <ReqTypeBadge type={req.requirement_type} />}
          {record.verified_by && (
            <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
              <BadgeCheck className="w-3.5 h-3.5" /> Verified
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 text-xs">
          <span className={statusMeta.className}>{statusMeta.label}</span>
          <span className="text-theme-text-muted">· {Math.round(record.progress_percentage)}%</span>
          {target && <span className="text-theme-text-muted">· target {target.value} {target.label}</span>}
        </div>
      </div>

      {/* Numeric value editor (hours / shifts / calls) */}
      {numeric && (
        <div className="flex items-end gap-2 mt-3">
          <div className="flex-1">
            <label className="block text-xs text-theme-text-muted mb-1">Logged {target?.label ?? 'value'}</label>
            <input
              type="number"
              min={0}
              step={req?.requirement_type === 'hours' ? 0.5 : 1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="form-input-sm"
              disabled={saving}
            />
          </div>
          <button
            type="button"
            onClick={() => { void onUpdate(record.id, { progress_value: value ? parseFloat(value) : 0 }); }}
            disabled={saving}
            className="btn-primary text-xs flex items-center gap-1 px-3 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      )}

      {/* Test score entry (knowledge test): officer enters a %, pass/fail derived */}
      {scored && (
        <div className="mt-3 space-y-2">
          {typeof latestScore === 'number' && (
            <div className="text-xs text-theme-text-muted">
              Last score:{' '}
              <span className={latestPassed ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                {latestScore}% ({latestPassed ? 'pass' : 'fail'})
              </span>
            </div>
          )}
          {maxAttempts && (
            <div className="text-xs text-theme-text-muted">
              Attempts: {attemptsUsed} / {maxAttempts}
              {attemptsExhausted && (
                <span className="text-red-700 dark:text-red-400"> · no attempts remaining</span>
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs text-theme-text-muted mb-1">
                Test score (%) · pass ≥ {passThreshold}%
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={score}
                onChange={(e) => setScore(e.target.value)}
                className="form-input-sm"
                disabled={saving || attemptsExhausted}
              />
            </div>
            <button
              type="button"
              onClick={recordScore}
              disabled={saving || attemptsExhausted}
              className="btn-primary text-xs flex items-center gap-1 px-3 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> Record
            </button>
          </div>
        </div>
      )}

      {/* Status quick actions — simple pass (Mark complete) / reopen */}
      <div className="flex flex-wrap gap-2 mt-3">
        <button
          type="button"
          onClick={() => { void onUpdate(record.id, { status: 'in_progress' }); }}
          disabled={saving || record.status === 'in_progress'}
          className="text-xs px-2 py-1 rounded-md border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-40"
        >
          <Clock className="w-3.5 h-3.5 inline mr-1" /> In progress
        </button>
        <button
          type="button"
          onClick={() => { void onUpdate(record.id, { status: 'completed' }); }}
          disabled={saving || isDone}
          className="text-xs px-2 py-1 rounded-md border border-green-600/40 text-green-700 dark:text-green-400 hover:bg-green-500/10 disabled:opacity-40"
        >
          <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" /> Mark complete
        </button>
        {isDone && (
          <button
            type="button"
            onClick={() => { void onUpdate(record.id, { status: 'not_started' }); }}
            disabled={saving}
            className="text-xs px-2 py-1 rounded-md border border-theme-surface-border text-theme-text-muted hover:bg-theme-surface-hover disabled:opacity-40"
          >
            <Circle className="w-3.5 h-3.5 inline mr-1" /> Reopen
          </button>
        )}
      </div>
    </div>
  );
};

const EnrollmentProgressModal: React.FC<{
  isOpen: boolean;
  enrollmentId: string | null;
  memberName: string;
  phases: ProgramPhase[];
  programReqs: ProgramRequirement[];
  structureType: ProgramStructureType;
  onClose: () => void;
  onSaved: () => void;
}> = ({ isOpen, enrollmentId, memberName, phases, programReqs, structureType, onClose, onSaved }) => {
  const [data, setData] = useState<MemberProgramProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const load = useCallback(async () => {
    if (!enrollmentId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await trainingProgramService.getEnrollmentProgress(enrollmentId);
      setData(result);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load progress.'));
    } finally {
      setLoading(false);
    }
  }, [enrollmentId]);

  useEffect(() => {
    if (isOpen && enrollmentId) void load();
    if (!isOpen) { setData(null); setError(null); }
  }, [isOpen, enrollmentId, load]);

  const handleUpdate = async (progressId: string, updates: RequirementProgressUpdate) => {
    setSavingId(progressId);
    try {
      await trainingProgramService.updateProgress(progressId, updates);
      await load();  // pull recalculated percentages/status (may auto-advance the phase)
      onSaved();     // refresh the outer enrollments list (overall %, completion)
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update progress'));
    } finally {
      setSavingId(null);
    }
  };

  const handleAdvance = async () => {
    if (!enrollmentId) return;
    setAdvancing(true);
    try {
      await trainingProgramService.advancePhase(enrollmentId);
      toast.success('Advanced to the next phase');
      await load();
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to advance phase'));
    } finally {
      setAdvancing(false);
    }
  };

  if (!isOpen) return null;

  const phased = structureType === 'phases' && phases.length > 0;
  const overall = data ? Math.round(data.enrollment.progress_percentage) : 0;

  const orderedPhases = [...phases].sort((a, b) => a.phase_number - b.phase_number);
  const currentIdx = data
    ? orderedPhases.findIndex((p) => p.id === data.enrollment.current_phase_id)
    : -1;
  // No current phase (idx -1) but phases exist → the first phase is still "next".
  const hasNextPhase = orderedPhases.length > 0 && currentIdx < orderedPhases.length - 1;

  const groups = data && phased
    ? groupRecordsByPhase(data.requirement_progress, phases, programReqs)
    : [];

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-theme-surface-border">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-theme-text-primary">Progress — {memberName}</h2>
              {data && (
                <p className="text-theme-text-muted text-sm mt-1">
                  {data.completed_requirements}/{data.total_requirements} requirements · {overall}% overall
                </p>
              )}
              {phased && data?.current_phase && (
                <p className="text-xs text-theme-text-muted mt-1">
                  Current phase: <span className="text-theme-text-secondary">{data.current_phase.name}</span>
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1 text-theme-text-muted hover:text-theme-text-primary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {phased && (
            <button
              type="button"
              onClick={() => { void handleAdvance(); }}
              disabled={!data || !hasNextPhase || advancing}
              className="btn-primary text-xs flex items-center gap-1 px-3 mt-3 disabled:opacity-50"
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              {advancing ? 'Advancing...' : hasNextPhase ? 'Advance to next phase' : 'Final phase reached'}
            </button>
          )}
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-theme-text-muted" role="status" aria-live="polite">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Loading progress...</span>
            </div>
          ) : error ? (
            <div className="p-3 text-sm text-red-600 dark:text-red-400">{error}</div>
          ) : !data || data.requirement_progress.length === 0 ? (
            <div className="py-10 text-center text-theme-text-muted text-sm">
              No requirements to track for this enrollment.
            </div>
          ) : phased ? (
            groups.map((group) => {
              const isCurrent = !!group.phase && data.enrollment.current_phase_id === group.phase.id;
              const complete = isPhaseGroupComplete(group.records, programReqs);
              return (
                <div key={group.phase?.id ?? 'program-level'} className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-theme-text-primary">
                      {group.phase ? `Phase ${group.phase.phase_number}: ${group.phase.name}` : 'Program-level'}
                    </h3>
                    {isCurrent && (
                      <span className="px-2 py-0.5 bg-red-500/15 text-red-700 dark:text-red-400 text-xs rounded-sm">Current phase</span>
                    )}
                    {complete && (
                      <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" aria-label="Phase complete" />
                    )}
                    {group.phase?.requires_manual_advancement && (
                      <span className="inline-flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-400">
                        <AlertTriangle className="w-3.5 h-3.5" /> Manual advancement
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {group.records.map((record) => (
                      <RequirementProgressRow
                        key={record.id}
                        record={record}
                        onUpdate={handleUpdate}
                        saving={savingId === record.id}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            data.requirement_progress.map((record) => (
              <RequirementProgressRow
                key={record.id}
                record={record}
                onUpdate={handleUpdate}
                saving={savingId === record.id}
              />
            ))
          )}
        </div>

        <div className="p-4 border-t border-theme-surface-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-theme-surface text-theme-text-primary rounded-lg hover:bg-theme-surface-hover text-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== Main Page ====================

const PipelineDetailPage: React.FC = () => {
  const { programId } = useParams<{ programId: string }>();
  const navigate = useNavigate();

  const [program, setProgram] = useState<ProgramDetails | null>(null);
  const [phases, setPhases] = useState<ProgramPhase[]>([]);
  const [programReqs, setProgramReqs] = useState<ProgramRequirement[]>([]);
  const [enrollments, setEnrollments] = useState<ProgramEnrollmentWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [progressEnrollment, setProgressEnrollment] = useState<ProgramEnrollmentWithUser | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [savingReqId, setSavingReqId] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<ProgramMilestone[]>([]);
  const canManage = useAuthStore((s) => s.checkPermission('training.manage'));

  // Editor modal + confirm state.
  const [showEditProgram, setShowEditProgram] = useState(false);
  const [phaseModal, setPhaseModal] = useState<{ phase?: ProgramPhase } | null>(null);
  const [reqModal, setReqModal] = useState<{ phaseId: string | null; link?: ProgramRequirement } | null>(null);
  const [milestoneModal, setMilestoneModal] = useState<{ milestone?: ProgramMilestone } | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; run: () => Promise<void> } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => {
    if (programId) void loadProgram();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId]);

  const loadProgram = async () => {
    if (!programId) return;
    setLoading(true);
    try {
      const [programData, phasesData, reqsData] = await Promise.all([
        trainingProgramService.getProgram(programId),
        trainingProgramService.getProgramPhases(programId),
        trainingProgramService.getProgramRequirements(programId),
      ]);
      setProgram(programData);
      setPhases(phasesData);
      setProgramReqs(reqsData);
      setMilestones(programData.milestones ?? []);

      // Expand all phases by default
      setExpandedPhases(new Set(phasesData.map((p: ProgramPhase) => p.id)));
    } catch (_error) {
      toast.error('Failed to load program');
      navigate('/training/programs');
    } finally {
      setLoading(false);
    }
    // Load enrollments alongside the program so the "Enrolled" stat is accurate.
    void loadEnrollments();
  };

  const loadEnrollments = async () => {
    if (!programId) return;
    try {
      const data = await trainingProgramService.getProgramEnrollments(programId);
      setEnrollments(data);
    } catch {
      // A plain member viewing this page may lack training.view_all/manage;
      // degrade quietly rather than surfacing a permission error.
      setEnrollments([]);
    }
  };

  useEffect(() => {
    if (activeTab === 'enrollments') void loadEnrollments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleDuplicate = async () => {
    if (!programId || !program) return;
    setIsDuplicating(true);
    try {
      const newProgram = await trainingProgramService.duplicateProgram(programId, `${program.name} (Copy)`);
      toast.success('Pipeline duplicated successfully');
      navigate(`/training/programs/${newProgram.id}`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to duplicate pipeline';
      toast.error(msg);
    } finally {
      setIsDuplicating(false);
    }
  };

  const togglePhase = (phaseId: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  };

  // Get requirements for a specific phase
  const getPhaseReqs = (phaseId: string) =>
    programReqs.filter((r) => r.phase_id === phaseId).sort((a, b) => a.sort_order - b.sort_order);

  const afterEdit = () => {
    setShowEditProgram(false);
    setPhaseModal(null);
    setReqModal(null);
    setMilestoneModal(null);
    void loadProgram();
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmLoading(true);
    try {
      await confirm.run();
      setConfirm(null);
      void loadProgram();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Action failed'));
    } finally {
      setConfirmLoading(false);
    }
  };

  // Reorder helpers move an item one slot up/down, then persist the new order.
  const movePhase = async (phase: ProgramPhase, dir: -1 | 1) => {
    if (!programId) return;
    const ordered = [...phases].sort((a, b) => a.phase_number - b.phase_number);
    const i = ordered.findIndex((p) => p.id === phase.id);
    const j = i + dir;
    const a = ordered[i];
    const b = ordered[j];
    if (!a || !b) return;
    ordered[i] = b;
    ordered[j] = a;
    try {
      await trainingProgramService.reorderProgramPhases(programId, ordered.map((p) => p.id));
      void loadProgram();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reorder phases'));
    }
  };

  const moveRequirement = async (link: ProgramRequirement, dir: -1 | 1) => {
    if (!programId || !link.phase_id) return;
    const ordered = getPhaseReqs(link.phase_id);
    const i = ordered.findIndex((r) => r.id === link.id);
    const j = i + dir;
    const a = ordered[i];
    const b = ordered[j];
    if (!a || !b) return;
    ordered[i] = b;
    ordered[j] = a;
    try {
      await trainingProgramService.reorderProgramRequirements(programId, ordered.map((r) => r.id));
      void loadProgram();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reorder requirements'));
    }
  };

  const confirmDeletePhase = (phase: ProgramPhase) =>
    setConfirm({
      message:
        `Delete phase "${phase.name}"? Its requirements and milestones are removed, ` +
        `and enrolled members' progress for them is cleared. This can't be undone.`,
      run: async () => {
        if (programId) await trainingProgramService.deleteProgramPhase(programId, phase.id);
      },
    });

  const confirmRemoveRequirement = (link: ProgramRequirement) =>
    setConfirm({
      message:
        `Remove "${link.requirement?.name ?? 'this requirement'}" from the pipeline? ` +
        `Enrolled members' progress for it is cleared. This can't be undone.`,
      run: async () => {
        if (programId) await trainingProgramService.removeProgramRequirement(programId, link.id);
      },
    });

  const confirmDeleteMilestone = (m: ProgramMilestone) =>
    setConfirm({
      message: `Delete milestone "${m.name}"?`,
      run: async () => {
        if (programId) await trainingProgramService.deleteMilestone(programId, m.id);
      },
    });

  // Toggle whether a linked requirement is required to complete its phase.
  // Enrolled members' progress is recomputed server-side, so refresh nothing
  // else here — the overview is structural, not per-member.
  const handleToggleRequired = async (pr: ProgramRequirement) => {
    if (!programId) return;
    const next = !pr.is_required;
    setSavingReqId(pr.id);
    try {
      const updated = await trainingProgramService.updateProgramRequirement(programId, pr.id, {
        is_required: next,
      });
      setProgramReqs((prev) => prev.map((r) => (r.id === pr.id ? { ...r, is_required: updated.is_required } : r)));
      toast.success(next ? 'Marked as required' : 'Marked as optional');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update requirement'));
    } finally {
      setSavingReqId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-red-500" aria-hidden="true" />
          <p className="text-theme-text-muted mt-4">Loading pipeline...</p>
        </div>
      </div>
    );
  }

  if (!program) return null;

  const totalReqs = programReqs.length;
  const requiredReqs = programReqs.filter((r) => r.is_required).length;

  return (
    <div className="min-h-screen">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumbs items={[
          { label: 'Training', path: '/training' },
          { label: 'Programs', path: '/training/programs' },
          { label: program.name },
        ]} />

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-start space-x-4">
            <button
              onClick={() => navigate('/training/programs')}
              className="mt-1 p-2 text-theme-text-muted hover:text-theme-text-primary rounded-lg hover:bg-theme-surface-hover"
              aria-label="Back to programs"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <h1 className="text-2xl font-bold text-theme-text-primary">{program.name}</h1>
                {program.is_template && (
                  <span className="px-2 py-0.5 bg-green-500/20 text-green-700 dark:text-green-400 text-xs rounded-sm">Template</span>
                )}
              </div>
              {program.description && (
                <p className="text-theme-text-muted text-sm max-w-2xl mb-3">{program.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {program.code && (
                  <span className="px-2 py-0.5 bg-theme-surface text-theme-text-secondary text-xs rounded-sm font-mono">{program.code}</span>
                )}
                <StructureBadge type={program.structure_type} />
                {program.target_position && <PositionBadge position={program.target_position} />}
                {program.version > 1 && (
                  <span className="px-2 py-0.5 bg-theme-surface text-theme-text-muted text-xs rounded-sm">v{program.version}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => window.open(`/training/print/program?id=${programId}`, '_blank')}
              className="flex items-center space-x-1 px-3 py-2 bg-theme-surface text-theme-text-secondary rounded-lg hover:bg-theme-surface-hover text-sm print:hidden"
            >
              <Printer className="w-4 h-4" />
              <span>Print</span>
            </button>
            {canManage && (
              <button
                onClick={() => setShowEditProgram(true)}
                className="flex items-center space-x-1 px-3 py-2 bg-theme-surface text-theme-text-primary rounded-lg hover:bg-theme-surface-hover text-sm"
              >
                <Pencil className="w-4 h-4" />
                <span>Edit</span>
              </button>
            )}
            <button
              onClick={() => setShowEnrollModal(true)}
              className="btn-success flex items-center px-3 space-x-1 text-sm"
            >
              <UserPlus className="w-4 h-4" />
              <span>Enroll</span>
            </button>
            <button
              onClick={() => { void handleDuplicate(); }}
              disabled={isDuplicating}
              className="flex items-center space-x-1 px-3 py-2 bg-theme-surface text-theme-text-primary rounded-lg hover:bg-theme-surface-hover text-sm disabled:opacity-50"
            >
              <Copy className="w-4 h-4" />
              <span>{isDuplicating ? 'Copying...' : 'Duplicate'}</span>
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-theme-surface rounded-lg p-4">
            <div className="flex items-center space-x-2 text-theme-text-muted mb-1">
              <Layers className="w-4 h-4" />
              <span className="text-xs uppercase">Phases</span>
            </div>
            <p className="text-2xl font-bold text-theme-text-primary">{phases.length}</p>
          </div>
          <div className="bg-theme-surface rounded-lg p-4">
            <div className="flex items-center space-x-2 text-theme-text-muted mb-1">
              <ListChecks className="w-4 h-4" />
              <span className="text-xs uppercase">Requirements</span>
            </div>
            <p className="text-2xl font-bold text-theme-text-primary">{totalReqs}</p>
            <p className="text-xs text-theme-text-muted">{requiredReqs} required</p>
          </div>
          <div className="bg-theme-surface rounded-lg p-4">
            <div className="flex items-center space-x-2 text-theme-text-muted mb-1">
              <Calendar className="w-4 h-4" />
              <span className="text-xs uppercase">Time Limit</span>
            </div>
            <p className="text-2xl font-bold text-theme-text-primary">
              {program.time_limit_days ? `${program.time_limit_days}d` : '—'}
            </p>
          </div>
          <div className="bg-theme-surface rounded-lg p-4">
            <div className="flex items-center space-x-2 text-theme-text-muted mb-1">
              <Users className="w-4 h-4" />
              <span className="text-xs uppercase">Enrolled</span>
            </div>
            <p className="text-2xl font-bold text-theme-text-primary">{enrollments.length}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 bg-theme-surface p-1 rounded-lg mb-6" role="tablist">
          {[
            { key: 'overview' as DetailTab, label: 'Phases & Requirements', icon: Layers },
            { key: 'enrollments' as DetailTab, label: 'Enrollments', icon: Users },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                role="tab"
                aria-selected={activeTab === tab.key}
                className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2 rounded-md font-medium text-sm transition-colors ${
                  activeTab === tab.key
                    ? 'bg-red-600 text-white'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {phases.length === 0 ? (
              <div className="text-center py-12 bg-theme-surface rounded-lg">
                <Layers className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
                <p className="text-theme-text-muted">No phases defined for this pipeline</p>
              </div>
            ) : (
              phases
                .slice()
                .sort((a, b) => a.phase_number - b.phase_number)
                .map((phase, phaseIndex) => {
                  const phaseReqs = getPhaseReqs(phase.id);
                  const isExpanded = expandedPhases.has(phase.id);

                  return (
                    <div key={phase.id} className="bg-theme-surface rounded-lg border border-theme-surface-border">
                      {/* Phase header */}
                      <div className="flex items-center justify-between p-4">
                        <button
                          type="button"
                          className="flex items-center space-x-3 text-left flex-1 min-w-0"
                          onClick={() => togglePhase(phase.id)}
                          aria-expanded={isExpanded}
                        >
                          <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                            {phase.phase_number}
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-theme-text-primary font-medium truncate">{phase.name}</h3>
                            <div className="flex items-center space-x-3 text-xs text-theme-text-muted">
                              <span>{phaseReqs.length} requirement{phaseReqs.length !== 1 ? 's' : ''}</span>
                              {phase.time_limit_days && (
                                <span className="flex items-center space-x-1">
                                  <Clock className="w-3 h-3" />
                                  <span>{phase.time_limit_days} day limit</span>
                                </span>
                              )}
                              {phase.requires_manual_advancement && (
                                <span className="flex items-center space-x-1 text-yellow-700 dark:text-yellow-400">
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>Manual advancement</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {canManage && (
                            <>
                              <button type="button" onClick={() => void movePhase(phase, -1)} disabled={phaseIndex === 0} title="Move phase up" aria-label="Move phase up" className="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded disabled:opacity-30 disabled:hover:bg-transparent">
                                <ArrowUp className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => void movePhase(phase, 1)} disabled={phaseIndex === phases.length - 1} title="Move phase down" aria-label="Move phase down" className="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded disabled:opacity-30 disabled:hover:bg-transparent">
                                <ArrowDown className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => setPhaseModal({ phase })} title="Edit phase" aria-label="Edit phase" className="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded">
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => confirmDeletePhase(phase)} title="Delete phase" aria-label="Delete phase" className="p-1.5 text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-theme-surface-hover rounded">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          <button type="button" onClick={() => togglePhase(phase.id)} aria-label={isExpanded ? 'Collapse phase' : 'Expand phase'} className="p-1.5 text-theme-text-muted hover:bg-theme-surface-hover rounded">
                            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </button>
                        </div>
                      </div>

                      {/* Phase content */}
                      {isExpanded && (
                        <div className="border-t border-theme-surface-border p-4">
                          {phase.description && (
                            <p className="text-theme-text-muted text-sm mb-4">{phase.description}</p>
                          )}

                          {phaseReqs.length === 0 ? (
                            <p className="text-theme-text-muted text-sm text-center py-4">No requirements assigned to this phase.</p>
                          ) : (
                            <div className="space-y-2">
                              {phaseReqs.map((pr, reqIndex) => (
                                <div
                                  key={pr.id}
                                  className="bg-theme-surface-secondary rounded-lg p-3 flex items-start justify-between gap-2"
                                >
                                  <div className="flex items-start space-x-3 min-w-0">
                                    <CheckCircle2 className="w-5 h-5 text-theme-text-muted mt-0.5" />
                                    <div>
                                      <div className="flex items-center space-x-2 mb-1">
                                        <span className="text-theme-text-primary text-sm font-medium">
                                          {pr.requirement?.name || `Requirement ${pr.requirement_id.slice(0, 8)}`}
                                        </span>
                                        {pr.requirement?.requirement_type && (
                                          <ReqTypeBadge type={pr.requirement.requirement_type} />
                                        )}
                                        {canManage ? (
                                          <button
                                            type="button"
                                            onClick={() => void handleToggleRequired(pr)}
                                            disabled={savingReqId === pr.id}
                                            title={
                                              pr.is_required
                                                ? 'Required to complete the phase — click to make optional'
                                                : 'Optional — click to make it required to complete the phase'
                                            }
                                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                                              pr.is_required
                                                ? 'bg-red-500/15 text-red-700 hover:bg-red-500/25 dark:text-red-400'
                                                : 'bg-theme-surface text-theme-text-muted hover:bg-theme-surface-hover'
                                            }`}
                                          >
                                            {savingReqId === pr.id && (
                                              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                                            )}
                                            {pr.is_required ? 'Required' : 'Optional'}
                                          </button>
                                        ) : (
                                          pr.is_required && (
                                            <span className="text-red-700 dark:text-red-400 text-xs">Required</span>
                                          )
                                        )}
                                      </div>
                                      {pr.requirement?.description && (
                                        <p className="text-theme-text-muted text-xs">{pr.requirement.description}</p>
                                      )}
                                      {pr.program_specific_description && (
                                        <p className="text-theme-text-secondary text-xs mt-1 italic">{pr.program_specific_description}</p>
                                      )}
                                      <div className="flex items-center space-x-3 mt-1 text-xs text-theme-text-muted">
                                        {pr.requirement?.required_hours && (
                                          <span>{pr.requirement.required_hours}h required</span>
                                        )}
                                        {pr.requirement?.required_shifts && (
                                          <span>{pr.requirement.required_shifts} shifts</span>
                                        )}
                                        {pr.requirement?.checklist_items && (
                                          <span>{pr.requirement.checklist_items.length} items</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  {canManage && (
                                    <div className="flex items-center gap-0.5 shrink-0">
                                      <button type="button" onClick={() => void moveRequirement(pr, -1)} disabled={reqIndex === 0} title="Move up" aria-label="Move requirement up" className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded disabled:opacity-30 disabled:hover:bg-transparent">
                                        <ArrowUp className="w-4 h-4" />
                                      </button>
                                      <button type="button" onClick={() => void moveRequirement(pr, 1)} disabled={reqIndex === phaseReqs.length - 1} title="Move down" aria-label="Move requirement down" className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded disabled:opacity-30 disabled:hover:bg-transparent">
                                        <ArrowDown className="w-4 h-4" />
                                      </button>
                                      <button type="button" onClick={() => setReqModal({ phaseId: phase.id, link: pr })} title="Edit requirement" aria-label="Edit requirement" className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded">
                                        <Pencil className="w-4 h-4" />
                                      </button>
                                      <button type="button" onClick={() => confirmRemoveRequirement(pr)} title="Remove requirement" aria-label="Remove requirement" className="p-1 text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-theme-surface rounded">
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => setReqModal({ phaseId: phase.id })}
                              className="mt-3 inline-flex items-center gap-1 text-sm text-red-700 dark:text-red-400 hover:underline"
                            >
                              <Plus className="w-4 h-4" /> Add requirement
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => setPhaseModal({})}
                className="w-full flex items-center justify-center gap-1 py-3 border border-dashed border-theme-surface-border rounded-lg text-sm text-theme-text-secondary hover:bg-theme-surface-hover"
              >
                <Plus className="w-4 h-4" /> Add phase
              </button>
            )}

            {/* Milestones */}
            <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-theme-text-primary font-medium flex items-center gap-2">
                  <Flag className="w-4 h-4 text-yellow-600 dark:text-yellow-400" /> Milestones
                </h3>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setMilestoneModal({})}
                    className="inline-flex items-center gap-1 text-sm text-red-700 dark:text-red-400 hover:underline"
                  >
                    <Plus className="w-4 h-4" /> Add milestone
                  </button>
                )}
              </div>
              {milestones.length === 0 ? (
                <p className="text-theme-text-muted text-sm">No milestones defined.</p>
              ) : (
                <div className="space-y-2">
                  {milestones
                    .slice()
                    .sort((a, b) => a.completion_percentage_threshold - b.completion_percentage_threshold)
                    .map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-2 bg-theme-surface-secondary rounded-lg p-3">
                        <div className="min-w-0">
                          <p className="text-sm text-theme-text-primary truncate">{m.name}</p>
                          <p className="text-xs text-theme-text-muted">Triggers at {Math.round(m.completion_percentage_threshold)}%</p>
                        </div>
                        {canManage && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button type="button" onClick={() => setMilestoneModal({ milestone: m })} title="Edit milestone" aria-label="Edit milestone" className="p-1 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button type="button" onClick={() => confirmDeleteMilestone(m)} title="Delete milestone" aria-label="Delete milestone" className="p-1 text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-theme-surface rounded">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'enrollments' && (
          <div>
            {enrollments.length === 0 ? (
              <div className="text-center py-12 bg-theme-surface rounded-lg">
                <Users className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
                <p className="text-theme-text-muted mb-2">No members enrolled yet</p>
                <p className="text-theme-text-muted text-sm mb-4">
                  Use the Enroll button to add members to this pipeline
                </p>
                <button
                  onClick={() => setShowEnrollModal(true)}
                  className="btn-primary text-sm"
                >
                  Enroll Members
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-theme-text-muted">
                  Select a member to view and update their requirement progress.
                </p>
                {enrollments.map((enrollment) => (
                  <button
                    key={enrollment.id}
                    type="button"
                    onClick={() => setProgressEnrollment(enrollment)}
                    className="w-full bg-theme-surface rounded-lg p-4 flex items-center justify-between text-left hover:bg-theme-surface-hover transition-colors"
                    aria-label={`Manage progress for ${enrollment.user_name}`}
                  >
                    <div>
                      <p className="text-theme-text-primary font-medium">{enrollment.user_name}</p>
                      <div className="flex items-center space-x-3 text-xs text-theme-text-muted mt-1">
                        <span>Status: {enrollment.status}</span>
                        <span>{Math.round(enrollment.progress_percentage)}% complete</span>
                      </div>
                    </div>
                    <div className="w-32 bg-theme-surface-secondary rounded-full h-2">
                      <div
                        className="bg-red-500 h-2 rounded-full transition-all"
                        style={{ width: `${enrollment.progress_percentage}%` }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <EnrollModal
        isOpen={showEnrollModal}
        programId={programId || ''}
        programName={program.name}
        onClose={() => setShowEnrollModal(false)}
        onSuccess={() => { void loadEnrollments(); }}
      />

      <EnrollmentProgressModal
        isOpen={progressEnrollment !== null}
        enrollmentId={progressEnrollment?.id ?? null}
        memberName={progressEnrollment?.user_name ?? ''}
        phases={phases}
        programReqs={programReqs}
        structureType={program.structure_type}
        onClose={() => setProgressEnrollment(null)}
        onSaved={() => { void loadEnrollments(); }}
      />

      {showEditProgram && (
        <EditProgramModal program={program} onClose={() => setShowEditProgram(false)} onSaved={afterEdit} />
      )}
      {phaseModal && programId && (
        <PhaseFormModal
          programId={programId}
          phase={phaseModal.phase}
          nextPhaseNumber={phases.reduce((max, p) => Math.max(max, p.phase_number), 0) + 1}
          onClose={() => setPhaseModal(null)}
          onSaved={afterEdit}
        />
      )}
      {reqModal && programId && (
        <RequirementFormModal
          programId={programId}
          phaseId={reqModal.phaseId}
          link={reqModal.link}
          sortOrder={reqModal.phaseId ? getPhaseReqs(reqModal.phaseId).length : programReqs.length}
          onClose={() => setReqModal(null)}
          onSaved={afterEdit}
        />
      )}
      {milestoneModal && programId && (
        <MilestoneFormModal
          programId={programId}
          phases={phases}
          milestone={milestoneModal.milestone}
          onClose={() => setMilestoneModal(null)}
          onSaved={afterEdit}
        />
      )}
      <ConfirmDialog
        isOpen={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => void runConfirm()}
        message={confirm?.message ?? ''}
        confirmLabel="Delete"
        variant="danger"
        loading={confirmLoading}
      />
    </div>
  );
};

export default PipelineDetailPage;
