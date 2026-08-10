import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft,
  Ruler,
  Plus,
  Pencil,
  RefreshCw,
  Eye,
  EyeOff,
  Package,
  DollarSign,
  Tag,
  AlertTriangle,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { ItemVariantGroup, ItemVariantGroupCreate, InventoryCategory, InventoryItem } from '../types';
import { STANDARD_SIZES } from '../types';
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
  name: '',
  description: '',
  category_id: '',
  base_price: '',
  base_replacement_cost: '',
  unit_of_measure: '',
};

const inputClass = 'form-input w-full';
const selectClass = 'form-input w-full';
const labelClass = 'form-label';

/**
 * Order sizes the way a quartermaster reads them.
 *
 * The matrix rows come out of a Set built by walking the item list, so without
 * this they follow whatever order the API returned — S, L, XL, M — which makes
 * the grid unreadable. Letter sizes sort by their position in the picker;
 * numeric sizes (boot 10.5, waist 34) sort numerically after them.
 */
const compareSizes = (a: string, b: string): number => {
  const order = (size: string): number => STANDARD_SIZES.findIndex((s) => s.value === size.toLowerCase());
  const [ia, ib] = [order(a), order(b)];
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  const [na, nb] = [Number.parseFloat(a), Number.parseFloat(b)];
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b);
};

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

    const sizeList = Array.from(sizes).sort(compareSizes);
    const colList = Array.from(columns).sort((a, b) => a.localeCompare(b));
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
      const key = colList.includes(cl) ? cl : (colList[0] ?? '');
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
          <div
            key={item.id}
            className="bg-theme-surface-secondary/50 border-theme-surface-border flex items-center justify-between rounded-lg border p-2.5"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Package className="text-theme-text-muted h-4 w-4 shrink-0" />
              <span className="text-theme-text-primary truncate text-sm">{getDisplayName(item)}</span>
              <VariantCapsules item={item} />
            </div>
            <span className="text-theme-text-muted ml-2 shrink-0 text-xs font-medium tabular-nums">
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
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="text-theme-text-muted border-theme-surface-border border-b p-2 text-left text-xs font-medium">
              Size
            </th>
            {hasColumns ? (
              colList.map((col) => (
                <th
                  key={col || '_none'}
                  className="text-theme-text-muted border-theme-surface-border border-b p-2 text-center text-xs font-medium"
                >
                  {col || 'Default'}
                </th>
              ))
            ) : (
              <th className="text-theme-text-muted border-theme-surface-border border-b p-2 text-center text-xs font-medium">
                On Hand
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sizeList.map((sz) => (
            <tr key={sz} className="border-theme-surface-border border-b last:border-b-0">
              <td className="text-theme-text-primary p-2 text-xs font-medium uppercase">{sz}</td>
              {colList.map((col) => {
                const cell = grid[sz]?.[col];
                const onHand = cell?.onHand ?? 0;
                const isLow = onHand === 0;
                return (
                  <td key={col || '_none'} className="p-2 text-center tabular-nums">
                    <span
                      className={`inline-flex min-w-[2rem] items-center justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${
                        isLow
                          ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                          : 'bg-green-500/10 text-green-700 dark:text-green-400'
                      }`}
                    >
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

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);
  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

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
    if (!formData.name.trim()) {
      toast.error('Group name is required');
      return;
    }
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
        type="submit"
        form="variant-group-form"
        disabled={isSaving}
        className="btn-info btn-md inline-flex items-center gap-2 disabled:opacity-50"
      >
        {isSaving && <RefreshCw className="h-4 w-4 animate-spin" />}
        {editingGroup ? 'Update Group' : 'Create Group'}
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
          <h1 className="text-theme-text-primary text-2xl font-bold">Variant Groups</h1>
          <p className="text-theme-text-secondary mt-1">Group pool item variants by size, style, and color.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-theme-text-secondary flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="border-theme-surface-border rounded"
            />
            Show inactive
          </label>
          {canManage && (
            <button onClick={openCreateModal} className="btn-info btn-md flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add Group
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="card-secondary py-16 text-center">
          <Ruler className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-muted mb-4">
            {showInactive ? 'No variant groups found.' : 'No active variant groups yet. Create one to get started.'}
          </p>
          {canManage && (
            <button onClick={openCreateModal} className="btn-info btn-md inline-flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add Group
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <div key={group.id} className={`card-secondary flex flex-col p-5 ${!group.active ? 'opacity-60' : ''}`}>
              <div className="mb-3 flex items-start justify-between">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/10">
                    <Ruler className="h-4 w-4 text-teal-500" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-theme-text-primary truncate font-semibold">{group.name}</h3>
                    {!group.active && <span className="text-theme-text-muted text-xs">Inactive</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => void openDetailModal(group)}
                    aria-label={`View ${group.name}`}
                    className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-md p-1.5 transition-colors"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  {canManage && (
                    <>
                      <button
                        onClick={() => openEditModal(group)}
                        aria-label={`Edit ${group.name}`}
                        className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-md p-1.5 transition-colors"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => void toggleActive(group)}
                        aria-label={group.active ? `Deactivate ${group.name}` : `Activate ${group.name}`}
                        className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-md p-1.5 transition-colors"
                      >
                        {group.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {getCategoryName(group.category_id) && (
                <span className="mb-3 inline-flex items-center gap-1 self-start rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-400">
                  <Tag className="h-3 w-3" />
                  {getCategoryName(group.category_id)}
                </span>
              )}

              {group.description && (
                <p className="text-theme-text-secondary mb-3 line-clamp-2 text-sm">{group.description}</p>
              )}

              <div className="text-theme-text-muted border-theme-surface-border mt-auto flex flex-wrap items-center gap-3 border-t pt-2 text-xs">
                {group.base_price != null && (
                  <span className="inline-flex items-center gap-1">
                    <DollarSign className="h-3.5 w-3.5" />${Number(group.base_price).toFixed(2)}
                  </span>
                )}
                {group.unit_of_measure && (
                  <span className="inline-flex items-center gap-1">
                    <Package className="h-3.5 w-3.5" />
                    {group.unit_of_measure}
                  </span>
                )}
                {group.items && (
                  <span className="inline-flex items-center gap-1">
                    <Ruler className="h-3.5 w-3.5" />
                    {group.items.length} variant{group.items.length !== 1 ? 's' : ''}
                  </span>
                )}
                {group.items &&
                  (() => {
                    const outOfStock = group.items.filter((i) => (i.quantity ?? 0) === 0).length;
                    return outOfStock > 0 ? (
                      <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                        <AlertTriangle className="h-3.5 w-3.5" />
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
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingGroup ? 'Edit Variant Group' : 'Add Variant Group'}
        footer={modalFooter}
        size="md"
      >
        <form id="variant-group-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="vg-name" className={labelClass}>
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="vg-name"
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className={inputClass}
              placeholder="e.g. Class A Dress Uniform"
            />
          </div>
          <div>
            <label htmlFor="vg-desc" className={labelClass}>
              Description
            </label>
            <textarea
              id="vg-desc"
              rows={2}
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              className={inputClass}
              placeholder="Optional description"
            />
          </div>
          <div>
            <label htmlFor="vg-category" className={labelClass}>
              Category
            </label>
            <select
              id="vg-category"
              value={formData.category_id}
              onChange={(e) => setFormData((prev) => ({ ...prev, category_id: e.target.value }))}
              className={selectClass}
            >
              <option value="">None</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="vg-price" className={labelClass}>
                Base Price
              </label>
              <input
                id="vg-price"
                type="number"
                min="0"
                step="0.01"
                value={formData.base_price}
                onChange={(e) => setFormData((prev) => ({ ...prev, base_price: e.target.value }))}
                className={inputClass}
                placeholder="0.00"
              />
            </div>
            <div>
              <label htmlFor="vg-replacement" className={labelClass}>
                Replacement Cost
              </label>
              <input
                id="vg-replacement"
                type="number"
                min="0"
                step="0.01"
                value={formData.base_replacement_cost}
                onChange={(e) => setFormData((prev) => ({ ...prev, base_replacement_cost: e.target.value }))}
                className={inputClass}
                placeholder="0.00"
              />
            </div>
          </div>
          <div>
            <label htmlFor="vg-uom" className={labelClass}>
              Unit of Measure
            </label>
            <input
              id="vg-uom"
              type="text"
              value={formData.unit_of_measure}
              onChange={(e) => setFormData((prev) => ({ ...prev, unit_of_measure: e.target.value }))}
              className={inputClass}
              placeholder="e.g. each, pair, set"
            />
          </div>
        </form>
      </Modal>

      {/* Detail View Modal */}
      <Modal
        isOpen={showDetail}
        onClose={() => {
          setShowDetail(false);
          setDetailGroup(null);
        }}
        title={detailGroup?.name ?? 'Variant Group Details'}
        size="md"
      >
        {detailGroup && (
          <div className="space-y-4">
            {detailGroup.description && <p className="text-theme-text-secondary text-sm">{detailGroup.description}</p>}

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                  detailGroup.active
                    ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border'
                }`}
              >
                {detailGroup.active ? 'Active' : 'Inactive'}
              </span>
              {getCategoryName(detailGroup.category_id) && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-400">
                  <Tag className="h-3 w-3" />
                  {getCategoryName(detailGroup.category_id)}
                </span>
              )}
            </div>

            {(detailGroup.base_price != null ||
              detailGroup.base_replacement_cost != null ||
              detailGroup.unit_of_measure) && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {detailGroup.base_price != null && (
                  <div className="bg-theme-surface-secondary/50 border-theme-surface-border rounded-lg border p-3">
                    <p className="text-theme-text-muted mb-0.5 text-xs">Base Price</p>
                    <p className="text-theme-text-primary text-sm font-medium">
                      ${Number(detailGroup.base_price).toFixed(2)}
                    </p>
                  </div>
                )}
                {detailGroup.base_replacement_cost != null && (
                  <div className="bg-theme-surface-secondary/50 border-theme-surface-border rounded-lg border p-3">
                    <p className="text-theme-text-muted mb-0.5 text-xs">Replacement Cost</p>
                    <p className="text-theme-text-primary text-sm font-medium">
                      ${Number(detailGroup.base_replacement_cost).toFixed(2)}
                    </p>
                  </div>
                )}
                {detailGroup.unit_of_measure && (
                  <div className="bg-theme-surface-secondary/50 border-theme-surface-border rounded-lg border p-3">
                    <p className="text-theme-text-muted mb-0.5 text-xs">Unit</p>
                    <p className="text-theme-text-primary text-sm font-medium">{detailGroup.unit_of_measure}</p>
                  </div>
                )}
              </div>
            )}

            <div>
              <h4 className="text-theme-text-primary mb-2 text-sm font-medium">
                Stock Matrix ({detailGroup.items?.length ?? 0} variant
                {(detailGroup.items?.length ?? 0) !== 1 ? 's' : ''})
              </h4>
              {detailGroup.items && detailGroup.items.length > 0 ? (
                <StockMatrix items={detailGroup.items} />
              ) : (
                <p className="text-theme-text-muted text-sm">
                  No variants in this group yet. Add inventory items and assign them to this group.
                </p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default VariantGroupsPage;
