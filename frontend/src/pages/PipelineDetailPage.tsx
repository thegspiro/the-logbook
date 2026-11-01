import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DialogPanel } from '../components/ux/DialogPanel';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import {
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
  RotateCcw,
  EyeOff,
  Lock,
  ArchiveRestore,
} from 'lucide-react';
import { trainingProgramService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { TrainingPageHeader } from '../components/training/TrainingPageHeader';
import { ConfirmDialog } from '../components/ux/ConfirmDialog';
import { RequirementDueDate } from '../components/training/RequirementDueDate';
import { InactiveNotRequiredBadge } from '../components/training/InactiveNotRequiredBadge';
import {
  NO_ACTIVE_REQUIREMENTS_LABEL,
  NoActiveRequirementsNotice,
} from '../components/training/NoActiveRequirementsNotice';
import { MarkPipelineCompleteDialog } from '../components/training/MarkPipelineCompleteDialog';
import {
  MARK_PIPELINE_COMPLETE_LABEL,
  canMarkPipelineComplete,
  completedByHandNote,
} from '../components/training/markPipelineComplete';
import { EditProgramModal, PhaseFormModal, RequirementFormModal, MilestoneFormModal } from './PipelineEditModals';
import { enumLabel } from '../utils/displayValue';
import { getErrorDetail, getErrorMessage } from '../utils/errorHandling';
import { formatDate } from '../utils/dateFormatting';
import { formatLegalName, formatMemberName } from '../utils/memberName';
import {
  STATUS_META,
  countsTowardCompletion,
  groupRecordsByPhase,
  isPhaseGroupComplete,
  phaseHasNoActiveRequirements,
} from '../utils/pipelineProgress';
import { checklistClaimedIds, checklistDoneIds } from '../utils/checklistItems';
import { useConfirm } from '../contexts/ConfirmContext';
import { ENROLLMENT_STATUSES } from '../types/training';
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
import { useTablist } from '../hooks/useTablist';

// Format a calendar-date-only value (e.g. the recert deadline "2028-03-30")
// without a timezone shift: build it at local midnight from its Y-M-D parts so
// it never rolls back a day in western timezones.
const formatCalendarDate = (isoDate?: string): string => {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  return formatDate(new Date(y, m - 1, d));
};

// Label + colour for each eligibility status; drives the picker badges.
const ELIGIBILITY_META: Record<EligibilityStatus, { label: string; className: string }> = {
  eligible: { label: 'Eligible', className: 'text-green-700 dark:text-green-400' },
  enrolled: { label: 'Enrolled', className: 'text-theme-text-muted' },
  prerequisite: { label: 'Prerequisite', className: 'text-yellow-700 dark:text-yellow-400' },
  concurrent: { label: 'In another program', className: 'text-yellow-700 dark:text-yellow-400' },
};

// The enrollment picker names members the way the department knows them.
function eligibilityName(m: MemberEligibility): string {
  return formatMemberName(m) || 'Unknown member';
}

// ==================== Types ====================

interface ProgramDetails extends TrainingProgram {
  phases?: ProgramPhase[];
  requirements?: (ProgramRequirement | TrainingRequirementEnhanced)[];
  milestones?: ProgramMilestone[];
  total_requirements?: number;
  total_required?: number;
  no_active_requirements?: boolean;
  phases_without_active_requirements?: string[];
}

type DetailTab = 'overview' | 'phases' | 'enrollments';

// ==================== Helper Components ====================

const StructureBadge: React.FC<{ type: ProgramStructureType }> = ({ type }) => {
  const colors: Record<ProgramStructureType, string> = {
    phases: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
    sequential: 'bg-purple-500/10 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400',
    flexible: 'bg-green-500/10 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  };

  return (
    <span className={`rounded-sm px-2 py-1 text-xs ${colors[type]}`}>
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
    <span className="rounded-sm bg-red-500/20 px-2 py-1 text-xs text-red-800 dark:text-red-400">
      {labels[position] || position}
    </span>
  );
};

const ReqTypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const colors: Record<string, string> = {
    hours: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
    courses: 'bg-green-500/10 text-green-800 dark:bg-green-500/20 dark:text-green-400',
    skills_evaluation: 'bg-purple-500/10 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400',
    knowledge_test: 'bg-indigo-500/10 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400',
    checklist: 'bg-yellow-500/10 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
    certification: 'bg-pink-500/10 text-pink-700 dark:bg-pink-500/20 dark:text-pink-400',
    shifts: 'bg-orange-500/10 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400',
    calls: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  };

  const labels: Record<string, string> = {
    hours: 'Hours',
    courses: 'Courses',
    skills_evaluation: 'Skills',
    knowledge_test: 'Written test',
    checklist: 'Checklist',
    certification: 'Certification',
    shifts: 'Shifts',
    calls: 'Calls',
  };

  return (
    <span
      className={`rounded-sm px-2 py-0.5 text-xs ${colors[type] || 'bg-theme-surface-secondary text-theme-text-muted'}`}
    >
      {labels[type] || type}
    </span>
  );
};

// ==================== Requirement List ====================

/**
 * The requirements attached to one bucket of a pipeline — a phase, or the
 * program itself. Program-level requirements had no home in this page at all:
 * only phase requirements were rendered, so a flexible (phase-less) program
 * showed nothing and offered no way to add anything.
 */
const RequirementList: React.FC<{
  links: ProgramRequirement[];
  emptyLabel: string;
  canManage: boolean;
  savingReqId: string | null;
  onToggleRequired: (pr: ProgramRequirement) => Promise<void>;
  onTogglePrerequisite: (pr: ProgramRequirement) => Promise<void>;
  onMove: (pr: ProgramRequirement, dir: -1 | 1) => Promise<void>;
  onEdit: (pr: ProgramRequirement) => void;
  onRemove: (pr: ProgramRequirement) => void;
  onAdd: () => void;
}> = ({
  links,
  emptyLabel,
  canManage,
  savingReqId,
  onToggleRequired,
  onTogglePrerequisite,
  onMove,
  onEdit,
  onRemove,
  onAdd,
}) => (
  <>
    {links.length === 0 ? (
      <p className="text-theme-text-muted py-4 text-center text-sm">{emptyLabel}</p>
    ) : (
      <div className="space-y-2">
        {links.map((pr, reqIndex) => (
          <div key={pr.id} className="bg-theme-surface-secondary flex items-start justify-between gap-2 rounded-lg p-3">
            <div className="flex min-w-0 items-start space-x-3">
              <CheckCircle2 className="text-theme-text-muted mt-0.5 h-5 w-5" />
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-theme-text-primary text-sm font-medium">
                    {pr.requirement?.name || `Requirement ${pr.requirement_id.slice(0, 8)}`}
                  </span>
                  {pr.requirement?.requirement_type && <ReqTypeBadge type={pr.requirement.requirement_type} />}
                  {pr.requirement?.active === false && <InactiveNotRequiredBadge />}
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => void onToggleRequired(pr)}
                      disabled={savingReqId === pr.id}
                      title={
                        pr.is_required
                          ? 'Required to finish — click to make optional'
                          : 'Optional — click to make it required to finish'
                      }
                      className={`inline-flex min-h-6 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        pr.is_required
                          ? 'bg-red-500/15 text-red-700 hover:bg-red-500/25 dark:text-red-400'
                          : 'bg-theme-surface text-theme-text-muted hover:bg-theme-surface-hover'
                      }`}
                    >
                      {savingReqId === pr.id && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                      {pr.is_required ? 'Required' : 'Optional'}
                    </button>
                  ) : (
                    pr.is_required && <span className="text-xs text-red-700 dark:text-red-400">Required</span>
                  )}
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => void onTogglePrerequisite(pr)}
                      disabled={savingReqId === pr.id}
                      title={
                        pr.is_prerequisite
                          ? 'Must be finished before the other items in this stage — click to unlock them'
                          : 'Click to make members finish this before the other items in this stage'
                      }
                      className={`inline-flex min-h-6 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        pr.is_prerequisite
                          ? 'bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:text-amber-400'
                          : 'bg-theme-surface text-theme-text-muted hover:bg-theme-surface-hover'
                      }`}
                    >
                      <Lock className="h-3 w-3" aria-hidden="true" />
                      {pr.is_prerequisite ? 'Do this first' : 'Any order'}
                    </button>
                  ) : (
                    pr.is_prerequisite && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        Do this first
                      </span>
                    )
                  )}
                </div>
                {pr.requirement?.description && (
                  <p className="text-theme-text-muted text-xs">{pr.requirement.description}</p>
                )}
                {pr.program_specific_description && (
                  <p className="text-theme-text-secondary mt-1 text-xs italic">{pr.program_specific_description}</p>
                )}
                {(pr.custom_deadline_days != null || pr.notification_message) && (
                  <div className="text-theme-text-muted mt-1 flex flex-wrap items-center gap-x-3 text-xs">
                    {pr.custom_deadline_days != null && (
                      <span>Due {pr.custom_deadline_days} days after enrollment</span>
                    )}
                    {pr.notification_message && <span>Completion message set</span>}
                  </div>
                )}
                <div className="text-theme-text-muted mt-1 flex items-center space-x-3 text-xs">
                  {pr.requirement?.required_hours && <span>{pr.requirement.required_hours}h required</span>}
                  {pr.requirement?.required_shifts && (
                    <span>
                      {pr.requirement.required_shifts}{' '}
                      {pr.requirement.requirement_type === 'evaluated_shifts' ? 'evaluated shifts' : 'shifts'}
                    </span>
                  )}
                  {pr.requirement?.required_transports && <span>{pr.requirement.required_transports} transports</span>}
                  {pr.requirement?.required_refusals && <span>{pr.requirement.required_refusals} refusals</span>}
                  {pr.requirement?.checklist_items && <span>{pr.requirement.checklist_items.length} items</span>}
                  {pr.requirement?.recency_days != null && <span>within last {pr.requirement.recency_days}d</span>}
                  {pr.requirement?.required_courses?.length ? (
                    <span>
                      {pr.requirement.required_courses.length} course
                      {pr.requirement.required_courses.length === 1 ? '' : 's'} linked
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            {canManage && (
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => void onMove(pr, -1)}
                  disabled={reqIndex === 0}
                  title="Move up"
                  aria-label="Move requirement up"
                  className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded p-1 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void onMove(pr, 1)}
                  disabled={reqIndex === links.length - 1}
                  title="Move down"
                  aria-label="Move requirement down"
                  className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded p-1 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(pr)}
                  title="Edit requirement"
                  aria-label="Edit requirement"
                  className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded p-1"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(pr)}
                  title="Remove requirement"
                  aria-label="Remove requirement"
                  className="text-theme-text-muted hover:bg-theme-surface rounded p-1 hover:text-red-600 dark:hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
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
        onClick={onAdd}
        className="mt-3 inline-flex items-center gap-1 text-sm text-red-700 hover:underline dark:text-red-400"
      >
        <Plus className="h-4 w-4" /> Add requirement
      </button>
    )}
  </>
);

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
    return () => {
      cancelled = true;
    };
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
        formatLegalName(m).toLowerCase().includes(q) ||
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
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="enroll-members-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <DialogPanel onClose={onClose} className="flex max-h-[90dvh] w-full max-w-lg flex-col">
        <div className="border-theme-surface-border border-b p-6">
          <h2 id="enroll-members-title" className="text-theme-text-primary text-xl font-bold">
            Enroll Members
          </h2>
          <p className="text-theme-text-muted mt-1 text-sm">Enroll members into {programName}</p>
        </div>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4 overflow-y-auto p-6"
        >
          {/* Selected chips */}
          {selected.size > 0 && (
            <div className="flex flex-wrap gap-2">
              {Array.from(selected.entries()).map(([id, name]) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-1 text-xs text-red-700 dark:text-red-400"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((prev) => {
                        const n = new Map(prev);
                        n.delete(id);
                        return n;
                      })
                    }
                    aria-label={`Remove ${name}`}
                    className="hover:text-red-900 dark:hover:text-red-200"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
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
              <label className="text-theme-text-secondary inline-flex cursor-pointer items-center gap-2 select-none">
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
          <div className="border-theme-surface-border max-h-64 overflow-y-auto rounded-lg border">
            {loadingMembers ? (
              <div
                className="text-theme-text-muted flex items-center justify-center py-8"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span className="text-sm">Loading members...</span>
              </div>
            ) : membersError ? (
              <div className="p-3 text-sm text-red-600 dark:text-red-400">{membersError}</div>
            ) : filtered.length === 0 ? (
              <div className="text-theme-text-muted px-4 py-8 text-center text-sm">
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
                    aria-pressed={isSelected}
                    className={`border-theme-surface-border flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm transition-colors last:border-b-0 ${
                      !m.eligible ? 'cursor-not-allowed' : isSelected ? 'bg-red-500/10' : 'hover:bg-theme-surface-hover'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className={`truncate ${m.eligible ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}>
                        {eligibilityName(m)}
                        {m.membership_number && (
                          <span className="text-theme-text-muted ml-2 text-xs">#{m.membership_number}</span>
                        )}
                      </span>
                      {m.reason && (
                        // Advisory (amber) for eligible-but-flagged members,
                        // muted for hard-ineligible ones.
                        <p
                          className={`mt-0.5 text-xs ${m.eligible ? 'text-yellow-700 dark:text-yellow-400' : 'text-theme-text-muted'}`}
                        >
                          {m.reason}
                        </p>
                      )}
                    </div>
                    {m.eligible ? (
                      isSelected ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                      ) : (
                        <Circle className="text-theme-text-muted h-4 w-4 shrink-0" />
                      )
                    ) : (
                      <span className={`shrink-0 text-xs ${meta.className}`}>{meta.label}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div>
            <label htmlFor="enroll-target-date" className="text-theme-text-secondary mb-1 block text-sm font-medium">
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
              className="bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover rounded-lg px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary text-sm" disabled={isSubmitting || selected.size === 0}>
              {isSubmitting
                ? 'Enrolling...'
                : `Enroll ${selected.size || ''} Member${selected.size === 1 ? '' : 's'}`.trim()}
            </button>
          </div>
        </form>
      </DialogPanel>
    </div>
  );
};

// ==================== Enrollment Progress Modal ====================

// Requirement types whose progress is a numeric accrual (log a value); all
// other types (courses, certification, checklist, knowledge test, skills) are
// completed by setting status.
const NUMERIC_TYPES = new Set(['hours', 'shifts', 'calls', 'courses', 'evaluated_shifts', 'transports', 'refusals']);

// Requirement types an officer scores by entering a percentage; pass/fail is
// derived from the requirement's passing_score. Groundwork for a fuller
// knowledge-test feature later.
const SCORED_TYPES = new Set(['knowledge_test']);

function requirementTarget(req?: TrainingRequirementEnhanced): { value: number; label: string } | null {
  if (!req) return null;
  if (req.requirement_type === 'hours' && req.required_hours) return { value: req.required_hours, label: 'hours' };
  if (req.requirement_type === 'shifts' && req.required_shifts) return { value: req.required_shifts, label: 'shifts' };
  if (req.requirement_type === 'calls' && req.required_calls) return { value: req.required_calls, label: 'calls' };
  if (req.requirement_type === 'evaluated_shifts' && req.required_shifts)
    return { value: req.required_shifts, label: 'evaluated shifts' };
  if (req.requirement_type === 'transports' && req.required_transports)
    return { value: req.required_transports, label: 'transports' };
  if (req.requirement_type === 'refusals' && req.required_refusals)
    return { value: req.required_refusals, label: 'refusals' };
  if (req.requirement_type === 'courses' && req.required_courses?.length)
    return { value: req.required_courses.length, label: 'courses' };
  return null;
}

const RequirementProgressRow: React.FC<{
  record: RequirementProgressRecord;
  /** Resolves true when the update was persisted, false when it was refused. */
  onUpdate: (progressId: string, updates: RequirementProgressUpdate) => Promise<boolean>;
  onReset: (progressId: string, requirementName: string) => Promise<void>;
  saving: boolean;
}> = ({ record, onUpdate, onReset, saving }) => {
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

  const checklistItems = req?.requirement_type === 'checklist' ? (req.checklist_items ?? []) : [];
  const doneIds = checklistDoneIds(record);
  const claimedIds = checklistClaimedIds(record);

  const toggleChecklistItem = (itemId: string) => {
    // The whole set goes back, not a single toggle — a retry or a second
    // officer on the same record then cannot leave a step half-applied.
    const next = doneIds.includes(itemId) ? doneIds.filter((id) => id !== itemId) : [...doneIds, itemId];
    void onUpdate(record.id, { checklist_done: next });
  };

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
    // Clearing the box unconditionally wiped the score the evaluator had just
    // typed even when the save was refused, leaving them to read it off the
    // toast and retype it. `saved` is false when handleUpdate caught the error.
    void onUpdate(record.id, { test_score: parsed }).then((saved) => {
      if (saved) setScore('');
    });
  };

  return (
    <div className="bg-theme-surface-secondary rounded-lg p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-theme-text-primary text-sm font-medium">{req?.name || 'Requirement'}</span>
          {req?.requirement_type && <ReqTypeBadge type={req.requirement_type} />}
          {record.verified_by && (
            <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
              <BadgeCheck className="h-3.5 w-3.5" /> Verified
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className={statusMeta.className}>{statusMeta.label}</span>
          {record.requirement?.active === false && <InactiveNotRequiredBadge />}
          <span className="text-theme-text-muted">· {Math.round(record.progress_percentage)}%</span>
          {target && (
            <span className="text-theme-text-muted">
              · target {target.value} {target.label}
            </span>
          )}
          <RequirementDueDate
            dueDate={record.due_date}
            isOverdue={record.is_overdue}
            done={isDone || record.status === 'waived'}
          />
        </div>
      </div>

      {/* A linked department requirement is the member's compliance result.
          Nothing here changes it but a waiver; offering the editors would
          offer controls the server refuses. */}
      {record.reads_compliance && (
        <div className="mt-3 space-y-2">
          <p className="text-theme-text-muted text-xs">
            {record.status === 'waived'
              ? 'Waived for this program.'
              : `Read from the member's training record, as the compliance screens grade it${
                  target ? ` (${record.progress_value} of ${target.value} ${target.label})` : ''
                }. Record the training to move it.`}
          </p>
          <button
            type="button"
            onClick={() => {
              void onUpdate(record.id, { status: record.status === 'waived' ? 'not_started' : 'waived' });
            }}
            disabled={saving}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-2 py-1 text-xs disabled:opacity-40"
          >
            {record.status === 'waived' ? 'Lift waiver' : 'Waive for this program'}
          </button>
        </div>
      )}

      {/* Numeric value editor (hours / shifts / calls) */}
      {numeric && !record.reads_compliance && (
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <label className="text-theme-text-muted mb-1 block text-xs">Logged {target?.label ?? 'value'}</label>
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
            onClick={() => {
              void onUpdate(record.id, { progress_value: value ? parseFloat(value) : 0 });
            }}
            disabled={saving}
            className="btn-primary flex items-center gap-1 px-3 text-xs disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> Save
          </button>
        </div>
      )}

      {/* Checklist steps: signed off one at a time, so the member watches the
          requirement fill up instead of waiting on a single all-or-nothing tick. */}
      {checklistItems.length > 0 && !record.reads_compliance && (
        <div className="mt-3 space-y-1.5">
          {checklistItems.map((item) => {
            const checked = doneIds.includes(item.id);
            return (
              <label key={item.id} className="text-theme-text-secondary flex cursor-pointer items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={saving}
                  onChange={() => toggleChecklistItem(item.id)}
                  className="form-checkbox mt-0.5 shrink-0"
                />
                <span className={checked ? 'text-theme-text-muted line-through' : ''}>{item.text}</span>
                {!checked && claimedIds.includes(item.id) && (
                  <span className="rounded-sm bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-700 dark:text-blue-400">
                    Member reported complete — validate
                  </span>
                )}
                {!item.member_visible && (
                  <span
                    title="Officer-only — the member does not see this step"
                    className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-400"
                  >
                    <EyeOff className="h-3 w-3" aria-hidden="true" /> Officer only
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}

      {/* Test score entry (knowledge test): officer enters a %, pass/fail derived */}
      {scored && !record.reads_compliance && (
        <div className="mt-3 space-y-2">
          {typeof latestScore === 'number' && (
            <div className="text-theme-text-muted text-xs">
              Last score:{' '}
              <span className={latestPassed ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                {latestScore}% ({latestPassed ? 'pass' : 'fail'})
              </span>
            </div>
          )}
          {maxAttempts && (
            <div className="text-theme-text-muted text-xs">
              Attempts: {attemptsUsed} / {maxAttempts}
              {attemptsExhausted && <span className="text-red-700 dark:text-red-400"> · no attempts remaining</span>}
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-theme-text-muted mb-1 block text-xs">
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
              className="btn-primary flex items-center gap-1 px-3 text-xs disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> Record
            </button>
          </div>
        </div>
      )}

      {/* Status quick actions — simple pass (Mark complete) / reopen */}
      {!record.reads_compliance && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void onUpdate(record.id, { status: 'in_progress' });
            }}
            disabled={saving || record.status === 'in_progress'}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-2 py-1 text-xs disabled:opacity-40"
          >
            <Clock className="mr-1 inline h-3.5 w-3.5" /> In progress
          </button>
          <button
            type="button"
            onClick={() => {
              void onUpdate(record.id, { status: 'completed' });
            }}
            disabled={saving || isDone}
            className="rounded-md border border-green-600/40 px-2 py-1 text-xs text-green-700 hover:bg-green-500/10 disabled:opacity-40 dark:text-green-400"
          >
            <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> Mark complete
          </button>
          {isDone && (
            <button
              type="button"
              onClick={() => {
                void onUpdate(record.id, { status: 'not_started' });
              }}
              disabled={saving}
              className="border-theme-surface-border text-theme-text-muted hover:bg-theme-surface-hover rounded-md border px-2 py-1 text-xs disabled:opacity-40"
            >
              <Circle className="mr-1 inline h-3.5 w-3.5" /> Reopen
            </button>
          )}
          {record.status !== 'not_started' && (
            <button
              type="button"
              onClick={() => {
                void onReset(record.id, req?.name ?? 'this requirement');
              }}
              disabled={saving}
              title="Reset accumulated progress for a new cycle"
              className="border-theme-surface-border text-theme-text-muted hover:bg-theme-surface-hover rounded-md border px-2 py-1 text-xs disabled:opacity-40"
            >
              <RotateCcw className="mr-1 inline h-3.5 w-3.5" /> Reset
            </button>
          )}
        </div>
      )}
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
  /** training.manage — the only grant the manual completion endpoint accepts. */
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}> = ({ isOpen, enrollmentId, memberName, phases, programReqs, structureType, canManage, onClose, onSaved }) => {
  const { confirm } = useConfirm();
  const [completing, setCompleting] = useState(false);
  const [data, setData] = useState<MemberProgramProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [resettingCycle, setResettingCycle] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [newDeadline, setNewDeadline] = useState('');

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
    if (!isOpen) {
      setData(null);
      setError(null);
    }
  }, [isOpen, enrollmentId, load]);

  const handleUpdate = async (progressId: string, updates: RequirementProgressUpdate): Promise<boolean> => {
    setSavingId(progressId);
    try {
      await trainingProgramService.updateProgress(progressId, updates);
      await load(); // pull recalculated percentages/status (may auto-advance the phase)
      onSaved(); // refresh the outer enrollments list (overall %, completion)
      return true;
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update progress'));
      return false;
    } finally {
      setSavingId(null);
    }
  };

  // The server's verdicts (an empty required set completes nobody). A
  // finished enrollment keeps the figure it finished with.
  const noActiveRequirements =
    data?.no_active_requirements === true &&
    (data.enrollment.status === 'active' || data.enrollment.status === 'on_hold');
  const phasesWithoutActive = new Set(data?.phases_without_active_requirements ?? []);
  // A phase whose required items are all inactive never completes, so the
  // advance-phase endpoint would refuse it; the officer's advance is the
  // by-hand move the notice offers, sent as the endpoint's audited override.
  const currentPhaseHasNoActive =
    !!data?.enrollment.current_phase_id && phasesWithoutActive.has(data.enrollment.current_phase_id);

  const handleAdvance = async () => {
    if (!enrollmentId) return;
    setAdvancing(true);
    try {
      await (currentPhaseHasNoActive
        ? trainingProgramService.advancePhase(enrollmentId, true)
        : trainingProgramService.advancePhase(enrollmentId));
      toast.success('Advanced to the next phase');
      await load();
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to advance phase'));
    } finally {
      setAdvancing(false);
    }
  };

  const handleReset = async (progressId: string, requirementName: string) => {
    if (
      !(await confirm({
        title: 'Reset this requirement?',
        message: `"${requirementName}" goes back to not-started and the progress accumulated against it is cleared for a new cycle.`,
        confirmLabel: 'Reset',
        cancelLabel: 'Leave it',
        variant: 'warning',
      }))
    )
      return;
    setSavingId(progressId);
    try {
      await trainingProgramService.resetProgress(progressId);
      await load();
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reset requirement'));
    } finally {
      setSavingId(null);
    }
  };

  const handleResetCycle = async () => {
    if (!enrollmentId) return;
    if (
      !(await confirm({
        title: 'Start a new cycle?',
        message: `Every requirement resets to not-started for ${memberName} and they return to the first phase.`,
        confirmLabel: 'Start new cycle',
        cancelLabel: 'Leave it',
        variant: 'warning',
      }))
    )
      return;
    setResettingCycle(true);
    try {
      await trainingProgramService.resetEnrollment(enrollmentId);
      toast.success('Started a new cycle');
      await load();
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reset enrollment'));
    } finally {
      setResettingCycle(false);
    }
  };

  const handleReopen = async () => {
    if (!enrollmentId) return;
    setReopening(true);
    try {
      await trainingProgramService.reopenEnrollment(enrollmentId, newDeadline);
      toast.success(newDeadline ? 'Reopened with a new deadline' : 'Enrollment reopened');
      setNewDeadline('');
      await load();
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reopen this enrollment'));
    } finally {
      setReopening(false);
    }
  };

  if (!isOpen) return null;

  const phased = structureType === 'phases' && phases.length > 0;
  const overall = data ? Math.round(data.enrollment.progress_percentage) : 0;

  const orderedPhases = [...phases].sort((a, b) => a.phase_number - b.phase_number);
  const currentIdx = data ? orderedPhases.findIndex((p) => p.id === data.enrollment.current_phase_id) : -1;
  // No current phase (idx -1) but phases exist → the first phase is still "next".
  const hasNextPhase = orderedPhases.length > 0 && currentIdx < orderedPhases.length - 1;

  const byHandNote = completedByHandNote(data?.enrollment, canManage);

  const groups = data && phased ? groupRecordsByPhase(data.requirement_progress, phases, programReqs) : [];

  // A sibling of the panel, not a child: a portal still bubbles React key
  // events to its tree parent, and this panel closes on Escape.
  return (
    <>
      <div
        className="modal-overlay z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-progress-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <DialogPanel onClose={onClose} className="flex max-h-[90dvh] w-full max-w-2xl flex-col">
          <div className="border-theme-surface-border border-b p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 id="member-progress-title" className="text-theme-text-primary text-xl font-bold">
                  Progress — {memberName}
                </h2>
                {data && (
                  <p className="text-theme-text-muted mt-1 text-sm">
                    {noActiveRequirements
                      ? NO_ACTIVE_REQUIREMENTS_LABEL
                      : `${data.completed_requirements}/${data.total_requirements} requirements · ${overall}% overall`}
                  </p>
                )}
                {byHandNote && <p className="text-theme-text-muted mt-1 text-xs break-words">{byHandNote}</p>}
                {phased && data?.current_phase && (
                  <p className="text-theme-text-muted mt-1 text-xs">
                    Current phase: <span className="text-theme-text-secondary">{data.current_phase.name}</span>
                  </p>
                )}
                {data?.enrollment.next_recert_reset_at && (
                  <p className="text-theme-text-muted mt-1 inline-flex items-center gap-1 text-xs">
                    <RotateCcw className="h-3 w-3" />
                    Auto-resets{' '}
                    <span className="text-theme-text-secondary">
                      {formatCalendarDate(data.enrollment.next_recert_reset_at)}
                    </span>
                  </p>
                )}
              </div>
              <button
                data-dialog-close
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="text-theme-text-muted hover:text-theme-text-primary p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* An expired enrollment is a dead end without a way back: the member
              cannot make progress and the officer has nothing to act on. */}
            {noActiveRequirements && (
              <div className="mt-3">
                <NoActiveRequirementsNotice scope="pipeline" audience="officer" />
              </div>
            )}
            {data?.enrollment.status === 'expired' && (
              <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Deadline passed — this enrollment expired at {overall}% complete.
                </p>
                {canManage && (
                  <p className="text-theme-text-secondary mt-1 text-xs">
                    Reopening keeps everything {memberName} has already finished. Give them a new deadline, or reopen on
                    the old one.
                  </p>
                )}
                {canManage && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div>
                      <label htmlFor="reopen-deadline" className="text-theme-text-muted mb-1 block text-xs">
                        New deadline (optional)
                      </label>
                      <input
                        id="reopen-deadline"
                        type="date"
                        value={newDeadline}
                        onChange={(e) => setNewDeadline(e.target.value)}
                        className="form-input-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void handleReopen();
                      }}
                      disabled={reopening}
                      className="btn-primary px-3 text-xs disabled:opacity-50"
                    >
                      {reopening ? 'Reopening...' : 'Reopen enrollment'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Advance, reset and reopen all require training.manage on the server;
              a member who can only view progress is not offered them. */}
            {canManage && (
              <div className="mt-3 flex flex-wrap gap-2">
                {phased && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleAdvance();
                    }}
                    disabled={!data || !hasNextPhase || advancing}
                    className="btn-primary flex items-center gap-1 px-3 text-xs disabled:opacity-50"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    {advancing ? 'Advancing...' : hasNextPhase ? 'Advance to next phase' : 'Final phase reached'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void handleResetCycle();
                  }}
                  disabled={!data || resettingCycle}
                  title="Reset every requirement and return to the first phase — for a new recert cycle"
                  className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex items-center gap-1 rounded-lg border px-3 py-2 text-xs disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {resettingCycle ? 'Resetting...' : 'Start new cycle'}
                </button>
                {canMarkPipelineComplete(data?.enrollment.status) && (
                  <button
                    type="button"
                    onClick={() => setCompleting(true)}
                    className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex items-center gap-1 rounded-lg border px-3 py-2 text-xs"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {MARK_PIPELINE_COMPLETE_LABEL}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4 overflow-y-auto p-6">
            {loading ? (
              <div
                className="text-theme-text-muted flex items-center justify-center py-10"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                <span className="text-sm">Loading progress...</span>
              </div>
            ) : error ? (
              <div className="p-3 text-sm text-red-600 dark:text-red-400">{error}</div>
            ) : !data || data.requirement_progress.length === 0 ? (
              <div className="text-theme-text-muted py-10 text-center text-sm">
                No requirements to track for this enrollment.
              </div>
            ) : phased ? (
              groups.map((group) => {
                const isCurrent = !!group.phase && data.enrollment.current_phase_id === group.phase.id;
                const phaseNoActive = !!group.phase && phasesWithoutActive.has(group.phase.id);
                const complete = !phaseNoActive && isPhaseGroupComplete(group.records, programReqs);
                return (
                  <div key={group.phase?.id ?? 'program-level'} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-theme-text-primary text-sm font-semibold">
                        {group.phase ? `Phase ${group.phase.phase_number}: ${group.phase.name}` : 'Program-level'}
                      </h3>
                      {isCurrent && (
                        <span className="rounded-sm bg-red-500/15 px-2 py-0.5 text-xs text-red-700 dark:text-red-400">
                          Current phase
                        </span>
                      )}
                      {complete && (
                        <CheckCircle2
                          className="h-4 w-4 text-green-700 dark:text-green-400"
                          aria-label="Phase complete"
                        />
                      )}
                      {group.phase?.requires_manual_advancement && (
                        <span className="inline-flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-400">
                          <AlertTriangle className="h-3.5 w-3.5" /> Manual advancement
                        </span>
                      )}
                    </div>
                    {phaseNoActive && <NoActiveRequirementsNotice scope="phase" audience="officer" />}
                    <div className="space-y-2">
                      {group.records.map((record) => (
                        <RequirementProgressRow
                          key={record.id}
                          record={record}
                          onUpdate={handleUpdate}
                          onReset={handleReset}
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
                  onReset={handleReset}
                  saving={savingId === record.id}
                />
              ))
            )}
          </div>

          <div className="border-theme-surface-border flex justify-end border-t p-4">
            <button
              type="button"
              onClick={onClose}
              className="bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover rounded-lg px-4 py-2 text-sm"
            >
              Done
            </button>
          </div>
        </DialogPanel>
      </div>
      <MarkPipelineCompleteDialog
        enrollmentId={completing ? enrollmentId : null}
        memberName={memberName}
        onClose={() => setCompleting(false)}
        onCompleted={async () => {
          await load();
          onSaved();
        }}
      />
    </>
  );
};

// ==================== Main Page ====================

const PipelineDetailPage: React.FC = () => {
  const tablist = useTablist();
  const { programId } = useParams<{ programId: string }>();
  const navigate = useNavigate();

  const [program, setProgram] = useState<ProgramDetails | null>(null);
  const [phases, setPhases] = useState<ProgramPhase[]>([]);
  const [programReqs, setProgramReqs] = useState<ProgramRequirement[]>([]);
  const [enrollments, setEnrollments] = useState<ProgramEnrollmentWithUser[]>([]);
  // The list endpoint has always taken a status, but nothing on this tab asked
  // for one — so an officer looking for the enrollments that ran out of time
  // had to read every row.
  const [enrollmentStatus, setEnrollmentStatus] = useState('');
  const [loading, setLoading] = useState(true);
  // ?tab=enrollments is what the training notifications sent to a mentor link
  // to, so the tab has to be selectable from the URL.
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<DetailTab>(
    searchParams.get('tab') === 'enrollments' ? 'enrollments' : 'overview'
  );
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [progressEnrollment, setProgressEnrollment] = useState<ProgramEnrollmentWithUser | null>(null);
  const [completeTarget, setCompleteTarget] = useState<ProgramEnrollmentWithUser | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [savingReqId, setSavingReqId] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<ProgramMilestone[]>([]);
  const canManage = useAuthStore((s) => s.checkPermission('training.manage'));
  // The enrollment list answers only to training.view_all or training.manage.
  // A member without either was sent it anyway, twice, took the 403 as an
  // empty list, and read "Enrolled 0" on a program people were enrolled in.
  const canViewEnrollments = useAuthStore(
    (s) => s.checkPermission('training.view_all') || s.checkPermission('training.manage')
  );

  // Editor modal + confirm state.
  const [showEditProgram, setShowEditProgram] = useState(false);
  const [phaseModal, setPhaseModal] = useState<{ phase?: ProgramPhase } | null>(null);
  const [reqModal, setReqModal] = useState<{ phaseId: string | null; link?: ProgramRequirement } | null>(null);
  const [milestoneModal, setMilestoneModal] = useState<{ milestone?: ProgramMilestone } | null>(null);
  const [confirm, setConfirm] = useState<{
    message: string;
    title?: string;
    confirmLabel?: string;
    run: () => Promise<void>;
    after?: () => void;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  // `confirm` above is this page's own dialog state; reactivation goes through
  // the shared promise-based dialog instead.
  const { confirm: askConfirm } = useConfirm();
  const [isReactivating, setIsReactivating] = useState(false);

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
      void navigate('/training/programs');
    } finally {
      setLoading(false);
    }
    // Load enrollments alongside the program so the "Enrolled" stat is accurate.
    void loadEnrollments();
  };

  const loadEnrollments = async () => {
    if (!programId || !canViewEnrollments) return;
    try {
      const data = await trainingProgramService.getProgramEnrollments(programId, enrollmentStatus || undefined);
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
  }, [activeTab, enrollmentStatus]);

  const handleDuplicate = async () => {
    if (!programId || !program) return;
    setIsDuplicating(true);
    try {
      const newProgram = await trainingProgramService.duplicateProgram(programId, `${program.name} (Copy)`);
      toast.success('Pipeline duplicated');
      void navigate(`/training/programs/${newProgram.id}`);
    } catch (err: unknown) {
      const msg = getErrorDetail(err) || 'Failed to duplicate pipeline';
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

  // Requirements for one phase, or — with null — the ones attached to the
  // program itself rather than to any phase.
  const getPhaseReqs = (phaseId: string | null) =>
    programReqs.filter((r) => (r.phase_id ?? null) === phaseId).sort((a, b) => a.sort_order - b.sort_order);

  const programLevelReqs = getPhaseReqs(null);

  const afterEdit = () => {
    setShowEditProgram(false);
    setPhaseModal(null);
    setReqModal(null);
    setMilestoneModal(null);
    void loadProgram();
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const after = confirm.after;
    setConfirmLoading(true);
    try {
      await confirm.run();
      setConfirm(null);
      // A destructive action can navigate away (e.g. delete the whole pipeline);
      // otherwise just refresh the current view.
      if (after) after();
      else void loadProgram();
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
      await trainingProgramService.reorderProgramPhases(
        programId,
        ordered.map((p) => p.id)
      );
      void loadProgram();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reorder phases'));
    }
  };

  const moveRequirement = async (link: ProgramRequirement, dir: -1 | 1) => {
    if (!programId) return;
    const ordered = getPhaseReqs(link.phase_id ?? null);
    const i = ordered.findIndex((r) => r.id === link.id);
    const j = i + dir;
    const a = ordered[i];
    const b = ordered[j];
    if (!a || !b) return;
    ordered[i] = b;
    ordered[j] = a;
    try {
      await trainingProgramService.reorderProgramRequirements(
        programId,
        ordered.map((r) => r.id)
      );
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

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // The backend deactivates a pipeline anyone has graduated from instead of
  // deleting it (graduations are history), and withdraws whoever is still in
  // progress. Which one happens depends on every enrollment, not the
  // status-filtered list the Enrollments tab may be showing, so fetch them
  // unfiltered before asking.
  const confirmDeleteProgram = async () => {
    if (!program || !programId) return;
    const all: ProgramEnrollmentWithUser[] | null = await trainingProgramService
      .getProgramEnrollments(programId)
      .catch(() => null);
    const graduates = all?.filter((e) => e.status === 'completed').length ?? 0;
    const inProgress = all?.filter((e) => e.status === 'active' || e.status === 'on_hold').length ?? 0;

    if (all === null) {
      setConfirm({
        title: 'Delete pipeline',
        confirmLabel: 'Delete pipeline',
        message:
          `Delete "${program.name}"? If any member has graduated from it, it is deactivated instead of ` +
          `deleted: it leaves the pipeline list, every enrollment is kept, and members still in progress ` +
          `are withdrawn. Otherwise its phases, requirements, milestones and enrollments are permanently ` +
          `deleted, which can't be undone.`,
        run: async () => {
          await trainingProgramService.deleteProgram(programId);
          toast.success('Pipeline deleted, or deactivated if anyone had graduated from it');
        },
        after: () => void navigate('/training/programs'),
      });
      return;
    }

    if (graduates > 0) {
      const withdrawNote =
        inProgress > 0 ? ` The ${plural(inProgress, 'member')} still in progress will be withdrawn from it.` : '';
      setConfirm({
        title: 'Deactivate pipeline',
        confirmLabel: 'Deactivate pipeline',
        message:
          `"${program.name}" has ${plural(graduates, 'graduate')}, so it is deactivated instead of deleted: ` +
          `it leaves the pipeline list, and its phases, requirements and every enrollment are kept as ` +
          `the record of who finished it.${withdrawNote}`,
        run: async () => {
          await trainingProgramService.deleteProgram(programId);
          toast.success('Pipeline deactivated');
        },
        after: () => void navigate('/training/programs'),
      });
      return;
    }

    const enrolledNote =
      all.length > 0
        ? ` This pipeline has ${plural(all.length, 'enrolled member')} — their progress will be permanently deleted.`
        : '';
    setConfirm({
      title: 'Delete pipeline',
      confirmLabel: 'Delete pipeline',
      message:
        `Permanently delete "${program.name}"? Its phases, requirements, milestones, ` +
        `and all enrollments are removed.${enrolledNote} This can't be undone.`,
      run: async () => {
        await trainingProgramService.deleteProgram(programId);
        toast.success('Pipeline deleted');
      },
      after: () => void navigate('/training/programs'),
    });
  };

  // A deactivated pipeline is reached from the list's "Show inactive" view.
  // Reactivating restores the flag only: the backend leaves enrollments it
  // withdrew on deactivation withdrawn, so the dialog says so.
  const handleReactivateProgram = async () => {
    if (!program || !programId) return;
    const confirmed = await askConfirm({
      title: 'Reactivate pipeline',
      message:
        `Reactivate "${program.name}"? It returns to the pipeline list and members can be enrolled in it again. ` +
        `Members who were withdrawn when it was deactivated are not re-enrolled; enroll them again if they should continue.`,
      confirmLabel: 'Reactivate',
      cancelLabel: 'Leave inactive',
      variant: 'info',
    });
    if (!confirmed) return;
    setIsReactivating(true);
    try {
      await trainingProgramService.updateProgram(programId, { active: true });
      toast.success(`${program.name} reactivated`);
      await loadProgram();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reactivate pipeline'));
    } finally {
      setIsReactivating(false);
    }
  };

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

  const handleTogglePrerequisite = async (pr: ProgramRequirement) => {
    if (!programId) return;
    const next = !pr.is_prerequisite;
    setSavingReqId(pr.id);
    try {
      const updated = await trainingProgramService.updateProgramRequirement(programId, pr.id, {
        is_prerequisite: next,
      });
      setProgramReqs((prev) =>
        prev.map((r) => (r.id === pr.id ? { ...r, is_prerequisite: updated.is_prerequisite } : r))
      );
      toast.success(next ? 'Members must finish this before the rest of this stage' : 'No longer a prerequisite');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update requirement'));
    } finally {
      setSavingReqId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <div className="text-center">
          <div
            className="inline-block h-10 w-10 animate-spin rounded-full border-b-2 border-red-500"
            aria-hidden="true"
          />
          <p className="text-theme-text-muted mt-4">Loading pipeline...</p>
        </div>
      </div>
    );
  }

  if (!program) return null;

  const totalReqs = programReqs.length;
  // Required *and active*: the backend does not count a deactivated
  // requirement toward finishing the pipeline while it stays inactive.
  const requiredReqs = programReqs.filter(countsTowardCompletion).length;
  // The server's `no_active_requirements`, kept live as links are toggled
  // here. A pipeline with nothing in it yet already says so in its own words.
  const noActiveRequirements = totalReqs > 0 && requiredReqs === 0;

  return (
    <div className="min-h-screen">
      <div data-page-main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* The hub is a sibling of this page, so `underHub` supplies it with the
            registry's label and gate: members without training.manage cannot
            open /training/admin, so the crumb only renders for users who can
            follow it. */}
        <TrainingPageHeader
          icon={Layers}
          title={program.name}
          underHub="/training/admin"
          subtitle={
            <>
              {program.description && (
                <p className="text-theme-text-muted mb-3 max-w-2xl text-sm">{program.description}</p>
              )}
              {/* The status badges sit here rather than in the heading, which the
                  route announcer reads aloud as the page's name. */}
              <div className="flex flex-wrap items-center gap-2">
                {program.is_template && (
                  <span className="rounded-sm bg-green-500/20 px-2 py-0.5 text-xs text-green-800 dark:text-green-400">
                    Template
                  </span>
                )}
                {!program.active && <span className="badge bg-theme-surface text-theme-text-secondary">Inactive</span>}
                {program.code && (
                  <span className="bg-theme-surface text-theme-text-secondary rounded-sm px-2 py-0.5 font-mono text-xs">
                    {program.code}
                  </span>
                )}
                <StructureBadge type={program.structure_type} />
                {program.target_position && <PositionBadge position={program.target_position} />}
                {program.version > 1 && (
                  <span className="bg-theme-surface text-theme-text-muted rounded-sm px-2 py-0.5 text-xs">
                    v{program.version}
                  </span>
                )}
              </div>
              <dl className="text-theme-text-secondary mt-3 space-y-1 text-sm" aria-label="Enrollment rules">
                <div className="flex flex-wrap gap-x-1">
                  <dt className="text-theme-text-muted">Prerequisite programs:</dt>
                  <dd>
                    {/* An inactive prerequisite is listed, flagged: it is
                        skipped while inactive and applies again if the
                        pipeline is reactivated. */}
                    {program.prerequisite_programs?.length
                      ? program.prerequisite_programs.map((p, i) => (
                          <React.Fragment key={p.id}>
                            {i > 0 && ', '}
                            {p.name}
                            {p.active === false && (
                              <>
                                {' '}
                                <InactiveNotRequiredBadge />
                              </>
                            )}
                          </React.Fragment>
                        ))
                      : 'None'}
                  </dd>
                </div>
                <div className="flex flex-wrap gap-x-1">
                  <dt className="text-theme-text-muted">Enrolled in other programs at the same time:</dt>
                  <dd>
                    {program.allows_concurrent_enrollment === false
                      ? 'Not allowed — flagged when enrolling'
                      : 'Allowed'}
                  </dd>
                </div>
              </dl>
            </>
          }
          actions={
            <>
              <button
                onClick={() => window.open(`/training/print/program?id=${programId}`, '_blank')}
                className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover flex items-center space-x-1 rounded-lg px-3 py-2 text-sm print:hidden"
              >
                <Printer className="h-4 w-4" />
                <span>Print</span>
              </button>
              {canManage && !program.active && (
                <button
                  type="button"
                  onClick={() => void handleReactivateProgram()}
                  disabled={isReactivating}
                  className="btn-secondary btn-sm"
                >
                  {isReactivating ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>Reactivate</span>
                </button>
              )}
              {canManage && (
                <button
                  onClick={() => setShowEditProgram(true)}
                  className="bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover flex items-center space-x-1 rounded-lg px-3 py-2 text-sm"
                >
                  <Pencil className="h-4 w-4" />
                  <span>Edit</span>
                </button>
              )}
              {canManage && (
                <button
                  onClick={() => setShowEnrollModal(true)}
                  className="btn-success flex items-center space-x-1 px-3 text-sm"
                >
                  <UserPlus className="h-4 w-4" />
                  <span>Enroll</span>
                </button>
              )}
              {canManage && (
                <button
                  onClick={() => {
                    void handleDuplicate();
                  }}
                  disabled={isDuplicating}
                  className="bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover flex items-center space-x-1 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                >
                  <Copy className="h-4 w-4" />
                  <span>{isDuplicating ? 'Copying...' : 'Duplicate'}</span>
                </button>
              )}
              {canManage && (
                <button
                  onClick={() => void confirmDeleteProgram()}
                  title="Delete pipeline"
                  className="flex items-center space-x-1 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-500/10 dark:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Delete</span>
                </button>
              )}
            </>
          }
        />

        {/* Stats Cards */}
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="bg-theme-surface rounded-lg p-4">
            <div className="text-theme-text-muted mb-1 flex items-center space-x-2">
              <Layers className="h-4 w-4" />
              <span className="text-xs uppercase">Phases</span>
            </div>
            <p className="text-theme-text-primary text-2xl font-bold">{phases.length}</p>
          </div>
          <div className="bg-theme-surface rounded-lg p-4">
            <div className="text-theme-text-muted mb-1 flex items-center space-x-2">
              <ListChecks className="h-4 w-4" />
              <span className="text-xs uppercase">Requirements</span>
            </div>
            <p className="text-theme-text-primary text-2xl font-bold">{totalReqs}</p>
            <p className="text-theme-text-muted text-xs">{requiredReqs} required</p>
          </div>
          <div className="bg-theme-surface rounded-lg p-4">
            <div className="text-theme-text-muted mb-1 flex items-center space-x-2">
              <Calendar className="h-4 w-4" />
              <span className="text-xs uppercase">Time Limit</span>
            </div>
            <p className="text-theme-text-primary text-2xl font-bold">
              {program.time_limit_days ? `${program.time_limit_days}d` : '—'}
            </p>
          </div>
          {canViewEnrollments && (
            <div className="bg-theme-surface rounded-lg p-4">
              <div className="text-theme-text-muted mb-1 flex items-center space-x-2">
                <Users className="h-4 w-4" />
                <span className="text-xs uppercase">Enrolled</span>
              </div>
              <p className="text-theme-text-primary text-2xl font-bold">{enrollments.length}</p>
            </div>
          )}
        </div>

        {noActiveRequirements && (
          <div className="mb-6">
            <NoActiveRequirementsNotice scope="pipeline" audience="officer" />
          </div>
        )}

        {/* Tabs */}
        <div className="bg-theme-surface hscroll mb-6 flex space-x-1 rounded-lg p-1" role="tablist" {...tablist}>
          {[
            { key: 'overview' as DetailTab, label: 'Phases & Requirements', icon: Layers },
            ...(canViewEnrollments ? [{ key: 'enrollments' as DetailTab, label: 'Enrollments', icon: Users }] : []),
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                role="tab"
                aria-selected={activeTab === tab.key}
                className={`flex flex-1 items-center justify-center space-x-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-red-800 text-white'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {phases.length === 0 && programLevelReqs.length === 0 && !canManage ? (
              <div className="bg-theme-surface rounded-lg py-12 text-center">
                <Layers className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
                <p className="text-theme-text-muted">Nothing has been added to this pipeline yet</p>
              </div>
            ) : (
              phases
                .slice()
                .sort((a, b) => a.phase_number - b.phase_number)
                .map((phase, phaseIndex) => {
                  const phaseReqs = getPhaseReqs(phase.id);
                  const isExpanded = expandedPhases.has(phase.id);

                  return (
                    <div key={phase.id} className="card">
                      {/* Phase header */}
                      <div className="flex items-center justify-between p-4">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center space-x-3 text-left"
                          onClick={() => togglePhase(phase.id)}
                          aria-expanded={isExpanded}
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-800 text-sm font-bold text-white">
                            {phase.phase_number}
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-theme-text-primary line-clamp-2 font-medium">{phase.name}</h3>
                            <div className="text-theme-text-muted flex items-center space-x-3 text-xs">
                              <span>
                                {phaseReqs.length} requirement{phaseReqs.length !== 1 ? 's' : ''}
                              </span>
                              {phase.time_limit_days && (
                                <span className="flex items-center space-x-1">
                                  <Clock className="h-3 w-3" />
                                  <span>{phase.time_limit_days} day limit</span>
                                </span>
                              )}
                              {phase.requires_manual_advancement && (
                                <span className="flex items-center space-x-1 text-yellow-700 dark:text-yellow-400">
                                  <AlertTriangle className="h-3 w-3" />
                                  <span>Manual advancement</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5">
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => void movePhase(phase, -1)}
                                disabled={phaseIndex === 0}
                                title="Move phase up"
                                aria-label="Move phase up"
                                className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded p-1.5 disabled:opacity-30 disabled:hover:bg-transparent"
                              >
                                <ArrowUp className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void movePhase(phase, 1)}
                                disabled={phaseIndex === phases.length - 1}
                                title="Move phase down"
                                aria-label="Move phase down"
                                className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded p-1.5 disabled:opacity-30 disabled:hover:bg-transparent"
                              >
                                <ArrowDown className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setPhaseModal({ phase })}
                                title="Edit phase"
                                aria-label="Edit phase"
                                className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded p-1.5"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => confirmDeletePhase(phase)}
                                title="Delete phase"
                                aria-label="Delete phase"
                                className="text-theme-text-muted hover:bg-theme-surface-hover rounded p-1.5 hover:text-red-600 dark:hover:text-red-400"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => togglePhase(phase.id)}
                            aria-label={isExpanded ? 'Collapse phase' : 'Expand phase'}
                            className="text-theme-text-muted hover:bg-theme-surface-hover rounded p-1.5"
                          >
                            {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                          </button>
                        </div>
                      </div>

                      {/* Phase content */}
                      {isExpanded && (
                        <div className="border-theme-surface-border border-t p-4">
                          {phase.description && (
                            <p className="text-theme-text-muted mb-4 text-sm">{phase.description}</p>
                          )}
                          {phase.prerequisite_phase_ids && phase.prerequisite_phase_ids.length > 0 && (
                            <p className="mb-4 flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
                              <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
                              Members can't start this phase until they finish{' '}
                              {phase.prerequisite_phase_ids
                                .map((id) => phases.find((p) => p.id === id)?.name)
                                .filter((n): n is string => !!n)
                                .join(', ')}
                              .
                            </p>
                          )}

                          {phaseHasNoActiveRequirements(phaseReqs) && (
                            <div className="mb-4">
                              <NoActiveRequirementsNotice scope="phase" audience="officer" />
                            </div>
                          )}
                          <RequirementList
                            links={phaseReqs}
                            emptyLabel="No requirements assigned to this phase."
                            canManage={canManage}
                            savingReqId={savingReqId}
                            onToggleRequired={handleToggleRequired}
                            onTogglePrerequisite={handleTogglePrerequisite}
                            onMove={moveRequirement}
                            onEdit={(pr) => setReqModal({ phaseId: phase.id, link: pr })}
                            onRemove={confirmRemoveRequirement}
                            onAdd={() => setReqModal({ phaseId: phase.id })}
                          />
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
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-3 text-sm"
              >
                <Plus className="h-4 w-4" /> Add phase
              </button>
            )}

            {/* Requirements that belong to the program rather than a phase.
                Always shown to an officer so a phase-less pipeline is editable;
                shown to everyone else only when it actually has some. */}
            {(canManage || programLevelReqs.length > 0) && (
              <div className="card p-4">
                <div className="mb-3">
                  <h3 className="text-theme-text-primary flex items-center gap-2 font-medium">
                    <ListChecks className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Requirements outside any phase
                  </h3>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    Every enrolled member has to complete these, whichever phase they are in.
                  </p>
                </div>
                <RequirementList
                  links={programLevelReqs}
                  emptyLabel="None yet."
                  canManage={canManage}
                  savingReqId={savingReqId}
                  onToggleRequired={handleToggleRequired}
                  onTogglePrerequisite={handleTogglePrerequisite}
                  onMove={moveRequirement}
                  onEdit={(pr) => setReqModal({ phaseId: null, link: pr })}
                  onRemove={confirmRemoveRequirement}
                  onAdd={() => setReqModal({ phaseId: null })}
                />
              </div>
            )}

            {/* Milestones */}
            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-theme-text-primary flex items-center gap-2 font-medium">
                  <Flag className="h-4 w-4 text-yellow-700 dark:text-yellow-400" /> Milestones
                </h3>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setMilestoneModal({})}
                    className="inline-flex items-center gap-1 text-sm text-red-700 hover:underline dark:text-red-400"
                  >
                    <Plus className="h-4 w-4" /> Add milestone
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
                      <div
                        key={m.id}
                        className="bg-theme-surface-secondary flex items-center justify-between gap-2 rounded-lg p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-theme-text-primary truncate text-sm">{m.name}</p>
                          <p className="text-theme-text-muted text-xs">
                            Triggers at {Math.round(m.completion_percentage_threshold)}%
                          </p>
                        </div>
                        {canManage && (
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => setMilestoneModal({ milestone: m })}
                              title="Edit milestone"
                              aria-label="Edit milestone"
                              className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded p-1"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => confirmDeleteMilestone(m)}
                              title="Delete milestone"
                              aria-label="Delete milestone"
                              className="text-theme-text-muted hover:bg-theme-surface rounded p-1 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
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

        {activeTab === 'enrollments' && canViewEnrollments && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <label htmlFor="enrollment-status" className="text-theme-text-muted text-xs">
                Status
              </label>
              <select
                id="enrollment-status"
                value={enrollmentStatus}
                onChange={(e) => setEnrollmentStatus(e.target.value)}
                className="form-input-sm w-44"
              >
                <option value="">All statuses</option>
                {ENROLLMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {enumLabel(status)}
                  </option>
                ))}
              </select>
            </div>
            {enrollments.length === 0 && enrollmentStatus ? (
              // Distinct from "nobody is enrolled": the filter is the reason
              // the list is empty, and the way out is to clear it.
              <div className="bg-theme-surface rounded-lg py-12 text-center">
                <Users className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
                <p className="text-theme-text-muted mb-4">
                  No {enumLabel(enrollmentStatus).toLowerCase()} enrollments in this pipeline.
                </p>
                <button onClick={() => setEnrollmentStatus('')} className="btn-primary text-sm">
                  Show all statuses
                </button>
              </div>
            ) : enrollments.length === 0 ? (
              <div className="bg-theme-surface rounded-lg py-12 text-center">
                <Users className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
                <p className="text-theme-text-muted mb-2">No members enrolled yet</p>
                {canManage && (
                  <>
                    <p className="text-theme-text-muted mb-4 text-sm">
                      Enroll members to start tracking their progress.
                    </p>
                    <button onClick={() => setShowEnrollModal(true)} className="btn-primary text-sm">
                      Enroll Members
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-theme-text-muted text-xs">
                  Select a member to view and update their requirement progress.
                </p>
                {enrollments.map((enrollment) => {
                  // A finished enrollment keeps the figure it finished with; a
                  // running one has nothing left to measure progress against.
                  const unmeasured =
                    noActiveRequirements && (enrollment.status === 'active' || enrollment.status === 'on_hold');
                  const byHandNote = completedByHandNote(enrollment, canManage);
                  return (
                    <div
                      key={enrollment.id}
                      className="bg-theme-surface flex flex-col overflow-hidden rounded-lg sm:flex-row sm:items-stretch"
                    >
                      <button
                        type="button"
                        onClick={() => setProgressEnrollment(enrollment)}
                        className="hover:bg-theme-surface-hover flex w-full min-w-0 flex-1 items-center justify-between p-4 text-left transition-colors"
                        aria-label={`Manage progress for ${enrollment.user_name}`}
                      >
                        <div className="min-w-0">
                          <p className="text-theme-text-primary font-medium">{enrollment.user_name}</p>
                          <div className="text-theme-text-muted mt-1 flex items-center space-x-3 text-xs">
                            <span>Status: {enumLabel(enrollment.status)}</span>
                            <span>
                              {unmeasured
                                ? NO_ACTIVE_REQUIREMENTS_LABEL
                                : `${Math.round(enrollment.progress_percentage)}% complete`}
                            </span>
                          </div>
                          {byHandNote && <p className="text-theme-text-muted mt-1 text-xs break-words">{byHandNote}</p>}
                        </div>
                        {!unmeasured && (
                          <div className="bg-theme-surface-secondary h-2 w-32 rounded-full">
                            <div
                              className="h-2 rounded-full bg-red-500 transition-all"
                              style={{ width: `${enrollment.progress_percentage}%` }}
                            />
                          </div>
                        )}
                      </button>
                      {canManage && canMarkPipelineComplete(enrollment.status) && (
                        <button
                          type="button"
                          onClick={() => setCompleteTarget(enrollment)}
                          className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover touch-target-phone flex shrink-0 items-center justify-center gap-1 border-t px-4 py-2 text-xs sm:border-t-0 sm:border-l"
                          aria-label={`${MARK_PIPELINE_COMPLETE_LABEL} for ${enrollment.user_name}`}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {MARK_PIPELINE_COMPLETE_LABEL}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <EnrollModal
        isOpen={showEnrollModal}
        programId={programId || ''}
        programName={program.name}
        onClose={() => setShowEnrollModal(false)}
        onSuccess={() => {
          void loadEnrollments();
        }}
      />

      <EnrollmentProgressModal
        isOpen={progressEnrollment !== null}
        enrollmentId={progressEnrollment?.id ?? null}
        memberName={progressEnrollment?.user_name ?? ''}
        phases={phases}
        programReqs={programReqs}
        structureType={program.structure_type}
        canManage={canManage}
        onClose={() => setProgressEnrollment(null)}
        onSaved={() => {
          void loadEnrollments();
        }}
      />

      <MarkPipelineCompleteDialog
        enrollmentId={completeTarget?.id ?? null}
        memberName={completeTarget?.user_name ?? ''}
        onClose={() => setCompleteTarget(null)}
        onCompleted={() => loadEnrollments()}
      />

      {showEditProgram && (
        <EditProgramModal program={program} onClose={() => setShowEditProgram(false)} onSaved={afterEdit} />
      )}
      {phaseModal && programId && (
        <PhaseFormModal
          programId={programId}
          phase={phaseModal.phase}
          allPhases={phases}
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
          sortOrder={getPhaseReqs(reqModal.phaseId).length}
          linkedRequirementIds={programReqs.map((pr) => pr.requirement_id)}
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
        title={confirm?.title ?? 'Confirm'}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.confirmLabel ?? 'Delete'}
        variant="danger"
        loading={confirmLoading}
      />
    </div>
  );
};

export default PipelineDetailPage;
