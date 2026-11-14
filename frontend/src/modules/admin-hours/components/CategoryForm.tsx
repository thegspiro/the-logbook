/**
 * CategoryForm Component
 *
 * Create/edit form for admin hours categories with color picker
 * and fields for name, description, approval settings, and limits.
 */

import React from 'react';
import { FormField } from '@/components/ux/FormField';
import type { AdminHoursCategoryCreate } from '../types';
import { CATEGORY_FIELD_IDS, CATEGORY_NAME_MAX_LENGTH, type CategoryField } from './categoryFields';

const DEFAULT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

// The swatches are buttons with no text; these name them (W70).
const COLOR_NAMES: Record<string, string> = {
  '#3B82F6': 'Blue',
  '#10B981': 'Green',
  '#F59E0B': 'Amber',
  '#EF4444': 'Red',
  '#8B5CF6': 'Violet',
  '#EC4899': 'Pink',
  '#06B6D4': 'Cyan',
  '#84CC16': 'Lime',
};

interface CategoryFormProps {
  formData: AdminHoursCategoryCreate;
  onChange: (data: AdminHoursCategoryCreate) => void;
  onSubmit: (e: React.FormEvent) => void;
  isEditing: boolean;
  /** True while a submit is in flight — blocks the double-click duplicate. */
  submitting?: boolean;
  onCancel: () => void;
  /** Each field's open error, from the form's own check or the server's 422. */
  errors?: Partial<Record<CategoryField, string>>;
}

const CategoryForm: React.FC<CategoryFormProps> = ({
  formData,
  onChange,
  onSubmit,
  isEditing,
  submitting = false,
  onCancel,
  errors = {},
}) => {
  return (
    <div className="bg-theme-surface mb-6 rounded-lg p-6 shadow-md">
      <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">
        {isEditing ? 'Edit Category' : 'New Category'}
      </h3>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            id={CATEGORY_FIELD_IDS.name}
            label="Name"
            required
            error={errors.name}
            maxLength={CATEGORY_NAME_MAX_LENGTH}
            count={formData.name.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={formData.name}
                onChange={(e) => onChange({ ...formData, name: e.target.value })}
                className="form-input"
                placeholder="e.g., Building Maintenance"
              />
            )}
          </FormField>
          <div>
            <span id="category-color-label" className="form-label">
              Color
            </span>
            <div
              id={CATEGORY_FIELD_IDS.color}
              tabIndex={-1}
              role="group"
              aria-labelledby="category-color-label"
              aria-describedby={errors.color ? 'category-color-error' : undefined}
              className="flex flex-wrap items-center gap-2"
            >
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange({ ...formData, color: c })}
                  aria-label={COLOR_NAMES[c] ?? c}
                  aria-pressed={formData.color === c}
                  className={`touch-target-phone h-8 w-8 rounded-full border-2 transition ${formData.color === c ? 'border-theme-surface scale-110 ring-2 ring-blue-500' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            {errors.color && (
              <p id="category-color-error" className="mt-1 text-sm text-red-800 dark:text-red-300">
                {errors.color}
              </p>
            )}
          </div>
        </div>

        <FormField id={CATEGORY_FIELD_IDS.description} label="Description" error={errors.description}>
          {(field) => (
            <textarea
              {...field}
              value={formData.description ?? ''}
              onChange={(e) => onChange({ ...formData, description: e.target.value })}
              rows={2}
              className="form-input"
              placeholder="Brief description of this type of admin work"
            />
          )}
        </FormField>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="touch:min-h-11 flex cursor-pointer items-center gap-2">
            <input
              id={CATEGORY_FIELD_IDS.require_approval}
              type="checkbox"
              checked={formData.require_approval ?? true}
              onChange={(e) => onChange({ ...formData, require_approval: e.target.checked })}
              className="form-checkbox"
              aria-invalid={errors.require_approval ? true : undefined}
              aria-describedby={
                errors.require_approval ? 'category-approval-error category-approval-scope' : 'category-approval-scope'
              }
            />
            <span className="text-theme-text-secondary text-sm">Require approval</span>
          </label>

          <FormField
            id={CATEGORY_FIELD_IDS.auto_approve_under_hours}
            label="Auto-approve under (hours)"
            error={errors.auto_approve_under_hours}
          >
            {(field) => (
              <input
                {...field}
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0"
                value={formData.auto_approve_under_hours ?? ''}
                onChange={(e) =>
                  onChange({
                    ...formData,
                    auto_approve_under_hours: e.target.value ? parseFloat(e.target.value) : null,
                  })
                }
                className="form-input"
                placeholder="e.g., 4"
              />
            )}
          </FormField>

          <FormField
            id={CATEGORY_FIELD_IDS.max_hours_per_session}
            label="Max hours per session"
            error={errors.max_hours_per_session}
          >
            {(field) => (
              <input
                {...field}
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0.5"
                value={formData.max_hours_per_session ?? ''}
                onChange={(e) =>
                  onChange({ ...formData, max_hours_per_session: e.target.value ? parseFloat(e.target.value) : null })
                }
                className="form-input"
                placeholder="e.g., 12"
              />
            )}
          </FormField>
        </div>
        {errors.require_approval && (
          <p id="category-approval-error" className="text-sm text-red-800 dark:text-red-300">
            {errors.require_approval}
          </p>
        )}
        {/* Manual entries are pinned to PENDING server-side (audit finding AH-1:
            both times are member-supplied, so auto-approving them would let a
            member self-credit backdated hours). Say so here, or an officer who
            switches approval off reads every manual submission as a bug. */}
        <p id="category-approval-scope" className="text-theme-text-muted -mt-2 text-xs">
          Approval settings apply to clock-in/clock-out sessions and event attendance credit. Hours a member logs
          manually always go to an officer for review, because the member enters both the start and end time.
        </p>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="btn-info transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isEditing ? 'Save changes' : 'Create category'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg px-4 py-2 transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default CategoryForm;
