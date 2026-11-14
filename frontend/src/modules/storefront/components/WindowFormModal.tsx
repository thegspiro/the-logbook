/**
 * Order Window Form Modal
 *
 * Create/edit an order period: when it opens and closes, whether the scheduler
 * flips it automatically, what it offers, and what members are told.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatForDateTimeInput, localToUTC } from '../../../utils/dateFormatting';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { formCoercions } from '../../../utils/formValues';
import { storefrontService, type WindowOfferingInput } from '../services/api';
import { toDateInputValue } from '../utils/formatting';
import type { StoreOrderWindow, StoreProduct } from '../types';

interface WindowFormModalProps {
  isOpen: boolean;
  window: StoreOrderWindow | null;
  products: StoreProduct[];
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  name: string;
  description: string;
  opensAt: string;
  closesAt: string;
  autoOpen: boolean;
  autoClose: boolean;
  expectedDeliveryDate: string;
  pickupInstructions: string;
  includeAllProducts: boolean;
  notifyOnOpen: boolean;
  notes: string;
}

const emptyForm: FormState = {
  name: '',
  description: '',
  opensAt: '',
  closesAt: '',
  autoOpen: true,
  autoClose: true,
  expectedDeliveryDate: '',
  pickupInstructions: '',
  includeAllProducts: true,
  notifyOnOpen: true,
  notes: '',
};

type WindowField =
  'name' | 'description' | 'opensAt' | 'closesAt' | 'expectedDeliveryDate' | 'pickupInstructions' | 'notes';

/**
 * How the order-window endpoints' field names land on this dialog (forms
 * review F-2), in screen order. The length is `StoreOrderWindowBase`'s.
 */
const WINDOW_FIELDS: Record<WindowField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: 200 },
  description: { label: 'Description' },
  opensAt: { label: 'Opens' },
  closesAt: { label: 'Closes' },
  expectedDeliveryDate: { label: 'Expected delivery date' },
  pickupInstructions: { label: 'Pickup instructions' },
  notes: { label: 'Internal notes' },
};

// The ids the dialog has always used, so labels and focus keep their targets.
const IDS: Record<WindowField, string> = {
  name: 'window-name',
  description: 'window-description',
  opensAt: 'window-opens',
  closesAt: 'window-closes',
  expectedDeliveryDate: 'window-delivery',
  pickupInstructions: 'window-pickup',
  notes: 'window-notes',
};

export const WindowFormModal: React.FC<WindowFormModalProps> = ({ isOpen, window, products, onClose, onSaved }) => {
  const tz = useTimezone();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<WindowField, string>>>({});
  // What the form held when it opened (or last saved), so Escape, the X and
  // Cancel can ask before discarding anything typed since (forms review F-6).
  const [baseline, setBaseline] = useState('');
  const snapshot = JSON.stringify({ form, selectedProducts });
  const isDirty = baseline !== '' && snapshot !== baseline;
  const requestClose = useDiscardGuard({ isDirty, onClose });

  useEffect(() => {
    if (!isOpen) return;
    let seeded = emptyForm;
    let seededProducts: string[] = [];
    if (window) {
      seeded = {
        name: window.name,
        description: window.description ?? '',
        opensAt: formatForDateTimeInput(window.opensAt, tz),
        closesAt: formatForDateTimeInput(window.closesAt, tz),
        autoOpen: window.autoOpen,
        autoClose: window.autoClose,
        expectedDeliveryDate: toDateInputValue(window.expectedDeliveryDate),
        pickupInstructions: window.pickupInstructions ?? '',
        includeAllProducts: window.includeAllProducts,
        notifyOnOpen: window.notifyOnOpen,
        notes: window.notes ?? '',
      };
      seededProducts = window.offerings.map((o) => o.productId);
    }
    setForm(seeded);
    setSelectedProducts(seededProducts);
    setBaseline(JSON.stringify({ form: seeded, selectedProducts: seededProducts }));
    setErrors({});
  }, [isOpen, window, tz]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key in WINDOW_FIELDS) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const showErrors = (next: Partial<Record<WindowField, string>>) => {
    setErrors(next);
    const first = (Object.keys(IDS) as WindowField[]).find((k) => next[k]);
    if (first) globalThis.setTimeout(() => document.getElementById(IDS[first])?.focus(), 0);
  };

  /** After an edit that wrote everything but `refused`: flag those, and count only them as unsaved. */
  const keepRefused = (refused: Partial<Record<WindowField, string>>) => {
    showErrors(refused);
    const stored = (JSON.parse(baseline) as { form: FormState }).form;
    const keys = Object.keys(refused) as WindowField[];
    const kept = { ...form, ...Object.fromEntries(keys.map((k) => [k, stored[k]])) };
    setBaseline(JSON.stringify({ form: kept, selectedProducts }));
    const first = (Object.keys(IDS) as WindowField[]).find((k) => refused[k]);
    if (first) {
      toast.error(
        `Order window saved, except ${WINDOW_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''} Fix it and save again.`
      );
    }
  };

  const toggleProduct = (productId: string) =>
    setSelectedProducts((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: Partial<Record<WindowField, string>> = {};
    if (!form.name.trim()) missing.name = 'Give the order window a name.';
    // A new window is not created until every field is fixed; an edit saves
    // the rest and keeps the stored value of a refused one (below).
    if (!window && Object.keys(missing).length > 0) {
      showErrors(missing);
      return;
    }

    const offerings: WindowOfferingInput[] = form.includeAllProducts
      ? []
      : selectedProducts.map((productId, index) => ({
          productId,
          sortOrder: index,
        }));

    // A cleared box must reach the PUT as null — the update endpoint treats an
    // omitted key as "keep". A cleared open/close time is safe to send: the
    // scheduler skips auto-open/auto-close for a window with no time set, the
    // same as one created without one.
    const { text, pick } = formCoercions(Boolean(window));
    const payload = {
      name: form.name.trim(),
      description: text(form.description),
      opensAt: pick(form.opensAt && localToUTC(form.opensAt, tz)),
      closesAt: pick(form.closesAt && localToUTC(form.closesAt, tz)),
      autoOpen: form.autoOpen,
      autoClose: form.autoClose,
      expectedDeliveryDate: pick(form.expectedDeliveryDate),
      pickupInstructions: text(form.pickupInstructions),
      includeAllProducts: form.includeAllProducts,
      notifyOnOpen: form.notifyOnOpen,
      notes: text(form.notes),
      offerings,
    };

    setSaving(true);
    try {
      if (window) {
        // Single-save rule (owner, 2026-11-05): a value the record cannot hold
        // is not written — its key is left out, which the backend reads as
        // "leave alone", so the stored value is kept — the rest saves, and the
        // field stays flagged until it is fixed.
        let refused: Partial<Record<WindowField, string>> = missing;
        const send = (skip: Partial<Record<WindowField, string>>) => {
          const rest: Record<string, unknown> = { ...payload };
          for (const key of Object.keys(skip)) delete rest[key];
          return storefrontService.updateWindow(window.id, rest);
        };
        try {
          await send(refused);
        } catch (err) {
          const mapped = mapServerFieldErrors(err, WINDOW_FIELDS);
          if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
          refused = { ...refused, ...mapped.fieldErrors };
          await send(refused);
        }
        if (Object.keys(refused).length > 0) {
          onSaved();
          keepRefused(refused);
          return;
        }
        toast.success('Order window updated');
      } else {
        await storefrontService.createWindow(payload);
        toast.success('Order window created');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      // A refused field is flagged on that field rather than named in a toast
      // (forms review F-2); a new record is not created until it is fixed.
      const mapped = mapServerFieldErrors(err, WINDOW_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        toast.error(mapped.unmatched.join(' ') || 'Fix the fields marked below, then save again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Could not save the order window'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={window ? 'Edit order window' : 'New order window'}
      size="lg"
      onSubmit={(e) => void handleSave(e)}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary btn-md" onClick={requestClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary btn-md" disabled={saving}>
            {saving ? 'Saving…' : 'Save window'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <FormField
          label="Name"
          required
          error={errors.name}
          id={IDS.name}
          maxLength={WINDOW_FIELDS.name.maxLength}
          count={form.name.length}
        >
          {(field) => (
            <input
              {...field}
              className="form-input"
              type="text"
              placeholder="Fall 2026 apparel order"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
            />
          )}
        </FormField>

        <FormField label="Description" error={errors.description} id={IDS.description}>
          {(field) => (
            <textarea
              {...field}
              className="form-input"
              rows={2}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
            />
          )}
        </FormField>

        <div className="form-grid-2">
          <FormField label="Opens" error={errors.opensAt} id={IDS.opensAt}>
            {(field) => (
              <input
                {...field}
                className="form-input"
                type="datetime-local"
                value={form.opensAt}
                onChange={(e) => update('opensAt', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Closes" error={errors.closesAt} id={IDS.closesAt}>
            {(field) => (
              <input
                {...field}
                className="form-input"
                type="datetime-local"
                value={form.closesAt}
                onChange={(e) => update('closesAt', e.target.value)}
              />
            )}
          </FormField>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={form.autoOpen}
              onChange={(e) => update('autoOpen', e.target.checked)}
            />
            Open automatically at the scheduled time
          </label>
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={form.autoClose}
              onChange={(e) => update('autoClose', e.target.checked)}
            />
            Close automatically at the scheduled time
          </label>
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={form.notifyOnOpen}
              onChange={(e) => update('notifyOnOpen', e.target.checked)}
            />
            Email the membership when it opens
          </label>
        </div>

        <div className="form-grid-2">
          <FormField label="Expected delivery date" error={errors.expectedDeliveryDate} id={IDS.expectedDeliveryDate}>
            {(field) => (
              <input
                {...field}
                className="form-input"
                type="date"
                value={form.expectedDeliveryDate}
                onChange={(e) => update('expectedDeliveryDate', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Pickup instructions" error={errors.pickupInstructions} id={IDS.pickupInstructions}>
            {(field) => (
              <input
                {...field}
                className="form-input"
                type="text"
                placeholder="Pick up at Station 1, weekdays 9–5"
                value={form.pickupInstructions}
                onChange={(e) => update('pickupInstructions', e.target.value)}
              />
            )}
          </FormField>
        </div>

        <div>
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={form.includeAllProducts}
              onChange={(e) => update('includeAllProducts', e.target.checked)}
            />
            Offer every active catalog item
          </label>

          {!form.includeAllProducts && (
            <div className="border-theme-surface-border mt-3 max-h-48 space-y-2 overflow-y-auto rounded-lg border p-3">
              {products.length === 0 ? (
                <p className="text-theme-text-muted text-xs">No catalog items yet.</p>
              ) : (
                products.map((product) => (
                  <label key={product.id} className="text-theme-text-secondary flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={selectedProducts.includes(product.id)}
                      onChange={() => toggleProduct(product.id)}
                    />
                    {product.name}
                  </label>
                ))
              )}
            </div>
          )}
        </div>

        <FormField label="Internal notes" error={errors.notes} id={IDS.notes}>
          {(field) => (
            <textarea
              {...field}
              className="form-input"
              rows={2}
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};
