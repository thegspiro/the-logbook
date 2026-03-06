/**
 * Inventory Categories Page
 *
 * Manages inventory categories: viewing, creating, and editing.
 * Categories classify inventory items by type (uniform, PPE, tool, etc.)
 * and configure tracking requirements (serial numbers, maintenance, NFPA).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Tag, Plus, Pencil, RefreshCw, Settings, Shield, Wrench, Hash, AlertTriangle } from 'lucide-react';
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
  other: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/30',
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
  name: '', description: '', item_type: 'equipment',
  requires_serial_number: false, requires_maintenance: false,
  requires_assignment: false, nfpa_tracking_enabled: false, low_stock_threshold: '',
};

const inputClass =
  'form-input w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const selectClass =
  'form-input w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';

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

  useEffect(() => { void loadCategories(); }, [loadCategories]);

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

  const closeModal = () => { setShowModal(false); setEditingCategory(null); setFormData(EMPTY_FORM); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) { toast.error('Category name is required'); return; }
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
        type="submit" form="category-form" disabled={isSaving}
        className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {isSaving && <RefreshCw className="w-4 h-4 animate-spin" />}
        {editingCategory ? 'Update Category' : 'Create Category'}
      </button>
      <button
        type="button" onClick={closeModal}
        className="mr-2 sm:mr-3 inline-flex items-center px-4 py-2 text-sm font-medium text-theme-text-secondary hover:text-theme-text-primary"
      >
        Cancel
      </button>
    </>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-theme-text-primary">Categories</h1>
          <p className="text-theme-text-secondary mt-1">
            Organize inventory items by type and configure tracking requirements.
          </p>
        </div>
        {canManage && (
          <button onClick={openCreateModal} className="btn-primary flex gap-2 items-center py-2.5">
            <Plus className="w-4 h-4" /> Add Category
          </button>
        )}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <label htmlFor="filter-type" className="text-sm font-medium text-theme-text-secondary">
          Filter by type:
        </label>
        <select id="filter-type" value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className={selectClass + ' max-w-xs'}>
          <option value="">All Types</option>
          {ITEM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-8 h-8 animate-spin text-theme-text-muted" />
        </div>
      ) : categories.length === 0 ? (
        <div className="text-center py-16 bg-theme-surface border border-theme-surface-border rounded-xl">
          <Tag className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-muted mb-4">
            {filterType ? 'No categories match the selected type.' : 'No categories yet. Create one to get started.'}
          </p>
          {!filterType && canManage && (
            <button onClick={openCreateModal} className="btn-primary inline-flex gap-2 items-center">
              <Plus className="w-4 h-4" /> Add Category
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((cat) => (
            <div key={cat.id} className="bg-theme-surface border border-theme-surface-border rounded-xl p-5 flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                    <Tag className="w-4 h-4 text-blue-500" />
                  </div>
                  <h3 className="font-semibold text-theme-text-primary truncate">{cat.name}</h3>
                </div>
                {canManage && (
                  <button onClick={() => openEditModal(cat)} aria-label={`Edit ${cat.name}`}
                    className="p-1.5 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors shrink-0">
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
              </div>
              <span className={`inline-flex self-start text-xs font-medium px-2.5 py-1 rounded-full border mb-3 ${
                ITEM_TYPE_COLORS[cat.item_type] ?? ITEM_TYPE_COLORS['other'] ?? ''
              }`}>
                {getItemTypeLabel(cat.item_type)}
              </span>
              {cat.description && (
                <p className="text-sm text-theme-text-secondary mb-3 line-clamp-2">{cat.description}</p>
              )}
              <div className="flex flex-wrap gap-2 mb-3">
                {cat.requires_serial_number && (
                  <span className="inline-flex items-center gap-1 text-xs text-theme-text-muted bg-theme-surface-hover px-2 py-1 rounded-md">
                    <Hash className="w-3 h-3" /> Serial #
                  </span>
                )}
                {cat.requires_maintenance && (
                  <span className="inline-flex items-center gap-1 text-xs text-theme-text-muted bg-theme-surface-hover px-2 py-1 rounded-md">
                    <Wrench className="w-3 h-3" /> Maintenance
                  </span>
                )}
                {cat.requires_assignment && (
                  <span className="inline-flex items-center gap-1 text-xs text-theme-text-muted bg-theme-surface-hover px-2 py-1 rounded-md">
                    <Settings className="w-3 h-3" /> Assignment
                  </span>
                )}
                {cat.nfpa_tracking_enabled && (
                  <span className="inline-flex items-center gap-1 text-xs text-theme-text-muted bg-theme-surface-hover px-2 py-1 rounded-md">
                    <Shield className="w-3 h-3" /> NFPA
                  </span>
                )}
              </div>
              {cat.low_stock_threshold != null && cat.low_stock_threshold > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mt-auto pt-2 border-t border-theme-surface-border">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Low stock alert at {cat.low_stock_threshold} items
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={closeModal}
        title={editingCategory ? 'Edit Category' : 'Add Category'} footer={modalFooter} size="md">
        <form id="category-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="cat-name" className={labelClass}>Name <span className="text-red-500">*</span></label>
            <input id="cat-name" type="text" required value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className={inputClass} placeholder="e.g. Turnout Gear" />
          </div>
          <div>
            <label htmlFor="cat-desc" className={labelClass}>Description</label>
            <textarea id="cat-desc" rows={2} value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              className={inputClass} placeholder="Optional description for this category" />
          </div>
          <div>
            <label htmlFor="cat-type" className={labelClass}>Item Type</label>
            <select id="cat-type" value={formData.item_type}
              onChange={(e) => setFormData((prev) => ({ ...prev, item_type: e.target.value }))}
              className={selectClass}>
              {ITEM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium text-theme-text-secondary">Tracking Options</p>
            <ToggleSwitch id="cat-serial" label="Requires Serial Number"
              checked={formData.requires_serial_number}
              onChange={(v) => setFormData((prev) => ({ ...prev, requires_serial_number: v }))} />
            <ToggleSwitch id="cat-maint" label="Requires Maintenance"
              checked={formData.requires_maintenance}
              onChange={(v) => setFormData((prev) => ({ ...prev, requires_maintenance: v }))} />
            <ToggleSwitch id="cat-assign" label="Requires Assignment"
              checked={formData.requires_assignment}
              onChange={(v) => setFormData((prev) => ({ ...prev, requires_assignment: v }))} />
            <ToggleSwitch id="cat-nfpa" label="NFPA Tracking Enabled"
              checked={formData.nfpa_tracking_enabled}
              onChange={(v) => setFormData((prev) => ({ ...prev, nfpa_tracking_enabled: v }))} />
          </div>
          <div>
            <label htmlFor="cat-threshold" className={labelClass}>Low Stock Threshold</label>
            <input id="cat-threshold" type="number" min="0" value={formData.low_stock_threshold}
              onChange={(e) => setFormData((prev) => ({ ...prev, low_stock_threshold: e.target.value }))}
              className={inputClass} placeholder="e.g. 5" />
            <p className="text-xs text-theme-text-muted mt-1">
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
  <label htmlFor={id} className="flex items-center justify-between cursor-pointer">
    <span className="text-sm text-theme-text-primary">{label}</span>
    <div className="relative">
      <input id={id} type="checkbox" checked={checked}
        onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <div className="w-9 h-5 rounded-full bg-theme-surface-border peer-checked:bg-blue-500 transition-colors" />
      <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
    </div>
  </label>
);

export default InventoryCategoriesPage;
