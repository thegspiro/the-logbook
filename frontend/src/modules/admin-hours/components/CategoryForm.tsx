/**
 * CategoryForm Component
 *
 * Create/edit form for admin hours categories with color picker
 * and fields for name, description, approval settings, and limits.
 */

import React from 'react';
import type { AdminHoursCategoryCreate } from '../types';

const DEFAULT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

interface CategoryFormProps {
  formData: AdminHoursCategoryCreate;
  onChange: (data: AdminHoursCategoryCreate) => void;
  onSubmit: (e: React.FormEvent) => void;
  isEditing: boolean;
  onCancel: () => void;
}

const CategoryForm: React.FC<CategoryFormProps> = ({ formData, onChange, onSubmit, isEditing, onCancel }) => {
  return (
    <div className="bg-theme-surface rounded-lg shadow-md p-6 mb-6">
      <h3 className="text-lg font-semibold text-theme-text-primary mb-4">
        {isEditing ? 'Edit Category' : 'New Category'}
      </h3>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => onChange({ ...formData, name: e.target.value })}
              className="card-secondary focus:border-transparent focus:ring-2 focus:ring-theme-focus-ring px-3 py-2 text-theme-text-primary w-full"
              required
              placeholder="e.g., Building Maintenance"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Color</label>
            <div className="flex gap-2 items-center">
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange({ ...formData, color: c })}
                  className={`w-8 h-8 rounded-full border-2 transition ${formData.color === c ? 'border-white scale-110 ring-2 ring-blue-500' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-theme-text-secondary mb-1">Description</label>
          <textarea
            value={formData.description ?? ''}
            onChange={(e) => onChange({ ...formData, description: e.target.value })}
            rows={2}
            className="card-secondary focus:border-transparent focus:ring-2 focus:ring-theme-focus-ring px-3 py-2 text-theme-text-primary w-full"
            placeholder="Brief description of this type of admin work"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.require_approval ?? true}
              onChange={(e) => onChange({ ...formData, require_approval: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300"
            />
            <span className="text-sm text-theme-text-secondary">Require approval</span>
          </label>

          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Auto-approve under (hours)</label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={formData.auto_approve_under_hours ?? ''}
              onChange={(e) => onChange({ ...formData, auto_approve_under_hours: e.target.value ? parseFloat(e.target.value) : null })}
              className="card-secondary focus:border-transparent focus:ring-2 focus:ring-theme-focus-ring px-3 py-2 text-theme-text-primary w-full"
              placeholder="e.g., 4"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Max hours per session</label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              value={formData.max_hours_per_session ?? ''}
              onChange={(e) => onChange({ ...formData, max_hours_per_session: e.target.value ? parseFloat(e.target.value) : null })}
              className="card-secondary focus:border-transparent focus:ring-2 focus:ring-theme-focus-ring px-3 py-2 text-theme-text-primary w-full"
              placeholder="e.g., 12"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn-info transition">
            {isEditing ? 'Update' : 'Create'}
          </button>
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-theme-surface-secondary text-theme-text-secondary rounded-lg hover:bg-theme-surface-hover transition">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default CategoryForm;
