/**
 * Inventory Categories Page
 *
 * Manages inventory categories: viewing, creating, and editing.
 * Categories classify inventory items by type (uniform, PPE, tool, etc.)
 * and configure tracking requirements (serial numbers, maintenance, NFPA).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Tag, Plus, Pencil, RefreshCw, Settings, Shield, Wrench, Hash, AlertTriangle } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { InventoryCategory, InventoryCategoryCreate } from '../types';
import { ITEM_TYPES } from '../types';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';

const ITEM_TYPE_COLORS: Record<string, string> = {
  uniform: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
  ppe: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30',
  tool: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  equipment: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30',
  vehicle: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  electronics: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/30',
  consumable: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30',
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
};

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
    setShowModal(true);
  };

  const openEditModal = (category: InventoryCategory) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      description: category.description ?? '',
      item_type: category.item_type,
      requires_serial_number: category.requires_serial_number,
      requires_maintenance: category.requires_maintenance,
      requires_assignment: category.requires_assignment,
      nfpa_tracking_enabled: category.nfpa_tracking_enabled,
      low_stock_threshold: category.low_stock_threshold != null ? String(category.low_stock_threshold) : '',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingCategory(null);
    setFormData(EMPTY_FORM);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Category name is required');
      return;
    }
    setIsSaving(true);
    try {
      const threshold = parseInt(formData.low_stock_threshold, 10);
      const payload: InventoryCategoryCreate = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        item_type: formData.item_type,
        requires_serial_number: formData.requires_serial_number,
        requires_maintenance: formData.requires_maintenance,
        requires_assignment: formData.requires_assignment,
        nfpa_tracking_enabled: formData.nfpa_tracking_enabled,
        low_stock_threshold: isNaN(threshold) ? undefined : threshold,
      };
      if (editingCategory) {
        await inventoryService.updateCategory(editingCategory.id, payload);
        toast.success('Category updated');
      } else {
        await inventoryService.createCategory(payload);
        toast.success('Category created');
      }
      closeModal();
      void loadCategories();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save category'));
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
        onClick={closeModal}
        className="text-theme-text-secondary hover:text-theme-text-primary mr-2 inline-flex items-center px-4 py-2 text-sm font-medium sm:mr-3"
      >
        Cancel
      </button>
    </>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <Link
        to="/inventory/admin"
        className="text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Categories</h1>
          <p className="text-theme-text-secondary mt-1">
            Organize inventory items by type and configure tracking requirements.
          </p>
        </div>
        {canManage && (
          <button onClick={openCreateModal} className="btn-info btn-md flex items-center gap-2">
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <div key={cat.id} className="card-secondary flex flex-col p-5">
              <div className="mb-3 flex items-start justify-between">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                    <Tag className="h-4 w-4 text-blue-500" />
                  </div>
                  <h3 className="text-theme-text-primary truncate font-semibold">{cat.name}</h3>
                </div>
                {canManage && (
                  <button
                    onClick={() => openEditModal(cat)}
                    aria-label={`Edit ${cat.name}`}
                    className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover shrink-0 rounded-md p-1.5 transition-colors"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
              <span
                className={`mb-3 inline-flex self-start rounded-full border px-2.5 py-1 text-xs font-medium ${
                  ITEM_TYPE_COLORS[cat.item_type] ?? ITEM_TYPE_COLORS['other'] ?? ''
                }`}
              >
                {getItemTypeLabel(cat.item_type)}
              </span>
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
              </div>
              {cat.low_stock_threshold != null && cat.low_stock_threshold > 0 && (
                <div className="border-theme-surface-border mt-auto flex items-center gap-1.5 border-t pt-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
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
        onClose={closeModal}
        title={editingCategory ? 'Edit Category' : 'Add Category'}
        footer={modalFooter}
        size="md"
      >
        <form id="category-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="cat-name" className={labelClass}>
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="cat-name"
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className={inputClass}
              placeholder="e.g. Turnout Gear"
            />
          </div>
          <div>
            <label htmlFor="cat-desc" className={labelClass}>
              Description
            </label>
            <textarea
              id="cat-desc"
              rows={2}
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              className={inputClass}
              placeholder="Optional description for this category"
            />
          </div>
          <div>
            <label htmlFor="cat-type" className={labelClass}>
              Item Type
            </label>
            <select
              id="cat-type"
              value={formData.item_type}
              onChange={(e) => setFormData((prev) => ({ ...prev, item_type: e.target.value }))}
              className={selectClass}
            >
              {ITEM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
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
          <div>
            <label htmlFor="cat-threshold" className={labelClass}>
              Low Stock Threshold
            </label>
            <input
              id="cat-threshold"
              type="number"
              min="0"
              value={formData.low_stock_threshold}
              onChange={(e) => setFormData((prev) => ({ ...prev, low_stock_threshold: e.target.value }))}
              className={inputClass}
              placeholder="e.g. 5"
            />
            <p className="text-theme-text-muted mt-1 text-xs">
              Receive alerts when item count falls below this number. Leave empty to disable.
            </p>
          </div>
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
