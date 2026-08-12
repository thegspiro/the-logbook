import React from 'react';
import { Plus, Trash2, Palette } from 'lucide-react';
import type { EventCategoryConfig } from '../../types/event';
import type { CategoriesSectionProps } from './types';

const CATEGORY_COLOR_OPTIONS = [
  { value: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400', label: 'Blue', preview: 'bg-blue-500' },
  {
    value: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
    label: 'Green',
    preview: 'bg-green-500',
  },
  {
    value: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-400',
    label: 'Purple',
    preview: 'bg-purple-500',
  },
  { value: 'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-400', label: 'Pink', preview: 'bg-pink-500' },
  {
    value: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
    label: 'Yellow',
    preview: 'bg-yellow-500',
  },
  {
    value: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-400',
    label: 'Indigo',
    preview: 'bg-indigo-500',
  },
  { value: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400', label: 'Red', preview: 'bg-red-500' },
  { value: 'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-400', label: 'Teal', preview: 'bg-teal-500' },
  {
    value: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400',
    label: 'Orange',
    preview: 'bg-orange-500',
  },
] as const;

const CategoriesSection: React.FC<CategoriesSectionProps> = ({
  settings,
  saving,
  onAddCategory,
  onRemoveCategory,
  newCategoryLabel,
  onNewCategoryLabelChange,
  newCategoryColor,
  onNewCategoryColorChange,
}) => {
  const customCategories = settings.custom_event_categories || [];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-theme-text-primary text-lg font-semibold">Custom Event Categories</h3>
        <p className="text-theme-text-muted mt-1 text-sm">
          Create organization-specific event categories beyond the built-in types.
        </p>
      </div>

      {customCategories.length > 0 ? (
        <div className="space-y-2">
          {customCategories.map((cat: EventCategoryConfig) => (
            <div
              key={cat.value}
              className="border-theme-surface-border flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cat.color}`}
                >
                  {cat.label}
                </span>
                <span className="text-theme-text-muted font-mono text-xs">{cat.value}</span>
              </div>
              <button
                type="button"
                onClick={() => onRemoveCategory(cat.value)}
                disabled={saving}
                className="text-theme-text-muted text-sm transition-colors hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                title={`Remove "${cat.label}"`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-theme-text-muted py-2 text-center text-sm italic">
          No custom categories yet. Add one below.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="new-category-label" className="text-theme-text-muted mb-1 block text-xs font-medium">
            Category Name
          </label>
          <input
            id="new-category-label"
            type="text"
            value={newCategoryLabel}
            onChange={(e) => onNewCategoryLabelChange(e.target.value)}
            placeholder="e.g., Drill, Inspection"
            className="form-input placeholder-theme-text-muted text-sm"
          />
        </div>
        <div className="w-36">
          <label htmlFor="new-category-color" className="text-theme-text-muted mb-1 block text-xs font-medium">
            <Palette className="mr-1 inline h-3 w-3" />
            Color
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {CATEGORY_COLOR_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => onNewCategoryColorChange(opt.value)}
                className={`h-5 w-5 rounded-full ${opt.preview} transition-all ${
                  newCategoryColor === opt.value
                    ? 'ring-theme-focus-ring ring-2 ring-offset-2 dark:ring-offset-gray-800'
                    : 'opacity-60 hover:opacity-100'
                }`}
                title={opt.label}
                aria-label={`Select ${opt.label} color`}
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onAddCategory}
          disabled={saving || !newCategoryLabel.trim()}
          className="btn-primary flex items-center gap-1.5 text-sm font-medium"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>
    </div>
  );
};

export default CategoriesSection;
