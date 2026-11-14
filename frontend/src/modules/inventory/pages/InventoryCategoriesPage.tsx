/**
 * Inventory Categories Page
 *
 * Manages inventory categories: viewing, creating, and editing.
 * Categories classify inventory items by type (uniform, PPE, tool, etc.)
 * and configure tracking requirements (serial numbers, maintenance, NFPA).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Tag, Plus, Pencil, RefreshCw, Settings, Shield, Wrench, Hash, AlertTriangle, Nfc } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { InventoryCategory, InventoryCategoryCreate } from '../types';
import { ITEM_TYPES } from '../types';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { DuplicateCategoryNameBadge } from '../components/DuplicateCategoryNameBadge';
import toast from 'react-hot-toast';
import { formCoercions } from '../../../utils/formValues';
import { firstRefused, saveExceptRefused } from '../../../utils/saveExceptRefused';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { placeApiError } from '../../../hooks/useFieldErrors';

const ITEM_TYPE_COLORS: Record<string, string> = {
  uniform: 'bg-blue-500/10 text-blue-900 dark:text-blue-300 border-blue-500/30',
  ppe: 'bg-red-500/10 text-red-900 dark:text-red-300 border-red-500/30',
  tool: 'bg-amber-500/10 text-amber-900 dark:text-amber-300 border-amber-500/30',
  equipment: 'bg-purple-500/10 text-purple-900 dark:text-purple-300 border-purple-500/30',
  vehicle: 'bg-emerald-500/10 text-emerald-900 dark:text-emerald-300 border-emerald-500/30',
  electronics: 'bg-cyan-500/10 text-cyan-900 dark:text-cyan-300 border-cyan-500/30',
  consumable: 'bg-orange-500/10 text-orange-900 dark:text-orange-300 border-orange-500/30',
  medical: 'bg-sky-500/10 text-sky-900 dark:text-sky-300 border-sky-500/30',
  other: 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border',
};

function getItemTypeLabel(value: string): string {
  return ITEM_TYPES.find((t) => t.value === value)?.label ?? value;
}

interface CategoryFormData {
  name: string;
  description: string;
  item_type: string;
  requires_serial_number: boolean;
  requires_maintenance: boolean;
  requires_assignment: boolean;
  nfpa_tracking_enabled: boolean;
  low_stock_threshold: string;
  allow_self_checkout: boolean;
  self_checkout_loan_days: string;
}

const EMPTY_FORM: CategoryFormData = {
  name: '',
  description: '',
  item_type: 'equipment',
  requires_serial_number: false,
  requires_maintenance: false,
  requires_assignment: false,
  nfpa_tracking_enabled: false,
  low_stock_threshold: '',
  allow_self_checkout: false,
  self_checkout_loan_days: '',
};

type CategoryField = 'name' | 'description' | 'item_type' | 'self_checkout_loan_days' | 'low_stock_threshold';

// snake_case keys: schemas/inventory.py carries no alias generator, so a 422
// names the request body's own keys. Ordered as on screen, so the first
// refusal takes focus.
const CATEGORY_FIELDS: FieldSpecs<CategoryField> = {
  name: { id: 'cat-name', label: 'Name' },
  description: { id: 'cat-desc', label: 'Description' },
  item_type: { id: 'cat-type', label: 'Item Type' },
  self_checkout_loan_days: { id: 'cat-loan-days', label: 'Kiosk loan period (days)' },
  low_stock_threshold: { id: 'cat-threshold', label: 'Low Stock Threshold' },
};
const CATEGORY_ORDER = Object.keys(CATEGORY_FIELDS) as CategoryField[];

/** `EntityName` and `FreeText` in schemas/inventory.py. */
const NAME_MAX = 255;
const DESCRIPTION_MAX = 2000;

/** A whole number in range, or null for a blank box; `undefined` when the text is not one. */
function parseWhole(text: string, min: number, max: number): number | null | undefined {
  if (!text.trim()) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

const inputClass = 'form-input w-full';
const selectClass = 'form-input w-full';
const labelClass = 'form-label';

const InventoryCategoriesPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('inventory.manage');
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<InventoryCategory | null>(null);
  const [formData, setFormData] = useState<CategoryFormData>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const categoryErrors = useFieldErrors(CATEGORY_FIELDS);
  // What the dialog held when it opened (or last saved), so Escape, the X and
  // Cancel ask before throwing typed changes away (forms review F-6).
  const [baseline, setBaseline] = useState<CategoryFormData>(EMPTY_FORM);
  const isDirty = showModal && JSON.stringify(formData) !== JSON.stringify(baseline);

  const loadCategories = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await inventoryService.getCategories(filterType || undefined, true);
      setCategories(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load categories'));
    } finally {
      setIsLoading(false);
    }
  }, [filterType]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const openCreateModal = () => {
    setEditingCategory(null);
    setFormData(EMPTY_FORM);
    setBaseline(EMPTY_FORM);
    categoryErrors.clear();
    setShowModal(true);
  };

  const openEditModal = (category: InventoryCategory) => {
    setEditingCategory(category);
    const seeded: CategoryFormData = {
      name: category.name,
      description: category.description ?? '',
      item_type: category.item_type,
      requires_serial_number: category.requires_serial_number,
      requires_maintenance: category.requires_maintenance,
      requires_assignment: category.requires_assignment,
      nfpa_tracking_enabled: category.nfpa_tracking_enabled,
      low_stock_threshold: category.low_stock_threshold != null ? String(category.low_stock_threshold) : '',
      allow_self_checkout: category.allow_self_checkout ?? false,
      self_checkout_loan_days: category.self_checkout_loan_days != null ? String(category.self_checkout_loan_days) : '',
    };
    setFormData(seeded);
    setBaseline(seeded);
    categoryErrors.clear();
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingCategory(null);
    setFormData(EMPTY_FORM);
    setBaseline(EMPTY_FORM);
  };
  const requestClose = useDiscardGuard({ isDirty, onClose: closeModal });

  const update = <K extends keyof CategoryFormData>(key: K, value: CategoryFormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (key in CATEGORY_FIELDS) categoryErrors.setError(key as CategoryField, null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Checked here rather than by the browser's required bubble, which
    // vanished after a few seconds and was tied to nothing a screen reader
    // could find again (forms review F-3).
    const problems: FieldErrors<CategoryField> = {};
    if (!formData.name.trim()) problems.name = 'Enter a name for the category.';
    const threshold = parseWhole(formData.low_stock_threshold, 0, 2_147_483_647);
    if (threshold === undefined) problems.low_stock_threshold = 'Enter a whole number of 0 or more, or leave it empty.';
    const loanDays = formData.allow_self_checkout ? parseWhole(formData.self_checkout_loan_days, 1, 365) : null;
    if (loanDays === undefined) {
      problems.self_checkout_loan_days = 'Enter a whole number of days from 1 to 365, or leave it empty.';
    }
    categoryErrors.setFormError(null);
    categoryErrors.setErrors(problems);
    // A new category is not created until every field is fixed; an edit saves
    // the rest and keeps a refused field's stored value (owner rule, 2026-11-05).
    if (!editingCategory && Object.keys(problems).length > 0) {
      categoryErrors.focusFirst(problems);
      return;
    }
    setIsSaving(true);
    try {
      // Create and edit want opposite things from a blank box. On create a blank
      // is omitted so `""` never reaches a Pydantic validator; on edit it goes
      // as an explicit null, because the backend dumps update payloads with
      // `exclude_unset` and an omitted key means "leave this alone" — the clear
      // was being lost behind a success toast (CLAUDE.md pitfall #1).
      const { text, num } = formCoercions(Boolean(editingCategory));
      const payload: InventoryCategoryCreate = {
        name: formData.name.trim(),
        description: text(formData.description),
        item_type: formData.item_type,
        requires_serial_number: formData.requires_serial_number,
        requires_maintenance: formData.requires_maintenance,
        requires_assignment: formData.requires_assignment,
        nfpa_tracking_enabled: formData.nfpa_tracking_enabled,
        low_stock_threshold: threshold ?? num(''),
        allow_self_checkout: formData.allow_self_checkout,
        // Only meaningful with self-checkout on; sent (as null when blank) on
        // edit so clearing the box actually removes the due date.
        self_checkout_loan_days: loanDays ?? num(''),
      };
      if (editingCategory) {
        const { refused } = await saveExceptRefused<CategoryField, unknown>({
          payload: { ...payload },
          refused: problems,
          send: (body) => inventoryService.updateCategory(editingCategory.id, body),
          place: (err) => placeApiError(CATEGORY_FIELDS, err),
        });
        const first = firstRefused(CATEGORY_ORDER, refused);
        if (first) {
          // The list refreshes behind the dialog, which stays open with the
          // refused field flagged; only that field still counts as unsaved.
          void loadCategories();
          categoryErrors.setErrors(refused);
          categoryErrors.setFormError(
            `Category saved, except ${CATEGORY_FIELDS[first].label.toLowerCase()}. Fix it and save again.`
          );
          categoryErrors.focusFirst(refused);
          const keep = Object.fromEntries(Object.keys(refused).map((k) => [k, baseline[k as keyof CategoryFormData]]));
          setBaseline({ ...formData, ...keep });
          return;
        }
        toast.success('Category updated');
      } else {
        await inventoryService.createCategory(payload);
        toast.success('Category created');
      }
      closeModal();
      void loadCategories();
    } catch (err: unknown) {
      categoryErrors.focusFirst(categoryErrors.setFromApiError(err, 'Failed to save category'));
    } finally {
      setIsSaving(false);
    }
  };

  const modalFooter = (
    <>
      <button
        type="submit"
        form="category-form"
        disabled={isSaving}
        className="btn-info btn-md inline-flex items-center gap-2 disabled:opacity-50"
      >
        {isSaving && <RefreshCw className="h-4 w-4 animate-spin" />}
        {editingCategory ? 'Update Category' : 'Create Category'}
      </button>
      <button
        type="button"
        onClick={requestClose}
        className="text-theme-text-secondary hover:text-theme-text-primary mr-2 inline-flex items-center px-4 py-2 text-sm font-medium sm:mr-3"
      >
        Cancel
      </button>
    </>
  );

  return (
    <div className="max-w-7xl space-y-6 py-6 sm:py-8">
      {/* Header */}
      <div className="split-row gap-4 sm:items-center">
        <div className="split-row-main">
          <h2 className="text-theme-text-primary text-2xl font-bold">Categories</h2>
          <p className="text-theme-text-secondary mt-1">
            Organize inventory items by type and configure tracking requirements.
          </p>
        </div>
        {canManage && (
          <button
            onClick={openCreateModal}
            className="split-row-aside btn-info btn-md flex items-center gap-2 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" /> Add Category
          </button>
        )}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <label htmlFor="filter-type" className="text-theme-text-secondary text-sm font-medium">
          Filter by type:
        </label>
        <select
          id="filter-type"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className={selectClass + ' max-w-xs'}
        >
          <option value="">All Types</option>
          {ITEM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : categories.length === 0 ? (
        <div className="card-secondary py-16 text-center">
          <Tag className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-muted mb-4">
            {filterType ? 'No categories match the selected type.' : 'No categories yet. Create one to get started.'}
          </p>
          {!filterType && canManage && (
            <button onClick={openCreateModal} className="btn-info btn-md inline-flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add Category
            </button>
          )}
        </div>
      ) : (
        <div className="card-grid gap-4">
          {categories.map((cat) => (
            <div key={cat.id} className="card-secondary flex flex-col p-5">
              <div className="mb-3 flex min-w-0 items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                  <Tag className="h-4 w-4 text-blue-500" />
                </div>
                <h3 className="text-theme-text-primary line-clamp-2 font-semibold">{cat.name}</h3>
              </div>
              {cat.duplicate_name && (
                <div className="mb-3">
                  <DuplicateCategoryNameBadge />
                </div>
              )}
              {/* Edit shares the type badge's row, not the title's: at its 44px
                  touch size beside the title it cut a 320px phone's category
                  names to half their length. */}
              <div className="mb-3 flex items-center justify-between gap-2">
                <span
                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                    ITEM_TYPE_COLORS[cat.item_type] ?? ITEM_TYPE_COLORS['other'] ?? ''
                  }`}
                >
                  {getItemTypeLabel(cat.item_type)}
                </span>
                {canManage && (
                  <button
                    onClick={() => openEditModal(cat)}
                    aria-label={`Edit ${cat.name}`}
                    className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone shrink-0 rounded-md p-1.5 transition-colors"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
              {cat.description && (
                <p className="text-theme-text-secondary mb-3 line-clamp-2 text-sm">{cat.description}</p>
              )}
              <div className="mb-3 flex flex-wrap gap-2">
                {cat.requires_serial_number && (
                  <span className="text-theme-text-muted bg-theme-surface-hover inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs">
                    <Hash className="h-3 w-3" /> Serial #
                  </span>
                )}
                {cat.requires_maintenance && (
                  <span className="text-theme-text-muted bg-theme-surface-hover inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs">
                    <Wrench className="h-3 w-3" /> Maintenance
                  </span>
                )}
                {cat.requires_assignment && (
                  <span className="text-theme-text-muted bg-theme-surface-hover inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs">
                    <Settings className="h-3 w-3" /> Assignment
                  </span>
                )}
                {cat.nfpa_tracking_enabled && (
                  <span className="text-theme-text-muted bg-theme-surface-hover inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs">
                    <Shield className="h-3 w-3" /> NFPA
                  </span>
                )}
                {cat.allow_self_checkout && (
                  <span className="text-theme-text-muted bg-theme-surface-hover inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs">
                    <Nfc className="h-3 w-3" /> Kiosk
                    {cat.self_checkout_loan_days ? ` · ${cat.self_checkout_loan_days}d` : ''}
                  </span>
                )}
              </div>
              {cat.low_stock_threshold != null && cat.low_stock_threshold > 0 && (
                <div className="border-theme-surface-border mt-auto flex items-center gap-1.5 border-t pt-2 text-xs text-amber-900 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  Low stock alert at {cat.low_stock_threshold} items
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={requestClose}
        title={editingCategory ? 'Edit Category' : 'Add Category'}
        footer={modalFooter}
        size="md"
      >
        <form id="category-form" onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
          {categoryErrors.formError && (
            <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
              {categoryErrors.formError}
            </p>
          )}
          <FormField
            id={CATEGORY_FIELDS.name.id}
            label="Name"
            required
            error={categoryErrors.errors.name}
            labelClassName={labelClass}
            maxLength={NAME_MAX}
            count={formData.name.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={formData.name}
                onChange={(e) => update('name', e.target.value)}
                className={inputClass}
                placeholder="e.g. Turnout Gear"
              />
            )}
          </FormField>
          <FormField
            id={CATEGORY_FIELDS.description.id}
            label="Description"
            error={categoryErrors.errors.description}
            labelClassName={labelClass}
            maxLength={DESCRIPTION_MAX}
            count={formData.description.length}
          >
            {(field) => (
              <textarea
                {...field}
                rows={2}
                value={formData.description}
                onChange={(e) => update('description', e.target.value)}
                className={inputClass}
                placeholder="Optional description for this category"
              />
            )}
          </FormField>
          <FormField
            id={CATEGORY_FIELDS.item_type.id}
            label="Item Type"
            error={categoryErrors.errors.item_type}
            labelClassName={labelClass}
          >
            {(field) => (
              <select
                {...field}
                value={formData.item_type}
                onChange={(e) => update('item_type', e.target.value)}
                className={selectClass}
              >
                {ITEM_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <div className="space-y-3">
            <p className="text-theme-text-secondary text-sm font-medium">Tracking Options</p>
            <ToggleSwitch
              id="cat-serial"
              label="Requires Serial Number"
              checked={formData.requires_serial_number}
              onChange={(v) => setFormData((prev) => ({ ...prev, requires_serial_number: v }))}
            />
            <ToggleSwitch
              id="cat-maint"
              label="Requires Maintenance"
              checked={formData.requires_maintenance}
              onChange={(v) => setFormData((prev) => ({ ...prev, requires_maintenance: v }))}
            />
            <ToggleSwitch
              id="cat-assign"
              label="Requires Assignment"
              checked={formData.requires_assignment}
              onChange={(v) => setFormData((prev) => ({ ...prev, requires_assignment: v }))}
            />
            <ToggleSwitch
              id="cat-nfpa"
              label="NFPA Tracking Enabled"
              checked={formData.nfpa_tracking_enabled}
              onChange={(v) => setFormData((prev) => ({ ...prev, nfpa_tracking_enabled: v }))}
            />
          </div>
          <div className="space-y-2">
            <ToggleSwitch
              id="cat-self-checkout"
              label="Allow self-checkout at the kiosk"
              checked={formData.allow_self_checkout}
              onChange={(v) => setFormData((prev) => ({ ...prev, allow_self_checkout: v }))}
            />
            {formData.allow_self_checkout && (
              <FormField
                id={CATEGORY_FIELDS.self_checkout_loan_days.id}
                label="Kiosk loan period (days)"
                error={categoryErrors.errors.self_checkout_loan_days}
                labelClassName={labelClass}
                hint="Items checked out at the kiosk are due back after this many days, and are flagged overdue after that. Leave empty for no due date."
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="365"
                    value={formData.self_checkout_loan_days}
                    onChange={(e) => update('self_checkout_loan_days', e.target.value)}
                    className={inputClass}
                    placeholder="e.g. 14"
                  />
                )}
              </FormField>
            )}
          </div>
          <FormField
            id={CATEGORY_FIELDS.low_stock_threshold.id}
            label="Low Stock Threshold"
            error={categoryErrors.errors.low_stock_threshold}
            labelClassName={labelClass}
            hint="Flag the category as low on stock when its total quantity drops to this number or lower. Leave empty to turn off."
          >
            {(field) => (
              <input
                {...field}
                type="number"
                inputMode="numeric"
                min="0"
                value={formData.low_stock_threshold}
                onChange={(e) => update('low_stock_threshold', e.target.value)}
                className={inputClass}
                placeholder="e.g. 5"
              />
            )}
          </FormField>
        </form>
      </Modal>
    </div>
  );
};

/* ---------- Sub-components ---------- */

interface ToggleSwitchProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ id, label, checked, onChange }) => (
  <label htmlFor={id} className="flex cursor-pointer items-center justify-between">
    <span className="text-theme-text-primary text-sm">{label}</span>
    <div className="relative">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <div className="bg-theme-surface-border h-5 w-9 rounded-full transition-colors peer-checked:bg-blue-500" />
      <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4 dark:bg-gray-200" />
    </div>
  </label>
);

export default InventoryCategoriesPage;
