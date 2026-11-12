import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Ruler, Plus, Pencil, RefreshCw, Eye, EyeOff, Package, DollarSign, Tag, AlertTriangle } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { ItemVariantGroup, ItemVariantGroupCreate, InventoryCategory, InventoryItem } from '../types';
import { STANDARD_SIZES, styleAttributesLabel } from '../types';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { VariantCapsules } from '../components/VariantCapsules';
import { getDisplayName } from '../utils/variantHelpers';
import toast from 'react-hot-toast';
import { formCoercions } from '../../../utils/formValues';
import { firstRefused, saveExceptRefused } from '../../../utils/saveExceptRefused';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { placeApiError } from '../../../hooks/useFieldErrors';

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

type GroupField = 'name' | 'description' | 'category_id' | 'base_price' | 'base_replacement_cost' | 'unit_of_measure';

// snake_case keys: schemas/inventory.py carries no alias generator, so a 422
// names the request body's own keys. Ordered as on screen.
const GROUP_FIELDS: FieldSpecs<GroupField> = {
  name: { id: 'vg-name', label: 'Name' },
  description: { id: 'vg-desc', label: 'Description' },
  category_id: { id: 'vg-category', label: 'Category' },
  base_price: { id: 'vg-price', label: 'Base Price' },
  base_replacement_cost: { id: 'vg-replacement', label: 'Replacement Cost' },
  unit_of_measure: { id: 'vg-uom', label: 'Unit of Measure' },
};
const GROUP_ORDER = Object.keys(GROUP_FIELDS) as GroupField[];

/** `ItemVariantGroupCreate` in schemas/inventory.py. */
const NAME_MAX = 255;
const DESCRIPTION_MAX = 2000;
const UNIT_MAX = 50;

/** A money amount of 0 or more, null for a blank box, `undefined` when the text is not one. */
function parseAmount(text: string): number | null | undefined {
  if (!text.trim()) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

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
      // The whole garment: two items in a group can share the primary
      // `style` ("polo") and differ by fit, which would otherwise collapse two
      // stock cells into one and double-count the on-hand number.
      const col = it.color || styleAttributesLabel(it.style_attributes, it.style);
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
      const cl = it.color || styleAttributesLabel(it.style_attributes, it.style);
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
                          : 'bg-green-500/10 text-green-800 dark:text-green-400'
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
  const groupErrors = useFieldErrors(GROUP_FIELDS);
  // What the dialog held when it opened (or last saved), so Escape, the X and
  // Cancel ask before throwing typed changes away (forms review F-6).
  const [baseline, setBaseline] = useState<GroupFormData>(EMPTY_FORM);
  const isDirty = showModal && JSON.stringify(formData) !== JSON.stringify(baseline);
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
    setBaseline(EMPTY_FORM);
    groupErrors.clear();
    setShowModal(true);
  };

  const openEditModal = (group: ItemVariantGroup) => {
    setEditingGroup(group);
    const seeded: GroupFormData = {
      name: group.name,
      description: group.description ?? '',
      category_id: group.category_id ?? '',
      base_price: group.base_price != null ? String(group.base_price) : '',
      base_replacement_cost: group.base_replacement_cost != null ? String(group.base_replacement_cost) : '',
      unit_of_measure: group.unit_of_measure ?? '',
    };
    setFormData(seeded);
    setBaseline(seeded);
    groupErrors.clear();
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
    setBaseline(EMPTY_FORM);
  };
  const requestClose = useDiscardGuard({ isDirty, onClose: closeModal });

  const update = (key: keyof GroupFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    groupErrors.setError(key, null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Checked here rather than by the browser's required bubble, which
    // vanished after a few seconds and was tied to nothing a screen reader
    // could find again (forms review F-3).
    const problems: FieldErrors<GroupField> = {};
    if (!formData.name.trim()) problems.name = 'Enter a name for the group.';
    const basePrice = parseAmount(formData.base_price);
    if (basePrice === undefined) problems.base_price = 'Enter an amount of 0 or more, or leave it empty.';
    const replacementCost = parseAmount(formData.base_replacement_cost);
    if (replacementCost === undefined) {
      problems.base_replacement_cost = 'Enter an amount of 0 or more, or leave it empty.';
    }
    groupErrors.setFormError(null);
    groupErrors.setErrors(problems);
    // A new group is not created until every field is fixed; an edit saves the
    // rest and keeps a refused field's stored value (owner rule, 2026-11-05).
    if (!editingGroup && Object.keys(problems).length > 0) {
      groupErrors.focusFirst(problems);
      return;
    }
    setIsSaving(true);
    try {
      // Create and edit want opposite things from a blank box. On create a blank
      // is omitted so `""` never reaches a Pydantic validator; on edit it goes
      // as an explicit null, because the backend dumps update payloads with
      // `exclude_unset` and an omitted key means "leave this alone" — the clear
      // was being lost behind a success toast (CLAUDE.md pitfall #1).
      const { text, pick, num } = formCoercions(Boolean(editingGroup));
      const payload: ItemVariantGroupCreate = {
        name: formData.name.trim(),
        description: text(formData.description),
        category_id: pick(formData.category_id),
        base_price: basePrice ?? num(''),
        base_replacement_cost: replacementCost ?? num(''),
        unit_of_measure: text(formData.unit_of_measure),
      };
      if (editingGroup) {
        const { refused } = await saveExceptRefused<GroupField, unknown>({
          payload: { ...payload },
          refused: problems,
          send: (body) => inventoryService.updateVariantGroup(editingGroup.id, body),
          place: (err) => placeApiError(GROUP_FIELDS, err),
        });
        const first = firstRefused(GROUP_ORDER, refused);
        if (first) {
          // The list refreshes behind the dialog, which stays open with the
          // refused field flagged; only that field still counts as unsaved.
          void loadGroups();
          groupErrors.setErrors(refused);
          groupErrors.setFormError(
            `Variant group saved, except ${GROUP_FIELDS[first].label.toLowerCase()}. Fix it and save again.`
          );
          groupErrors.focusFirst(refused);
          const keep = Object.fromEntries(Object.keys(refused).map((k) => [k, baseline[k as keyof GroupFormData]]));
          setBaseline({ ...formData, ...keep });
          return;
        }
        toast.success('Variant group updated');
      } else {
        await inventoryService.createVariantGroup(payload);
        toast.success('Variant group created');
      }
      closeModal();
      void loadGroups();
    } catch (err: unknown) {
      groupErrors.focusFirst(groupErrors.setFromApiError(err, 'Failed to save variant group'));
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
          <h2 className="text-theme-text-primary text-2xl font-bold">Variant Groups</h2>
          <p className="text-theme-text-secondary mt-1">Group pool item variants by size, style, and color.</p>
        </div>
        <div className="split-row-aside flex flex-wrap items-center gap-3 whitespace-nowrap">
          <label className="text-theme-text-secondary touch:min-h-11 flex cursor-pointer items-center gap-2 text-sm">
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
        <div className="card-grid gap-4">
          {groups.map((group) => (
            <div key={group.id} className={`card-secondary flex flex-col p-5 ${!group.active ? 'opacity-60' : ''}`}>
              <div className="mb-3 flex min-w-0 items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/10">
                  <Ruler className="h-4 w-4 text-teal-500" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-theme-text-primary line-clamp-2 font-semibold">{group.name}</h3>
                  {!group.active && <span className="text-theme-text-muted text-xs">Inactive</span>}
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

              {/* Actions share the footer with the stats, for the reason given on
                  the kits card: beside the title they clamped it to two words. */}
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
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => void openDetailModal(group)}
                    aria-label={`View ${group.name}`}
                    className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone rounded-md p-1.5 transition-colors"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  {canManage && (
                    <>
                      <button
                        onClick={() => openEditModal(group)}
                        aria-label={`Edit ${group.name}`}
                        className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone rounded-md p-1.5 transition-colors"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => void toggleActive(group)}
                        aria-label={group.active ? `Deactivate ${group.name}` : `Activate ${group.name}`}
                        className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone rounded-md p-1.5 transition-colors"
                      >
                        {group.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={requestClose}
        title={editingGroup ? 'Edit Variant Group' : 'Add Variant Group'}
        footer={modalFooter}
        size="md"
      >
        <form id="variant-group-form" onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
          {groupErrors.formError && (
            <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
              {groupErrors.formError}
            </p>
          )}
          <FormField
            id={GROUP_FIELDS.name.id}
            label="Name"
            required
            error={groupErrors.errors.name}
            labelClassName={labelClass}
            maxLength={NAME_MAX}
            count={formData.name.length}
            hint={
              editingGroup
                ? 'Renaming also renames every item in this group. Each item keeps its size, colour and style.'
                : undefined
            }
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={formData.name}
                onChange={(e) => update('name', e.target.value)}
                className={inputClass}
                placeholder="e.g. Class A Dress Uniform"
              />
            )}
          </FormField>
          <FormField
            id={GROUP_FIELDS.description.id}
            label="Description"
            error={groupErrors.errors.description}
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
                placeholder="Optional description"
              />
            )}
          </FormField>
          <FormField
            id={GROUP_FIELDS.category_id.id}
            label="Category"
            error={groupErrors.errors.category_id}
            labelClassName={labelClass}
          >
            {(field) => (
              <select
                {...field}
                value={formData.category_id}
                onChange={(e) => update('category_id', e.target.value)}
                className={selectClass}
              >
                <option value="">None</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id={GROUP_FIELDS.base_price.id}
              label="Base Price"
              error={groupErrors.errors.base_price}
              labelClassName={labelClass}
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={formData.base_price}
                  onChange={(e) => update('base_price', e.target.value)}
                  className={inputClass}
                  placeholder="0.00"
                />
              )}
            </FormField>
            <FormField
              id={GROUP_FIELDS.base_replacement_cost.id}
              label="Replacement Cost"
              error={groupErrors.errors.base_replacement_cost}
              labelClassName={labelClass}
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={formData.base_replacement_cost}
                  onChange={(e) => update('base_replacement_cost', e.target.value)}
                  className={inputClass}
                  placeholder="0.00"
                />
              )}
            </FormField>
          </div>
          <FormField
            id={GROUP_FIELDS.unit_of_measure.id}
            label="Unit of Measure"
            error={groupErrors.errors.unit_of_measure}
            labelClassName={labelClass}
            maxLength={UNIT_MAX}
            count={formData.unit_of_measure.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                value={formData.unit_of_measure}
                onChange={(e) => update('unit_of_measure', e.target.value)}
                className={inputClass}
                placeholder="e.g. each, pair, set"
              />
            )}
          </FormField>
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
                    ? 'border-green-500/30 bg-green-500/10 text-green-800 dark:text-green-400'
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
                // Names the actual control: the item form's Variant Group
                // picker (W40-7). Generating variants makes a group of its own.
                <p className="text-theme-text-muted text-sm">
                  No variants in this group yet. Add an item to it by choosing this group under Variant Group when
                  adding or editing the item on All Items.
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
