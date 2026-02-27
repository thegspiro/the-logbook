/**
 * Skill Template Builder Page
 *
 * Desktop-optimized form for creating and editing skill evaluation templates.
 * Officers build templates with sections and criteria at a station computer.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
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
import type {
  SkillTemplateSectionCreate,
  SkillCriterionCreate,
  CriterionType,
} from '../types/skillsTesting';

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
  const [checklistText, setChecklistText] = useState(
    (criterion.checklist_items ?? []).join('\n')
  );

  return (
    <div className="bg-theme-surface rounded-lg p-4 border border-theme-surface-border">
      <div className="flex items-start gap-3">
        <div className="flex items-center mt-2 text-theme-text-muted cursor-grab">
          <GripVertical className="w-4 h-4" />
          <span className="text-xs font-mono ml-1">{index + 1}</span>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Label */}
          <div className="lg:col-span-4">
            <label className="block text-xs font-medium text-theme-text-muted mb-1">
              Criterion Label <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={criterion.label}
              onChange={(e) => onChange({ ...criterion, label: e.target.value })}
              placeholder="e.g., Dons SCBA within 60 seconds"
              className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50"
            />
          </div>

          {/* Type */}
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-theme-text-muted mb-1">Type</label>
            <select
              value={criterion.type}
              onChange={(e) => onChange({ ...criterion, type: e.target.value as CriterionType })}
              className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50"
            >
              {CRITERION_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Type-specific fields */}
          {criterion.type === 'score' && (
            <>
              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-theme-text-muted mb-1">Max Points</label>
                <input
                  type="number"
                  min="1"
                  value={criterion.max_score ?? ''}
                  onChange={(e) => onChange({ ...criterion, max_score: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="3"
                  className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-theme-text-muted mb-1">Passing Points</label>
                <input
                  type="number"
                  min="0"
                  value={criterion.passing_score ?? ''}
                  onChange={(e) => onChange({ ...criterion, passing_score: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="2"
                  className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50"
                />
              </div>
            </>
          )}

          {criterion.type === 'time_limit' && (
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-theme-text-muted mb-1">Time Limit (sec)</label>
              <input
                type="number"
                min="1"
                value={criterion.time_limit_seconds ?? ''}
                onChange={(e) => onChange({ ...criterion, time_limit_seconds: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="60"
                className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50"
              />
            </div>
          )}

          {criterion.type === 'checklist' && (
            <div className="lg:col-span-4">
              <label className="block text-xs font-medium text-theme-text-muted mb-1">Checklist Items (one per line)</label>
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
                className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
              />
            </div>
          )}

          {criterion.type === 'statement' && (
            <div className="lg:col-span-4">
              <label className="block text-xs font-medium text-theme-text-muted mb-1">Statement Text <span className="text-red-500">*</span></label>
              <textarea
                value={criterion.statement_text ?? ''}
                onChange={(e) => onChange({ ...criterion, statement_text: e.target.value || undefined })}
                rows={3}
                placeholder="Enter the statement the evaluator must read or announce..."
                className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
              />
            </div>
          )}

          {/* Required toggle */}
          <div className="lg:col-span-2 flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={criterion.required}
                onChange={(e) => onChange({ ...criterion, required: e.target.checked })}
                className="rounded border-theme-surface-border text-red-600 focus:ring-red-500"
              />
              <span className="text-sm text-theme-text-primary">Critical</span>
            </label>
          </div>
        </div>

        {/* Description */}
        <div className="hidden xl:block flex-shrink-0 w-48">
          <label className="block text-xs font-medium text-theme-text-muted mb-1">Description</label>
          <input
            type="text"
            value={criterion.description ?? ''}
            onChange={(e) => onChange({ ...criterion, description: e.target.value || undefined })}
            placeholder="Optional notes"
            className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50"
          />
        </div>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="mt-6 p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          title="Remove criterion"
        >
          <Trash2 className="w-4 h-4 text-red-500" />
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
    <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
      {/* Section Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-theme-surface-hover/50 border-b border-theme-surface-border">
        <GripVertical className="w-5 h-5 text-theme-text-muted cursor-grab" />
        <span className="text-sm font-bold text-theme-text-muted">Section {index + 1}</span>

        <div className="flex-1 flex gap-3">
          <input
            type="text"
            value={section.name}
            onChange={(e) => onChange({ ...section, name: e.target.value })}
            placeholder="Section name (e.g., SCBA Operations)"
            className="flex-1 px-3 py-1.5 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-500/50"
          />
          <input
            type="text"
            value={section.description ?? ''}
            onChange={(e) => onChange({ ...section, description: e.target.value || undefined })}
            placeholder="Description (optional)"
            className="hidden lg:block flex-1 px-3 py-1.5 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50"
          />
        </div>

        <button
          onClick={() => onChange({ ...section, collapsed: !section.collapsed })}
          className="p-1.5 rounded hover:bg-theme-surface-hover transition-colors"
        >
          {section.collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
        <button
          onClick={onRemove}
          className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          title="Remove section"
        >
          <Trash2 className="w-4 h-4 text-red-500" />
        </button>
      </div>

      {/* Criteria */}
      {!section.collapsed && (
        <div className="p-4 space-y-3">
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
            className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors w-full justify-center border border-dashed border-theme-surface-border"
          >
            <Plus className="w-4 h-4" />
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
  const [sections, setSections] = useState<LocalSection[]>([createEmptySection(0)]);
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

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
      setTimeLimitMinutes(currentTemplate.time_limit_seconds != null ? currentTemplate.time_limit_seconds / 60 : undefined);
      setPassingPercentage(currentTemplate.passing_percentage ?? undefined);
      setRequireAllCritical(currentTemplate.require_all_critical);
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
        if (criterion.type === 'score' && criterion.max_score != null && criterion.passing_score != null && criterion.passing_score > criterion.max_score) {
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
    const parsedTags = tags.split(',').map((t) => t.trim()).filter(Boolean);
    return {
      name: name.trim(),
      description: description.trim() || undefined,
      category: category.trim() || undefined,
      visibility: visibility as 'all_members' | 'officers_only' | 'assigned_only',
      time_limit_seconds: timeLimitMinutes != null ? Math.round(timeLimitMinutes * 60) : undefined,
      passing_percentage: passingPercentage,
      require_all_critical: requireAllCritical,
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
  }, [name, description, category, visibility, timeLimitMinutes, passingPercentage, requireAllCritical, tags, sections]);

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
        navigate(`/training/skills-testing/templates/${created.id}/edit`, { replace: true });
      }
    } catch {
      toast.error('Failed to save template');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!isEditing || !id) return;
    const errors = validate();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    if (window.confirm('Publish this template? Once published, it can be used for testing.')) {
      try {
        const payload = buildPayload();
        await updateTemplate(id, payload);
        await publishTemplate(id);
        toast.success('Template published');
        navigate('/training/admin?page=skills-testing&tab=templates');
      } catch {
        toast.error('Failed to publish template');
      }
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-red-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            to="/training/admin?page=skills-testing&tab=templates"
            className="flex items-center text-theme-text-muted hover:text-theme-text-primary transition-colors mb-4"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Skills Testing
          </Link>
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-theme-text-primary flex items-center space-x-3">
              <ClipboardCheck className="w-8 h-8 text-red-700" />
              <span>{isEditing ? 'Edit Template' : 'New Template'}</span>
            </h1>
            <div className="flex gap-2">
              <button
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 bg-theme-surface border border-theme-surface-border hover:bg-theme-surface-hover text-theme-text-primary rounded-lg transition-colors font-medium disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save Draft'}
              </button>
              {isEditing && (
                <button
                  onClick={() => void handlePublish()}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium"
                >
                  <Send className="w-4 h-4" />
                  Publish
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Validation Errors */}
        {validationErrors.length > 0 && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-700 dark:text-red-300">Please fix the following errors:</p>
                <ul className="mt-1 text-sm text-red-700 dark:text-red-300 list-disc list-inside">
                  {validationErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {storeError && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
            <p className="text-sm text-red-700 dark:text-red-300">{storeError}</p>
          </div>
        )}

        {/* Template Settings */}
        <div className="bg-theme-surface rounded-lg p-6 border border-theme-surface-border mb-6">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Template Settings</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-text-muted mb-1">
                Template Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., SCBA Proficiency Evaluation"
                className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-muted mb-1">Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., Fire Operations, EMS, Hazmat"
                className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500/50"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-theme-text-muted mb-1">Visibility</label>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
                className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500/50"
              >
                <option value="all_members">All Members</option>
                <option value="officers_only">Officers Only</option>
                <option value="assigned_only">Assigned Members Only</option>
              </select>
              <p className="text-xs text-theme-text-muted mt-1">
                Controls who can see this test. Officers always have full access.
              </p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-theme-text-muted mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Brief description of the evaluation..."
                className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-muted mb-1">Global Time Limit (minutes)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={timeLimitMinutes ?? ''}
                onChange={(e) => setTimeLimitMinutes(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="e.g., 30"
                className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-muted mb-1">Passing Percentage (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={passingPercentage ?? ''}
                onChange={(e) => setPassingPercentage(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="e.g., 70"
                className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-muted mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="e.g., NFPA 1001, Probationary"
                className="w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500/50"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireAllCritical}
                  onChange={(e) => setRequireAllCritical(e.target.checked)}
                  className="rounded border-theme-surface-border text-red-600 focus:ring-red-500"
                />
                <span className="text-sm text-theme-text-primary">Require all critical criteria to pass</span>
              </label>
            </div>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-4 mb-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-theme-text-primary">Evaluation Sections</h2>
            <span className="text-sm text-theme-text-muted">
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
            className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors w-full justify-center border-2 border-dashed border-theme-surface-border"
          >
            <Plus className="w-5 h-5" />
            Add Section
          </button>
        </div>

        {/* Bottom Save Bar */}
        <div className="sticky bottom-0 bg-theme-surface/95 backdrop-blur-sm border-t border-theme-surface-border py-4 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 flex justify-end gap-2">
          <button
            onClick={() => navigate('/training/admin?page=skills-testing&tab=templates')}
            className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Template'}
          </button>
        </div>
      </main>
    </div>
  );
};

export default SkillTemplateBuilderPage;
