/**
 * Edit modals for the pipeline detail page — program details, phases,
 * requirements, and milestones. Each is a small controlled form that calls the
 * matching training-program service method and then asks the parent to reload.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { trainingProgramService } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import type {
  ProgramMilestone,
  ProgramPhase,
  ProgramRequirement,
  ProgramStructureType,
  TrainingProgram,
} from '../types/training';

const REQUIREMENT_TYPES: { value: string; label: string }[] = [
  { value: 'hours', label: 'Training hours' },
  { value: 'shifts', label: 'Shifts' },
  { value: 'calls', label: 'Call responses' },
  { value: 'courses', label: 'Courses' },
  { value: 'skills_evaluation', label: 'Skills evaluation' },
  { value: 'knowledge_test', label: 'Knowledge test' },
  { value: 'checklist', label: 'Checklist' },
  { value: 'certification', label: 'Certification' },
];

const STRUCTURE_TYPES: { value: ProgramStructureType; label: string }[] = [
  { value: 'phases', label: 'Phases (staged)' },
  { value: 'sequential', label: 'Sequential (in order)' },
  { value: 'flexible', label: 'Flexible (any order)' },
];

const MONTHS: { value: number; label: string }[] = [
  { value: 1, label: 'January' }, { value: 2, label: 'February' },
  { value: 3, label: 'March' }, { value: 4, label: 'April' },
  { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' },
  { value: 9, label: 'September' }, { value: 10, label: 'October' },
  { value: 11, label: 'November' }, { value: 12, label: 'December' },
];

// Shared modal shell.
const ModalShell: React.FC<{
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel?: string;
  children: React.ReactNode;
}> = ({ title, onClose, onSubmit, submitting, submitLabel = 'Save', children }) => (
  <div
    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
  >
    <div className="bg-theme-surface-modal rounded-lg max-w-lg w-full max-h-[90vh] flex flex-col">
      <div className="p-5 border-b border-theme-surface-border flex items-center justify-between">
        <h2 className="text-lg font-bold text-theme-text-primary">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="text-theme-text-muted hover:text-theme-text-primary">
          <X className="w-5 h-5" />
        </button>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="p-5 space-y-4 overflow-y-auto"
      >
        {children}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-theme-surface text-theme-text-primary rounded-lg hover:bg-theme-surface-hover text-sm">
            Cancel
          </button>
          <button type="submit" className="btn-primary text-sm" disabled={submitting}>
            {submitting ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Program details
// ---------------------------------------------------------------------------

export const EditProgramModal: React.FC<{
  program: TrainingProgram;
  onClose: () => void;
  onSaved: () => void;
}> = ({ program, onClose, onSaved }) => {
  const [name, setName] = useState(program.name);
  const [description, setDescription] = useState(program.description ?? '');
  const [code, setCode] = useState(program.code ?? '');
  const [structureType, setStructureType] = useState<ProgramStructureType>(program.structure_type);
  const [targetPosition, setTargetPosition] = useState(program.target_position ?? '');
  const [timeLimit, setTimeLimit] = useState(program.time_limit_days?.toString() ?? '');
  const [warnDays, setWarnDays] = useState(program.warning_days_before?.toString() ?? '');
  const [isTemplate, setIsTemplate] = useState(!!program.is_template);
  const [active, setActive] = useState(program.active !== false);
  const [recertEnabled, setRecertEnabled] = useState(!!program.recert_enabled);
  const [recertInterval, setRecertInterval] = useState(
    program.recert_interval_months?.toString() ?? '24',
  );
  const [recertAnchorMonth, setRecertAnchorMonth] = useState(
    program.recert_anchor_month?.toString() ?? '',
  );
  const [recertAnchorDay, setRecertAnchorDay] = useState(
    program.recert_anchor_day?.toString() ?? '',
  );
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    // A fixed anchor needs both parts; require them together to avoid an
    // ambiguous "reset in March, day unknown".
    if (recertEnabled && (!!recertAnchorMonth) !== (!!recertAnchorDay)) {
      toast.error('Set both the reset month and day, or leave both blank');
      return;
    }
    setSubmitting(true);
    try {
      await trainingProgramService.updateProgram(program.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        code: code.trim() || undefined,
        structure_type: structureType,
        target_position: targetPosition.trim() || undefined,
        time_limit_days: timeLimit ? Number(timeLimit) : undefined,
        warning_days_before: warnDays ? Number(warnDays) : undefined,
        is_template: isTemplate,
        active,
        recert_enabled: recertEnabled,
        recert_interval_months:
          recertEnabled && recertInterval ? Number(recertInterval) : undefined,
        recert_anchor_month:
          recertEnabled && recertAnchorMonth ? Number(recertAnchorMonth) : undefined,
        recert_anchor_day:
          recertEnabled && recertAnchorDay ? Number(recertAnchorDay) : undefined,
      });
      toast.success('Pipeline updated');
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update pipeline'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Edit pipeline details" onClose={onClose} onSubmit={() => void submit()} submitting={submitting}>
      <div>
        <label className="form-label" htmlFor="ep-name">Name</label>
        <input id="ep-name" className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="form-label" htmlFor="ep-desc">Description</label>
        <textarea id="ep-desc" className="form-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label" htmlFor="ep-code">Code</label>
          <input id="ep-code" className="form-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. FF-RECRUIT" />
        </div>
        <div>
          <label className="form-label" htmlFor="ep-structure">Structure</label>
          <select id="ep-structure" className="form-input" value={structureType} onChange={(e) => setStructureType(e.target.value as ProgramStructureType)}>
            {STRUCTURE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label" htmlFor="ep-target">Target position</label>
          <input id="ep-target" className="form-input" value={targetPosition} onChange={(e) => setTargetPosition(e.target.value)} placeholder="e.g. probationary" />
        </div>
        <div>
          <label className="form-label" htmlFor="ep-limit">Time limit (days)</label>
          <input id="ep-limit" type="number" min={0} className="form-input" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="form-label" htmlFor="ep-warn">Warn days before deadline</label>
        <input id="ep-warn" type="number" min={0} className="form-input" value={warnDays} onChange={(e) => setWarnDays(e.target.value)} />
      </div>
      <div className="flex items-center gap-6">
        <label className="inline-flex items-center gap-2 text-sm text-theme-text-secondary">
          <input type="checkbox" checked={isTemplate} onChange={(e) => setIsTemplate(e.target.checked)} /> Template
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-theme-text-secondary">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
        </label>
      </div>
      <div className="rounded-md border border-theme-surface-border p-3 space-y-3">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-theme-text-primary">
          <input
            type="checkbox"
            checked={recertEnabled}
            onChange={(e) => setRecertEnabled(e.target.checked)}
          />
          Recertification cycle (auto-reset)
        </label>
        <p className="text-xs text-theme-text-muted">
          Clears each member&apos;s progress on a recurring deadline so a fresh
          certification cycle can begin — e.g. NREMT&apos;s biennial recert due
          every other March 30.
        </p>
        {recertEnabled && (
          <div className="space-y-3">
            <div>
              <label className="form-label" htmlFor="ep-recert-interval">
                Cycle length (months)
              </label>
              <input
                id="ep-recert-interval"
                type="number"
                min={1}
                max={120}
                className="form-input"
                value={recertInterval}
                onChange={(e) => setRecertInterval(e.target.value)}
                placeholder="e.g. 24 for a two-year cycle"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label" htmlFor="ep-recert-month">
                  Reset month <span className="text-theme-text-muted">(optional)</span>
                </label>
                <select
                  id="ep-recert-month"
                  className="form-input"
                  value={recertAnchorMonth}
                  onChange={(e) => setRecertAnchorMonth(e.target.value)}
                >
                  <option value="">Roll from enrollment date</option>
                  {MONTHS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="ep-recert-day">
                  Reset day <span className="text-theme-text-muted">(optional)</span>
                </label>
                <input
                  id="ep-recert-day"
                  type="number"
                  min={1}
                  max={31}
                  className="form-input"
                  value={recertAnchorDay}
                  onChange={(e) => setRecertAnchorDay(e.target.value)}
                  placeholder="e.g. 30"
                />
              </div>
            </div>
            <p className="text-xs text-theme-text-muted">
              Set a month and day to pin the reset to a fixed calendar date;
              leave them blank to reset on a rolling schedule from each
              member&apos;s enrollment date.
            </p>
          </div>
        )}
      </div>
    </ModalShell>
  );
};

// ---------------------------------------------------------------------------
// Phase (add / edit)
// ---------------------------------------------------------------------------

export const PhaseFormModal: React.FC<{
  programId: string;
  phase?: ProgramPhase | undefined;
  nextPhaseNumber: number;
  onClose: () => void;
  onSaved: () => void;
}> = ({ programId, phase, nextPhaseNumber, onClose, onSaved }) => {
  const [name, setName] = useState(phase?.name ?? '');
  const [description, setDescription] = useState(phase?.description ?? '');
  const [timeLimit, setTimeLimit] = useState(phase?.time_limit_days?.toString() ?? '');
  const [manual, setManual] = useState(!!phase?.requires_manual_advancement);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    setSubmitting(true);
    try {
      if (phase) {
        await trainingProgramService.updateProgramPhase(programId, phase.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          time_limit_days: timeLimit ? Number(timeLimit) : undefined,
          requires_manual_advancement: manual,
        });
        toast.success('Phase updated');
      } else {
        await trainingProgramService.createProgramPhase(programId, {
          program_id: programId,
          phase_number: nextPhaseNumber,
          name: name.trim(),
          description: description.trim() || undefined,
          time_limit_days: timeLimit ? Number(timeLimit) : undefined,
          requires_manual_advancement: manual,
        });
        toast.success('Phase added');
      }
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save phase'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={phase ? 'Edit phase' : 'Add phase'} onClose={onClose} onSubmit={() => void submit()} submitting={submitting}>
      <div>
        <label className="form-label" htmlFor="ph-name">Name</label>
        <input id="ph-name" className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="form-label" htmlFor="ph-desc">Description</label>
        <textarea id="ph-desc" className="form-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <label className="form-label" htmlFor="ph-limit">Time limit (days)</label>
        <input id="ph-limit" type="number" min={0} className="form-input" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} />
      </div>
      <label className="inline-flex items-center gap-2 text-sm text-theme-text-secondary">
        <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
        Require officer approval to advance out of this phase
      </label>
    </ModalShell>
  );
};

// ---------------------------------------------------------------------------
// Requirement (add / edit)
// ---------------------------------------------------------------------------

export const RequirementFormModal: React.FC<{
  programId: string;
  phaseId: string | null;
  link?: ProgramRequirement | undefined;
  sortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}> = ({ programId, phaseId, link, sortOrder, onClose, onSaved }) => {
  const req = link?.requirement;
  const [name, setName] = useState(req?.name ?? '');
  const [description, setDescription] = useState(req?.description ?? '');
  const [type, setType] = useState<string>(req?.requirement_type ?? 'hours');
  const [hours, setHours] = useState(req?.required_hours?.toString() ?? '');
  const [shifts, setShifts] = useState(req?.required_shifts?.toString() ?? '');
  const [calls, setCalls] = useState(req?.required_calls?.toString() ?? '');
  const [passing, setPassing] = useState(req?.passing_score?.toString() ?? '');
  const [attempts, setAttempts] = useState(req?.max_attempts?.toString() ?? '');
  const [checklist, setChecklist] = useState((req?.checklist_items ?? []).join('\n'));
  const [isRequired, setIsRequired] = useState(link?.is_required !== false);
  const [allowsExternal, setAllowsExternal] = useState(req?.allows_external_credit === true);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        requirement_type: type as never,
        required_hours: type === 'hours' && hours ? Number(hours) : undefined,
        required_shifts: type === 'shifts' && shifts ? Number(shifts) : undefined,
        required_calls: type === 'calls' && calls ? Number(calls) : undefined,
        passing_score: type === 'knowledge_test' && passing ? Number(passing) : undefined,
        max_attempts: type === 'knowledge_test' && attempts ? Number(attempts) : undefined,
        checklist_items:
          type === 'checklist'
            ? checklist.split('\n').map((s) => s.trim()).filter(Boolean)
            : undefined,
        allows_external_credit: allowsExternal,
      };
      if (link) {
        await trainingProgramService.updateRequirementEnhanced(link.requirement_id, payload);
        if (isRequired !== (link.is_required !== false)) {
          await trainingProgramService.updateProgramRequirement(programId, link.id, { is_required: isRequired });
        }
        toast.success('Requirement updated');
      } else {
        const created = await trainingProgramService.createRequirementEnhanced({
          ...payload,
          frequency: 'one_time',
          applies_to_all: false,
        } as never);
        await trainingProgramService.addProgramRequirement(programId, {
          program_id: programId,
          phase_id: phaseId ?? undefined,
          requirement_id: created.id,
          is_required: isRequired,
          sort_order: sortOrder,
        });
        toast.success('Requirement added');
      }
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save requirement'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={link ? 'Edit requirement' : 'Add requirement'} onClose={onClose} onSubmit={() => void submit()} submitting={submitting}>
      <div>
        <label className="form-label" htmlFor="rq-name">Name</label>
        <input id="rq-name" className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="form-label" htmlFor="rq-desc">Description</label>
        <textarea id="rq-desc" className="form-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <label className="form-label" htmlFor="rq-type">Type</label>
        <select id="rq-type" className="form-input" value={type} onChange={(e) => setType(e.target.value)}>
          {REQUIREMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      {type === 'hours' && (
        <div>
          <label className="form-label" htmlFor="rq-hours">Required hours</label>
          <input id="rq-hours" type="number" min={0} className="form-input" value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
      )}
      {type === 'shifts' && (
        <div>
          <label className="form-label" htmlFor="rq-shifts">Required shifts</label>
          <input id="rq-shifts" type="number" min={0} className="form-input" value={shifts} onChange={(e) => setShifts(e.target.value)} />
        </div>
      )}
      {type === 'calls' && (
        <div>
          <label className="form-label" htmlFor="rq-calls">Required calls</label>
          <input id="rq-calls" type="number" min={0} className="form-input" value={calls} onChange={(e) => setCalls(e.target.value)} />
        </div>
      )}
      {type === 'knowledge_test' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label" htmlFor="rq-pass">Passing score (%)</label>
            <input id="rq-pass" type="number" min={0} max={100} className="form-input" value={passing} onChange={(e) => setPassing(e.target.value)} />
          </div>
          <div>
            <label className="form-label" htmlFor="rq-att">Max attempts</label>
            <input id="rq-att" type="number" min={1} className="form-input" value={attempts} onChange={(e) => setAttempts(e.target.value)} />
          </div>
        </div>
      )}
      {type === 'checklist' && (
        <div>
          <label className="form-label" htmlFor="rq-check">Checklist items (one per line)</label>
          <textarea id="rq-check" className="form-input" rows={4} value={checklist} onChange={(e) => setChecklist(e.target.value)} />
        </div>
      )}
      {(type === 'hours' || type === 'courses') && (
        <label className="inline-flex items-start gap-2 text-sm text-theme-text-secondary">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={allowsExternal}
            onChange={(e) => setAllowsExternal(e.target.checked)}
          />
          <span>
            Accept external / imported training credit
            <span className="block text-xs text-theme-text-muted">
              Off by default: only in-house sessions, skills tests, or manual sign-off satisfy this.
              Turn on to let imported courses (e.g. Vector Solutions) in a matching category count
              toward it.
            </span>
          </span>
        </label>
      )}
      <label className="inline-flex items-center gap-2 text-sm text-theme-text-secondary">
        <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
        Required to complete the phase
      </label>
    </ModalShell>
  );
};

// ---------------------------------------------------------------------------
// Milestone (add / edit)
// ---------------------------------------------------------------------------

export const MilestoneFormModal: React.FC<{
  programId: string;
  phases: ProgramPhase[];
  milestone?: ProgramMilestone | undefined;
  onClose: () => void;
  onSaved: () => void;
}> = ({ programId, phases, milestone, onClose, onSaved }) => {
  const [name, setName] = useState(milestone?.name ?? '');
  const [description, setDescription] = useState(milestone?.description ?? '');
  const [threshold, setThreshold] = useState(milestone?.completion_percentage_threshold?.toString() ?? '100');
  const [message, setMessage] = useState(milestone?.notification_message ?? '');
  const [phaseId, setPhaseId] = useState(milestone?.phase_id ?? '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (milestone) setPhaseId(milestone.phase_id ?? ''); }, [milestone]);

  const submit = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    const pct = Number(threshold);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) { toast.error('Threshold must be 0–100'); return; }
    setSubmitting(true);
    try {
      if (milestone) {
        await trainingProgramService.updateMilestone(programId, milestone.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          completion_percentage_threshold: pct,
          notification_message: message.trim() || undefined,
        });
        toast.success('Milestone updated');
      } else {
        await trainingProgramService.createMilestone(programId, {
          program_id: programId,
          phase_id: phaseId || undefined,
          name: name.trim(),
          description: description.trim() || undefined,
          completion_percentage_threshold: pct,
          notification_message: message.trim() || undefined,
        });
        toast.success('Milestone added');
      }
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save milestone'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={milestone ? 'Edit milestone' : 'Add milestone'} onClose={onClose} onSubmit={() => void submit()} submitting={submitting}>
      <div>
        <label className="form-label" htmlFor="ms-name">Name</label>
        <input id="ms-name" className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="form-label" htmlFor="ms-desc">Description</label>
        <textarea id="ms-desc" className="form-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label" htmlFor="ms-thresh">Triggers at (%)</label>
          <input id="ms-thresh" type="number" min={0} max={100} className="form-input" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </div>
        {!milestone && phases.length > 0 && (
          <div>
            <label className="form-label" htmlFor="ms-phase">Phase (optional)</label>
            <select id="ms-phase" className="form-input" value={phaseId} onChange={(e) => setPhaseId(e.target.value)}>
              <option value="">Program-level</option>
              {phases.map((p) => <option key={p.id} value={p.id}>Phase {p.phase_number}: {p.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <div>
        <label className="form-label" htmlFor="ms-msg">Notification message</label>
        <input id="ms-msg" className="form-input" value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
    </ModalShell>
  );
};
