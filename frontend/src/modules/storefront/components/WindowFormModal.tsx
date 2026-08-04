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
import { getErrorMessage } from '../../../utils/errorHandling';
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

export const WindowFormModal: React.FC<WindowFormModalProps> = ({ isOpen, window, products, onClose, onSaved }) => {
  const tz = useTimezone();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (window) {
      setForm({
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
      });
      setSelectedProducts(window.offerings.map((o) => o.productId));
    } else {
      setForm(emptyForm);
      setSelectedProducts([]);
    }
  }, [isOpen, window, tz]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleProduct = (productId: string) =>
    setSelectedProducts((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Give the order window a name');
      return;
    }

    const offerings: WindowOfferingInput[] = form.includeAllProducts
      ? []
      : selectedProducts.map((productId, index) => ({
          productId,
          sortOrder: index,
        }));

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      opensAt: form.opensAt ? localToUTC(form.opensAt, tz) : undefined,
      closesAt: form.closesAt ? localToUTC(form.closesAt, tz) : undefined,
      autoOpen: form.autoOpen,
      autoClose: form.autoClose,
      expectedDeliveryDate: form.expectedDeliveryDate || undefined,
      pickupInstructions: form.pickupInstructions.trim() || undefined,
      includeAllProducts: form.includeAllProducts,
      notifyOnOpen: form.notifyOnOpen,
      notes: form.notes.trim() || undefined,
      offerings,
    };

    setSaving(true);
    try {
      if (window) {
        await storefrontService.updateWindow(window.id, payload);
        toast.success('Order window updated');
      } else {
        await storefrontService.createWindow(payload);
        toast.success('Order window created');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the order window'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={window ? 'Edit order window' : 'New order window'}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary btn-md" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary btn-md"
            disabled={saving}
            onClick={() => {
              void handleSave();
            }}
          >
            {saving ? 'Saving…' : 'Save window'}
          </button>
        </div>
      }
    >
      <div className="modal-body space-y-4">
        <div>
          <label htmlFor="window-name" className="form-label">
            Name
          </label>
          <input
            id="window-name"
            type="text"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="form-input"
            placeholder="Fall 2026 apparel order"
          />
        </div>

        <div>
          <label htmlFor="window-description" className="form-label">
            Description
          </label>
          <textarea
            id="window-description"
            rows={2}
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className="form-input"
          />
        </div>

        <div className="form-grid-2">
          <div>
            <label htmlFor="window-opens" className="form-label">
              Opens
            </label>
            <input
              id="window-opens"
              type="datetime-local"
              value={form.opensAt}
              onChange={(e) => update('opensAt', e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="window-closes" className="form-label">
              Closes
            </label>
            <input
              id="window-closes"
              type="datetime-local"
              value={form.closesAt}
              onChange={(e) => update('closesAt', e.target.value)}
              className="form-input"
            />
          </div>
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
          <div>
            <label htmlFor="window-delivery" className="form-label">
              Expected delivery date
            </label>
            <input
              id="window-delivery"
              type="date"
              value={form.expectedDeliveryDate}
              onChange={(e) => update('expectedDeliveryDate', e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="window-pickup" className="form-label">
              Pickup instructions
            </label>
            <input
              id="window-pickup"
              type="text"
              value={form.pickupInstructions}
              onChange={(e) => update('pickupInstructions', e.target.value)}
              className="form-input"
              placeholder="Pick up at Station 1, weekdays 9–5"
            />
          </div>
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

        <div>
          <label htmlFor="window-notes" className="form-label">
            Internal notes
          </label>
          <textarea
            id="window-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            className="form-input"
          />
        </div>
      </div>
    </Modal>
  );
};
