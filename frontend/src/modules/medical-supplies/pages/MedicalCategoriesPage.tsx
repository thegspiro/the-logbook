/**
 * Medical Supply Categories Page
 *
 * Categories are what file a supply as medical — an item reaches the domain
 * through its category, not through a field of its own. There is no item-type
 * picker here for that reason: everything created on this page is medical.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { ArrowLeft, ChevronDown, ChevronRight, Pencil, Plus, RefreshCw, Tag, Trash2 } from 'lucide-react';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import type { InventoryCategory, InventoryItem } from '../../../services/eventServices';
import { formatNumber } from '../../../utils/dateFormatting';
import { onHandQuantity } from '../../inventory/utils/onHand';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull, numberOrNull } from '../../../utils/formValues';
import { Modal } from '../../../components/Modal';
import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonCard } from '../../../components/ux/Skeleton';

interface FormState {
  name: string;
  description: string;
  low_stock_threshold: string;
}

const EMPTY_FORM: FormState = { name: '', description: '', low_stock_threshold: '' };

// One page of the list API. A category holding more than this is told so and
// pointed at Medical Supplies, which pages through all of them.
const CATEGORY_ITEMS_LIMIT = 100;

interface CategorySupplies {
  items: InventoryItem[];
  total: number;
}

interface CategorySupplyListProps {
  categoryId: string;
  categoryName: string;
}

/**
 * The supplies filed under one category, fetched when the card is opened.
 *
 * Fetched on demand rather than with the categories: a department with thirty
 * categories should not pay for thirty item lists to read the category names.
 */
const CategorySupplyList: React.FC<CategorySupplyListProps> = ({ categoryId, categoryName }) => {
  const [state, setState] = useState<CategorySupplies | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    medicalSuppliesService
      .getItems({ category_id: categoryId, sort_by: 'name', sort_order: 'asc', limit: CATEGORY_ITEMS_LIMIT })
      .then((response) => {
        if (!cancelled) setState({ items: response.items, total: response.total });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load supplies'));
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  if (error) {
    return (
      <p role="alert" className="alert-danger mt-3 text-sm">
        {error}
      </p>
    );
  }
  if (!state) {
    return <p className="text-theme-text-muted mt-3 text-sm">Loading supplies…</p>;
  }
  if (state.items.length === 0) {
    return <p className="text-theme-text-muted mt-3 text-sm">No supplies in this category yet.</p>;
  }
  return (
    <div className="mt-3">
      <ul className="divide-theme-surface-border divide-y text-sm" aria-label={`Supplies in ${categoryName}`}>
        {state.items.map((item) => (
          <li key={item.id} className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="text-theme-text-primary min-w-0 truncate">{item.name}</span>
            <span className="text-theme-text-muted shrink-0 tabular-nums">
              {formatNumber(onHandQuantity(item))} on hand
            </span>
          </li>
        ))}
      </ul>
      {state.total > state.items.length && (
        <p className="text-theme-text-muted mt-2 text-xs">
          Showing {formatNumber(state.items.length)} of {formatNumber(state.total)}.{' '}
          <Link to="/medical-supplies" className="underline">
            See them all under Medical Supplies
          </Link>
          .
        </p>
      )}
    </div>
  );
};

const MedicalCategoriesPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('inventory.manage_medical') || checkPermission('inventory.manage');

  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<InventoryCategory | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  const [deleting, setDeleting] = useState<InventoryCategory | null>(null);
  const [deleteItemCount, setDeleteItemCount] = useState<number | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const toggleExpanded = (categoryId: string) =>
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  // The dialog opens before the supply count arrives; this is what lets a late
  // answer for a category the user has since moved on from be ignored.
  const deletingIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setCategories(await medicalSuppliesService.getCategories(true));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load medical supply categories'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (category: InventoryCategory) => {
    setEditing(category);
    setForm({
      name: category.name,
      description: category.description ?? '',
      low_stock_threshold: category.low_stock_threshold !== undefined ? String(category.low_stock_threshold) : '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Give the category a name');
      return;
    }

    setIsSaving(true);
    try {
      if (editing) {
        // Update path: a cleared box travels as null so it is actually cleared.
        await medicalSuppliesService.updateCategory(editing.id, {
          name: form.name.trim(),
          description: blankToNull(form.description),
          low_stock_threshold: numberOrNull(form.low_stock_threshold),
        });
        toast.success('Category updated');
      } else {
        // Create path: blanks are omitted rather than sent as empty strings.
        // item_type is not sent — the server files this as medical.
        await medicalSuppliesService.createCategory({
          name: form.name.trim(),
          item_type: 'medical',
          description: form.description.trim() || undefined,
          low_stock_threshold: form.low_stock_threshold === '' ? undefined : Number(form.low_stock_threshold),
        });
        toast.success('Category created');
      }
      setShowModal(false);
      void load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the category'));
    } finally {
      setIsSaving(false);
    }
  };

  const loadItemCount = async (category: InventoryCategory) => {
    try {
      // Retired supplies count: they keep their category, and the server moves
      // them with the rest, so the dialog has to ask about them too.
      const page = await medicalSuppliesService.getItems({
        category_id: category.id,
        active_only: false,
        limit: 1,
      });
      if (deletingIdRef.current === category.id) setDeleteItemCount(page.total);
    } catch (err: unknown) {
      if (deletingIdRef.current !== category.id) return;
      deletingIdRef.current = null;
      setDeleting(null);
      toast.error(getErrorMessage(err, 'Could not check whether this category is in use'));
    }
  };

  const openDelete = (category: InventoryCategory) => {
    deletingIdRef.current = category.id;
    setDeleting(category);
    setDeleteItemCount(null);
    setMoveTarget('');
    void loadItemCount(category);
  };

  const closeDelete = () => {
    deletingIdRef.current = null;
    setDeleting(null);
  };

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleting || deleteItemCount === null) return;
    if (deleteItemCount > 0 && !moveTarget) {
      toast.error('Choose a category to move the supplies to');
      return;
    }

    setIsDeleting(true);
    try {
      const result = await medicalSuppliesService.deleteCategory(
        deleting.id,
        deleteItemCount > 0 ? moveTarget : undefined
      );
      toast.success(
        result.items_moved > 0
          ? `Deleted "${result.category_name}" and moved ${result.items_moved} ${
              result.items_moved === 1 ? 'supply' : 'supplies'
            } to "${result.moved_to_name ?? ''}"`
          : `Deleted "${result.category_name}"`
      );
      closeDelete();
      void load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete the category'));
      // The count can have changed since the dialog opened (a supply filed
      // here meanwhile); ask again so the picker matches what the server sees.
      void loadItemCount(deleting);
    } finally {
      setIsDeleting(false);
    }
  };

  const moveTargets = deleting ? categories.filter((category) => category.id !== deleting.id) : [];
  const mustMove = deleteItemCount !== null && deleteItemCount > 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link
        to="/medical-supplies"
        className="text-theme-text-muted hover:text-theme-text-primary mb-3 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Medical Supplies
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-semibold">
            <Tag className="h-6 w-6" />
            Medical Supply Categories
          </h1>
          <p className="text-theme-text-muted mt-1 text-sm">
            Group EMS stock by type, such as airway, trauma or medications. Only supplies in these categories appear
            under Medical Supplies.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} className="btn-icon" aria-label="Refresh categories">
            <RefreshCw className="h-4 w-4" />
          </button>
          {canManage && (
            <button type="button" onClick={openCreate} className="btn-primary inline-flex items-center gap-2">
              <Plus className="h-4 w-4" />
              New category
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <SkeletonCard />
      ) : categories.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No medical supply categories yet"
          description={
            canManage
              ? 'Add categories that match how your stock is organized, such as airway, trauma or medications.'
              : 'No categories have been set up for medical supplies.'
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {categories.map((category) => (
            <li key={category.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-theme-text-primary font-medium">{category.name}</p>
                  {category.description && <p className="text-theme-text-muted mt-1 text-sm">{category.description}</p>}
                  {category.low_stock_threshold !== undefined && (
                    <p className="text-theme-text-muted mt-1 text-xs">
                      Low stock at {category.low_stock_threshold} or below
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(category)}
                      className="btn-icon"
                      aria-label={`Edit ${category.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openDelete(category)}
                      className="btn-icon"
                      aria-label={`Delete ${category.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => toggleExpanded(category.id)}
                className="touch-target-phone text-theme-text-secondary hover:text-theme-text-primary mt-2 inline-flex items-center gap-1 text-sm"
                aria-expanded={expandedIds.has(category.id)}
                aria-controls={`category-supplies-${category.id}`}
              >
                {expandedIds.has(category.id) ? (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                )}
                {expandedIds.has(category.id) ? 'Hide supplies' : 'Show supplies'}
              </button>
              {expandedIds.has(category.id) && (
                <div id={`category-supplies-${category.id}`}>
                  <CategorySupplyList categoryId={category.id} categoryName={category.name} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit medical supply category' : 'New medical supply category'}
        onSubmit={(e) => void handleSubmit(e)}
        footer={
          <>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? 'Saving…' : editing ? 'Save changes' : 'Create category'}
            </button>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="mc-name" className="form-label">
              Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="mc-name"
              className="form-input w-full"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Airway"
              required
            />
          </div>

          <div>
            <label htmlFor="mc-description" className="form-label">
              Description
            </label>
            <textarea
              id="mc-description"
              className="form-input w-full"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div>
            <label htmlFor="mc-threshold" className="form-label">
              Low stock threshold
            </label>
            <input
              id="mc-threshold"
              type="number"
              min="0"
              className="form-input w-full"
              value={form.low_stock_threshold}
              onChange={(e) => setForm((f) => ({ ...f, low_stock_threshold: e.target.value }))}
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={deleting !== null}
        onClose={closeDelete}
        title="Delete category"
        onSubmit={(e) => void handleDelete(e)}
        footer={
          <>
            <button
              type="submit"
              className="mobile-touch-target rounded-md bg-red-800 px-4 py-2 text-sm font-medium text-white hover:bg-red-900 disabled:opacity-50"
              disabled={
                isDeleting || deleteItemCount === null || (mustMove && (moveTarget === '' || moveTargets.length === 0))
              }
            >
              {isDeleting ? 'Deleting…' : 'Delete category'}
            </button>
            <button
              type="button"
              onClick={closeDelete}
              className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-theme-text-primary text-sm">
            Delete <strong>{deleting?.name}</strong>? This cannot be undone.
          </p>

          {deleteItemCount === null && <p className="text-theme-text-muted text-sm">Checking for supplies…</p>}

          {deleteItemCount === 0 && <p className="text-theme-text-muted text-sm">No supplies use this category.</p>}

          {mustMove && (
            <>
              <p className="text-theme-text-muted text-sm">
                {deleteItemCount} {deleteItemCount === 1 ? 'supply uses' : 'supplies use'} this category, retired ones
                included. They need a category to move to, or they would drop out of Medical Supplies. Their low stock
                threshold will follow the new category.
              </p>
              {moveTargets.length === 0 ? (
                <p role="alert" className="alert-warning text-sm">
                  There is no other category to move them to. Create one first, then delete this one.
                </p>
              ) : (
                <div>
                  <label htmlFor="mc-move-target" className="form-label">
                    Move supplies to <span aria-hidden="true">*</span>
                  </label>
                  <select
                    id="mc-move-target"
                    className="form-input w-full"
                    value={moveTarget}
                    onChange={(e) => setMoveTarget(e.target.value)}
                    required
                  >
                    <option value="">Choose a category…</option>
                    {moveTargets.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default MedicalCategoriesPage;
