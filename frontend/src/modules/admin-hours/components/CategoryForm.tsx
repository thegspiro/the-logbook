/**
 * CategoryForm Component
 *
 * Create/edit form for admin hours categories with color picker
 * and fields for name, description, approval settings, and limits.
 */

import React from 'react';
import type { AdminHoursCategoryCreate } from '../types';

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
}

const CategoryForm: React.FC<CategoryFormProps> = ({
  formData,
  onChange,
  onSubmit,
  isEditing,
  submitting = false,
  onCancel,
}) => {
  return (
    <div className="bg-theme-surface mb-6 rounded-lg p-6 shadow-md">
      <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">
        {isEditing ? 'Edit Category' : 'New Category'}
      </h3>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="category-name" className="form-label">
              Name *
            </label>
            <input
              id="category-name"
              type="text"
              value={formData.name}
              onChange={(e) => onChange({ ...formData, name: e.target.value })}
              className="form-input"
              required
              placeholder="e.g., Building Maintenance"
            />
          </div>
          <div>
            <span id="category-color-label" className="form-label">
              Color
            </span>
            <div role="group" aria-labelledby="category-color-label" className="flex flex-wrap items-center gap-2">
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
          </div>
        </div>

        <div>
          <label htmlFor="category-description" className="form-label">
            Description
          </label>
          <textarea
            id="category-description"
            value={formData.description ?? ''}
            onChange={(e) => onChange({ ...formData, description: e.target.value })}
            rows={2}
            className="form-input"
            placeholder="Brief description of this type of admin work"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="touch:min-h-11 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={formData.require_approval ?? true}
              onChange={(e) => onChange({ ...formData, require_approval: e.target.checked })}
              className="form-checkbox"
              aria-describedby="category-approval-scope"
            />
            <span className="text-theme-text-secondary text-sm">Require approval</span>
          </label>

          <div>
            <label htmlFor="category-auto-approve" className="form-label">
              Auto-approve under (hours)
            </label>
            <input
              id="category-auto-approve"
              type="number"
              step="0.5"
              min="0"
              value={formData.auto_approve_under_hours ?? ''}
              onChange={(e) =>
                onChange({ ...formData, auto_approve_under_hours: e.target.value ? parseFloat(e.target.value) : null })
              }
              className="form-input"
              placeholder="e.g., 4"
            />
          </div>

          <div>
            <label htmlFor="category-max-hours" className="form-label">
              Max hours per session
            </label>
            <input
              id="category-max-hours"
              type="number"
              step="0.5"
              min="0.5"
              value={formData.max_hours_per_session ?? ''}
              onChange={(e) =>
                onChange({ ...formData, max_hours_per_session: e.target.value ? parseFloat(e.target.value) : null })
              }
              className="form-input"
              placeholder="e.g., 12"
            />
          </div>
        </div>
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
