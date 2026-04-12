import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Ruler, Plus, Pencil, RefreshCw, Eye, EyeOff, Package, DollarSign, Tag,
  AlertTriangle,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { ItemVariantGroup, ItemVariantGroupCreate, InventoryCategory, InventoryItem } from '../types';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import { VariantCapsules } from '../components/VariantCapsules';
import { getDisplayName } from '../utils/variantHelpers';
import toast from 'react-hot-toast';

interface GroupFormData {
  name: string;
  description: string;
  category_id: string;
  base_price: string;
  base_replacement_cost: string;
  unit_of_measure: string;
}

const EMPTY_FORM: GroupFormData = {
  name: '', description: '', category_id: '',
  base_price: '', base_replacement_cost: '', unit_of_measure: '',
};

const inputClass = 'form-input w-full';
const selectClass = 'form-input w-full';
const labelClass = 'form-label';

/** Stock matrix — shows on-hand quantities by size × color (or style) */
const StockMatrix: React.FC<{ items: InventoryItem[] }> = ({ items }) => {
  const matrix = useMemo(() => {
    const sizes = new Set<string>();
    const columns = new Set<string>();

    for (const it of items) {
      const sz = it.standard_size || it.size || '';
      if (sz) sizes.add(sz);
      const col = it.color || it.style?.replace(/_/g, ' ') || '';
      if (col) columns.add(col);
    }

    if (sizes.size === 0) return null;

    const sizeList = Array.from(sizes);
    const colList = Array.from(columns);
    if (colList.length === 0) colList.push('');

    const grid: Record<string, Record<string, { onHand: number; total: number }>> = {};
    for (const sz of sizeList) {
      grid[sz] = {};
      for (const cl of colList) {
        grid[sz][cl] = { onHand: 0, total: 0 };
      }
    }

    for (const it of items) {
      const sz = it.standard_size || it.size || '';
      if (!sz) continue;
      const cl = it.color || it.style?.replace(/_/g, ' ') || '';
      const key = colList.includes(cl) ? cl : colList[0] ?? '';
      const cell = grid[sz]?.[key];
      if (cell) {
        const issued = it.quantity_issued ?? 0;
        const qty = it.quantity ?? 0;
        cell.onHand += qty;
        cell.total += qty + issued;
      }
    }

    return { sizeList, colList, grid };
  }, [items]);

  if (!matrix) {
    return (
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between p-2.5 rounded-lg bg-theme-surface-secondary/50 border border-theme-surface-border">
            <div className="flex items-center gap-2 min-w-0">
              <Package className="w-4 h-4 text-theme-text-muted shrink-0" />
              <span className="text-sm text-theme-text-primary truncate">{getDisplayName(item)}</span>
              <VariantCapsules item={item} />
            </div>
            <span className="text-xs font-medium text-theme-text-muted tabular-nums shrink-0 ml-2">
              {item.quantity ?? 0} on hand
            </span>
          </div>
        ))}
      </div>
    );
  }

  const { sizeList, colList, grid } = matrix;
  const hasColumns = colList.length > 1 || colList[0] !== '';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left p-2 text-xs font-medium text-theme-text-muted border-b border-theme-surface-border">Size</th>
            {hasColumns ? colList.map((col) => (
              <th key={col || '_none'} className="text-center p-2 text-xs font-medium text-theme-text-muted border-b border-theme-surface-border">
                {col || 'Default'}
              </th>
            )) : (
              <th className="text-center p-2 text-xs font-medium text-theme-text-muted border-b border-theme-surface-border">On Hand</th>
            )}
          </tr>
        </thead>
        <tbody>
          {sizeList.map((sz) => (
            <tr key={sz} className="border-b border-theme-surface-border last:border-b-0">
              <td className="p-2 font-medium text-theme-text-primary uppercase text-xs">{sz}</td>
              {colList.map((col) => {
                const cell = grid[sz]?.[col];
                const onHand = cell?.onHand ?? 0;
                const isLow = onHand === 0;
                return (
                  <td key={col || '_none'} className="text-center p-2 tabular-nums">
                    <span className={`inline-flex items-center justify-center min-w-[2rem] px-1.5 py-0.5 rounded text-xs font-semibold ${
                      isLow
                        ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                        : 'bg-green-500/10 text-green-700 dark:text-green-400'
                    }`}>
                      {onHand}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const VariantGroupsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('inventory.manage');
  const [groups, setGroups] = useState<ItemVariantGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ItemVariantGroup | null>(null);
  const [formData, setFormData] = useState<GroupFormData>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [detailGroup, setDetailGroup] = useState<ItemVariantGroup | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);

  const loadGroups = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await inventoryService.getVariantGroups(!showInactive);
      setGroups(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load variant groups'));
    } finally {
      setIsLoading(false);
    }
  }, [showInactive]);

  const loadCategories = useCallback(async () => {
    try {
      const data = await inventoryService.getCategories(undefined, true);
      setCategories(data);
    } catch {
      // Supplementary data; don't block the page
    }
  }, []);

  useEffect(() => { void loadGroups(); }, [loadGroups]);
  useEffect(() => { void loadCategories(); }, [loadCategories]);

  const openCreateModal = () => {
    setEditingGroup(null);
    setFormData(EMPTY_FORM);
    setShowModal(true);
  };

  const openEditModal = (group: ItemVariantGroup) => {
    setEditingGroup(group);
    setFormData({
      name: group.name,
      description: group.description ?? '',
      category_id: group.category_id ?? '',
      base_price: group.base_price != null ? String(group.base_price) : '',
      base_replacement_cost: group.base_replacement_cost != null ? String(group.base_replacement_cost) : '',
      unit_of_measure: group.unit_of_measure ?? '',
    });
    setShowModal(true);
  };

  const openDetailModal = async (group: ItemVariantGroup) => {
    try {
      const full = await inventoryService.getVariantGroup(group.id);
      setDetailGroup(full);
      setShowDetail(true);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load variant group details'));
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingGroup(null);
    setFormData(EMPTY_FORM);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) { toast.error('Group name is required'); return; }
    setIsSaving(true);
    try {
      const basePrice = parseFloat(formData.base_price);
      const replacementCost = parseFloat(formData.base_replacement_cost);
      const payload: ItemVariantGroupCreate = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        category_id: formData.category_id || undefined,
        base_price: isNaN(basePrice) ? undefined : basePrice,
        base_replacement_cost: isNaN(replacementCost) ? undefined : replacementCost,
        unit_of_measure: formData.unit_of_measure.trim() || undefined,
      };
      if (editingGroup) {
        await inventoryService.updateVariantGroup(editingGroup.id, payload);
        toast.success('Variant group updated');
      } else {
        await inventoryService.createVariantGroup(payload);
        toast.success('Variant group created');
      }
      closeModal();
      void loadGroups();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save variant group'));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleActive = async (group: ItemVariantGroup) => {
    try {
      await inventoryService.updateVariantGroup(group.id, { active: !group.active });
      toast.success(group.active ? 'Variant group deactivated' : 'Variant group activated');
      void loadGroups();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update variant group'));
    }
  };

  const getCategoryName = (categoryId?: string) => {
    if (!categoryId) return null;
    return categories.find((c) => c.id === categoryId)?.name ?? null;
  };

  const modalFooter = (
    <>
      <button
        type="submit" form="variant-group-form" disabled={isSaving}
        className="btn-info btn-md inline-flex items-center gap-2 disabled:opacity-50"
      >
        {isSaving && <RefreshCw className="w-4 h-4 animate-spin" />}
        {editingGroup ? 'Update Group' : 'Create Group'}
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
      <Link to="/inventory/admin" className="text-sm text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1">
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">Variant Groups</h1>
          <p className="text-theme-text-secondary mt-1">
            Group pool item variants by size, style, and color.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
            <input
              type="checkbox" checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-theme-surface-border"
            />
            Show inactive
          </label>
          {canManage && (
            <button onClick={openCreateModal} className="btn-info btn-md flex gap-2 items-center">
              <Plus className="w-4 h-4" /> Add Group
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <RefreshCw className="w-8 h-8 animate-spin text-theme-text-muted" />
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 card-secondary">
          <Ruler className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-muted mb-4">
            {showInactive ? 'No variant groups found.' : 'No active variant groups yet. Create one to get started.'}
          </p>
          {canManage && (
            <button onClick={openCreateModal} className="btn-info btn-md inline-flex gap-2 items-center">
              <Plus className="w-4 h-4" /> Add Group
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => (
            <div key={group.id} className={`card-secondary p-5 flex flex-col ${!group.active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0">
                    <Ruler className="w-4 h-4 text-teal-500" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-theme-text-primary truncate">{group.name}</h3>
                    {!group.active && (
                      <span className="text-xs text-theme-text-muted">Inactive</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => void openDetailModal(group)}
                    aria-label={`View ${group.name}`}
                    className="p-1.5 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  {canManage && (
                    <>
                      <button
                        onClick={() => openEditModal(group)}
                        aria-label={`Edit ${group.name}`}
                        className="p-1.5 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => void toggleActive(group)}
                        aria-label={group.active ? `Deactivate ${group.name}` : `Activate ${group.name}`}
                        className="p-1.5 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
                      >
                        {group.active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {getCategoryName(group.category_id) && (
                <span className="inline-flex self-start items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30 mb-3">
                  <Tag className="w-3 h-3" />
                  {getCategoryName(group.category_id)}
                </span>
              )}

              {group.description && (
                <p className="text-sm text-theme-text-secondary mb-3 line-clamp-2">{group.description}</p>
              )}

              <div className="flex flex-wrap items-center gap-3 text-xs text-theme-text-muted mt-auto pt-2 border-t border-theme-surface-border">
                {group.base_price != null && (
                  <span className="inline-flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5" />
                    ${Number(group.base_price).toFixed(2)}
                  </span>
                )}
                {group.unit_of_measure && (
                  <span className="inline-flex items-center gap-1">
                    <Package className="w-3.5 h-3.5" />
                    {group.unit_of_measure}
                  </span>
                )}
                {group.items && (
                  <span className="inline-flex items-center gap-1">
                    <Ruler className="w-3.5 h-3.5" />
                    {group.items.length} variant{group.items.length !== 1 ? 's' : ''}
                  </span>
                )}
                {group.items && (() => {
                  const outOfStock = group.items.filter(i => (i.quantity ?? 0) === 0).length;
                  return outOfStock > 0 ? (
                    <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {outOfStock} out of stock
                    </span>
                  ) : null;
                })()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal isOpen={showModal} onClose={closeModal}
        title={editingGroup ? 'Edit Variant Group' : 'Add Variant Group'} footer={modalFooter} size="md">
        <form id="variant-group-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="vg-name" className={labelClass}>Name <span className="text-red-500">*</span></label>
            <input id="vg-name" type="text" required value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className={inputClass} placeholder="e.g. Class A Dress Uniform" />
          </div>
          <div>
            <label htmlFor="vg-desc" className={labelClass}>Description</label>
            <textarea id="vg-desc" rows={2} value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              className={inputClass} placeholder="Optional description" />
          </div>
          <div>
            <label htmlFor="vg-category" className={labelClass}>Category</label>
            <select id="vg-category" value={formData.category_id}
              onChange={(e) => setFormData((prev) => ({ ...prev, category_id: e.target.value }))}
              className={selectClass}>
              <option value="">None</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="vg-price" className={labelClass}>Base Price</label>
              <input id="vg-price" type="number" min="0" step="0.01" value={formData.base_price}
                onChange={(e) => setFormData((prev) => ({ ...prev, base_price: e.target.value }))}
                className={inputClass} placeholder="0.00" />
            </div>
            <div>
              <label htmlFor="vg-replacement" className={labelClass}>Replacement Cost</label>
              <input id="vg-replacement" type="number" min="0" step="0.01" value={formData.base_replacement_cost}
                onChange={(e) => setFormData((prev) => ({ ...prev, base_replacement_cost: e.target.value }))}
                className={inputClass} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label htmlFor="vg-uom" className={labelClass}>Unit of Measure</label>
            <input id="vg-uom" type="text" value={formData.unit_of_measure}
              onChange={(e) => setFormData((prev) => ({ ...prev, unit_of_measure: e.target.value }))}
              className={inputClass} placeholder="e.g. each, pair, set" />
          </div>
        </form>
      </Modal>

      {/* Detail View Modal */}
      <Modal isOpen={showDetail} onClose={() => { setShowDetail(false); setDetailGroup(null); }}
        title={detailGroup?.name ?? 'Variant Group Details'} size="md">
        {detailGroup && (
          <div className="space-y-4">
            {detailGroup.description && (
              <p className="text-sm text-theme-text-secondary">{detailGroup.description}</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full border ${
                detailGroup.active
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30'
                  : 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border'
              }`}>
                {detailGroup.active ? 'Active' : 'Inactive'}
              </span>
              {getCategoryName(detailGroup.category_id) && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30">
                  <Tag className="w-3 h-3" />
                  {getCategoryName(detailGroup.category_id)}
                </span>
              )}
            </div>

            {(detailGroup.base_price != null || detailGroup.base_replacement_cost != null || detailGroup.unit_of_measure) && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {detailGroup.base_price != null && (
                  <div className="p-3 rounded-lg bg-theme-surface-secondary/50 border border-theme-surface-border">
                    <p className="text-xs text-theme-text-muted mb-0.5">Base Price</p>
                    <p className="text-sm font-medium text-theme-text-primary">${Number(detailGroup.base_price).toFixed(2)}</p>
                  </div>
                )}
                {detailGroup.base_replacement_cost != null && (
                  <div className="p-3 rounded-lg bg-theme-surface-secondary/50 border border-theme-surface-border">
                    <p className="text-xs text-theme-text-muted mb-0.5">Replacement Cost</p>
                    <p className="text-sm font-medium text-theme-text-primary">${Number(detailGroup.base_replacement_cost).toFixed(2)}</p>
                  </div>
                )}
                {detailGroup.unit_of_measure && (
                  <div className="p-3 rounded-lg bg-theme-surface-secondary/50 border border-theme-surface-border">
                    <p className="text-xs text-theme-text-muted mb-0.5">Unit</p>
                    <p className="text-sm font-medium text-theme-text-primary">{detailGroup.unit_of_measure}</p>
                  </div>
                )}
              </div>
            )}

            <div>
              <h4 className="text-sm font-medium text-theme-text-primary mb-2">
                Stock Matrix ({detailGroup.items?.length ?? 0} variant{(detailGroup.items?.length ?? 0) !== 1 ? 's' : ''})
              </h4>
              {detailGroup.items && detailGroup.items.length > 0 ? (
                <StockMatrix items={detailGroup.items} />
              ) : (
                <p className="text-sm text-theme-text-muted">No variants in this group yet. Add inventory items and assign them to this group.</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default VariantGroupsPage;
