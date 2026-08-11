import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  GraduationCap,
  Info,
  Layers,
  ListChecks,
  Flag,
  Eye,
  Link2,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { trainingProgramService } from '../services/api';
import { CourseLibraryPicker } from '../components/training/CourseLibraryPicker';
import { RecencyWindowField } from '../components/training/RecencyWindowField';
import { RequirementLibraryPicker } from '../components/training/RequirementLibraryPicker';
import { ChecklistItemsEditor } from '../components/training/ChecklistItemsEditor';
import { useCourseLibrary } from '../hooks/useCourseLibrary';
import { useRequirementLibrary } from '../hooks/useRequirementLibrary';
import type {
  ChecklistItem,
  ProgramStructureType,
  RequirementType,
  RequirementFrequency,
  ProgramBuildRequest,
  TrainingCourse,
  TrainingRequirementEnhanced,
} from '../types/training';

// ==================== Types ====================

interface PhaseFormData {
  id: string; // client-side only
  phase_number: number;
  name: string;
  description: string;
  time_limit_days: string;
  requires_manual_advancement: boolean;
  requirements: RequirementFormData[];
  milestones: MilestoneFormData[];
  isExpanded: boolean;
}

interface RequirementFormData {
  id: string;
  // 'library' entries link an existing department requirement and carry only
  // `requirement_id` + `is_required`; 'new' entries define one from the fields
  // below. The two never mix — the build payload rejects a card with both.
  source: 'library' | 'new';
  requirement_id: string;
  name: string;
  description: string;
  requirement_type: RequirementType;
  frequency: RequirementFrequency;
  required_hours: string;
  required_shifts: string;
  required_calls: string;
  passing_score: string;
  max_attempts: string;
  checklist_items: ChecklistItem[];
  // Course-library ids backing a `courses` or `certification` requirement.
  required_courses: string[];
  // Freshness window in days, or undefined for no window.
  recency_days: number | undefined;
  allows_external_credit: boolean;
  is_required: boolean;
  sort_order: number;
}

interface MilestoneFormData {
  id: string;
  name: string;
  description: string;
  completion_percentage_threshold: string;
  notification_message: string;
}

/**
 * One bucket of requirements/milestones in the Requirements and Milestones
 * steps: a phase in a phased program, or the program itself when the program is
 * a single flat list. Modelling both the same way is what lets a non-phased
 * program be built at all — requirements used to hang only off phases, so
 * choosing "one list" left the officer with a wizard that could not accept a
 * single requirement.
 */
interface RequirementGroup {
  key: string;
  title: string;
  requirements: RequirementFormData[];
  milestones: MilestoneFormData[];
}

/** Group key for the program-level bucket (no phase). */
const PROGRAM_GROUP = 'program';

type WizardStep = 'info' | 'phases' | 'requirements' | 'milestones' | 'review';

const ALL_WIZARD_STEPS: { key: WizardStep; label: string; icon: React.ElementType }[] = [
  { key: 'info', label: 'Program Info', icon: Info },
  { key: 'phases', label: 'Phases', icon: Layers },
  { key: 'requirements', label: 'Requirements', icon: ListChecks },
  { key: 'milestones', label: 'Milestones', icon: Flag },
  { key: 'review', label: 'Review', icon: Eye },
];

// ==================== Helper ====================

let clientIdCounter = 0;
const nextId = () => `client-${++clientIdCounter}`;

const emptyPhase = (num: number): PhaseFormData => ({
  id: nextId(),
  phase_number: num,
  name: '',
  description: '',
  time_limit_days: '',
  requires_manual_advancement: false,
  requirements: [],
  milestones: [],
  isExpanded: true,
});

const emptyRequirement = (sortOrder: number, source: 'library' | 'new' = 'new'): RequirementFormData => ({
  id: nextId(),
  source,
  requirement_id: '',
  name: '',
  description: '',
  requirement_type: 'hours',
  frequency: 'one_time',
  required_hours: '',
  required_shifts: '',
  required_calls: '',
  passing_score: '',
  max_attempts: '',
  checklist_items: [],
  required_courses: [],
  recency_days: undefined,
  allows_external_credit: false,
  is_required: true,
  sort_order: sortOrder,
});

const emptyMilestone = (): MilestoneFormData => ({
  id: nextId(),
  name: '',
  description: '',
  completion_percentage_threshold: '',
  notification_message: '',
});

// A linked entry sends only the id and the Required toggle. The build payload
// rejects a requirement carrying both an id and a name, so the two shapes stay
// strictly separate.
const toRequirementPayload = (reqData: RequirementFormData) =>
  reqData.source === 'library'
    ? {
        requirement_id: reqData.requirement_id,
        is_required: reqData.is_required,
        sort_order: reqData.sort_order,
      }
    : {
        name: reqData.name,
        description: reqData.description || undefined,
        requirement_type: reqData.requirement_type,
        frequency: reqData.frequency,
        required_hours: reqData.required_hours ? parseFloat(reqData.required_hours) : undefined,
        required_shifts: reqData.required_shifts ? parseInt(reqData.required_shifts) : undefined,
        required_calls: reqData.required_calls ? parseInt(reqData.required_calls) : undefined,
        passing_score: reqData.passing_score ? parseFloat(reqData.passing_score) : undefined,
        max_attempts: reqData.max_attempts ? parseInt(reqData.max_attempts) : undefined,
        checklist_items: reqData.checklist_items.filter((i) => i.text.trim()),
        required_courses: reqData.required_courses.length > 0 ? reqData.required_courses : undefined,
        recency_days: reqData.recency_days,
        allows_external_credit: reqData.allows_external_credit,
        is_required: reqData.is_required,
        sort_order: reqData.sort_order,
      };

const toMilestonePayload = (msData: MilestoneFormData) => ({
  name: msData.name,
  description: msData.description || undefined,
  completion_percentage_threshold: msData.completion_percentage_threshold
    ? parseFloat(msData.completion_percentage_threshold)
    : 100,
  notification_message: msData.notification_message || undefined,
});

// ==================== Help Components ====================

// Small muted hint shown beneath a field.
const HelpText: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-theme-text-muted mt-1 text-xs">{children}</p>
);

// Highlighted explanatory callout shown at the top of a step.
const InfoCallout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-theme-text-secondary flex gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm">
    <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
    <div className="space-y-1">{children}</div>
  </div>
);

// Plain-language explanation of each requirement type and how it gets completed —
// shown under the Type selector so the builder knows what they're choosing.
const REQUIREMENT_TYPE_HELP: Record<string, string> = {
  hours:
    'Training hours. Fill in automatically from linked training sessions and approved shift reports, or an officer can log them.',
  courses: 'Completion of specific courses from the library — pick them below; progress fills in as each is recorded.',
  skills_evaluation:
    'A hands-on skill an officer signs off on. Link it to a skills test from the requirement library if you want it to complete automatically.',
  knowledge_test: 'A written test. An officer records a pass/fail or score; reaching the passing score completes it.',
  checklist: 'A list of items an officer checks off. Completed when marked done.',
  certification:
    'A certification. Link the library course that grants it, or leave it unlinked and an officer marks it earned.',
  shifts: 'A number of shifts. Accrue automatically from approved shift reports.',
  calls: 'A number of call responses. Accrue automatically from approved shift reports.',
};

// ==================== Step Components ====================

const StepInfo: React.FC<{
  data: {
    name: string;
    description: string;
    code: string;
    target_position: string;
    structure_type: ProgramStructureType;
    time_limit_days: string;
    warning_days_before: string;
    is_template: boolean;
  };
  onChange: (field: string, value: string | boolean) => void;
}> = ({ data, onChange }) => (
  <div className="space-y-6">
    <div>
      <h2 className="text-theme-text-primary mb-1 text-xl font-semibold">Program Information</h2>
      <p className="text-theme-text-muted text-sm">Define the basic details for your training pipeline.</p>
    </div>

    <InfoCallout>
      <p className="text-theme-text-primary font-medium">How a training pipeline works</p>
      <p>
        A pipeline tracks a member&apos;s progression through a training program. You build it in three parts:{' '}
        <strong>Phases</strong> (the stages a member moves through), <strong>Requirements</strong> (what they must
        complete), and optional <strong>Milestones</strong> (progress notifications). After you create it, enroll
        members from the program&apos;s page — their progress then updates automatically from training sessions, shifts,
        and skills tests, or by an officer.
      </p>
      <p>
        Only a <strong>Program Name</strong> is required; you can add phases and requirements now or later.
      </p>
    </InfoCallout>

    <div>
      <label htmlFor="prog-name" className="form-label">
        Program Name <span className="text-red-700 dark:text-red-400">*</span>
      </label>
      <input
        id="prog-name"
        type="text"
        value={data.name}
        onChange={(e) => onChange('name', e.target.value)}
        className="form-input"
        placeholder="e.g., Recruit / Probationary Firefighter"
        required
      />
    </div>

    <div>
      <label htmlFor="prog-desc" className="form-label">
        Description
      </label>
      <textarea
        id="prog-desc"
        value={data.description}
        onChange={(e) => onChange('description', e.target.value)}
        rows={3}
        className="form-input"
        placeholder="Describe what this program covers and who it's for..."
      />
    </div>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <label htmlFor="prog-code" className="form-label">
          Program Code
        </label>
        <input
          id="prog-code"
          type="text"
          value={data.code}
          onChange={(e) => onChange('code', e.target.value.toUpperCase())}
          className="form-input"
          placeholder="e.g., RECRUIT"
          maxLength={50}
        />
        <HelpText>A short identifier shown on the program and in reports. Optional.</HelpText>
      </div>

      <div>
        <label htmlFor="prog-target" className="form-label">
          Target Position
        </label>
        <select
          id="prog-target"
          value={data.target_position}
          onChange={(e) => onChange('target_position', e.target.value)}
          className="form-input"
        >
          <option value="">All Positions</option>
          <option value="probationary">Probationary</option>
          <option value="firefighter">Firefighter</option>
          <option value="driver_candidate">Driver Candidate</option>
          <option value="driver">Driver</option>
          <option value="officer">Officer</option>
          <option value="aic">AIC (Attendant in Charge)</option>
        </select>
        <HelpText>Who this program is aimed at. Informational — it does not restrict who you can enroll.</HelpText>
      </div>
    </div>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div>
        <label htmlFor="prog-structure" className="form-label">
          Structure Type
        </label>
        <select
          id="prog-structure"
          value={data.structure_type}
          onChange={(e) => onChange('structure_type', e.target.value)}
          className="form-input"
        >
          <option value="phases">Phases — stages the member moves through in order</option>
          <option value="flexible">One list — everything in any order</option>
        </select>
        <HelpText>
          Pick <strong>Phases</strong> for a recruit school or driver program, where a member finishes one stage before
          starting the next. Pick <strong>One list</strong> for something like annual continuing education, where the
          order doesn&apos;t matter.
        </HelpText>
      </div>

      <div>
        <label htmlFor="prog-timelimit" className="form-label">
          Time Limit (days)
        </label>
        <input
          id="prog-timelimit"
          type="number"
          value={data.time_limit_days}
          onChange={(e) => onChange('time_limit_days', e.target.value)}
          className="form-input"
          placeholder="e.g., 365"
          min={1}
        />
        <HelpText>Overall deadline from the enrollment date. Leave blank for no deadline.</HelpText>
      </div>

      <div>
        <label htmlFor="prog-warning" className="form-label">
          Warning (days before)
        </label>
        <input
          id="prog-warning"
          type="number"
          value={data.warning_days_before}
          onChange={(e) => onChange('warning_days_before', e.target.value)}
          className="form-input"
          placeholder="30"
          min={1}
        />
        <HelpText>Send the member a reminder this many days before the deadline.</HelpText>
      </div>
    </div>

    <div>
      <label className="flex items-center space-x-2">
        <input
          type="checkbox"
          id="is-template"
          checked={data.is_template}
          onChange={(e) => onChange('is_template', e.target.checked)}
          className="form-checkbox"
        />
        <span className="text-theme-text-secondary text-sm">Save as template (can be cloned for future use)</span>
      </label>
      <HelpText>Templates are reusable blueprints — you don&apos;t enroll members directly into a template.</HelpText>
    </div>
  </div>
);

const StepPhases: React.FC<{
  phases: PhaseFormData[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, field: string, value: string | boolean) => void;
  onToggleExpand: (id: string) => void;
}> = ({ phases, onAdd, onRemove, onUpdate, onToggleExpand }) => (
  <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-theme-text-primary mb-1 text-xl font-semibold">Program Phases</h2>
        <p className="text-theme-text-muted text-sm">
          Define the phases or stages of your training pipeline. Members progress through these in order.
        </p>
      </div>
      <button
        onClick={onAdd}
        className="btn-primary flex shrink-0 items-center space-x-1 self-start px-3 text-sm sm:self-auto"
      >
        <Plus className="h-4 w-4" />
        <span>Add Phase</span>
      </button>
    </div>

    <InfoCallout>
      <p>
        Phases are the stages a member works through, in order (e.g. <em>Orientation → Engine Ops → Truck Ops</em>). A
        member finishes a phase once every required item in it is complete, and then
        <strong> advances automatically</strong> to the next one.
      </p>
      <p>
        Tick <strong>&ldquo;Require officer approval to advance&rdquo;</strong> on a phase to hold members there until
        an officer signs off — even after they finish it. You&apos;ll add the actual requirements in the next step.
      </p>
    </InfoCallout>

    {phases.length === 0 ? (
      <div className="card-secondary border-dashed py-12 text-center">
        <Layers className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
        <p className="text-theme-text-muted mb-2">No phases defined yet</p>
        <p className="text-theme-text-muted mb-4 text-sm">Add phases to structure your training pipeline</p>
        <button onClick={onAdd} className="btn-primary text-sm">
          Add First Phase
        </button>
      </div>
    ) : (
      <div className="space-y-3">
        {phases.map((phase) => (
          <div key={phase.id} className="bg-theme-surface border-theme-surface-border rounded-lg border">
            <div
              className="flex cursor-pointer items-center justify-between p-4"
              onClick={() => onToggleExpand(phase.id)}
            >
              <div className="flex items-center space-x-3">
                <GripVertical className="text-theme-text-muted h-4 w-4" />
                <span className="text-sm font-bold text-red-700 dark:text-red-400">Phase {phase.phase_number}</span>
                <span className="text-theme-text-primary font-medium">{phase.name || 'Untitled Phase'}</span>
                {phase.requirements.length > 0 && (
                  <span className="rounded-sm bg-blue-500/20 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-400">
                    {phase.requirements.length} req{phase.requirements.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(phase.id);
                  }}
                  className="text-theme-text-muted p-1 hover:text-red-800 dark:hover:text-red-400"
                  aria-label={`Remove phase ${phase.phase_number}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                {phase.isExpanded ? (
                  <ChevronUp className="text-theme-text-muted h-4 w-4" />
                ) : (
                  <ChevronDown className="text-theme-text-muted h-4 w-4" />
                )}
              </div>
            </div>

            {phase.isExpanded && (
              <div className="border-theme-surface-border space-y-4 border-t px-4 pt-4 pb-4">
                <div>
                  <label className="form-label-sm">Phase Name *</label>
                  <input
                    type="text"
                    value={phase.name}
                    onChange={(e) => onUpdate(phase.id, 'name', e.target.value)}
                    className="form-input-sm"
                    placeholder="e.g., Engine Company Operations"
                  />
                </div>
                <div>
                  <label className="form-label-sm">Description</label>
                  <textarea
                    value={phase.description}
                    onChange={(e) => onUpdate(phase.id, 'description', e.target.value)}
                    rows={2}
                    className="form-input-sm"
                    placeholder="Describe what this phase covers..."
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="form-label-sm">Time Limit (days)</label>
                    <input
                      type="number"
                      value={phase.time_limit_days}
                      onChange={(e) => onUpdate(phase.id, 'time_limit_days', e.target.value)}
                      className="form-input-sm"
                      placeholder="Optional"
                      min={1}
                    />
                    <HelpText>Target time to finish this phase. Optional.</HelpText>
                  </div>
                  <div>
                    <label className="text-theme-text-secondary flex items-center space-x-2 text-sm">
                      <input
                        type="checkbox"
                        checked={phase.requires_manual_advancement}
                        onChange={(e) => onUpdate(phase.id, 'requires_manual_advancement', e.target.checked)}
                        className="form-checkbox"
                      />
                      <span>Require officer approval to advance</span>
                    </label>
                    <HelpText>
                      Members won&apos;t auto-advance out of this phase, even when complete, until an officer approves.
                    </HelpText>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
);

const StepRequirements: React.FC<{
  groups: RequirementGroup[];
  usesPhases: boolean;
  courses: TrainingCourse[];
  coursesLoading: boolean;
  coursesError: string;
  requirementLibrary: TrainingRequirementEnhanced[];
  requirementLibraryLoading: boolean;
  requirementLibraryError: string;
  onAddRequirement: (groupKey: string, source: 'library' | 'new') => void;
  onRemoveRequirement: (groupKey: string, reqId: string) => void;
  onUpdateRequirement: (
    groupKey: string,
    reqId: string,
    field: string,
    value: string | boolean | string[] | ChecklistItem[] | number | undefined
  ) => void;
}> = ({
  groups,
  usesPhases,
  courses,
  coursesLoading,
  coursesError,
  requirementLibrary,
  requirementLibraryLoading,
  requirementLibraryError,
  onAddRequirement,
  onRemoveRequirement,
  onUpdateRequirement,
}) => (
  <div className="space-y-6">
    <div>
      <h2 className="text-theme-text-primary mb-1 text-xl font-semibold">Requirements</h2>
      <p className="text-theme-text-muted text-sm">
        {usesPhases
          ? 'Define the requirements members must complete within each phase.'
          : 'Define everything a member must complete in this program.'}
      </p>
    </div>

    {groups.length > 0 && (
      <InfoCallout>
        <p>
          Requirements are what a member must complete. Choose a <strong>type</strong> for each — the help under the
          selector explains how it&apos;s completed. Some fill in
          <strong> automatically</strong> (hours, shifts, calls from sessions and shift reports; skills from skills
          tests); others an <strong>officer marks off</strong> (checklist, certification, knowledge test).
        </p>
        <p>
          {usesPhases ? 'A phase is finished' : 'The program is finished'} when its <strong>required</strong> items are
          done. Uncheck
          <strong> &ldquo;Required&rdquo;</strong> for optional items that shouldn&apos;t hold anyone up.
        </p>
        <p>
          For something the department already tracks — CPR, HIPAA, an imported NFPA item — use
          <strong> Link existing</strong> rather than retyping it. The program then reads the same records the
          department does, so a member who already holds it starts out credited.
        </p>
      </InfoCallout>
    )}

    {groups.length === 0 ? (
      <div className="card-secondary border-dashed py-12 text-center">
        <ListChecks className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
        <p className="text-theme-text-muted">Add phases first before defining requirements.</p>
      </div>
    ) : (
      groups.map((phase) => (
        <div key={phase.key} className="bg-theme-surface border-theme-surface-border rounded-lg border p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-theme-text-primary font-medium">{phase.title}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onAddRequirement(phase.key, 'library')}
                className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover flex items-center space-x-1 rounded-sm px-2 py-1 text-xs"
              >
                <Link2 className="h-3 w-3" />
                <span>Link Existing</span>
              </button>
              <button
                onClick={() => onAddRequirement(phase.key, 'new')}
                className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover flex items-center space-x-1 rounded-sm px-2 py-1 text-xs"
              >
                <Plus className="h-3 w-3" />
                <span>New Requirement</span>
              </button>
            </div>
          </div>

          {phase.requirements.length === 0 ? (
            <p className="text-theme-text-muted py-4 text-center text-sm">No requirements yet.</p>
          ) : (
            <div className="space-y-3">
              {phase.requirements.map((req) =>
                req.source === 'library' ? (
                  <div key={req.id} className="bg-theme-surface-secondary space-y-3 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <RequirementLibraryPicker
                          idPrefix={`wizard-${req.id}`}
                          requirements={requirementLibrary}
                          loading={requirementLibraryLoading}
                          error={requirementLibraryError}
                          // Everything else this phase already links, so the
                          // same requirement can't be added to it twice.
                          linkedIds={phase.requirements
                            .filter((r) => r.id !== req.id && r.requirement_id)
                            .map((r) => r.requirement_id)}
                          selectedId={req.requirement_id}
                          onChange={(id) => onUpdateRequirement(phase.key, req.id, 'requirement_id', id)}
                        />
                      </div>
                      <button
                        onClick={() => onRemoveRequirement(phase.key, req.id)}
                        className="text-theme-text-muted p-1 hover:text-red-800 dark:hover:text-red-400"
                        aria-label="Remove requirement"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div>
                      <label className="text-theme-text-secondary flex items-center space-x-2 text-xs">
                        <input
                          type="checkbox"
                          checked={req.is_required}
                          onChange={(e) => onUpdateRequirement(phase.key, req.id, 'is_required', e.target.checked)}
                          className="form-checkbox"
                        />
                        <span>Required to complete the phase</span>
                      </label>
                      <HelpText>
                        The requirement&apos;s own settings — hours, linked courses, freshness window — stay under the
                        department&apos;s control. Only this toggle is specific to the phase.
                      </HelpText>
                    </div>
                  </div>
                ) : (
                  <div key={req.id} className="bg-theme-surface-secondary space-y-3 rounded-lg p-3">
                    <div className="flex items-start justify-between">
                      <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <label className="text-theme-text-muted mb-1 block text-xs font-medium">
                            Requirement Name *
                          </label>
                          <input
                            type="text"
                            value={req.name}
                            onChange={(e) => onUpdateRequirement(phase.key, req.id, 'name', e.target.value)}
                            className="form-input-sm"
                            placeholder="e.g., Hose Operations Skills"
                          />
                        </div>
                        <div>
                          <label className="text-theme-text-muted mb-1 block text-xs font-medium">Type</label>
                          <select
                            value={req.requirement_type}
                            onChange={(e) => onUpdateRequirement(phase.key, req.id, 'requirement_type', e.target.value)}
                            className="form-input-sm"
                          >
                            <option value="hours">Training Hours</option>
                            <option value="courses">Course Completion</option>
                            <option value="skills_evaluation">Skills Evaluation</option>
                            <option value="knowledge_test">Knowledge Test</option>
                            <option value="checklist">Checklist</option>
                            <option value="certification">Certification</option>
                            <option value="shifts">Shifts Completed</option>
                            <option value="calls">Call Responses</option>
                          </select>
                          {REQUIREMENT_TYPE_HELP[req.requirement_type] && (
                            <HelpText>{REQUIREMENT_TYPE_HELP[req.requirement_type]}</HelpText>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => onRemoveRequirement(phase.key, req.id)}
                        className="text-theme-text-muted ml-2 p-1 hover:text-red-800 dark:hover:text-red-400"
                        aria-label="Remove requirement"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div>
                      <label className="text-theme-text-muted mb-1 block text-xs font-medium">Description</label>
                      <textarea
                        value={req.description}
                        onChange={(e) => onUpdateRequirement(phase.key, req.id, 'description', e.target.value)}
                        rows={2}
                        className="form-input-sm"
                        placeholder="Describe what this requirement entails..."
                      />
                    </div>

                    {/* Required toggle — applies to every requirement type */}
                    <div>
                      <label className="text-theme-text-secondary flex items-center space-x-2 text-xs">
                        <input
                          type="checkbox"
                          checked={req.is_required}
                          onChange={(e) => onUpdateRequirement(phase.key, req.id, 'is_required', e.target.checked)}
                          className="form-checkbox"
                        />
                        <span>Required to complete the phase</span>
                      </label>
                      <HelpText>
                        Uncheck for optional or extra-credit items that shouldn&apos;t hold up advancement.
                      </HelpText>
                    </div>

                    {/* External-credit flag — a deliberate choice for each hours/
                      courses requirement, since the default is in-house-only. */}
                    {(req.requirement_type === 'hours' || req.requirement_type === 'courses') && (
                      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
                        <AlertCircle
                          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                          aria-hidden="true"
                        />
                        <div>
                          <label className="text-theme-text-secondary flex items-start gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={req.allows_external_credit}
                              onChange={(e) =>
                                onUpdateRequirement(phase.key, req.id, 'allows_external_credit', e.target.checked)
                              }
                              className="form-checkbox mt-0.5"
                            />
                            <span>Accept external / imported training credit</span>
                          </label>
                          <HelpText>
                            Off by default — imported courses (e.g. Vector Solutions) won&apos;t count toward this; only
                            in-house sessions, skills tests, or manual sign-off will. Check it if online/third-party
                            delivery is acceptable.
                          </HelpText>
                        </div>
                      </div>
                    )}

                    {/* Course-library link — the requirement's target for course
                      and certification types. */}
                    {(req.requirement_type === 'courses' || req.requirement_type === 'certification') && (
                      <CourseLibraryPicker
                        idPrefix={`wizard-${req.id}`}
                        courses={courses}
                        loading={coursesLoading}
                        error={coursesError}
                        variant={req.requirement_type === 'certification' ? 'certification' : 'courses'}
                        selectedIds={req.required_courses}
                        onChange={(ids) => onUpdateRequirement(phase.key, req.id, 'required_courses', ids)}
                      />
                    )}

                    {/* Freshness window — offered for the types where a stale
                      completion is the realistic failure (a certification from
                      three years ago, a course taken before the last revision).
                      Hours/shifts/calls accrue continuously, so a window there
                      would mostly confuse. */}
                    {(req.requirement_type === 'courses' || req.requirement_type === 'certification') && (
                      <RecencyWindowField
                        idPrefix={`wizard-${req.id}`}
                        value={req.recency_days}
                        onChange={(days) => onUpdateRequirement(phase.key, req.id, 'recency_days', days)}
                      />
                    )}

                    {/* Conditional fields based on type */}
                    {req.requirement_type === 'hours' && (
                      <div>
                        <label className="text-theme-text-muted mb-1 block text-xs font-medium">Required Hours</label>
                        <input
                          type="number"
                          value={req.required_hours}
                          onChange={(e) => onUpdateRequirement(phase.key, req.id, 'required_hours', e.target.value)}
                          className="form-input-sm"
                          placeholder="e.g., 40"
                          min={0}
                          step={0.5}
                        />
                      </div>
                    )}

                    {req.requirement_type === 'shifts' && (
                      <div>
                        <label className="text-theme-text-muted mb-1 block text-xs font-medium">Required Shifts</label>
                        <input
                          type="number"
                          value={req.required_shifts}
                          onChange={(e) => onUpdateRequirement(phase.key, req.id, 'required_shifts', e.target.value)}
                          className="form-input-sm"
                          placeholder="e.g., 10"
                          min={1}
                        />
                      </div>
                    )}

                    {req.requirement_type === 'calls' && (
                      <div>
                        <label className="text-theme-text-muted mb-1 block text-xs font-medium">Required Calls</label>
                        <input
                          type="number"
                          value={req.required_calls}
                          onChange={(e) => onUpdateRequirement(phase.key, req.id, 'required_calls', e.target.value)}
                          className="form-input-sm"
                          placeholder="e.g., 20"
                          min={1}
                        />
                      </div>
                    )}

                    {req.requirement_type === 'checklist' && (
                      <ChecklistItemsEditor
                        idPrefix={`wizard-${req.id}`}
                        items={req.checklist_items}
                        onChange={(items) => onUpdateRequirement(phase.key, req.id, 'checklist_items', items)}
                      />
                    )}

                    {req.requirement_type === 'knowledge_test' && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="text-theme-text-muted mb-1 block text-xs font-medium">
                            Passing Score (%)
                          </label>
                          <input
                            type="number"
                            value={req.passing_score}
                            onChange={(e) => onUpdateRequirement(phase.key, req.id, 'passing_score', e.target.value)}
                            className="form-input-sm"
                            placeholder="e.g., 70"
                            min={0}
                            max={100}
                          />
                          <HelpText>Minimum score to pass. Defaults to 70% if left blank.</HelpText>
                        </div>
                        <div>
                          <label className="text-theme-text-muted mb-1 block text-xs font-medium">Max Attempts</label>
                          <input
                            type="number"
                            value={req.max_attempts}
                            onChange={(e) => onUpdateRequirement(phase.key, req.id, 'max_attempts', e.target.value)}
                            className="form-input-sm"
                            placeholder="Unlimited"
                            min={1}
                          />
                          <HelpText>How many times a member may take it. Blank = unlimited.</HelpText>
                        </div>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      ))
    )}
  </div>
);

const StepMilestones: React.FC<{
  groups: RequirementGroup[];
  onAddMilestone: (groupKey: string) => void;
  onRemoveMilestone: (groupKey: string, msId: string) => void;
  onUpdateMilestone: (groupKey: string, msId: string, field: string, value: string) => void;
  onMoveMilestone: (groupKey: string, msId: string, direction: 'up' | 'down') => void;
}> = ({ groups, onAddMilestone, onRemoveMilestone, onUpdateMilestone, onMoveMilestone }) => (
  <div className="space-y-6">
    <div>
      <h2 className="text-theme-text-primary mb-1 text-xl font-semibold">
        Milestones <span className="text-theme-text-muted text-sm font-normal">(optional)</span>
      </h2>
      <p className="text-theme-text-muted text-sm">
        Define milestones to celebrate member progress and trigger notifications. Use the arrows to reorder.
      </p>
    </div>

    {groups.length > 0 && (
      <InfoCallout>
        <p>
          Milestones are optional check-ins. When a member&apos;s <strong>overall progress in this program</strong>{' '}
          reaches the percentage you set, they get a notification with your message — a nice way to mark &ldquo;halfway
          there&rdquo; moments. Milestones <strong>don&apos;t gate advancement</strong>; they&apos;re purely
          encouragement. Skip this step entirely if you don&apos;t need them.
        </p>
      </InfoCallout>
    )}

    {groups.length === 0 ? (
      <div className="card-secondary border-dashed py-12 text-center">
        <Flag className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
        <p className="text-theme-text-muted">Add phases first before defining milestones.</p>
      </div>
    ) : (
      groups.map((phase) => (
        <div key={phase.key} className="bg-theme-surface border-theme-surface-border rounded-lg border p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-theme-text-primary font-medium">{phase.title}</h3>
            <button
              onClick={() => onAddMilestone(phase.key)}
              className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover flex items-center space-x-1 rounded-sm px-2 py-1 text-xs"
            >
              <Plus className="h-3 w-3" />
              <span>Add Milestone</span>
            </button>
          </div>

          {phase.milestones.length === 0 ? (
            <p className="text-theme-text-muted py-4 text-center text-sm">No milestones for this phase (optional).</p>
          ) : (
            <div className="space-y-3">
              {phase.milestones.map((ms, msIndex) => (
                <div key={ms.id} className="bg-theme-surface-secondary space-y-3 rounded-lg p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-2">
                      {/* Reorder buttons */}
                      <div className="flex flex-col space-y-0.5 pt-1">
                        <button
                          onClick={() => onMoveMilestone(phase.key, ms.id, 'up')}
                          disabled={msIndex === 0}
                          className="text-theme-text-muted hover:text-theme-text-primary p-0.5 disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label="Move milestone up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => onMoveMilestone(phase.key, ms.id, 'down')}
                          disabled={msIndex === phase.milestones.length - 1}
                          className="text-theme-text-muted hover:text-theme-text-primary p-0.5 disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label="Move milestone down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <label className="text-theme-text-muted mb-1 block text-xs font-medium">
                            Milestone Name *
                          </label>
                          <input
                            type="text"
                            value={ms.name}
                            onChange={(e) => onUpdateMilestone(phase.key, ms.id, 'name', e.target.value)}
                            className="form-input-sm"
                            placeholder="e.g., Halfway Complete"
                          />
                        </div>
                        <div>
                          <label className="text-theme-text-muted mb-1 block text-xs font-medium">
                            Trigger at (% complete)
                          </label>
                          <input
                            type="number"
                            value={ms.completion_percentage_threshold}
                            onChange={(e) =>
                              onUpdateMilestone(phase.key, ms.id, 'completion_percentage_threshold', e.target.value)
                            }
                            className="form-input-sm"
                            placeholder="e.g., 50"
                            min={1}
                            max={100}
                          />
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => onRemoveMilestone(phase.key, ms.id)}
                      className="text-theme-text-muted ml-2 p-1 hover:text-red-800 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="pl-7">
                    <label className="text-theme-text-muted mb-1 block text-xs font-medium">Notification Message</label>
                    <input
                      type="text"
                      value={ms.notification_message}
                      onChange={(e) => onUpdateMilestone(phase.key, ms.id, 'notification_message', e.target.value)}
                      className="form-input-sm"
                      placeholder="Message sent when this milestone is reached..."
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))
    )}
  </div>
);

const StepReview: React.FC<{
  info: {
    name: string;
    description: string;
    code: string;
    target_position: string;
    structure_type: ProgramStructureType;
    time_limit_days: string;
    warning_days_before: string;
    is_template: boolean;
  };
  groups: RequirementGroup[];
  phases: PhaseFormData[];
  courses: TrainingCourse[];
  requirementLibrary: TrainingRequirementEnhanced[];
}> = ({ info, groups, phases, courses, requirementLibrary }) => {
  const totalReqs = groups.reduce((sum, g) => sum + g.requirements.length, 0);
  const totalMs = groups.reduce((sum, g) => sum + g.milestones.length, 0);
  const courseNameById = new Map(courses.map((c) => [c.id, c.name]));
  const libraryById = new Map(requirementLibrary.map((r) => [r.id, r]));
  const phaseByKey = new Map(phases.map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-theme-text-primary mb-1 text-xl font-semibold">Review Your Pipeline</h2>
        <p className="text-theme-text-muted text-sm">Review all details before creating the training pipeline.</p>
      </div>

      <InfoCallout>
        <p>
          Everything is created together when you click <strong>Create Pipeline</strong>. Next, open the program and{' '}
          <strong>enroll members</strong> from its Enrollments tab — from there you can track progress, and members can
          watch their own progression from <em>My Training</em>. You can edit or duplicate the program later.
        </p>
      </InfoCallout>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        <div className="bg-theme-surface rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-red-700 dark:text-red-400">{phases.length}</p>
          <p className="text-theme-text-muted text-sm">Phases</p>
        </div>
        <div className="bg-theme-surface rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{totalReqs}</p>
          <p className="text-theme-text-muted text-sm">Requirements</p>
        </div>
        <div className="bg-theme-surface rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{totalMs}</p>
          <p className="text-theme-text-muted text-sm">Milestones</p>
        </div>
        <div className="bg-theme-surface rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-green-700 dark:text-green-400">{info.time_limit_days || '\u2014'}</p>
          <p className="text-theme-text-muted text-sm">Days Limit</p>
        </div>
      </div>

      {/* Program info */}
      <div className="bg-theme-surface rounded-lg p-4">
        <h3 className="text-theme-text-primary mb-3 text-lg font-semibold">{info.name || 'Untitled Program'}</h3>
        {info.description && <p className="text-theme-text-muted mb-3 text-sm">{info.description}</p>}
        <div className="flex flex-wrap gap-2 text-xs">
          {info.code && (
            <span className="bg-theme-surface-hover text-theme-text-secondary rounded-sm px-2 py-1">{info.code}</span>
          )}
          {info.target_position && (
            <span className="rounded-sm bg-red-500/20 px-2 py-1 text-red-700 dark:text-red-400">
              {info.target_position}
            </span>
          )}
          <span className="rounded-sm bg-blue-500/20 px-2 py-1 text-blue-700 dark:text-blue-400">
            {info.structure_type === 'phases' ? 'Phases, in order' : 'One list, any order'}
          </span>
          {info.is_template && (
            <span className="rounded-sm bg-green-500/20 px-2 py-1 text-green-700 dark:text-green-400">Template</span>
          )}
        </div>
      </div>

      {/* Phase (or program-level) details */}
      {groups.map((group) => {
        const phase = phaseByKey.get(group.key);
        return (
          <div key={group.key} className="bg-theme-surface rounded-lg p-4">
            <h4 className="text-theme-text-primary mb-2 font-medium">{group.title}</h4>
            {phase?.description && <p className="text-theme-text-muted mb-3 text-sm">{phase.description}</p>}
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              {phase?.time_limit_days && (
                <span className="bg-theme-surface-hover text-theme-text-secondary rounded-sm px-2 py-1">
                  {phase.time_limit_days} day limit
                </span>
              )}
              {phase?.requires_manual_advancement && (
                <span className="rounded-sm bg-yellow-500/20 px-2 py-1 text-yellow-700 dark:text-yellow-400">
                  Officer must approve advancement
                </span>
              )}
            </div>

            {group.requirements.length > 0 && (
              <div className="mb-2 space-y-1">
                <p className="text-theme-text-muted text-xs font-medium uppercase">Requirements:</p>
                {group.requirements.map((req) => (
                  <div key={req.id} className="text-theme-text-secondary text-sm">
                    {req.source === 'library' ? (
                      <div className="flex items-center space-x-2">
                        <Link2 className="h-3 w-3 text-blue-700 dark:text-blue-400" />
                        {req.requirement_id ? (
                          <>
                            <span>{libraryById.get(req.requirement_id)?.name ?? 'Unknown requirement'}</span>
                            <span className="text-theme-text-muted text-xs">(linked from the department)</span>
                          </>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400">
                            No requirement picked — go back and choose one, or remove the entry.
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2">
                        <ListChecks className="h-3 w-3 text-blue-700 dark:text-blue-400" />
                        <span>{req.name || 'Untitled'}</span>
                        <span className="text-theme-text-muted text-xs">({req.requirement_type})</span>
                        {req.required_hours && (
                          <span className="text-theme-text-muted text-xs">- {req.required_hours}h</span>
                        )}
                      </div>
                    )}
                    {req.required_courses.length > 0 && (
                      <p className="text-theme-text-muted pl-5 text-xs">
                        {req.required_courses.map((id) => courseNameById.get(id) ?? 'Unknown course').join(', ')}
                      </p>
                    )}
                    {req.required_courses.length === 0 && req.requirement_type === 'courses' && (
                      <p className="pl-5 text-xs text-amber-700 dark:text-amber-400">
                        No course linked — members can&apos;t earn credit for this yet.
                      </p>
                    )}
                    {req.recency_days != null && (
                      <p className="text-theme-text-muted pl-5 text-xs">
                        Must be completed within the last {req.recency_days} days
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {group.milestones.length > 0 && (
              <div className="space-y-1">
                <p className="text-theme-text-muted text-xs font-medium uppercase">Milestones:</p>
                {group.milestones.map((ms) => (
                  <div key={ms.id} className="text-theme-text-secondary flex items-center space-x-2 text-sm">
                    <Flag className="h-3 w-3 text-yellow-700 dark:text-yellow-400" />
                    <span>{ms.name || 'Untitled'}</span>
                    {ms.completion_percentage_threshold && (
                      <span className="text-theme-text-muted text-xs">at {ms.completion_percentage_threshold}%</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ==================== Main Component ====================

const CreatePipelinePage: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<WizardStep>('info');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Program info state
  const [info, setInfo] = useState({
    name: '',
    description: '',
    code: '',
    target_position: '',
    structure_type: 'phases' as ProgramStructureType,
    time_limit_days: '',
    warning_days_before: '30',
    is_template: false,
  });

  // Phases state
  const [phases, setPhases] = useState<PhaseFormData[]>([]);
  // Requirements/milestones for a program that isn't split into phases.
  const [programRequirements, setProgramRequirements] = useState<RequirementFormData[]>([]);
  const [programMilestones, setProgramMilestones] = useState<MilestoneFormData[]>([]);

  // Course catalog backing the course/certification requirement pickers.
  const { courses, loading: coursesLoading, error: coursesError } = useCourseLibrary();
  // The department's existing requirements, for phases that link rather than define.
  const {
    requirements: requirementLibrary,
    loading: requirementLibraryLoading,
    error: requirementLibraryError,
  } = useRequirementLibrary();

  const usesPhases = info.structure_type === 'phases';

  // A one-list program has no phases, so the Phases step is skipped entirely
  // rather than shown as a step the officer must pass through and leave empty.
  const wizardSteps = usesPhases ? ALL_WIZARD_STEPS : ALL_WIZARD_STEPS.filter((s) => s.key !== 'phases');

  // The buckets the Requirements/Milestones steps work on.
  const groups: RequirementGroup[] = usesPhases
    ? phases.map((p) => ({
        key: p.id,
        title: `Phase ${p.phase_number}: ${p.name || 'Untitled'}`,
        requirements: p.requirements,
        milestones: p.milestones,
      }))
    : [
        {
          key: PROGRAM_GROUP,
          title: 'Requirements for this program',
          requirements: programRequirements,
          milestones: programMilestones,
        },
      ];

  // ---- Step navigation ----
  const stepIndex = wizardSteps.findIndex((s) => s.key === currentStep);

  const canGoNext = () => {
    if (currentStep === 'info') return info.name.trim().length > 0;
    return true;
  };

  const goNext = () => {
    const idx = wizardSteps.findIndex((s) => s.key === currentStep);
    const next = wizardSteps[idx + 1];
    if (idx < wizardSteps.length - 1 && next) setCurrentStep(next.key);
  };

  const goBack = () => {
    const idx = wizardSteps.findIndex((s) => s.key === currentStep);
    const prev = wizardSteps[idx - 1];
    if (idx > 0 && prev) setCurrentStep(prev.key);
  };

  // ---- Info handlers ----
  const handleInfoChange = (field: string, value: string | boolean) => {
    setInfo((prev) => ({ ...prev, [field]: value }));
    // Switching to a one-list program while sitting on the Phases step would
    // leave the wizard showing a step that no longer exists.
    if (field === 'structure_type' && value !== 'phases' && currentStep === 'phases') {
      setCurrentStep('requirements');
    }
  };

  // ---- Phase handlers ----
  const addPhase = () => {
    setPhases((prev) => [...prev, emptyPhase(prev.length + 1)]);
  };

  const removePhase = (id: string) => {
    setPhases((prev) => {
      const filtered = prev.filter((p) => p.id !== id);
      return filtered.map((p, i) => ({ ...p, phase_number: i + 1 }));
    });
  };

  const updatePhase = (id: string, field: string, value: string | boolean) => {
    setPhases((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const togglePhaseExpand = (id: string) => {
    setPhases((prev) => prev.map((p) => (p.id === id ? { ...p, isExpanded: !p.isExpanded } : p)));
  };

  // ---- Requirement handlers ----
  // Each handler edits either one phase's list or the program-level list,
  // depending on the group key the step passed back.
  const editRequirements = (
    groupKey: string,
    transform: (requirements: RequirementFormData[]) => RequirementFormData[]
  ) => {
    if (groupKey === PROGRAM_GROUP) {
      setProgramRequirements(transform);
      return;
    }
    setPhases((prev) => prev.map((p) => (p.id === groupKey ? { ...p, requirements: transform(p.requirements) } : p)));
  };

  const addRequirement = (groupKey: string, source: 'library' | 'new') => {
    editRequirements(groupKey, (reqs) => [...reqs, emptyRequirement(reqs.length, source)]);
  };

  const removeRequirement = (groupKey: string, reqId: string) => {
    editRequirements(groupKey, (reqs) => reqs.filter((r) => r.id !== reqId));
  };

  const updateRequirement = (
    groupKey: string,
    reqId: string,
    field: string,
    value: string | boolean | string[] | ChecklistItem[] | number | undefined
  ) => {
    editRequirements(groupKey, (reqs) => reqs.map((r) => (r.id === reqId ? { ...r, [field]: value } : r)));
  };

  // ---- Milestone handlers ----
  const editMilestones = (groupKey: string, transform: (milestones: MilestoneFormData[]) => MilestoneFormData[]) => {
    if (groupKey === PROGRAM_GROUP) {
      setProgramMilestones(transform);
      return;
    }
    setPhases((prev) => prev.map((p) => (p.id === groupKey ? { ...p, milestones: transform(p.milestones) } : p)));
  };

  const addMilestone = (groupKey: string) => {
    editMilestones(groupKey, (ms) => [...ms, emptyMilestone()]);
  };

  const removeMilestone = (groupKey: string, msId: string) => {
    editMilestones(groupKey, (ms) => ms.filter((m) => m.id !== msId));
  };

  const updateMilestone = (groupKey: string, msId: string, field: string, value: string) => {
    editMilestones(groupKey, (ms) => ms.map((m) => (m.id === msId ? { ...m, [field]: value } : m)));
  };

  const moveMilestone = (groupKey: string, msId: string, direction: 'up' | 'down') => {
    editMilestones(groupKey, (ms) => {
      const idx = ms.findIndex((m) => m.id === msId);
      if (idx < 0) return ms;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= ms.length) return ms;
      const updated = [...ms];
      const a = updated[idx];
      const b = updated[swapIdx];
      if (a && b) {
        updated[idx] = b;
        updated[swapIdx] = a;
      }
      return updated;
    });
  };

  /**
   * Everything the server would reject, checked here first so the message names
   * the phase and the field. A 422 from the build endpoint identifies the
   * offending item only by its position in a nested payload, which tells the
   * officer nothing about which card on screen to go and fix.
   */
  const firstProblem = (): string | null => {
    if (usesPhases) {
      const unnamedPhase = phases.find((p) => !p.name.trim());
      if (unnamedPhase) {
        return `Phase ${unnamedPhase.phase_number} needs a name.`;
      }
    }
    for (const group of groups) {
      for (const req of group.requirements) {
        if (req.source === 'library' && !req.requirement_id) {
          return `${group.title} has a linked requirement with nothing picked. Choose one or remove it.`;
        }
        if (req.source === 'new' && !req.name.trim()) {
          return `${group.title} has a requirement with no name. Name it or remove it.`;
        }
        // A count-based requirement with no target can never reach 100%, so the
        // member would be stuck on it forever with no way to finish the program.
        const missingTarget =
          (req.requirement_type === 'hours' && !req.required_hours.trim()) ||
          (req.requirement_type === 'shifts' && !req.required_shifts.trim()) ||
          (req.requirement_type === 'calls' && !req.required_calls.trim());
        if (req.source === 'new' && missingTarget) {
          return `"${req.name.trim()}" in ${group.title} needs a number to count toward, or nobody can ever complete it.`;
        }
      }
      for (const ms of group.milestones) {
        if (!ms.name.trim()) {
          return `${group.title} has a milestone with no name. Name it or remove it.`;
        }
      }
    }
    return null;
  };

  // ---- Submit ----
  const handleSubmit = async () => {
    const problem = firstProblem();
    if (problem) {
      setError(problem);
      toast.error(problem);
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      // Build the whole structure (program + phases + requirements +
      // milestones) as one nested payload. The backend persists it in a single
      // transaction, so a failure part-way can't leave an orphaned, half-built
      // program behind — unlike the old one-request-per-entity flow.
      const payload: ProgramBuildRequest = {
        program: {
          name: info.name,
          description: info.description || undefined,
          code: info.code || undefined,
          target_position: info.target_position || undefined,
          structure_type: info.structure_type,
          time_limit_days: info.time_limit_days ? parseInt(info.time_limit_days) : undefined,
          warning_days_before: info.warning_days_before ? parseInt(info.warning_days_before) : undefined,
          is_template: info.is_template,
        },
        phases: usesPhases
          ? phases.map((phaseData) => ({
              phase_number: phaseData.phase_number,
              name: phaseData.name,
              description: phaseData.description || undefined,
              time_limit_days: phaseData.time_limit_days ? parseInt(phaseData.time_limit_days) : undefined,
              requires_manual_advancement: phaseData.requires_manual_advancement,
              requirements: phaseData.requirements.map(toRequirementPayload),
              milestones: phaseData.milestones.map(toMilestonePayload),
            }))
          : [],
        // A one-list program hangs its requirements off the program itself.
        requirements: usesPhases ? [] : programRequirements.map(toRequirementPayload),
        milestones: usesPhases ? [] : programMilestones.map(toMilestonePayload),
      };

      const program = await trainingProgramService.buildProgram(payload);

      toast.success('Training pipeline created successfully!');
      void navigate(`/training/programs/${program.id}`);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to create pipeline';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center space-x-4">
          <button
            onClick={() => void navigate('/training/programs')}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded-lg p-2"
            aria-label="Back to programs"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-theme-text-primary flex items-center space-x-2 text-2xl font-bold">
              <GraduationCap className="h-7 w-7 text-red-500" />
              <span>Create Training Pipeline</span>
            </h1>
            <p className="text-theme-text-muted text-sm">Step-by-step wizard to build your training program</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="bg-theme-surface mb-8 flex items-center rounded-lg p-3">
          {wizardSteps.map((step, i) => {
            const StepIcon = step.icon;
            const isActive = step.key === currentStep;
            const isComplete = i < stepIndex;

            return (
              <React.Fragment key={step.key}>
                {i > 0 && (
                  <div className={`mx-2 h-0.5 flex-1 ${isComplete ? 'bg-red-500' : 'bg-theme-surface-border'}`} />
                )}
                <button
                  onClick={() => {
                    if (i <= stepIndex || canGoNext()) setCurrentStep(step.key);
                  }}
                  className={`flex items-center space-x-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-red-600 text-white'
                      : isComplete
                        ? 'hover:bg-theme-surface-hover text-red-700 dark:text-red-400'
                        : 'text-theme-text-muted hover:text-theme-text-secondary'
                  }`}
                >
                  {isComplete ? <Check className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
                  <span className="hidden sm:inline">{step.label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Step content */}
        <div className="card-secondary mb-6 p-6">
          {error && (
            <div className="mb-4 rounded-sm border border-red-500 bg-red-500/10 px-4 py-3 text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {currentStep === 'info' && <StepInfo data={info} onChange={handleInfoChange} />}
          {currentStep === 'phases' && (
            <StepPhases
              phases={phases}
              onAdd={addPhase}
              onRemove={removePhase}
              onUpdate={updatePhase}
              onToggleExpand={togglePhaseExpand}
            />
          )}
          {currentStep === 'requirements' && (
            <StepRequirements
              groups={groups}
              usesPhases={usesPhases}
              courses={courses}
              coursesLoading={coursesLoading}
              coursesError={coursesError}
              requirementLibrary={requirementLibrary}
              requirementLibraryLoading={requirementLibraryLoading}
              requirementLibraryError={requirementLibraryError}
              onAddRequirement={addRequirement}
              onRemoveRequirement={removeRequirement}
              onUpdateRequirement={updateRequirement}
            />
          )}
          {currentStep === 'milestones' && (
            <StepMilestones
              groups={groups}
              onAddMilestone={addMilestone}
              onRemoveMilestone={removeMilestone}
              onUpdateMilestone={updateMilestone}
              onMoveMilestone={moveMilestone}
            />
          )}
          {currentStep === 'review' && (
            <StepReview
              info={info}
              groups={groups}
              phases={phases}
              courses={courses}
              requirementLibrary={requirementLibrary}
            />
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={goBack}
            disabled={stepIndex === 0}
            className="bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover flex items-center space-x-2 rounded-lg px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </button>

          {currentStep === 'review' ? (
            <button
              onClick={() => {
                void handleSubmit();
              }}
              disabled={isSubmitting || !info.name.trim()}
              className="btn-primary flex items-center space-x-2 px-6"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>Create Pipeline</span>
                </>
              )}
            </button>
          ) : (
            <button onClick={goNext} disabled={!canGoNext()} className="btn-primary flex items-center space-x-2">
              <span>Next</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </main>
    </div>
  );
};

export default CreatePipelinePage;
