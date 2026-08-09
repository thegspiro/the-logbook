/**
 * Skill Template Builder Page
 *
 * Desktop-optimized form for creating and editing skill evaluation templates.
 * Officers build templates with sections and criteria at a station computer.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router';
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  ClipboardCheck,
  Save,
  Send,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import { trainingProgramService, trainingModuleConfigService, roleService } from '../services/api';
import type { TrainingRequirementEnhanced, TrainingModuleConfig as TMConfig } from '../types/training';
import type { Role } from '../types/role';
import { ConfirmDialog } from '../components/ux';
import type {
  SkillTemplateSectionCreate,
  SkillCriterionCreate,
  CriterionType,
  ResultDisclosure,
  ResultRelease,
} from '../types/skillsTesting';

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
}> = ({ criterion, onChange, onRemove, index }) => {
  const [checklistText, setChecklistText] = useState((criterion.checklist_items ?? []).join('\n'));

  return (
    <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="text-theme-text-muted mt-2 flex cursor-grab items-center">
          <GripVertical className="h-4 w-4" />
          <span className="ml-1 font-mono text-xs">{index + 1}</span>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-12">
          {/* Label */}
          <div className="lg:col-span-4">
            <label className="text-theme-text-muted mb-1 block text-xs font-medium">
              Criterion Label <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={criterion.label}
              onChange={(e) => onChange({ ...criterion, label: e.target.value })}
              placeholder="e.g., Dons SCBA within 60 seconds"
              className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
            />
          </div>

          {/* Type */}
          <div className="lg:col-span-2">
            <label className="text-theme-text-muted mb-1 block text-xs font-medium">Type</label>
            <select
              value={criterion.type}
              onChange={(e) => onChange({ ...criterion, type: e.target.value as CriterionType })}
              className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
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
                <label className="text-theme-text-muted mb-1 block text-xs font-medium">Max Points</label>
                <input
                  type="number"
                  min="1"
                  value={criterion.max_score ?? ''}
                  onChange={(e) =>
                    onChange({ ...criterion, max_score: e.target.value ? Number(e.target.value) : undefined })
                  }
                  placeholder="3"
                  className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                />
              </div>
              {/* A passing threshold only means anything on a critical
                  criterion: a non-critical one contributes its points to the
                  overall score and cannot fail the test on its own, so asking
                  for a threshold there invites an answer that is then ignored.
                  The field used to render always, with a "(critical only)"
                  hint doing the explaining. */}
              {criterion.required && (
                <div className="lg:col-span-2">
                  <label className="text-theme-text-muted mb-1 block text-xs font-medium">Passing Points</label>
                  <input
                    type="number"
                    min="0"
                    value={criterion.passing_score ?? ''}
                    onChange={(e) =>
                      onChange({ ...criterion, passing_score: e.target.value ? Number(e.target.value) : undefined })
                    }
                    placeholder="2"
                    className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  />
                </div>
              )}
            </>
          )}

          {criterion.type === 'time_limit' && (
            <div className="lg:col-span-2">
              <label className="text-theme-text-muted mb-1 block text-xs font-medium">Time Limit (sec)</label>
              <input
                type="number"
                min="1"
                value={criterion.time_limit_seconds ?? ''}
                onChange={(e) =>
                  onChange({ ...criterion, time_limit_seconds: e.target.value ? Number(e.target.value) : undefined })
                }
                placeholder="60"
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
          )}

          {criterion.type === 'checklist' && (
            <div className="lg:col-span-4">
              <label className="text-theme-text-muted mb-1 block text-xs font-medium">
                Checklist Items (one per line)
              </label>
              <textarea
                value={checklistText}
                onChange={(e) => {
                  setChecklistText(e.target.value);
                  onChange({
                    ...criterion,
                    checklist_items: e.target.value.split('\n').filter((l) => l.trim()),
                  });
                }}
                rows={3}
                placeholder="Check airway&#10;Assess breathing&#10;Check pulse"
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
          )}

          {criterion.type === 'statement' && (
            <div className="lg:col-span-4">
              <label className="text-theme-text-muted mb-1 block text-xs font-medium">
                Statement Text <span className="text-red-500">*</span>
              </label>
              <textarea
                value={criterion.statement_text ?? ''}
                onChange={(e) => onChange({ ...criterion, statement_text: e.target.value || undefined })}
                rows={3}
                placeholder="Enter the statement the evaluator must read or announce..."
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
          )}

          {/* Required toggle */}
          <div className="flex items-end lg:col-span-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={criterion.required}
                onChange={(e) => onChange({ ...criterion, required: e.target.checked })}
                className="border-theme-surface-border focus:ring-theme-focus-ring rounded-sm text-blue-600"
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
          <label className="text-theme-text-muted mb-1 block text-xs font-medium">Description</label>
          <input
            type="text"
            value={criterion.description ?? ''}
            onChange={(e) => onChange({ ...criterion, description: e.target.value || undefined })}
            placeholder="Optional notes"
            className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
          />
        </div>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="mt-6 rounded-sm p-1.5 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30"
          title="Remove criterion"
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
}> = ({ section, onChange, onRemove, index }) => {
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
    <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-lg border">
      {/* Section Header */}
      <div className="bg-theme-surface-hover/50 border-theme-surface-border flex items-center gap-3 border-b px-4 py-3">
        <GripVertical className="text-theme-text-muted h-5 w-5 cursor-grab" />
        <span className="text-theme-text-muted text-sm font-bold">Section {index + 1}</span>

        <div className="flex flex-1 gap-3">
          <input
            type="text"
            value={section.name}
            onChange={(e) => onChange({ ...section, name: e.target.value })}
            placeholder="Section name (e.g., SCBA Operations)"
            className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium focus:ring-2 focus:outline-hidden"
          />
          <input
            type="text"
            value={section.description ?? ''}
            onChange={(e) => onChange({ ...section, description: e.target.value || undefined })}
            placeholder="Description (optional)"
            className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 hidden flex-1 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:outline-hidden lg:block"
          />
        </div>

        <button
          onClick={() => onChange({ ...section, collapsed: !section.collapsed })}
          className="hover:bg-theme-surface-hover rounded-sm p-1.5 transition-colors"
        >
          {section.collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
        <button
          onClick={onRemove}
          className="rounded-sm p-1.5 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30"
          title="Remove section"
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
            />
          ))}

          <button
            onClick={addCriterion}
            className="border-theme-surface-border flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
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
    error: storeError,
  } = useSkillsTestingStore();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [visibility, setVisibility] = useState<string>('all_members');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number | undefined>();
  const [passingPercentage, setPassingPercentage] = useState<number | undefined>();
  const [requireAllCritical, setRequireAllCritical] = useState(true);
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
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

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
        setPositions(await roleService.getRoles());
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
    if (currentTemplate && isEditing) {
      setName(currentTemplate.name);
      setDescription(currentTemplate.description ?? '');
      setCategory(currentTemplate.category ?? '');
      setVisibility(currentTemplate.visibility ?? 'all_members');
      setTimeLimitMinutes(
        currentTemplate.time_limit_seconds != null ? currentTemplate.time_limit_seconds / 60 : undefined
      );
      setPassingPercentage(currentTemplate.passing_percentage ?? undefined);
      setRequireAllCritical(currentTemplate.require_all_critical);
      setRequirementId(currentTemplate.requirement_id ?? '');
      setResultDisclosure(currentTemplate.result_disclosure ?? '');
      setResultRelease(currentTemplate.result_release ?? '');
      setViewerPositions(currentTemplate.result_viewer_positions ?? []);
      setTags((currentTemplate.tags ?? []).join(', '));
      setSections(
        currentTemplate.sections.map((s) => ({
          localId: s.id,
          name: s.name,
          description: s.description,
          sort_order: s.sort_order,
          collapsed: false,
          criteria: s.criteria.map((c) => ({
            localId: c.id,
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
          })),
        }))
      );
    }
  }, [currentTemplate, isEditing]);

  const validate = useCallback((): string[] => {
    const errors: string[] = [];
    if (!name.trim()) errors.push('Template name is required');
    if (sections.length === 0) errors.push('At least one section is required');

    sections.forEach((section, si) => {
      if (!section.name.trim()) errors.push(`Section ${si + 1}: Name is required`);
      if (section.criteria.length === 0) errors.push(`Section ${si + 1}: At least one criterion is required`);
      section.criteria.forEach((criterion, ci) => {
        if (!criterion.label.trim()) errors.push(`Section ${si + 1}, Criterion ${ci + 1}: Label is required`);
        // Scoped to critical criteria because that is where the field is now
        // shown. A non-critical criterion can still carry a stale passing_score
        // from before it was unmarked, and validating that would block saving
        // over a field the editor no longer displays — an error with no
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
          errors.push(`Section ${si + 1}, Criterion ${ci + 1}: Passing score cannot exceed max score`);
        }
        if (criterion.type === 'checklist' && (!criterion.checklist_items || criterion.checklist_items.length === 0)) {
          errors.push(`Section ${si + 1}, Criterion ${ci + 1}: At least one checklist item is required`);
        }
        if (criterion.type === 'statement' && !criterion.statement_text?.trim()) {
          errors.push(`Section ${si + 1}, Criterion ${ci + 1}: Statement text is required`);
        }
      });
    });

    return errors;
  }, [name, sections]);

  const buildPayload = useCallback(() => {
    const parsedTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    return {
      name: name.trim(),
      description: description.trim() || undefined,
      category: category.trim() || undefined,
      visibility: visibility as 'all_members' | 'officers_only' | 'assigned_only',
      time_limit_seconds: timeLimitMinutes != null ? Math.round(timeLimitMinutes * 60) : undefined,
      passing_percentage: passingPercentage,
      require_all_critical: requireAllCritical,
      requirement_id: requirementId || undefined,
      // null, not undefined: undefined is dropped by exclude_unset on the
      // backend, so clearing an override back to "inherit" would silently keep
      // the old value. null is an explicit "unset this".
      result_disclosure: (resultDisclosure || null) as ResultDisclosure | null,
      result_release: (resultRelease || null) as ResultRelease | null,
      result_viewer_positions: viewerPositions.length > 0 ? viewerPositions : null,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
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
    requireAllCritical,
    requirementId,
    resultDisclosure,
    resultRelease,
    viewerPositions,
    tags,
    sections,
  ]);

  const handleSave = async () => {
    const errors = validate();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    setIsSaving(true);

    try {
      const payload = buildPayload();
      if (isEditing && id) {
        await updateTemplate(id, payload);
        toast.success('Template updated');
      } else {
        const created = await createTemplate(payload);
        toast.success('Template created');
        void navigate(`/training/skills-testing/templates/${created.id}/edit`, { replace: true });
      }
    } catch {
      toast.error('Failed to save template');
    } finally {
      setIsSaving(false);
    }
  };

  /** Validate first, then ask. Publishing saves the current edits as well, so
   *  the confirmation has to say so — the officer is agreeing to both. */
  const requestPublish = () => {
    if (!isEditing || !id) return;
    const errors = validate();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setShowPublishConfirm(true);
  };

  const handlePublish = async () => {
    if (!isEditing || !id) return;
    setIsPublishing(true);
    try {
      const payload = buildPayload();
      await updateTemplate(id, payload);
      await publishTemplate(id);
      setShowPublishConfirm(false);
      toast.success('Template published');
      void navigate('/training/admin?page=skills-testing&tab=templates');
    } catch {
      toast.error('Failed to publish template');
    } finally {
      setIsPublishing(false);
    }
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
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            to="/training/admin?page=skills-testing&tab=templates"
            className="text-theme-text-muted hover:text-theme-text-primary mb-4 flex items-center transition-colors"
          >
            <ArrowLeft className="mr-2 h-5 w-5" />
            Back to Skills Testing
          </Link>
          <div className="flex items-center justify-between">
            <h1 className="text-theme-text-primary flex items-center space-x-3 text-3xl font-bold">
              <ClipboardCheck className="h-8 w-8 text-red-700" />
              <span>{isEditing ? 'Edit Template' : 'New Template'}</span>
            </h1>
            <div className="flex gap-2">
              <button
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover text-theme-text-primary flex items-center gap-2 rounded-lg border px-4 py-2 font-medium transition-colors disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {isSaving ? 'Saving...' : 'Save Draft'}
              </button>
              {isEditing && (
                <button onClick={requestPublish} className="btn-success flex items-center gap-2 font-medium">
                  <Send className="h-4 w-4" />
                  Publish
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Validation Errors */}
        {validationErrors.length > 0 && (
          <div
            className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4"
            role="alert"
            aria-live="assertive"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
              <div>
                <p className="font-medium text-red-700 dark:text-red-300">Please fix the following errors:</p>
                <ul className="mt-1 list-inside list-disc text-sm text-red-700 dark:text-red-300">
                  {validationErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {storeError && (
          <div
            className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4"
            role="alert"
            aria-live="assertive"
          >
            <p className="text-sm text-red-700 dark:text-red-300">{storeError}</p>
          </div>
        )}

        {/* Template Settings */}
        <div className="bg-theme-surface border-theme-surface-border mb-6 rounded-lg border p-6">
          <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Template Settings</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-theme-text-muted mb-1 block text-sm font-medium">
                Template Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., SCBA Proficiency Evaluation"
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-hidden"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-sm font-medium">Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., Fire Operations, EMS, Hazmat"
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-hidden"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-theme-text-muted mb-1 block text-sm font-medium">Visibility</label>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-hidden"
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
              <label className="text-theme-text-muted mb-1 block text-sm font-medium">
                Linked Training Requirement (optional)
              </label>
              <select
                value={requirementId}
                onChange={(e) => setRequirementId(e.target.value)}
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-hidden"
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
              <div className="border-theme-surface-border bg-theme-surface rounded-lg border p-4">
                <p className="text-theme-text-primary text-sm font-medium">Result Disclosure</p>
                <p className="text-theme-text-muted mt-0.5 mb-3 text-xs">
                  What the person tested sees of their own result, and when. Officers always see everything. Individual
                  tests can override this again.
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
                      className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
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
                        className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
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
              <label className="text-theme-text-muted mb-1 block text-sm font-medium">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Brief description of the evaluation..."
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full resize-none rounded-lg border px-3 py-2 focus:ring-2 focus:outline-hidden"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-sm font-medium">
                Global Time Limit (minutes)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={timeLimitMinutes ?? ''}
                onChange={(e) => setTimeLimitMinutes(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="e.g., 30"
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-hidden"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-sm font-medium">Passing Percentage (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={passingPercentage ?? ''}
                onChange={(e) => setPassingPercentage(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="e.g., 70"
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-hidden"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-sm font-medium">Tags (comma-separated)</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="e.g., NFPA 1001, Probationary"
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-hidden"
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
        </div>

        {/* Sections */}
        <div className="mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-theme-text-primary text-lg font-semibold">Evaluation Sections</h2>
            <span className="text-theme-text-muted text-sm">
              {sections.length} section{sections.length !== 1 ? 's' : ''} &middot;{' '}
              {sections.reduce((sum, s) => sum + s.criteria.length, 0)} criteria
            </span>
          </div>

          {sections.map((section, i) => (
            <SectionEditor
              key={section.localId}
              section={section}
              onChange={(updated) => updateSection(i, updated)}
              onRemove={() => removeSection(i)}
              index={i}
            />
          ))}

          <button
            onClick={addSection}
            className="border-theme-surface-border flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <Plus className="h-5 w-5" />
            Add Section
          </button>
        </div>

        {/* Bottom Save Bar */}
        <div className="bg-theme-surface-modal border-theme-surface-border action-bar-safe sticky bottom-0 -mx-4 flex justify-end gap-2 border-t px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <button
            onClick={() => void navigate('/training/admin?page=skills-testing&tab=templates')}
            className="text-theme-text-muted hover:text-theme-text-primary px-4 py-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="btn-primary flex items-center gap-2 px-6 font-medium"
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Template'}
          </button>
        </div>
      </main>

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
