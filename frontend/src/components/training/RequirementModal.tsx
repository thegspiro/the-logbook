import React, { useState } from 'react';
import { AlertCircle, CheckCircle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { CourseLibraryPicker } from './CourseLibraryPicker';
import { RecencyWindowField } from './RecencyWindowField';
import { useCourseLibrary } from '../../hooks/useCourseLibrary';
import type {
  TrainingRequirement,
  TrainingRequirementCreate,
  TrainingRequirementUpdate,
  TrainingCategory,
  DueDateType,
  RequirementFrequency,
  RequirementType,
  TrainingType,
} from '../../types/training';

const MEMBERSHIP_TYPES = [
  { value: 'active', label: 'Active' },
  { value: 'probationary', label: 'Probationary' },
  { value: 'administrative', label: 'Administrative' },
  { value: 'life', label: 'Life' },
  { value: 'retired', label: 'Retired' },
  { value: 'honorary', label: 'Honorary' },
] as const;

/**
 * Full create/edit form for a training requirement.
 *
 * Shared by the Training Admin requirements page and the Training Programs
 * requirements tab so both surfaces edit the same fields with the same
 * validation — a second, partial copy of this form would let one surface
 * silently drop fields the other persists.
 */
export interface RequirementModalProps {
  requirement: TrainingRequirement | null;
  template?: TrainingRequirementCreate | null;
  categories: TrainingCategory[];
  onClose: () => void;
  onSave: (data: TrainingRequirementCreate | TrainingRequirementUpdate, isEdit: boolean, id?: string) => void;
}

export const RequirementModal: React.FC<RequirementModalProps> = ({
  requirement,
  template,
  categories,
  onClose,
  onSave,
}) => {
  const seed = requirement ?? template;
  const seedFrequency = seed?.frequency || 'annual';
  const [formData, setFormData] = useState({
    name: seed?.name || '',
    description: seed?.description || '',
    requirement_type: seed?.requirement_type || 'hours',
    training_type: seed?.training_type || '',
    required_hours: seed?.required_hours || undefined,
    required_shifts: seed?.required_shifts || undefined,
    required_calls: seed?.required_calls || undefined,
    checklist_items: (seed?.checklist_items || []).join('\n'),
    passing_score: seed?.passing_score || undefined,
    max_attempts: seed?.max_attempts || undefined,
    frequency: seedFrequency,
    // A one-time requirement has no recurring cycle, so it must never carry a
    // year: "One time" next to "2026" reads as "only required during 2026",
    // when in fact the completion counts permanently (the backend returns an
    // unbounded date window for one_time and ignores `year` entirely).
    year: seedFrequency === 'one_time' ? undefined : seed?.year || (new Date().getFullYear() as number | undefined),
    allows_external_credit: seed?.allows_external_credit ?? false,
    applies_to_all: seed?.applies_to_all ?? true,
    required_membership_types: seed?.required_membership_types || ([] as string[]),
    due_date: seed?.due_date || '',
    start_date: seed?.start_date || '',
    due_date_type: seed?.due_date_type || 'calendar_period',
    rolling_period_months: seed?.rolling_period_months || 12,
    period_start_month: seed?.period_start_month || 1,
    period_start_day: seed?.period_start_day || 1,
    period_end_month: seed?.period_end_month || (undefined as number | undefined),
    period_end_day: seed?.period_end_day || (undefined as number | undefined),
    include_current_month_mode:
      seed?.include_current_month == null ? 'inherit' : seed.include_current_month ? 'include' : 'exclude',
    category_ids: seed?.category_ids || ([] as string[]),
  });

  // Linked course-library ids. Kept out of `formData` because it is an id list
  // the picker owns, not a text field.
  const [requiredCourses, setRequiredCourses] = useState<string[]>(seed?.required_courses ?? []);
  const [recencyDays, setRecencyDays] = useState<number | undefined>(seed?.recency_days ?? undefined);
  const { courses, loading: coursesLoading, error: coursesError } = useCourseLibrary();

  const [saving, setSaving] = useState(false);

  // A one-time requirement never recurs, so every cycle-related control (due
  // date type, calendar period, year) is hidden rather than shown with values
  // the backend ignores — that pairing is what made one-time requirements read
  // as annual.
  const isOneTime = formData.frequency === 'one_time';

  const splitLines = (value: string): string[] =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Name is required');
      return;
    }

    // Mirror the backend TrainingRequirementCreate validator so users get a
    // specific message instead of a generic 422 failure
    const checklistItems = splitLines(formData.checklist_items);
    if (formData.requirement_type === 'hours' && !formData.required_hours) {
      toast.error('Required hours must be set for an hours requirement');
      return;
    }
    if (formData.requirement_type === 'courses' && requiredCourses.length === 0) {
      toast.error('Select at least one course from the library for a courses requirement');
      return;
    }
    if (formData.requirement_type === 'shifts' && !formData.required_shifts) {
      toast.error('Required shifts must be set for a shifts requirement');
      return;
    }
    if (formData.requirement_type === 'calls' && !formData.required_calls) {
      toast.error('Required calls must be set for a calls requirement');
      return;
    }
    if (formData.requirement_type === 'knowledge_test' && !formData.passing_score) {
      toast.error('Passing score must be set for a knowledge test requirement');
      return;
    }

    // A requirement that applies to nobody silently disappears from every
    // member's compliance view — block it unless the record targets by
    // role/position (set outside this form)
    const hasRoleTargeting = (seed?.required_roles?.length || 0) > 0 || (seed?.required_positions?.length || 0) > 0;
    if (!formData.applies_to_all && formData.required_membership_types.length === 0 && !hasRoleTargeting) {
      toast.error('Select at least one member category, or check "Applies to all members"');
      return;
    }

    setSaving(true);
    try {
      // One-time requirements have no cycle to configure — the calendar period
      // and year are meaningless for them and only make the requirement look
      // like it repeats, so they are never persisted.
      const usesCalendarPeriod = !isOneTime && formData.due_date_type === 'calendar_period';
      const data = {
        name: formData.name,
        ...(formData.description ? { description: formData.description } : {}),
        requirement_type: formData.requirement_type,
        ...(formData.training_type ? { training_type: formData.training_type as TrainingType } : {}),
        ...(formData.required_hours ? { required_hours: formData.required_hours } : {}),
        // Always sent so switching a requirement off the course/certification
        // types clears stale links — a leftover course id silently narrows the
        // hours evaluator to only that course's records.
        required_courses:
          formData.requirement_type === 'courses' || formData.requirement_type === 'certification'
            ? requiredCourses
            : [],
        // Sent unconditionally (undefined when off) so lifting a freshness
        // window persists rather than silently keeping the old value.
        recency_days:
          formData.requirement_type === 'courses' || formData.requirement_type === 'certification'
            ? recencyDays
            : undefined,
        ...(formData.requirement_type === 'shifts' && formData.required_shifts
          ? { required_shifts: formData.required_shifts }
          : {}),
        ...(formData.requirement_type === 'calls' && formData.required_calls
          ? { required_calls: formData.required_calls }
          : {}),
        ...(formData.requirement_type === 'checklist' && checklistItems.length > 0
          ? { checklist_items: checklistItems }
          : {}),
        ...(formData.requirement_type === 'knowledge_test' && formData.passing_score
          ? { passing_score: formData.passing_score }
          : {}),
        ...(formData.requirement_type === 'knowledge_test' && formData.max_attempts
          ? { max_attempts: formData.max_attempts }
          : {}),
        frequency: formData.frequency,
        ...(!isOneTime && formData.year ? { year: formData.year } : {}),
        allows_external_credit: formData.allows_external_credit,
        applies_to_all: formData.applies_to_all,
        required_membership_types:
          formData.required_membership_types.length > 0 ? formData.required_membership_types : undefined,
        ...(formData.due_date ? { due_date: formData.due_date } : {}),
        ...(formData.start_date ? { start_date: formData.start_date } : {}),
        due_date_type: formData.due_date_type,
        rolling_period_months:
          !isOneTime && formData.due_date_type === 'rolling' ? formData.rolling_period_months : undefined,
        period_start_month: usesCalendarPeriod ? formData.period_start_month : undefined,
        period_start_day: usesCalendarPeriod ? formData.period_start_day : undefined,
        period_end_month: usesCalendarPeriod ? formData.period_end_month : undefined,
        period_end_day: usesCalendarPeriod ? formData.period_end_day : undefined,
        include_current_month:
          formData.include_current_month_mode === 'inherit' ? null : formData.include_current_month_mode === 'include',
        category_ids: formData.category_ids.length > 0 ? formData.category_ids : undefined,
        // Preserve registry attribution when creating from a standards template
        ...(!requirement && template?.source ? { source: template.source } : {}),
        ...(!requirement && template?.registry_name ? { registry_name: template.registry_name } : {}),
        ...(!requirement && template?.registry_code ? { registry_code: template.registry_code } : {}),
      };

      onSave(data, !!requirement, requirement?.id);
    } finally {
      setSaving(false);
    }
  };

  const handleCategoryToggle = (categoryId: string) => {
    setFormData((prev) => ({
      ...prev,
      category_ids: prev.category_ids.includes(categoryId)
        ? prev.category_ids.filter((id) => id !== categoryId)
        : [...prev.category_ids, categoryId],
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="requirement-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="bg-theme-surface-modal max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-lg p-6">
        <div className="mb-6 flex items-center justify-between">
          <h3 id="requirement-modal-title" className="text-theme-text-primary text-xl font-bold">
            {requirement ? 'Edit Requirement' : 'Create Requirement'}
          </h3>
          <button
            onClick={onClose}
            className="hover:bg-theme-surface-hover text-theme-text-muted rounded-lg p-2 transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <h4 className="text-theme-text-primary border-theme-surface-border border-b pb-2 font-semibold">
              Basic Information
            </h4>

            <div>
              <label htmlFor="req-name" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                Name{' '}
                <span aria-hidden="true" className="text-red-700 dark:text-red-400">
                  *
                </span>
              </label>
              <input
                id="req-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="form-input placeholder-theme-text-muted"
                placeholder="e.g., Annual Training Hours"
                required
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="req-description" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                Description
              </label>
              <textarea
                id="req-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="form-input placeholder-theme-text-muted"
                placeholder="Describe the requirement..."
                rows={3}
              />
            </div>

            <div>
              <label
                htmlFor="req-requirement-type"
                className="text-theme-text-secondary mb-2 block text-sm font-medium"
              >
                Requirement Type{' '}
                <span aria-hidden="true" className="text-red-700 dark:text-red-400">
                  *
                </span>
              </label>
              <select
                id="req-requirement-type"
                value={formData.requirement_type}
                onChange={(e) => {
                  const reqType = e.target.value as RequirementType;
                  // Auto-set related fields when there's a direct mapping
                  const trainingTypeMap: Record<string, string> = {
                    certification: 'certification',
                    skills_evaluation: 'skills_practice',
                  };
                  const dueDateTypeMap: Record<string, DueDateType> = {
                    certification: 'certification_period',
                  };
                  const autoTrainingType = trainingTypeMap[reqType];
                  const autoDueDateType = dueDateTypeMap[reqType];
                  setFormData({
                    ...formData,
                    requirement_type: reqType,
                    ...(autoTrainingType ? { training_type: autoTrainingType } : {}),
                    ...(autoDueDateType ? { due_date_type: autoDueDateType } : {}),
                  });
                }}
                className="form-input"
                required
                aria-required="true"
              >
                <option value="hours">Hours</option>
                <option value="courses">Courses</option>
                <option value="certification">Certification</option>
                <option value="shifts">Shifts</option>
                <option value="calls">Calls</option>
                <option value="skills_evaluation">Skills Evaluation</option>
                <option value="checklist">Checklist</option>
                <option value="knowledge_test">Knowledge Test</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="req-training-type" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                  Training Type
                </label>
                <select
                  id="req-training-type"
                  value={formData.training_type}
                  onChange={(e) => setFormData({ ...formData, training_type: e.target.value })}
                  className="form-input"
                >
                  <option value="">Any Type</option>
                  <option value="certification">Certification</option>
                  <option value="continuing_education">Continuing Education</option>
                  <option value="skills_practice">Skills Practice</option>
                  <option value="orientation">Orientation</option>
                  <option value="refresher">Refresher</option>
                  <option value="specialty">Specialty</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="req-required-hours"
                  className="text-theme-text-secondary mb-2 block text-sm font-medium"
                >
                  Required Hours
                  {formData.requirement_type === 'hours' && (
                    <span aria-hidden="true" className="text-red-700 dark:text-red-400">
                      {' '}
                      *
                    </span>
                  )}
                </label>
                <input
                  id="req-required-hours"
                  type="number"
                  value={formData.required_hours || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, required_hours: e.target.value ? Number(e.target.value) : undefined })
                  }
                  className="form-input placeholder-theme-text-muted"
                  placeholder="e.g., 36"
                  min="0"
                  step="0.5"
                />
              </div>
            </div>

            {/* Per-type quantity fields */}
            {/* Courses are picked from the library, never typed: compliance
                matches a member's records by course id, so a typed-in course
                name never matches and the requirement could never complete. */}
            {(formData.requirement_type === 'courses' || formData.requirement_type === 'certification') && (
              <CourseLibraryPicker
                idPrefix="req"
                courses={courses}
                loading={coursesLoading}
                error={coursesError}
                variant={formData.requirement_type === 'certification' ? 'certification' : 'courses'}
                selectedIds={requiredCourses}
                onChange={setRequiredCourses}
              />
            )}

            {(formData.requirement_type === 'courses' || formData.requirement_type === 'certification') && (
              <RecencyWindowField idPrefix="req" value={recencyDays} onChange={setRecencyDays} />
            )}

            {formData.requirement_type === 'shifts' && (
              <div>
                <label
                  htmlFor="req-required-shifts"
                  className="text-theme-text-secondary mb-2 block text-sm font-medium"
                >
                  Required Shifts{' '}
                  <span aria-hidden="true" className="text-red-700 dark:text-red-400">
                    *
                  </span>
                </label>
                <input
                  id="req-required-shifts"
                  type="number"
                  value={formData.required_shifts || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, required_shifts: e.target.value ? Number(e.target.value) : undefined })
                  }
                  className="form-input placeholder-theme-text-muted"
                  placeholder="e.g., 12"
                  min="1"
                />
              </div>
            )}

            {formData.requirement_type === 'calls' && (
              <div>
                <label
                  htmlFor="req-required-calls"
                  className="text-theme-text-secondary mb-2 block text-sm font-medium"
                >
                  Required Calls{' '}
                  <span aria-hidden="true" className="text-red-700 dark:text-red-400">
                    *
                  </span>
                </label>
                <input
                  id="req-required-calls"
                  type="number"
                  value={formData.required_calls || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, required_calls: e.target.value ? Number(e.target.value) : undefined })
                  }
                  className="form-input placeholder-theme-text-muted"
                  placeholder="e.g., 24"
                  min="1"
                />
              </div>
            )}

            {formData.requirement_type === 'checklist' && (
              <div>
                <label
                  htmlFor="req-checklist-items"
                  className="text-theme-text-secondary mb-2 block text-sm font-medium"
                >
                  Checklist Items
                </label>
                <textarea
                  id="req-checklist-items"
                  value={formData.checklist_items}
                  onChange={(e) => setFormData({ ...formData, checklist_items: e.target.value })}
                  className="form-input placeholder-theme-text-muted"
                  placeholder={'One item per line, e.g.\nStation tour completed\nSCBA fit test'}
                  rows={5}
                />
                <p className="text-theme-text-muted mt-1 text-sm">Each line becomes an item members must check off.</p>
              </div>
            )}

            {formData.requirement_type === 'knowledge_test' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="req-passing-score"
                    className="text-theme-text-secondary mb-2 block text-sm font-medium"
                  >
                    Passing Score (%){' '}
                    <span aria-hidden="true" className="text-red-700 dark:text-red-400">
                      *
                    </span>
                  </label>
                  <input
                    id="req-passing-score"
                    type="number"
                    value={formData.passing_score || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, passing_score: e.target.value ? Number(e.target.value) : undefined })
                    }
                    className="form-input placeholder-theme-text-muted"
                    placeholder="e.g., 80"
                    min="1"
                    max="100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="req-max-attempts"
                    className="text-theme-text-secondary mb-2 block text-sm font-medium"
                  >
                    Max Attempts
                  </label>
                  <input
                    id="req-max-attempts"
                    type="number"
                    value={formData.max_attempts || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, max_attempts: e.target.value ? Number(e.target.value) : undefined })
                    }
                    className="form-input placeholder-theme-text-muted"
                    placeholder="Unlimited"
                    min="1"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Due Date Configuration */}
          <div className="space-y-4">
            <h4 className="text-theme-text-primary border-theme-surface-border border-b pb-2 font-semibold">
              Due Date Configuration
            </h4>

            {/* Frequency comes first: it decides whether any of the recurring
                cycle controls below apply at all. */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="req-frequency" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                  Frequency
                </label>
                <select
                  id="req-frequency"
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value as RequirementFrequency })}
                  className="form-input"
                >
                  <option value="annual">Annual</option>
                  <option value="biannual">Biannual (Every 2 Years)</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="monthly">Monthly</option>
                  <option value="one_time">One Time</option>
                </select>
              </div>

              {!isOneTime && (
                <div>
                  <label htmlFor="req-year" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    Year
                  </label>
                  <input
                    id="req-year"
                    type="number"
                    value={formData.year || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, year: e.target.value ? Number(e.target.value) : undefined })
                    }
                    className="form-input placeholder-theme-text-muted"
                    placeholder="e.g., 2026"
                    min="2020"
                    max="2100"
                  />
                </div>
              )}
            </div>

            {isOneTime && (
              <div className="flex items-start gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <p className="text-xs text-blue-800 dark:text-blue-300">
                  One-time requirements never reset. Once a member completes this, they stay compliant permanently —
                  there is no renewal cycle, compliance period, or year to configure.
                </p>
              </div>
            )}

            {!isOneTime && (
              <div>
                <label className="text-theme-text-secondary mb-2 block text-sm font-medium">Due Date Type</label>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="radiogroup" aria-label="Due date type">
                  {[
                    { value: 'calendar_period', label: 'Calendar Period', desc: 'Due by end of period (e.g., Dec 31)' },
                    { value: 'rolling', label: 'Rolling', desc: 'Due X months from last completion' },
                    { value: 'certification_period', label: 'Cert Period', desc: 'Due when certification expires' },
                    { value: 'fixed_date', label: 'Fixed Date', desc: 'Due by a specific date' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={formData.due_date_type === option.value}
                      onClick={() => setFormData({ ...formData, due_date_type: option.value as DueDateType })}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        formData.due_date_type === option.value
                          ? 'text-theme-text-primary border-red-500 bg-red-500/20'
                          : 'border-theme-input-border bg-theme-input-bg text-theme-text-secondary hover:border-theme-input-border'
                      }`}
                    >
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className="text-theme-text-muted mt-1 text-xs">{option.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Rolling period options */}
            {!isOneTime && formData.due_date_type === 'rolling' && (
              <div>
                <label
                  htmlFor="req-rolling-period"
                  className="text-theme-text-secondary mb-2 block text-sm font-medium"
                >
                  Rolling Period (Months)
                </label>
                <input
                  id="req-rolling-period"
                  type="number"
                  value={formData.rolling_period_months}
                  onChange={(e) => setFormData({ ...formData, rolling_period_months: Number(e.target.value) })}
                  className="form-input"
                  min="1"
                  max="120"
                />
                <p className="text-theme-text-muted mt-1 text-sm">
                  Training must be completed every {formData.rolling_period_months} months from the last completion
                  date.
                </p>
              </div>
            )}

            {/* Calendar period options */}
            {!isOneTime && formData.due_date_type === 'calendar_period' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="req-period-start-month"
                      className="text-theme-text-secondary mb-2 block text-sm font-medium"
                    >
                      Period Start Month
                    </label>
                    <select
                      id="req-period-start-month"
                      value={formData.period_start_month}
                      onChange={(e) => setFormData({ ...formData, period_start_month: Number(e.target.value) })}
                      className="form-input"
                    >
                      {[
                        'January',
                        'February',
                        'March',
                        'April',
                        'May',
                        'June',
                        'July',
                        'August',
                        'September',
                        'October',
                        'November',
                        'December',
                      ].map((month, idx) => (
                        <option key={idx} value={idx + 1}>
                          {month}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="req-period-start-day"
                      className="text-theme-text-secondary mb-2 block text-sm font-medium"
                    >
                      Period Start Day
                    </label>
                    <input
                      id="req-period-start-day"
                      type="number"
                      value={formData.period_start_day}
                      onChange={(e) => setFormData({ ...formData, period_start_day: Number(e.target.value) })}
                      className="form-input"
                      min="1"
                      max="31"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="req-period-end-month"
                      className="text-theme-text-secondary mb-2 block text-sm font-medium"
                    >
                      Period End Month (Optional)
                    </label>
                    <select
                      id="req-period-end-month"
                      value={formData.period_end_month || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          period_end_month: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      className="form-input"
                    >
                      <option value="">Default (end of year)</option>
                      {[
                        'January',
                        'February',
                        'March',
                        'April',
                        'May',
                        'June',
                        'July',
                        'August',
                        'September',
                        'October',
                        'November',
                        'December',
                      ].map((month, idx) => (
                        <option key={idx} value={idx + 1}>
                          {month}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="req-period-end-day"
                      className="text-theme-text-secondary mb-2 block text-sm font-medium"
                    >
                      Period End Day
                    </label>
                    <input
                      id="req-period-end-day"
                      type="number"
                      value={formData.period_end_day || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          period_end_day: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      className="form-input"
                      min="1"
                      max="31"
                      disabled={!formData.period_end_month}
                      placeholder={formData.period_end_month ? 'Last day of month' : ''}
                    />
                  </div>
                </div>
                {formData.period_end_month && formData.period_start_month > formData.period_end_month && (
                  <p className="text-theme-text-muted text-sm">
                    Cross-year window: completions accepted from month {formData.period_start_month} of the previous
                    year through month {formData.period_end_month}, day {formData.period_end_day || 'last'} of the
                    current year.
                  </p>
                )}
              </>
            )}

            {/* Fixed date option */}
            {!isOneTime && formData.due_date_type === 'fixed_date' && (
              <div>
                <label htmlFor="req-due-date" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                  Due Date
                </label>
                <input
                  id="req-due-date"
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="form-input"
                />
              </div>
            )}

            {/* Evaluation period boundary (per-requirement override) */}
            <div>
              <label
                htmlFor="req-include-current-month"
                className="text-theme-text-secondary mb-2 block text-sm font-medium"
              >
                Evaluation Period
              </label>
              <select
                id="req-include-current-month"
                value={formData.include_current_month_mode}
                onChange={(e) => setFormData({ ...formData, include_current_month_mode: e.target.value })}
                className="form-input"
              >
                <option value="inherit">Use department default</option>
                <option value="include">Count the current (in-progress) month</option>
                <option value="exclude">Stop at the end of the previous month</option>
              </select>
              <p className="text-theme-text-muted mt-1 text-xs">
                Controls whether this requirement counts the in-progress month. Choose &ldquo;stop at the end of the
                previous month&rdquo; for drills held late in the month so members aren&rsquo;t flagged early. Defaults
                to the department-wide compliance setting.
              </p>
            </div>
          </div>

          {/* Categories */}
          {categories.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-theme-text-primary border-theme-surface-border border-b pb-2 font-semibold">
                Training Categories
              </h4>
              <p className="text-theme-text-muted text-sm">
                Select categories that can satisfy this requirement. Training sessions tagged with these categories will
                count towards completion.
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Training categories">
                {categories
                  .filter((c) => c.active)
                  .map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => handleCategoryToggle(category.id)}
                      aria-pressed={formData.category_ids.includes(category.id)}
                      className={`flex items-center space-x-2 rounded-lg border px-3 py-2 transition-colors ${
                        formData.category_ids.includes(category.id)
                          ? 'text-theme-text-primary border-red-500 bg-red-500/20'
                          : 'border-theme-input-border bg-theme-input-bg text-theme-text-secondary hover:border-theme-input-border'
                      }`}
                    >
                      {category.color && (
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: category.color }}
                          aria-hidden="true"
                        />
                      )}
                      <span>{category.name}</span>
                      {formData.category_ids.includes(category.id) && (
                        <CheckCircle className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                      )}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* External / imported training credit — flagged so the officer makes
              a deliberate choice about whether third-party courses count. */}
          {(formData.requirement_type === 'hours' || formData.requirement_type === 'courses') && (
            <div className="space-y-3">
              <h4 className="text-theme-text-primary border-theme-surface-border border-b pb-2 font-semibold">
                External / Imported Training Credit
              </h4>
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <AlertCircle
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <div className="space-y-2">
                  <p className="text-theme-text-secondary text-sm">
                    {formData.allows_external_credit ? (
                      <>
                        Imported courses <strong>will</strong> count toward this requirement when they carry a matching
                        category (e.g. a Vector Solutions completion).
                      </>
                    ) : (
                      <>
                        By default, courses imported from an external provider (e.g. Vector Solutions){' '}
                        <strong>will not</strong> count toward this requirement — it can only be satisfied by an
                        in-house session, a skills test, or manual sign-off.
                      </>
                    )}
                  </p>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={formData.allows_external_credit}
                      onChange={(e) => setFormData({ ...formData, allows_external_credit: e.target.checked })}
                      className="border-theme-input-border bg-theme-input-bg focus:ring-theme-focus-ring mt-0.5 h-5 w-5 rounded-sm text-red-700 dark:text-red-500"
                    />
                    <span className="text-theme-text-secondary text-sm">
                      Accept external / imported training credit for this requirement
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Assignment */}
          <div className="space-y-4">
            <h4 className="text-theme-text-primary border-theme-surface-border border-b pb-2 font-semibold">
              Assignment
            </h4>

            <div>
              <label className="flex cursor-pointer items-center space-x-3">
                <input
                  type="checkbox"
                  checked={formData.applies_to_all}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      applies_to_all: e.target.checked,
                      ...(e.target.checked ? { required_membership_types: [] } : {}),
                    })
                  }
                  className="border-theme-input-border bg-theme-input-bg focus:ring-theme-focus-ring h-5 w-5 rounded-sm text-red-700 dark:text-red-500"
                />
                <span className="text-theme-text-secondary">Applies to all members</span>
              </label>
              <p className="text-theme-text-muted mt-1 ml-8 text-sm">
                When checked, this requirement applies to everyone in the organization.
              </p>
            </div>

            {/* Member Categories - shown when not applies_to_all */}
            {!formData.applies_to_all && (
              <div>
                <label className="text-theme-text-secondary mb-2 block text-sm font-medium">Member Categories</label>
                <p className="text-theme-text-muted mb-3 text-sm">
                  Select which member categories this requirement applies to.
                </p>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3" role="group" aria-label="Member categories">
                  {MEMBERSHIP_TYPES.map((memberType) => (
                    <label
                      key={memberType.value}
                      className={`flex cursor-pointer items-center space-x-3 rounded-lg border px-3 py-2 transition-colors ${
                        formData.required_membership_types.includes(memberType.value)
                          ? 'text-theme-text-primary border-red-500 bg-red-500/20'
                          : 'border-theme-input-border bg-theme-input-bg text-theme-text-secondary hover:border-theme-input-border'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={formData.required_membership_types.includes(memberType.value)}
                        onChange={() => {
                          setFormData((prev) => ({
                            ...prev,
                            required_membership_types: prev.required_membership_types.includes(memberType.value)
                              ? prev.required_membership_types.filter((v) => v !== memberType.value)
                              : [...prev.required_membership_types, memberType.value],
                          }));
                        }}
                        className="border-theme-input-border bg-theme-input-bg focus:ring-theme-focus-ring h-4 w-4 rounded-sm text-red-700 dark:text-red-500"
                      />
                      <span className="text-sm">{memberType.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="req-start-date" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                  Start Date
                </label>
                <input
                  id="req-start-date"
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="form-input"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="border-theme-surface-border flex justify-end space-x-3 border-t pt-4">
            <button
              type="button"
              onClick={onClose}
              className="bg-theme-surface-hover hover:bg-theme-surface-secondary text-theme-text-primary rounded-lg px-4 py-2 transition-colors"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-success">
              {saving ? 'Saving...' : requirement ? 'Update Requirement' : 'Create Requirement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
