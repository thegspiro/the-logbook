/**
 * Medical Categories Page
 *
 * Categories are what file a supply as medical — an item reaches the domain
 * through its category, not through a field of its own. There is no item-type
 * picker here for that reason: everything created on this page is medical.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { ArrowLeft, Pencil, Plus, RefreshCw, Tag } from 'lucide-react';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import type { InventoryCategory } from '../../../services/eventServices';
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

const MedicalCategoriesPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('inventory.manage_medical') || checkPermission('inventory.manage');

  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<InventoryCategory | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setCategories(await medicalSuppliesService.getCategories(true));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load medical categories'));
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
            Medical Categories
          </h1>
          <p className="text-theme-text-muted mt-1 text-sm">
            How EMS stock is grouped — airway, trauma, medications. Filing a supply under one of these is what makes it
            medical.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} className="btn-icon" aria-label="Refresh categories">
            <RefreshCw className="h-4 w-4" />
          </button>
          {canManage && (
            <button type="button" onClick={openCreate} className="btn-primary">
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
          title="No medical categories yet"
          description={
            canManage
              ? 'Create one — airway, trauma, medications, whatever matches how your stock is organized.'
              : 'No categories have been set up for medical supplies.'
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {categories.map((category) => (
            <li key={category.id} className="card flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-theme-text-primary font-medium">{category.name}</p>
                {category.description && <p className="text-theme-text-muted mt-1 text-sm">{category.description}</p>}
                {category.low_stock_threshold !== undefined && (
                  <p className="text-theme-text-muted mt-1 text-xs">Low below {category.low_stock_threshold}</p>
                )}
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => openEdit(category)}
                  className="btn-icon shrink-0"
                  aria-label={`Edit ${category.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit medical category' : 'New medical category'}
      >
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="modal-body space-y-4">
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

          <div className="border-theme-surface-border flex justify-end gap-2 border-t px-5 py-4">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? 'Saving…' : editing ? 'Save changes' : 'Create category'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default MedicalCategoriesPage;
