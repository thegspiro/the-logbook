/**
 * Skill Template Builder Page
 *
 * Desktop-optimized form for creating and editing skill evaluation templates.
 * Officers build templates with sections and criteria at a station computer.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Plus, Trash2, GripVertical, ClipboardCheck, Save, Send, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import { trainingProgramService, trainingModuleConfigService, roleService } from '../services/api';
import type { TrainingRequirementEnhanced, TrainingModuleConfig as TMConfig } from '../types/training';
import type { Role } from '../types/role';
import { ConfirmDialog } from '../components/ux';
import { ErrorSummary } from '../components/ux/ErrorSummary';
import { FIELD_ERROR_CLASS, FormField } from '../components/ux/FormField';
import {
  placeApiError,
  useFieldErrors,
  type FieldErrors,
  type FieldSpecs,
  type SummaryItem,
} from '../hooks/useFieldErrors';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { useConfirm } from '../contexts/ConfirmContext';
import { firstRefused, saveExceptRefused } from '../utils/saveExceptRefused';
import { TrainingPageHeader } from '../components/training/TrainingPageHeader';
import { blankToNull } from '../utils/formValues';
import { CriterionScoreMode, SCORE_MODE_TYPES } from '../types/skillsTesting';
import type {
  SkillTemplateSectionCreate,
  SkillCriterionCreate,
  CriterionType,
  ResultDisclosure,
  ResultRelease,
} from '../types/skillsTesting';

/**
 * The template's own settings a save can refuse, by the request key they
 * write, in the order they appear. `sections` is the whole sheet: the update
 * replaces every section on each save, so a sheet with an open error keeps
 * the stored one rather than saving part of it.
 */
type TemplateField =
  'name' | 'category' | 'time_limit_seconds' | 'passing_percentage' | 'valid_for_months' | 'sections';

// Limits mirror SkillTemplateCreate (name 255, category 100, passing 0-100,
// valid_for_months 1-MAX_VALID_FOR_MONTHS).
const NAME_MAX_LENGTH = 255;
const CATEGORY_MAX_LENGTH = 100;
const MAX_VALID_FOR_MONTHS = 120;

const TEMPLATE_FIELDS: FieldSpecs<TemplateField> = {
  name: { id: 'template-template-name', label: 'Template name' },
  category: { id: 'template-category', label: 'Category' },
  time_limit_seconds: { id: 'template-global-time-limit-minutes', label: 'Global time limit' },
  passing_percentage: { id: 'template-passing-percentage', label: 'Passing percentage' },
  valid_for_months: { id: 'template-valid-for-months', label: 'Valid for' },
  sections: { id: 'template-sections', label: 'Evaluation sections' },
};
const TEMPLATE_ORDER = Object.keys(TEMPLATE_FIELDS) as TemplateField[];

/** One open error on the sheet, keyed by the DOM id of the control it belongs to. */
type SheetErrors = Record<string, string>;

const sectionNameId = (localId: string) => `section-name-${localId}`;

/**
 * A 422 placed on the template's settings, with every entry about the sheet
 * (`sections.N.criteria.M.label`, …) put on the sheet as a whole: its last
 * key would otherwise land on a setting of the same name — a section's `name`
 * on the template name.
 */
function placeTemplateError(error: unknown): { fieldErrors: FieldErrors<TemplateField>; unmatched: string[] } | null {
  const response = (error as { response?: { status?: number; data?: { detail?: unknown } } } | null)?.response;
  const detail = response?.data?.detail;
  if (response?.status !== 422 || !Array.isArray(detail)) return null;
  const entries = detail as Array<{ loc?: unknown[]; msg?: string; message?: string }>;
  const aboutSheet = entries.filter((entry) => Array.isArray(entry.loc) && entry.loc.includes('sections'));
  const rest = entries.filter((entry) => !aboutSheet.includes(entry));
  const placed = placeApiError(TEMPLATE_FIELDS, { response: { status: 422, data: { detail: rest } } }) ?? {
    fieldErrors: {},
    unmatched: [],
  };
  if (aboutSheet.length > 0) {
    placed.fieldErrors.sections = aboutSheet
      .map((entry) => (entry.message || entry.msg || 'Invalid value').replace(/^Value error, /, ''))
      .join(' ');
  }
  return placed;
}

/** Empty value means "inherit"; the label names what that resolves to. */
const DISCLOSURE_CHOICES = [
  { value: 'full', label: 'Full results — scores and examiner notes' },
  { value: 'scores', label: 'Scores only — pass/fail and points, no written notes' },
  { value: 'none', label: 'Nothing — results are never shown to the member' },
];

const RELEASE_CHOICES = [
  { value: 'on_completion', label: 'As soon as the examiner submits' },
  { value: 'on_release', label: 'Only after an officer releases the result' },
];

function labelFor(choices: { value: string; label: string }[], value: string | undefined): string {
  return choices.find((c) => c.value === value)?.label ?? value ?? 'not set';
}

// ==================== Helpers ====================

function generateLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface LocalCriterion extends SkillCriterionCreate {
  localId: string;
}

interface LocalSection extends Omit<SkillTemplateSectionCreate, 'criteria'> {
  localId: string;
  criteria: LocalCriterion[];
  collapsed: boolean;
}

const CRITERION_TYPE_OPTIONS: { value: CriterionType; label: string }[] = [
  { value: 'pass_fail', label: 'Pass / Fail' },
  { value: 'score', label: 'Numeric Score' },
  { value: 'time_limit', label: 'Timed Task' },
  { value: 'checklist', label: 'Checklist' },
  { value: 'statement', label: 'Statement' },
];

/** The score-effect choices for a step judged by a pass/fail verdict.
 *
 *  '' is the stored `undefined` — for a Pass/Fail step it defers to the
 *  template-wide setting (which is all that existed before per-step modes, and
 *  is why leaving it alone must keep scoring identically); for the other types
 *  nothing has ever deferred, so it simply means no effect. */
const SCORE_MODE_CHOICES = [
  { value: CriterionScoreMode.NONE, label: 'Recorded only — no effect on the score' },
  { value: CriterionScoreMode.POINTS, label: 'Worth points — earned by passing' },
  { value: CriterionScoreMode.DEDUCT, label: 'Deducts points — taken off if failed' },
];

function createEmptyCriterion(sortOrder: number): LocalCriterion {
  return {
    localId: generateLocalId(),
    label: '',
    type: 'pass_fail',
    required: false,
    sort_order: sortOrder,
  };
}

function createEmptySection(sortOrder: number): LocalSection {
  return {
    localId: generateLocalId(),
    name: '',
    sort_order: sortOrder,
    criteria: [createEmptyCriterion(0)],
    collapsed: false,
  };
}

// ==================== Criterion Editor ====================

const CriterionEditor: React.FC<{
  criterion: LocalCriterion;
  onChange: (updated: LocalCriterion) => void;
  onRemove: () => void;
  index: number;
  /** The template-wide Pass/Fail setting, so the "template default" choice can
   *  say what it currently resolves to instead of leaving the author to guess. */
  scorePassFailCriteria: boolean;
  /** Open errors on the sheet, by control id; editing a control answers its own. */
  errors: SheetErrors;
  onFieldEdit: (id: string) => void;
}> = ({ criterion, onChange, onRemove, index, scorePassFailCriteria, errors, onFieldEdit }) => {
  const [checklistText, setChecklistText] = useState((criterion.checklist_items ?? []).join('\n'));
  const aria = (id: string, describedBy?: string) =>
    errors[id]
      ? { 'aria-invalid': true as const, 'aria-describedby': [`${id}-error`, describedBy].filter(Boolean).join(' ') }
      : describedBy
        ? { 'aria-describedby': describedBy }
        : {};
  const message = (id: string) =>
    errors[id] ? (
      <p id={`${id}-error`} className={`mt-1 text-xs ${FIELD_ERROR_CLASS}`}>
        {errors[id]}
      </p>
    ) : null;
  const labelId = `criterion-criterion-label-${criterion.localId}`;
  const maxId = `criterion-max-points-${criterion.localId}`;
  const passingId = `criterion-passing-points-${criterion.localId}`;
  const checklistId = `criterion-checklist-items-one-per-line-${criterion.localId}`;
  const statementId = `criterion-statement-text-${criterion.localId}`;
  const modeId = `criterion-if-this-step-is-failed-${criterion.localId}`;
  const takesScoreMode = SCORE_MODE_TYPES.includes(criterion.type);
  const mode = criterion.score_mode;

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="text-theme-text-muted mt-2 flex cursor-grab items-center">
          <GripVertical className="h-4 w-4" />
          <span className="ml-1 font-mono text-xs">{index + 1}</span>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-12">
          {/* Label */}
          <div className="lg:col-span-4">
            <label
              htmlFor={`criterion-criterion-label-${criterion.localId}`}
              className="text-theme-text-muted mb-1 block text-xs font-medium"
            >
              Criterion Label{' '}
              <span className={FIELD_ERROR_CLASS} aria-hidden="true">
                *
              </span>
            </label>
            <input
              id={labelId}
              type="text"
              value={criterion.label}
              onChange={(e) => {
                onChange({ ...criterion, label: e.target.value });
                onFieldEdit(labelId);
              }}
              placeholder="e.g., Dons SCBA within 60 seconds"
              className="form-input px-3 text-sm"
              maxLength={NAME_MAX_LENGTH}
              aria-required="true"
              {...aria(labelId)}
            />
            {message(labelId)}
          </div>

          {/* Type */}
          <div className="lg:col-span-2">
            <label
              htmlFor={`criterion-type-${criterion.localId}`}
              className="text-theme-text-muted mb-1 block text-xs font-medium"
            >
              Type
            </label>
            <select
              id={`criterion-type-${criterion.localId}`}
              value={criterion.type}
              onChange={(e) => onChange({ ...criterion, type: e.target.value as CriterionType })}
              className="form-input px-3 text-sm"
            >
              {CRITERION_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Type-specific fields */}
          {criterion.type === 'score' && (
            <>
              <div className="lg:col-span-2">
                <label
                  htmlFor={`criterion-max-points-${criterion.localId}`}
                  className="text-theme-text-muted mb-1 block text-xs font-medium"
                >
                  Max Points
                </label>
                <input
                  id={maxId}
                  type="number"
                  min="1"
                  value={criterion.max_score ?? ''}
                  onChange={(e) => {
                    onChange({ ...criterion, max_score: e.target.value ? Number(e.target.value) : undefined });
                    onFieldEdit(maxId);
                  }}
                  placeholder="3"
                  className="form-input px-3 text-sm"
                  {...aria(maxId)}
                />
                {message(maxId)}
                {/* A scored step with no maximum carries no points at all —
                    the percentage is computed from max_score, so the step is
                    on the sheet, is marked by the examiner, and contributes
                    nothing. Said here as well as in the save-time errors
                    because this is where the author can still fix it. */}
                {!errors[maxId] && (criterion.max_score == null || criterion.max_score <= 0) && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Without a maximum this step earns no points toward the score.
                  </p>
                )}
              </div>
              {/* A passing threshold only means anything on a critical
                  criterion: a non-critical one contributes its points to the
                  overall score and cannot fail the test on its own, so asking
                  for a threshold there invites an answer that is then ignored.
                  The field used to render always, with a "(critical only)"
                  hint doing the explaining. */}
              {criterion.required && (
                <div className="lg:col-span-2">
                  <label
                    htmlFor={`criterion-passing-points-${criterion.localId}`}
                    className="text-theme-text-muted mb-1 block text-xs font-medium"
                  >
                    Passing Points
                  </label>
                  <input
                    id={passingId}
                    type="number"
                    min="0"
                    value={criterion.passing_score ?? ''}
                    onChange={(e) => {
                      onChange({ ...criterion, passing_score: e.target.value ? Number(e.target.value) : undefined });
                      onFieldEdit(passingId);
                    }}
                    placeholder="2"
                    className="form-input px-3 text-sm"
                    {...aria(passingId)}
                  />
                  {message(passingId)}
                </div>
              )}
            </>
          )}

          {criterion.type === 'time_limit' && (
            <div className="lg:col-span-2">
              <label
                htmlFor={`criterion-time-limit-sec-${criterion.localId}`}
                className="text-theme-text-muted mb-1 block text-xs font-medium"
              >
                Time Limit (sec)
              </label>
              <input
                id={`criterion-time-limit-sec-${criterion.localId}`}
                type="number"
                min="1"
                value={criterion.time_limit_seconds ?? ''}
                onChange={(e) =>
                  onChange({ ...criterion, time_limit_seconds: e.target.value ? Number(e.target.value) : undefined })
                }
                placeholder="60"
                className="form-input px-3 text-sm"
              />
            </div>
          )}

          {criterion.type === 'checklist' && (
            <div className="lg:col-span-4">
              <label
                htmlFor={`criterion-checklist-items-one-per-line-${criterion.localId}`}
                className="text-theme-text-muted mb-1 block text-xs font-medium"
              >
                Checklist Items (one per line)
              </label>
              <textarea
                id={checklistId}
                value={checklistText}
                {...aria(checklistId)}
                onChange={(e) => {
                  setChecklistText(e.target.value);
                  onFieldEdit(checklistId);
                  onChange({
                    ...criterion,
                    checklist_items: e.target.value.split('\n').filter((l) => l.trim()),
                  });
                }}
                rows={3}
                placeholder="Check airway&#10;Assess breathing&#10;Check pulse"
                className="form-input resize-none px-3 text-sm"
              />
              {message(checklistId)}
            </div>
          )}

          {criterion.type === 'statement' && (
            <div className="lg:col-span-4">
              <label
                htmlFor={`criterion-statement-text-${criterion.localId}`}
                className="text-theme-text-muted mb-1 block text-xs font-medium"
              >
                Statement Text{' '}
                <span className={FIELD_ERROR_CLASS} aria-hidden="true">
                  *
                </span>
              </label>
              <textarea
                id={statementId}
                value={criterion.statement_text ?? ''}
                onChange={(e) => {
                  onChange({ ...criterion, statement_text: e.target.value || undefined });
                  onFieldEdit(statementId);
                }}
                rows={3}
                placeholder="Enter the statement the evaluator must read or announce..."
                className="form-input resize-none px-3 text-sm"
                aria-required="true"
                {...aria(statementId)}
              />
              {message(statementId)}
              {/* Sheets differ on this and the difference is invisible from the
                  scorecard afterwards: an opening brief read before the
                  candidate is in position is off the clock, while a prompt
                  delivered mid-evolution runs against the time limit. */}
              <label className="mt-2 flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={criterion.starts_timer ?? false}
                  onChange={(e) => onChange({ ...criterion, starts_timer: e.target.checked })}
                  className="border-theme-surface-border focus:ring-theme-focus-ring mt-0.5 rounded-sm text-blue-600"
                />
                <span>
                  <span className="text-theme-text-primary text-xs">Read inside the time limit</span>
                  <p className="text-theme-text-muted text-xs">
                    The examiner gets a &ldquo;Start clock &amp; read&rdquo; button on this statement. Leave off for an
                    opening brief read before the clock starts.
                  </p>
                </span>
              </label>
            </div>
          )}

          {/* Score effect — how a failure on this step moves the percentage.
              Deliberately separate from Critical: those are different questions
              ("what does this cost?" vs "does this end the test?"), and with
              only the second one available a recorded Fail could sit on a
              scorecard above a 100%. */}
          {takesScoreMode && (
            <div className="lg:col-span-4">
              <label
                htmlFor={`criterion-if-this-step-is-failed-${criterion.localId}`}
                className="text-theme-text-muted mb-1 block text-xs font-medium"
              >
                If this step is failed
              </label>
              <div className="flex gap-2">
                <select
                  id={modeId}
                  value={mode ?? ''}
                  aria-label={`Score effect for criterion ${index + 1}`}
                  {...aria(modeId)}
                  onChange={(e) => {
                    onFieldEdit(modeId);
                    const next = e.target.value as CriterionScoreMode | '';
                    onChange({
                      ...criterion,
                      score_mode: next === '' ? undefined : next,
                      // Drop a stale penalty when the step stops deducting, so
                      // a number the author can no longer see cannot come back
                      // into force if they switch the mode again later.
                      deduction_points: next === CriterionScoreMode.DEDUCT ? criterion.deduction_points : undefined,
                    });
                  }}
                  className="form-input min-w-0 flex-1 px-3 text-sm"
                >
                  <option value="">
                    {criterion.type === 'pass_fail'
                      ? `Template default (${scorePassFailCriteria ? 'worth points' : 'no effect'})`
                      : 'Recorded only — no effect on the score'}
                  </option>
                  {SCORE_MODE_CHOICES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {mode === CriterionScoreMode.POINTS && (
                  <input
                    type="number"
                    min="1"
                    step="any"
                    aria-label={`Points for criterion ${index + 1}`}
                    value={criterion.max_score ?? ''}
                    onChange={(e) =>
                      onChange({ ...criterion, max_score: e.target.value ? Number(e.target.value) : undefined })
                    }
                    placeholder="1"
                    className="form-input w-20 shrink-0 px-3 text-sm"
                  />
                )}
                {mode === CriterionScoreMode.DEDUCT && (
                  <input
                    type="number"
                    min="0"
                    step="any"
                    aria-label={`Points off for criterion ${index + 1}`}
                    value={criterion.deduction_points ?? ''}
                    onChange={(e) =>
                      onChange({ ...criterion, deduction_points: e.target.value ? Number(e.target.value) : undefined })
                    }
                    placeholder="1"
                    className="form-input w-20 shrink-0 px-3 text-sm"
                  />
                )}
              </div>
              {message(modeId)}
              {mode === CriterionScoreMode.POINTS && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  Adds {criterion.max_score && criterion.max_score > 0 ? criterion.max_score : 1} to the points
                  available; a fail earns none of them.
                </p>
              )}
              {mode === CriterionScoreMode.DEDUCT && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  Takes {criterion.deduction_points && criterion.deduction_points > 0 ? criterion.deduction_points : 1}{' '}
                  off the total, without changing the points available. Not charged if the step is left unscored.
                </p>
              )}
            </div>
          )}

          {/* Required toggle */}
          <div className="flex items-end lg:col-span-2">
            <label className="flex cursor-pointer items-center gap-2 md:items-start">
              <input
                type="checkbox"
                checked={criterion.required}
                onChange={(e) => onChange({ ...criterion, required: e.target.checked })}
                className="border-theme-surface-border focus:ring-theme-focus-ring rounded-sm text-blue-600 md:mt-1"
              />
              <div>
                <span className="text-theme-text-primary text-sm">Critical</span>
                <p className="text-theme-text-muted text-xs">Must pass to pass the test</p>
              </div>
            </label>
          </div>
        </div>

        {/* Description */}
        <div className="hidden w-48 shrink-0 xl:block">
          <label
            htmlFor={`criterion-description-${criterion.localId}`}
            className="text-theme-text-muted mb-1 block text-xs font-medium"
          >
            Description
          </label>
          <input
            id={`criterion-description-${criterion.localId}`}
            type="text"
            value={criterion.description ?? ''}
            onChange={(e) => onChange({ ...criterion, description: e.target.value || undefined })}
            placeholder="Optional notes"
            className="form-input px-3 text-sm"
          />
        </div>

        {/* Remove button */}
        <button
          type="button"
          onClick={onRemove}
          className="touch:min-h-11 touch:min-w-11 mt-6 inline-flex items-center justify-center rounded-sm p-1.5 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30"
          title="Remove criterion"
          aria-label="Remove criterion"
        >
          <Trash2 className="h-4 w-4 text-red-500" />
        </button>
      </div>
    </div>
  );
};

// ==================== Section Editor ====================

const SectionEditor: React.FC<{
  section: LocalSection;
  onChange: (updated: LocalSection) => void;
  onRemove: () => void;
  index: number;
  scorePassFailCriteria: boolean;
  errors: SheetErrors;
  onFieldEdit: (id: string) => void;
}> = ({ section, onChange, onRemove, index, scorePassFailCriteria, errors, onFieldEdit }) => {
  const nameId = sectionNameId(section.localId);
  const addCriterion = () => {
    onChange({
      ...section,
      criteria: [...section.criteria, createEmptyCriterion(section.criteria.length)],
    });
  };

  const updateCriterion = (criterionIndex: number, updated: LocalCriterion) => {
    const criteria = [...section.criteria];
    criteria[criterionIndex] = updated;
    onChange({ ...section, criteria });
  };

  const removeCriterion = (criterionIndex: number) => {
    if (section.criteria.length <= 1) {
      toast.error('A section must have at least one criterion');
      return;
    }
    const criteria = section.criteria.filter((_, i) => i !== criterionIndex);
    onChange({ ...section, criteria });
  };

  return (
    <div className="card overflow-hidden">
      {/* Section Header */}
      <div className="bg-theme-surface-hover/50 border-theme-surface-border flex items-center gap-3 border-b px-4 py-3">
        <GripVertical className="text-theme-text-muted h-5 w-5 cursor-grab" />
        <span className="text-theme-text-muted text-sm font-bold">Section {index + 1}</span>

        <div className="flex flex-1 gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <input
              id={nameId}
              type="text"
              value={section.name}
              onChange={(e) => {
                onChange({ ...section, name: e.target.value });
                onFieldEdit(nameId);
              }}
              aria-label="Section name"
              placeholder="Section name (e.g., SCBA Operations)"
              className="form-input px-3 py-1.5 text-sm font-medium"
              maxLength={NAME_MAX_LENGTH}
              aria-required="true"
              {...(errors[nameId] ? { 'aria-invalid': true as const, 'aria-describedby': `${nameId}-error` } : {})}
            />
            {errors[nameId] && (
              <p id={`${nameId}-error`} className={`mt-1 text-xs ${FIELD_ERROR_CLASS}`}>
                {errors[nameId]}
              </p>
            )}
          </div>
          <input
            type="text"
            value={section.description ?? ''}
            onChange={(e) => onChange({ ...section, description: e.target.value || undefined })}
            aria-label="Section description"
            placeholder="Description (optional)"
            className="form-input hidden flex-1 px-3 py-1.5 text-sm lg:block"
          />
        </div>

        <button
          type="button"
          onClick={() => onChange({ ...section, collapsed: !section.collapsed })}
          className="hover:bg-theme-surface-hover touch:min-h-11 touch:min-w-11 inline-flex items-center justify-center rounded-sm p-1.5 transition-colors"
          aria-label={section.collapsed ? 'Expand section' : 'Collapse section'}
          aria-expanded={!section.collapsed}
        >
          {section.collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="touch:min-h-11 touch:min-w-11 inline-flex items-center justify-center rounded-sm p-1.5 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30"
          title="Remove section"
          aria-label="Remove section"
        >
          <Trash2 className="h-4 w-4 text-red-500" />
        </button>
      </div>

      {/* Criteria */}
      {!section.collapsed && (
        <div className="space-y-3 p-4">
          {section.criteria.map((criterion, i) => (
            <CriterionEditor
              key={criterion.localId}
              criterion={criterion}
              onChange={(updated) => updateCriterion(i, updated)}
              onRemove={() => removeCriterion(i)}
              index={i}
              scorePassFailCriteria={scorePassFailCriteria}
              errors={errors}
              onFieldEdit={onFieldEdit}
            />
          ))}

          <button
            type="button"
            onClick={addCriterion}
            className="border-theme-surface-border touch:min-h-11 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-red-800 transition-colors hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20"
          >
            <Plus className="h-4 w-4" />
            Add Criterion
          </button>
        </div>
      )}
    </div>
  );
};

// ==================== Main Builder Page ====================

export const SkillTemplateBuilderPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id) && id !== 'new';

  const {
    currentTemplate,
    templateLoading,
    loadTemplate,
    createTemplate,
    updateTemplate,
    publishTemplate,
    clearCurrentTemplate,
    clearError,
    error: storeError,
  } = useSkillsTestingStore();
  const { confirm } = useConfirm();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [visibility, setVisibility] = useState<string>('all_members');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number | undefined>();
  const [passingPercentage, setPassingPercentage] = useState<number | undefined>();
  const [validForMonths, setValidForMonths] = useState<number | undefined>();
  const [requireAllCritical, setRequireAllCritical] = useState(true);
  // Off by default so a new template's percentage means the same thing as every
  // one already on record: points from scored steps only.
  const [scorePassFailCriteria, setScorePassFailCriteria] = useState(false);
  const [tags, setTags] = useState('');
  const [requirementId, setRequirementId] = useState<string>('');
  const [requirements, setRequirements] = useState<TrainingRequirementEnhanced[]>([]);
  // '' means "inherit the department default" — the column is nullable, and an
  // empty select value maps back to null on save.
  const [resultDisclosure, setResultDisclosure] = useState<string>('');
  const [resultRelease, setResultRelease] = useState<string>('');
  const [viewerPositions, setViewerPositions] = useState<string[]>([]);
  const [positions, setPositions] = useState<Role[]>([]);
  const [orgConfig, setOrgConfig] = useState<TMConfig | null>(null);
  const [sections, setSections] = useState<LocalSection[]>([createEmptySection(0)]);
  const [isSaving, setIsSaving] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  // Open errors on the settings (useFieldErrors) and on the sheet (by control
  // id). Each stays flagged until it is fixed (owner rule, 2026-11-05).
  const fieldErrors = useFieldErrors(TEMPLATE_FIELDS);
  const [sheetErrors, setSheetErrors] = useState<SummaryItem[]>([]);
  const [summaryFocus, setSummaryFocus] = useState(0);
  const sheetErrorMap: SheetErrors = Object.fromEntries(sheetErrors.map((item) => [item.id, item.message]));
  const clearSheetError = useCallback(
    (id: string) =>
      setSheetErrors((prev) => (prev.some((item) => item.id === id) ? prev.filter((item) => item.id !== id) : prev)),
    []
  );
  // A save that left a refused setting out must not have the stored template
  // it returns re-seed the form: that would put the stored value back over
  // what was typed, and the flag would sit on a field showing something else.
  const keepTyped = useRef(false);
  // Bumped with each seed from the stored template, to retake the baseline.
  const [seedVersion, setSeedVersion] = useState(0);

  // Load the org's training requirements for the optional pipeline link.
  useEffect(() => {
    void (async () => {
      try {
        setRequirements(await trainingProgramService.getRequirementsEnhanced());
      } catch {
        // Non-fatal — the requirement link is optional.
      }
    })();
  }, []);

  // Corporate positions for the extra-viewer grants, and the department's
  // disclosure defaults so "Inherit" can say what it actually resolves to.
  // Both are non-fatal: the disclosure block still works without them, it just
  // cannot name the inherited value or offer a position list.
  useEffect(() => {
    void (async () => {
      try {
        // Sorted by name, not by the order the API returns.
        //
        // `list_roles` orders by `priority DESC`, which is an *authorization*
        // ranking — "higher priority = more powerful" — not an org chart. IT
        // Manager is seeded at 100, above Fire Chief at 95, so the rank order
        // opens this list with the most privileged account rather than the
        // most senior officer. That reads as a recommendation here, and it
        // isn't one.
        //
        // Rank order earns nothing anyway in a checkbox list someone is
        // scanning for a specific title, which is what this is: alphabetical
        // is the order you can predict before you look.
        const roles = await roleService.getRoles();
        setPositions([...roles].sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        // Non-fatal — position grants are optional.
      }
    })();
    void (async () => {
      try {
        setOrgConfig(await trainingModuleConfigService.getConfig());
      } catch {
        // Non-fatal — only affects the wording of the inherit options.
      }
    })();
  }, []);

  // Load template data for editing
  useEffect(() => {
    if (isEditing && id) {
      void loadTemplate(id);
    }
    return () => clearCurrentTemplate();
  }, [id, isEditing, loadTemplate, clearCurrentTemplate]);

  // Populate form when template data loads
  useEffect(() => {
    if (keepTyped.current) {
      keepTyped.current = false;
      return;
    }
    if (currentTemplate && isEditing) {
      setSeedVersion((n) => n + 1);
      setName(currentTemplate.name);
      setDescription(currentTemplate.description ?? '');
      setCategory(currentTemplate.category ?? '');
      setVisibility(currentTemplate.visibility ?? 'all_members');
      setTimeLimitMinutes(
        currentTemplate.time_limit_seconds != null ? currentTemplate.time_limit_seconds / 60 : undefined
      );
      setPassingPercentage(currentTemplate.passing_percentage ?? undefined);
      setValidForMonths(currentTemplate.valid_for_months ?? undefined);
      setRequireAllCritical(currentTemplate.require_all_critical);
      setScorePassFailCriteria(currentTemplate.score_pass_fail_criteria ?? false);
      setRequirementId(currentTemplate.requirement_id ?? '');
      setResultDisclosure(currentTemplate.result_disclosure ?? '');
      setResultRelease(currentTemplate.result_release ?? '');
      setViewerPositions(currentTemplate.result_viewer_positions ?? []);
      setTags((currentTemplate.tags ?? []).join(', '));
      setSections(
        // localId falls back to a generated one: the API serves a template's
        // sections straight out of the JSON column, and nothing ever wrote an
        // `id` into it, so `s.id` / `c.id` arrive undefined on every load. They
        // are React keys — undefined for every row means duplicate keys and a
        // list React cannot reconcile.
        currentTemplate.sections.map((s) => ({
          localId: s.id || generateLocalId(),
          name: s.name,
          description: s.description,
          sort_order: s.sort_order,
          collapsed: false,
          criteria: s.criteria.map((c) => ({
            localId: c.id || generateLocalId(),
            label: c.label,
            description: c.description,
            type: c.type,
            required: c.required,
            sort_order: c.sort_order,
            passing_score: c.passing_score,
            max_score: c.max_score,
            time_limit_seconds: c.time_limit_seconds,
            checklist_items: c.checklist_items,
            statement_text: c.statement_text,
            starts_timer: c.starts_timer ?? false,
            score_mode: c.score_mode,
            deduction_points: c.deduction_points,
          })),
        }))
      );
    }
  }, [currentTemplate, isEditing]);

  /**
   * Every open error: on the settings by field, and on the sheet as summary
   * rows that point at their control. The sheet's wording names the section
   * and criterion, so the summary reads the way the old banner did.
   */
  const validate = useCallback((): { fields: FieldErrors<TemplateField>; sheet: SummaryItem[] } => {
    const fields: FieldErrors<TemplateField> = {};
    const sheet: SummaryItem[] = [];
    if (!name.trim()) fields.name = 'Give the template a name.';
    if (passingPercentage != null && (passingPercentage < 0 || passingPercentage > 100)) {
      fields.passing_percentage = 'Enter a percentage from 0 to 100, or leave it empty.';
    }
    if (
      validForMonths != null &&
      (!Number.isInteger(validForMonths) || validForMonths < 1 || validForMonths > MAX_VALID_FOR_MONTHS)
    ) {
      fields.valid_for_months = `Enter a whole number of months from 1 to ${MAX_VALID_FOR_MONTHS}, or leave it empty.`;
    }
    if (timeLimitMinutes != null && timeLimitMinutes < 0) {
      fields.time_limit_seconds = 'Enter 0 or more minutes, or leave it empty.';
    }
    if (sections.length === 0) {
      sheet.push({
        id: TEMPLATE_FIELDS.sections.id,
        label: 'Evaluation sections',
        message: 'Add at least one section.',
      });
    }

    sections.forEach((section, si) => {
      const where = `Section ${si + 1}`;
      if (!section.name.trim()) {
        sheet.push({ id: sectionNameId(section.localId), label: where, message: 'Name is required.' });
      }
      if (section.criteria.length === 0) {
        sheet.push({
          id: sectionNameId(section.localId),
          label: where,
          message: 'At least one criterion is required.',
        });
      }
      section.criteria.forEach((criterion, ci) => {
        const at = `${where}, Criterion ${ci + 1}`;
        const cid = criterion.localId;
        if (!criterion.label.trim()) {
          sheet.push({ id: `criterion-criterion-label-${cid}`, label: at, message: 'Give the criterion a label.' });
        }
        // Scoped to critical criteria because that is where the field is now
        // shown. A non-critical criterion can still carry a stale passing_score
        // from before it was unmarked, and validating that would refuse the
        // sheet over a field the editor no longer displays — an error with no
        // reachable cause. The value is inert while non-critical, and is
        // deliberately kept rather than cleared: dropping it would silently
        // reset the threshold to 0 (pass at any score) if the criterion were
        // ever marked critical again.
        if (
          criterion.type === 'score' &&
          criterion.required &&
          criterion.max_score != null &&
          criterion.passing_score != null &&
          criterion.passing_score > criterion.max_score
        ) {
          sheet.push({
            id: `criterion-passing-points-${cid}`,
            label: at,
            message: 'Passing score cannot exceed max score.',
          });
        }
        // A scored step's points come entirely from max_score: _criterion_point_value
        // returns null without one, so the step is marked by the examiner and
        // contributes nothing to the percentage — silently. The API refuses it
        // too, so it refuses the sheet here, on the step, rather than as a 422
        // naming the whole sheet.
        if (criterion.type === 'score' && (criterion.max_score == null || criterion.max_score <= 0)) {
          sheet.push({
            id: `criterion-max-points-${cid}`,
            label: at,
            message: 'Scored steps need a max points value, or they earn nothing.',
          });
        }
        if (criterion.type === 'checklist' && (!criterion.checklist_items || criterion.checklist_items.length === 0)) {
          sheet.push({
            id: `criterion-checklist-items-one-per-line-${cid}`,
            label: at,
            message: 'At least one checklist item is required.',
          });
        }
        if (criterion.type === 'statement' && !criterion.statement_text?.trim()) {
          sheet.push({ id: `criterion-statement-text-${cid}`, label: at, message: 'Statement text is required.' });
        }
      });
    });

    // A deduction is subtracted from a point total; with no point-carrying step
    // anywhere on the sheet there is no total to subtract from, and the scorer
    // falls back to averaging per-section percentages — which quietly ignores
    // every deduction the examiner recorded. Said on the first deducting step.
    const allCriteria = sections.flatMap((s) => s.criteria);
    const deducting = allCriteria.filter(
      (c) => SCORE_MODE_TYPES.includes(c.type) && c.score_mode === CriterionScoreMode.DEDUCT
    );
    const earnsPoints = allCriteria.some((c) => {
      if (c.type === 'score') return c.max_score != null && c.max_score > 0;
      if (!SCORE_MODE_TYPES.includes(c.type)) return false;
      if (c.score_mode === CriterionScoreMode.POINTS) return true;
      return c.score_mode == null && c.type === 'pass_fail' && scorePassFailCriteria;
    });
    const firstDeducting = deducting[0];
    if (firstDeducting && !earnsPoints) {
      const si = sections.findIndex((s) => s.criteria.includes(firstDeducting));
      const ci = sections[si]?.criteria.indexOf(firstDeducting) ?? 0;
      sheet.push({
        id: `criterion-if-this-step-is-failed-${firstDeducting.localId}`,
        label: `Section ${si + 1}, Criterion ${ci + 1}`,
        message:
          `${deducting.length === 1 ? 'A step deducts points' : `${deducting.length} steps deduct points`}, but no step ` +
          'on this template earns any — there is no total for the deduction to come off. Give at least one step a ' +
          'point value first.',
      });
    }

    return { fields, sheet };
  }, [name, sections, scorePassFailCriteria, passingPercentage, validForMonths, timeLimitMinutes]);

  const buildPayload = useCallback(() => {
    const parsedTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    // Every optional field goes out as null (tags as []) when blank, never as
    // an omitted key: on an edit, exclude_unset on the backend reads an omitted
    // key as "keep the old value", so emptying the pass mark kept grading new
    // tests against it and "None" kept crediting the old requirement. Create
    // accepts the same nulls, so one builder serves both.
    return {
      name: name.trim(),
      description: blankToNull(description),
      category: blankToNull(category),
      visibility: visibility as 'all_members' | 'officers_only' | 'assigned_only',
      time_limit_seconds: timeLimitMinutes != null ? Math.round(timeLimitMinutes * 60) : null,
      passing_percentage: passingPercentage ?? null,
      valid_for_months: validForMonths ?? null,
      require_all_critical: requireAllCritical,
      score_pass_fail_criteria: scorePassFailCriteria,
      requirement_id: requirementId || null,
      result_disclosure: (resultDisclosure || null) as ResultDisclosure | null,
      result_release: (resultRelease || null) as ResultRelease | null,
      result_viewer_positions: viewerPositions.length > 0 ? viewerPositions : null,
      tags: parsedTags,
      sections: sections.map((s, si) => ({
        name: s.name.trim(),
        description: s.description?.trim() || undefined,
        sort_order: si,
        criteria: s.criteria.map((c, ci) => ({
          label: c.label.trim(),
          description: c.description?.trim() || undefined,
          type: c.type,
          required: c.required,
          sort_order: ci,
          passing_score: c.passing_score,
          max_score: c.max_score,
          time_limit_seconds: c.time_limit_seconds,
          checklist_items: c.checklist_items?.length ? c.checklist_items : undefined,
          statement_text: c.statement_text?.trim() || undefined,
          // Only sent for the types that honour it, so a step switched from
          // Pass/Fail to Statement does not carry a mode the scorer ignores —
          // and does not bring it back into force if it is switched back.
          score_mode: SCORE_MODE_TYPES.includes(c.type) ? c.score_mode : undefined,
          deduction_points:
            SCORE_MODE_TYPES.includes(c.type) && c.score_mode === CriterionScoreMode.DEDUCT
              ? c.deduction_points
              : undefined,
          // Only meaningful on a statement, and a stale true left behind by a
          // type change would put a start-clock button on a step that has no
          // statement to read.
          starts_timer: c.type === 'statement' ? (c.starts_timer ?? false) : false,
        })),
      })),
    };
  }, [
    name,
    description,
    category,
    visibility,
    timeLimitMinutes,
    passingPercentage,
    validForMonths,
    requireAllCritical,
    scorePassFailCriteria,
    requirementId,
    resultDisclosure,
    resultRelease,
    viewerPositions,
    tags,
    sections,
  ]);

  // What the form held when it was last loaded or saved, so leaving with
  // changes asks first (forms review F-6). Taken a render after each seed,
  // once the seeded values are what the form holds.
  const snapshot = JSON.stringify(buildPayload());
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [baseline, setBaseline] = useState<string | null>(null);
  useEffect(() => {
    setBaseline(snapshotRef.current);
  }, [seedVersion]);
  // A refused field left out of a partial save still counts as unsaved.
  const isDirty = (baseline !== null && snapshot !== baseline) || fieldErrors.hasErrors || sheetErrors.length > 0;
  useUnsavedChanges({ hasChanges: isDirty && !isSaving });

  /**
   * Show every open error: settings on their fields, the sheet on its
   * controls, with any collapsed section holding one opened so it can be
   * seen. Focus goes to the first, top to bottom.
   */
  const showProblems = (fields: FieldErrors<TemplateField>, sheet: SummaryItem[]) => {
    fieldErrors.setErrors(fields);
    setSheetErrors(sheet);
    const ids = new Set(sheet.map((item) => item.id));
    if (sheet.length > 0) {
      setSections((prev) =>
        prev.map((section) =>
          section.collapsed &&
          (ids.has(sectionNameId(section.localId)) ||
            section.criteria.some((c) => [...ids].some((id) => id.endsWith(c.localId))))
            ? { ...section, collapsed: false }
            : section
        )
      );
    }
    const first = TEMPLATE_ORDER.find((field) => fields[field]);
    const target = first ? TEMPLATE_FIELDS[first].id : sheet[0]?.id;
    // After the re-render that opens a collapsed section.
    if (target) window.setTimeout(() => document.getElementById(target)?.focus(), 0);
  };

  /** A failed save on the field it names, or in the form when none does. */
  const showFailure = (err: unknown, fallback: string) => {
    keepTyped.current = false;
    // The page says it itself; the store's banner would say it twice.
    clearError();
    const placed = placeTemplateError(err);
    if (placed) {
      fieldErrors.setErrors(placed.fieldErrors);
      fieldErrors.setFormError(placed.unmatched.length ? placed.unmatched.join(' ') : null);
      const first = TEMPLATE_ORDER.find((field) => placed.fieldErrors[field]);
      if (first) document.getElementById(TEMPLATE_FIELDS[first].id)?.focus();
      else setSummaryFocus((n) => n + 1);
      return;
    }
    fieldErrors.setFromApiError(err, fallback);
    setSummaryFocus((n) => n + 1);
  };

  const handleSave = async () => {
    if (isSaving) return;
    const { fields, sheet } = validate();
    fieldErrors.setFormError(null);
    showProblems(fields, sheet);
    // A new template is not created until every field is fixed (create forms
    // do not partially save). An existing one saves the rest: a refused
    // setting is left out and keeps its stored value, and a sheet with an open
    // error keeps the stored sheet, because the update replaces it whole.
    const refused: FieldErrors<TemplateField> =
      sheet.length > 0 ? { ...fields, sections: 'The sheet has an open error.' } : fields;
    if (!isEditing && Object.keys(refused).length > 0) return;
    setIsSaving(true);

    try {
      const payload = buildPayload();
      if (isEditing && id) {
        const result = await saveExceptRefused<TemplateField, unknown>({
          payload,
          refused,
          send: (body) => {
            if (Object.keys(payload).some((key) => !(key in body))) keepTyped.current = true;
            return updateTemplate(id, body);
          },
          place: placeTemplateError,
        });
        const first = firstRefused(TEMPLATE_ORDER, result.refused);
        if (first) {
          clearError();
          // A sheet refused here is already flagged on its controls; one the
          // server refused is said under the sheet's heading.
          const shown = { ...result.refused };
          if (sheet.length > 0) delete shown.sections;
          fieldErrors.setErrors(shown);
          fieldErrors.setFormError(
            `Template saved, except ${TEMPLATE_FIELDS[first].label.toLowerCase()}. Fix it and save again.`
          );
          setBaseline(JSON.stringify(payload));
          if (!fields[first] && first !== 'sections') document.getElementById(TEMPLATE_FIELDS[first].id)?.focus();
          return;
        }
        setBaseline(JSON.stringify(payload));
        toast.success('Template updated');
      } else {
        const created = await createTemplate(payload);
        setBaseline(JSON.stringify(payload));
        toast.success('Template created');
        void navigate(`/training/skills-testing/templates/${created.id}/edit`, { replace: true });
      }
    } catch (err: unknown) {
      showFailure(err, 'Could not save the template. Try again.');
    } finally {
      setIsSaving(false);
    }
  };

  /** Publishing is the step that refuses: every open error is fixed first. The
   *  confirmation says publishing saves the current edits as well, because the
   *  officer is agreeing to both. */
  const requestPublish = () => {
    if (!isEditing || !id) return;
    const { fields, sheet } = validate();
    fieldErrors.setFormError(null);
    showProblems(fields, sheet);
    if (Object.keys(fields).length > 0 || sheet.length > 0) return;
    setShowPublishConfirm(true);
  };

  const handlePublish = async () => {
    if (!isEditing || !id) return;
    setIsPublishing(true);
    try {
      const payload = buildPayload();
      await updateTemplate(id, payload);
      setBaseline(JSON.stringify(payload));
      await publishTemplate(id);
      setShowPublishConfirm(false);
      toast.success('Template published');
      void navigate('/training/admin?page=skills-testing&tab=templates');
    } catch (err: unknown) {
      setShowPublishConfirm(false);
      showFailure(err, 'Could not publish the template. Try again.');
    } finally {
      setIsPublishing(false);
    }
  };

  const leave = async () => {
    if (isDirty) {
      const discard = await confirm({
        title: 'Discard your changes?',
        message: 'What you changed on this template has not been saved. Leaving will lose it.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        variant: 'warning',
      });
      if (!discard) return;
    }
    void navigate('/training/admin?page=skills-testing&tab=templates');
  };

  const addSection = () => {
    setSections([...sections, createEmptySection(sections.length)]);
  };

  const updateSection = (index: number, updated: LocalSection) => {
    const newSections = [...sections];
    newSections[index] = updated;
    setSections(newSections);
  };

  const removeSection = (index: number) => {
    if (sections.length <= 1) {
      toast.error('A template must have at least one section');
      return;
    }
    setSections(sections.filter((_, i) => i !== index));
  };

  if (templateLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <div className="h-12 w-12 animate-spin rounded-full border-t-4 border-b-4 border-red-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div data-page-main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Templates are kept on the hub's Skills Testing page, which is where
            the old back link went; the crumb keeps that destination. */}
        <TrainingPageHeader
          icon={ClipboardCheck}
          title={isEditing ? 'Edit Template' : 'New Template'}
          underHub="/training/admin"
          parentCrumbs={[{ label: 'Templates', path: '/training/admin?page=skills-testing&tab=templates' }]}
          actions={
            <>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="btn-secondary flex items-center gap-2 font-medium"
              >
                <Save className="h-4 w-4" />
                {isSaving ? 'Saving...' : 'Save Draft'}
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={requestPublish}
                  className="btn-success flex items-center gap-2 font-medium"
                >
                  <Send className="h-4 w-4" />
                  Publish
                </button>
              )}
            </>
          }
        />

        <div className="mb-6 empty:hidden">
          <ErrorSummary
            items={[...fieldErrors.summary.filter((item) => item.id !== TEMPLATE_FIELDS.sections.id), ...sheetErrors]}
            formError={fieldErrors.formError}
            focusKey={summaryFocus}
            title="Fix these and save again"
          />
        </div>

        {storeError && (
          <div
            className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4"
            role="alert"
            aria-live="assertive"
          >
            <p className="text-sm text-red-700 dark:text-red-300">{storeError}</p>
          </div>
        )}

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          {/* Template Settings */}
          <div className="card mb-6 p-6">
            <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Template Settings</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                id={TEMPLATE_FIELDS.name.id}
                label="Template Name"
                required
                error={fieldErrors.errors.name}
                maxLength={NAME_MAX_LENGTH}
                count={name.length}
                labelClassName="text-theme-text-muted mb-1 block text-sm font-medium"
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      fieldErrors.setError('name', null);
                    }}
                    placeholder="e.g., SCBA Proficiency Evaluation"
                    className="form-input px-3"
                  />
                )}
              </FormField>
              <FormField
                id={TEMPLATE_FIELDS.category.id}
                label="Category"
                error={fieldErrors.errors.category}
                maxLength={CATEGORY_MAX_LENGTH}
                count={category.length}
                labelClassName="text-theme-text-muted mb-1 block text-sm font-medium"
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      fieldErrors.setError('category', null);
                    }}
                    placeholder="e.g., Fire Operations, EMS, Hazmat"
                    className="form-input px-3"
                  />
                )}
              </FormField>
              <div className="md:col-span-2">
                <label htmlFor="template-visibility" className="text-theme-text-muted mb-1 block text-sm font-medium">
                  Visibility
                </label>
                <select
                  id="template-visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value)}
                  className="form-input px-3"
                >
                  <option value="all_members">All Members</option>
                  <option value="officers_only">Officers Only</option>
                  <option value="assigned_only">Assigned Members Only</option>
                </select>
                <p className="text-theme-text-muted mt-1 text-xs">
                  Controls who can see this test. Officers always have full access.
                </p>
              </div>
              <div className="md:col-span-2">
                <label
                  htmlFor="template-linked-training-requirement-optional"
                  className="text-theme-text-muted mb-1 block text-sm font-medium"
                >
                  Linked Training Requirement (optional)
                </label>
                <select
                  id="template-linked-training-requirement-optional"
                  value={requirementId}
                  onChange={(e) => setRequirementId(e.target.value)}
                  className="form-input px-3"
                >
                  <option value="">None — not linked to a pipeline requirement</option>
                  {requirements.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <p className="text-theme-text-muted mt-1 text-xs">
                  When a test built from this template passes, this pipeline requirement is marked complete for the
                  candidate. Individual tests can override this.
                </p>
              </div>
              {/* Result disclosure — a per-template override of the department
                default. Left on "Inherit", a template follows whatever the
                organization is set to, so most templates need nothing here;
                the labels name the inherited value so an officer can see what
                that means without leaving the page. */}
              <div className="md:col-span-2">
                <div className="card p-4">
                  <p className="text-theme-text-primary text-sm font-medium">Result Disclosure</p>
                  <p className="text-theme-text-muted mt-0.5 mb-3 text-xs">
                    What the person tested sees of their own result, and when. Officers always see everything.
                    Individual tests can override this again.
                  </p>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <label
                        htmlFor="template-result-disclosure"
                        className="text-theme-text-muted mb-1 block text-xs font-medium"
                      >
                        What the member sees
                      </label>
                      <select
                        id="template-result-disclosure"
                        value={resultDisclosure}
                        onChange={(e) => setResultDisclosure(e.target.value)}
                        className="form-input px-3 text-sm"
                      >
                        <option value="">
                          Inherit — {labelFor(DISCLOSURE_CHOICES, orgConfig?.skills_result_disclosure ?? 'full')}
                        </option>
                        {DISCLOSURE_CHOICES.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Nothing to time when results are never shown. */}
                    {resultDisclosure !== 'none' && (
                      <div>
                        <label
                          htmlFor="template-result-release"
                          className="text-theme-text-muted mb-1 block text-xs font-medium"
                        >
                          When they see it
                        </label>
                        <select
                          id="template-result-release"
                          value={resultRelease}
                          onChange={(e) => setResultRelease(e.target.value)}
                          className="form-input px-3 text-sm"
                        >
                          <option value="">
                            Inherit — {labelFor(RELEASE_CHOICES, orgConfig?.skills_result_release ?? 'on_completion')}
                          </option>
                          {RELEASE_CHOICES.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {positions.length > 0 && (
                    <fieldset className="mt-4">
                      <legend className="text-theme-text-muted mb-1 block text-xs font-medium">
                        Also visible to these positions (optional)
                      </legend>
                      <p className="text-theme-text-muted mb-2 text-xs">
                        Holders of the selected positions can see results of tests built from this template, at the same
                        level the member sees them — never more.
                      </p>
                      <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                        {positions.map((position) => (
                          <label
                            key={position.id}
                            className="hover:bg-theme-surface-hover mobile-touch-target flex cursor-pointer items-center gap-2 rounded-md px-2 py-1"
                          >
                            <input
                              type="checkbox"
                              checked={viewerPositions.includes(position.slug)}
                              onChange={(e) =>
                                setViewerPositions((current) =>
                                  e.target.checked
                                    ? [...current, position.slug]
                                    : current.filter((slug) => slug !== position.slug)
                                )
                              }
                              className="border-theme-surface-border focus:ring-theme-focus-ring rounded-sm text-blue-600"
                            />
                            <span className="text-theme-text-primary text-sm">{position.name}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </div>
              </div>

              <div className="md:col-span-2">
                <label htmlFor="template-description" className="text-theme-text-muted mb-1 block text-sm font-medium">
                  Description
                </label>
                <textarea
                  id="template-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Brief description of the evaluation..."
                  className="form-input resize-none px-3"
                />
              </div>
              <FormField
                id={TEMPLATE_FIELDS.time_limit_seconds.id}
                label="Global Time Limit (minutes)"
                error={fieldErrors.errors.time_limit_seconds}
                labelClassName="text-theme-text-muted mb-1 block text-sm font-medium"
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    min="0"
                    step="1"
                    value={timeLimitMinutes ?? ''}
                    onChange={(e) => {
                      setTimeLimitMinutes(e.target.value ? Number(e.target.value) : undefined);
                      fieldErrors.setError('time_limit_seconds', null);
                    }}
                    placeholder="e.g., 30"
                    className="form-input px-3"
                  />
                )}
              </FormField>
              <FormField
                id={TEMPLATE_FIELDS.passing_percentage.id}
                label="Passing Percentage (%)"
                error={fieldErrors.errors.passing_percentage}
                labelClassName="text-theme-text-muted mb-1 block text-sm font-medium"
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    min="0"
                    max="100"
                    value={passingPercentage ?? ''}
                    onChange={(e) => {
                      setPassingPercentage(e.target.value ? Number(e.target.value) : undefined);
                      fieldErrors.setError('passing_percentage', null);
                    }}
                    placeholder="e.g., 70"
                    className="form-input px-3"
                  />
                )}
              </FormField>
              <FormField
                id={TEMPLATE_FIELDS.valid_for_months.id}
                label="Valid for (months)"
                error={fieldErrors.errors.valid_for_months}
                hint="A passing official test expires this many months after it was taken and appears in the member's upcoming list."
                labelClassName="text-theme-text-muted mb-1 block text-sm font-medium"
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    min="1"
                    max={MAX_VALID_FOR_MONTHS}
                    step="1"
                    value={validForMonths ?? ''}
                    onChange={(e) => {
                      setValidForMonths(e.target.value ? Number(e.target.value) : undefined);
                      fieldErrors.setError('valid_for_months', null);
                    }}
                    placeholder="Leave blank if it never expires"
                    className="form-input px-3"
                  />
                )}
              </FormField>
              <div>
                <label
                  htmlFor="template-tags-comma-separated"
                  className="text-theme-text-muted mb-1 block text-sm font-medium"
                >
                  Tags (comma-separated)
                </label>
                <input
                  id="template-tags-comma-separated"
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g., NFPA 1001, Probationary"
                  className="form-input px-3"
                />
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={requireAllCritical}
                    onChange={(e) => setRequireAllCritical(e.target.checked)}
                    className="border-theme-surface-border focus:ring-theme-focus-ring rounded-sm text-blue-600"
                  />
                  <span className="text-theme-text-primary text-sm">Require all critical criteria to pass</span>
                </label>
              </div>
            </div>

            {/* Which steps the percentage is actually computed from. Without this
              setting, Pass/Fail steps were worth nothing at all — a template
              whose knowledge questions are written as Pass/Fail produced a
              percentage that ignored every one of them, and nothing said so. */}
            <div className="border-theme-surface-border mt-4 border-t pt-4">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={scorePassFailCriteria}
                  onChange={(e) => setScorePassFailCriteria(e.target.checked)}
                  className="border-theme-surface-border focus:ring-theme-focus-ring mt-0.5 rounded-sm text-blue-600"
                />
                <span>
                  <span className="text-theme-text-primary text-sm font-medium">
                    Count Pass/Fail steps toward the overall percentage
                  </span>
                  <span className="text-theme-text-muted block text-xs">
                    A passed step earns its points, a failed one earns none. Each is worth 1 point unless you set a
                    point value on it. Leave this off and the percentage comes from scored steps only — Pass/Fail steps
                    still appear on the scorecard and can still fail the test outright when marked critical, but they do
                    not move the number.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* Sections */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2
                id={TEMPLATE_FIELDS.sections.id}
                tabIndex={-1}
                className="text-theme-text-primary text-lg font-semibold"
              >
                Evaluation Sections
              </h2>
              <span className="text-theme-text-muted text-sm">
                {sections.length} section{sections.length !== 1 ? 's' : ''} &middot;{' '}
                {sections.reduce((sum, s) => sum + s.criteria.length, 0)} criteria
              </span>
            </div>
            {fieldErrors.errors.sections && (
              <p className={`text-sm ${FIELD_ERROR_CLASS}`}>{fieldErrors.errors.sections}</p>
            )}

            {sections.map((section, i) => (
              <SectionEditor
                key={section.localId}
                section={section}
                onChange={(updated) => updateSection(i, updated)}
                onRemove={() => removeSection(i)}
                index={i}
                scorePassFailCriteria={scorePassFailCriteria}
                errors={sheetErrorMap}
                onFieldEdit={(fieldId) => {
                  clearSheetError(fieldId);
                  fieldErrors.setError('sections', null);
                }}
              />
            ))}

            <button
              type="button"
              onClick={addSection}
              className="border-theme-surface-border flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 text-sm font-medium text-red-800 transition-colors hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20"
            >
              <Plus className="h-5 w-5" />
              Add Section
            </button>
          </div>

          {/* Bottom Save Bar */}
          <div className="modal-footer-sticky -mx-4 flex justify-end gap-2 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <button
              type="button"
              onClick={() => void leave()}
              className="text-theme-text-muted hover:text-theme-text-primary px-4 py-2 transition-colors"
            >
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="btn-primary flex items-center gap-2 px-6 font-medium">
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Template'}
            </button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        isOpen={showPublishConfirm}
        onClose={() => setShowPublishConfirm(false)}
        onConfirm={() => void handlePublish()}
        title="Publish this template?"
        message={`Saves your changes and makes "${name || 'this template'}" available to start tests from. Each test keeps a copy of the template it was taken against, so later edits never re-score a test already run.`}
        cancelLabel="Not yet"
        confirmLabel="Publish"
        variant="info"
        loading={isPublishing}
      />
    </div>
  );
};

export default SkillTemplateBuilderPage;
