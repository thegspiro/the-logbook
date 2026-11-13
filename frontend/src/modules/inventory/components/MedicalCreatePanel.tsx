/**
 * MedicalCreatePanel
 *
 * The second step of "Create in Medical Supplies" from the checklist builder:
 * choose which medical category the new supply belongs to, then create and
 * link it in one request.
 *
 * The category is asked for rather than defaulted because it is what files
 * the row on the Medical Supplies page at all. An item with no category is
 * gear, and the gear-side create that the builder used to offer left every
 * rig's new consumables off the supply officer's list.
 */

import React, { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { medicalSuppliesService } from '@/services/medicalSuppliesService';
import type { InventoryCategory, InventoryItem } from '@/services/eventServices';
import { getErrorMessage } from '@/utils/errorHandling';
import { FIELD_ERROR_CLASS, FormField } from '@/components/ux/FormField';

interface MedicalCreatePanelProps {
  name: string;
  /** Pool rows are counted stock; an individual row is one physical device. */
  trackingType?: 'pool' | 'individual';
  onCreated: (item: InventoryItem, created: boolean) => void | Promise<void>;
  onCancel: () => void;
}

const MedicalCreatePanel: React.FC<MedicalCreatePanelProps> = ({
  name,
  trackingType = 'pool',
  onCreated,
  onCancel,
}) => {
  const [categories, setCategories] = useState<InventoryCategory[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  // A refusal the category cannot answer for (a 409 naming the gear item
  // with this name) stays in the panel rather than in a toast that vanished.
  const [panelError, setPanelError] = useState<string | null>(null);
  const selectId = useId();

  useEffect(() => {
    let cancelled = false;
    void medicalSuppliesService
      .getCategories(true)
      .then((list) => {
        if (cancelled) return;
        setCategories(list);
        // One category is not a choice, so do not make the officer make it.
        if (list.length === 1) setCategoryId(list[0]?.id ?? '');
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    if (submitting) return;
    // Named on the field rather than by a greyed-out button (forms review F-3).
    if (!categoryId) {
      setCategoryError('Choose the medical category this supply belongs to.');
      document.getElementById(selectId)?.focus();
      return;
    }
    setPanelError(null);
    setSubmitting(true);
    try {
      const { item, created } = await medicalSuppliesService.createItemIfAbsent({
        name,
        category_id: categoryId,
        tracking_type: trackingType,
        // Counted stock starts at nothing on hand; an individually tracked
        // row is the one physical asset it describes.
        quantity: trackingType === 'pool' ? 0 : 1,
      });
      await onCreated(item, created);
      toast.success(
        created
          ? `Added “${item.name}” to Medical Supplies`
          : `“${item.name}” was already in Medical Supplies — linked it`
      );
    } catch (err: unknown) {
      // The panel stays open so the officer can pick another category or
      // cancel; a 409 here names the clash with a gear item.
      setPanelError(getErrorMessage(err, 'Failed to create the medical supply'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card-secondary mt-2 space-y-2 p-3" role="group" aria-label="Create medical supply">
      <p className="text-theme-text-primary text-sm">Add “{name}” to Medical Supplies and link this item</p>

      {categories === null && !loadFailed && (
        <p role="status" className="text-theme-text-muted flex items-center gap-2 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading medical categories…
        </p>
      )}

      {loadFailed && (
        <p role="status" className="text-theme-text-muted text-xs">
          Couldn&rsquo;t load medical categories. Check your connection and try again.
        </p>
      )}

      {categories !== null && categories.length === 0 && (
        <p role="status" className="text-theme-text-muted text-xs">
          There are no medical categories yet. Add one on the Medical Supplies page first.
        </p>
      )}

      {panelError && (
        <p role="alert" className={`text-xs ${FIELD_ERROR_CLASS}`}>
          {panelError}
        </p>
      )}

      {categories !== null && categories.length > 0 && (
        <FormField id={selectId} label="Medical category" required error={categoryError}>
          {(field) => (
            <select
              {...field}
              className="form-input"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setCategoryError(null);
              }}
              disabled={submitting}
            >
              <option value="">Choose a category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting} className="btn-secondary touch:min-h-11 text-xs">
          Cancel
        </button>
        {/* Greyed out only when there is no category to choose at all; with
            one to choose, pressing it names what is missing instead. */}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!categories?.length || submitting}
          className="btn-primary flex items-center gap-1 text-xs"
        >
          {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
          Create &amp; link
        </button>
      </div>
    </div>
  );
};

export default MedicalCreatePanel;
