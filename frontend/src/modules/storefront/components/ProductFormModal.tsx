/**
 * Product Form Modal
 *
 * Create/edit a storefront catalog item and its size/color variants.
 */

import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { storefrontService } from '../services/api';
import { StoreProductStatus, type StoreProduct, type StoreProductInput, type StoreProductVariantInput } from '../types';

interface ProductFormModalProps {
  isOpen: boolean;
  product: StoreProduct | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  name: string;
  sku: string;
  description: string;
  imageUrl: string;
  category: string;
  price: string;
  cost: string;
  isTaxable: boolean;
  status: StoreProductStatus;
  maxPerMember: string;
  trackStock: boolean;
  stockQuantity: string;
  requiresVariant: boolean;
  personalizationEnabled: boolean;
  personalizationRequired: boolean;
  personalizationLabel: string;
  personalizationMaxLength: string;
  personalizationPrice: string;
  sortOrder: string;
  internalNotes: string;
}

const emptyForm: FormState = {
  name: '',
  sku: '',
  description: '',
  imageUrl: '',
  category: '',
  price: '',
  cost: '',
  isTaxable: false,
  status: StoreProductStatus.DRAFT,
  maxPerMember: '',
  trackStock: false,
  stockQuantity: '',
  requiresVariant: false,
  personalizationEnabled: false,
  personalizationRequired: false,
  personalizationLabel: '',
  personalizationMaxLength: '30',
  personalizationPrice: '0',
  sortOrder: '0',
  internalNotes: '',
};

interface VariantRow {
  id?: string | undefined;
  label: string;
  sku: string;
  priceDelta: string;
  stockQuantity: string;
  isActive: boolean;
}

export const ProductFormModal: React.FC<ProductFormModalProps> = ({ isOpen, product, onClose, onSaved }) => {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (file: File) => {
    if (!product) return;
    setUploading(true);
    try {
      await storefrontService.uploadProductImage(product.id, file);
      toast.success('Photo uploaded');
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not upload the photo'));
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveImage = async () => {
    if (!product) return;
    setUploading(true);
    try {
      await storefrontService.deleteProductImage(product.id);
      toast.success('Photo removed');
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not remove the photo'));
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    if (product) {
      setForm({
        name: product.name,
        sku: product.sku ?? '',
        description: product.description ?? '',
        imageUrl: product.imageUrl ?? '',
        category: product.category ?? '',
        price: String(product.price),
        cost: product.cost != null ? String(product.cost) : '',
        isTaxable: product.isTaxable,
        status: product.status,
        maxPerMember: product.maxPerMember != null ? String(product.maxPerMember) : '',
        trackStock: product.trackStock,
        stockQuantity: product.stockQuantity != null ? String(product.stockQuantity) : '',
        requiresVariant: product.requiresVariant,
        personalizationEnabled: product.personalizationEnabled,
        personalizationRequired: product.personalizationRequired,
        personalizationLabel: product.personalizationLabel ?? '',
        personalizationMaxLength: String(product.personalizationMaxLength ?? 30),
        personalizationPrice: String(product.personalizationPrice ?? '0'),
        sortOrder: String(product.sortOrder),
        internalNotes: product.internalNotes ?? '',
      });
      setVariants(
        product.variants.map((variant) => ({
          id: variant.id,
          label: variant.label,
          sku: variant.sku ?? '',
          priceDelta: String(variant.priceDelta),
          stockQuantity: variant.stockQuantity != null ? String(variant.stockQuantity) : '',
          isActive: variant.isActive,
        }))
      );
    } else {
      setForm(emptyForm);
      setVariants([]);
    }
  }, [isOpen, product]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const addVariant = () =>
    setVariants((prev) => [...prev, { label: '', sku: '', priceDelta: '0', stockQuantity: '', isActive: true }]);

  const updateVariant = (index: number, patch: Partial<VariantRow>) =>
    setVariants((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const removeVariant = (index: number) => setVariants((prev) => prev.filter((_, i) => i !== index));

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Give the item a name');
      return;
    }
    if (form.requiresVariant && variants.length === 0) {
      toast.error('Add at least one option, or turn off "requires an option"');
      return;
    }

    const variantPayload: StoreProductVariantInput[] = variants
      .filter((row) => row.label.trim())
      .map((row, index) => ({
        id: row.id,
        label: row.label.trim(),
        sku: row.sku.trim() || undefined,
        priceDelta: Number(row.priceDelta || 0),
        stockQuantity: row.stockQuantity ? Number(row.stockQuantity) : undefined,
        isActive: row.isActive,
        sortOrder: index,
      }));

    const payload: StoreProductInput = {
      name: form.name.trim(),
      sku: form.sku.trim() || undefined,
      description: form.description.trim() || undefined,
      imageUrl: form.imageUrl.trim() || undefined,
      category: form.category.trim() || undefined,
      price: Number(form.price || 0),
      cost: form.cost ? Number(form.cost) : undefined,
      isTaxable: form.isTaxable,
      status: form.status,
      maxPerMember: form.maxPerMember ? Number(form.maxPerMember) : undefined,
      trackStock: form.trackStock,
      stockQuantity: form.stockQuantity ? Number(form.stockQuantity) : undefined,
      requiresVariant: form.requiresVariant,
      personalizationEnabled: form.personalizationEnabled,
      personalizationRequired: form.personalizationEnabled && form.personalizationRequired,
      personalizationLabel: form.personalizationLabel.trim() || undefined,
      personalizationMaxLength: Number(form.personalizationMaxLength || 30),
      personalizationPrice: Number(form.personalizationPrice || 0),
      sortOrder: Number(form.sortOrder || 0),
      internalNotes: form.internalNotes.trim() || undefined,
      variants: variantPayload,
    };

    setSaving(true);
    try {
      if (product) {
        await storefrontService.updateProduct(product.id, payload);
        toast.success('Item updated');
      } else {
        await storefrontService.createProduct(payload);
        toast.success('Item added to the catalog');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the item'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={product ? 'Edit item' : 'New item'}
      size="xl"
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
            {saving ? 'Saving…' : 'Save item'}
          </button>
        </div>
      }
    >
      <div className="modal-body space-y-4">
        <div className="form-grid-2">
          <div>
            <label htmlFor="product-name" className="form-label">
              Name
            </label>
            <input
              id="product-name"
              type="text"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="product-sku" className="form-label">
              SKU (optional)
            </label>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              id="product-sku"
              type="text"
              value={form.sku}
              onChange={(e) => update('sku', e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="product-price" className="form-label">
              Price
            </label>
            <input
              id="product-price"
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(e) => update('price', e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="product-cost" className="form-label">
              Department cost (optional)
            </label>
            <input
              id="product-cost"
              type="number"
              min="0"
              step="0.01"
              value={form.cost}
              onChange={(e) => update('cost', e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="product-category" className="form-label">
              Category
            </label>
            <input
              id="product-category"
              type="text"
              value={form.category}
              onChange={(e) => update('category', e.target.value)}
              className="form-input"
              placeholder="Apparel, Challenge coins, …"
            />
          </div>
          <div>
            <label htmlFor="product-status" className="form-label">
              Status
            </label>
            <select
              id="product-status"
              value={form.status}
              onChange={(e) => update('status', e.target.value as StoreProductStatus)}
              className="form-input"
            >
              <option value={StoreProductStatus.DRAFT}>Draft</option>
              <option value={StoreProductStatus.ACTIVE}>Active (for sale)</option>
              <option value={StoreProductStatus.ARCHIVED}>Archived</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="product-image" className="form-label">
            Image URL (optional)
          </label>
          <input
            id="product-image"
            type="url"
            value={form.imageUrl}
            onChange={(e) => update('imageUrl', e.target.value)}
            className="form-input"
          />
        </div>

        <div>
          <label htmlFor="product-description" className="form-label">
            Description
          </label>
          <textarea
            id="product-description"
            rows={3}
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className="form-input"
          />
        </div>

        <div className="form-grid-3">
          <div>
            <label htmlFor="product-max" className="form-label">
              Max per member
            </label>
            <input
              id="product-max"
              type="number"
              min="1"
              value={form.maxPerMember}
              onChange={(e) => update('maxPerMember', e.target.value)}
              className="form-input"
              placeholder="No limit"
            />
          </div>
          <div>
            <label htmlFor="product-stock" className="form-label">
              Stock on hand
            </label>
            <input
              id="product-stock"
              type="number"
              min="0"
              value={form.stockQuantity}
              onChange={(e) => update('stockQuantity', e.target.value)}
              className="form-input"
              disabled={!form.trackStock}
            />
          </div>
          <div>
            <label htmlFor="product-sort" className="form-label">
              Sort order
            </label>
            <input
              id="product-sort"
              type="number"
              value={form.sortOrder}
              onChange={(e) => update('sortOrder', e.target.value)}
              className="form-input"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={form.trackStock}
              onChange={(e) => update('trackStock', e.target.checked)}
            />
            Limit sales to stock on hand
          </label>
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={form.isTaxable}
              onChange={(e) => update('isTaxable', e.target.checked)}
            />
            Taxable
          </label>
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={form.requiresVariant}
              onChange={(e) => update('requiresVariant', e.target.checked)}
            />
            Requires an option (size/color)
          </label>
        </div>

        <section className="border-theme-surface-border rounded-lg border p-3">
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={form.personalizationEnabled}
              onChange={(e) => update('personalizationEnabled', e.target.checked)}
            />
            Members can personalize this item (name, callsign, …)
          </label>

          {form.personalizationEnabled && (
            <div className="mt-3 space-y-3">
              <div className="form-grid-2">
                <div>
                  <label htmlFor="product-pers-label" className="form-label">
                    Prompt shown to the member
                  </label>
                  <input
                    id="product-pers-label"
                    type="text"
                    value={form.personalizationLabel}
                    onChange={(e) => update('personalizationLabel', e.target.value)}
                    className="form-input"
                    placeholder="Name to embroider"
                  />
                </div>
                <div>
                  <label htmlFor="product-pers-price" className="form-label">
                    Upcharge per unit
                  </label>
                  <input
                    id="product-pers-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.personalizationPrice}
                    onChange={(e) => update('personalizationPrice', e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>
              <div className="form-grid-2">
                <div>
                  <label htmlFor="product-pers-max" className="form-label">
                    Maximum characters
                  </label>
                  <input
                    id="product-pers-max"
                    type="number"
                    min="1"
                    max="200"
                    value={form.personalizationMaxLength}
                    onChange={(e) => update('personalizationMaxLength', e.target.value)}
                    className="form-input"
                  />
                </div>
                <label className="text-theme-text-secondary flex items-end gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={form.personalizationRequired}
                    onChange={(e) => update('personalizationRequired', e.target.checked)}
                  />
                  Required — the member must enter text
                </label>
              </div>
            </div>
          )}
        </section>

        {product && (
          <section className="border-theme-surface-border rounded-lg border p-3">
            <h3 className="text-theme-text-primary mb-2 text-sm font-semibold">Photo</h3>
            <div className="flex items-center gap-4">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="bg-theme-surface-secondary h-20 w-20 rounded-lg object-cover"
                />
              ) : (
                <div className="bg-theme-surface-secondary flex h-20 w-20 items-center justify-center rounded-lg">
                  <ImageIcon className="text-theme-text-muted h-6 w-6" />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label htmlFor="product-photo" className="btn-secondary btn-sm cursor-pointer">
                  {uploading ? 'Uploading…' : 'Upload photo'}
                  <input
                    id="product-photo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleUpload(file);
                      e.target.value = '';
                    }}
                  />
                </label>
                {product.hasImage && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={uploading}
                    onClick={() => {
                      void handleRemoveImage();
                    }}
                  >
                    Remove photo
                  </button>
                )}
                <p className="text-theme-text-muted text-xs">
                  JPEG, PNG or WebP up to 5MB. Re-encoded to WebP on upload.
                </p>
              </div>
            </div>
          </section>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-theme-text-primary text-sm font-semibold">Options</h3>
            <button type="button" className="btn-secondary btn-sm" onClick={addVariant}>
              <Plus className="h-3.5 w-3.5" />
              Add option
            </button>
          </div>
          {variants.length === 0 ? (
            <p className="text-theme-text-muted text-xs">No options — the item is sold as a single SKU.</p>
          ) : (
            <div className="space-y-2">
              {variants.map((variant, index) => (
                <div key={variant.id ?? `new-${index}`} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
                  <div className="col-span-2 sm:col-span-2">
                    <label htmlFor={`variant-label-${index}`} className="form-label-sm">
                      Label
                    </label>
                    <input
                      id={`variant-label-${index}`}
                      type="text"
                      value={variant.label}
                      onChange={(e) => updateVariant(index, { label: e.target.value })}
                      className="form-input-sm"
                      placeholder="L / Navy"
                    />
                  </div>
                  <div>
                    <label htmlFor={`variant-delta-${index}`} className="form-label-sm">
                      +/- price
                    </label>
                    <input
                      id={`variant-delta-${index}`}
                      type="number"
                      step="0.01"
                      value={variant.priceDelta}
                      onChange={(e) => updateVariant(index, { priceDelta: e.target.value })}
                      className="form-input-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor={`variant-stock-${index}`} className="form-label-sm">
                      Stock
                    </label>
                    <input
                      id={`variant-stock-${index}`}
                      type="number"
                      min="0"
                      value={variant.stockQuantity}
                      onChange={(e) => updateVariant(index, { stockQuantity: e.target.value })}
                      className="form-input-sm"
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove option ${index + 1}`}
                    className="btn-icon text-theme-text-muted hover:text-red-500"
                    onClick={() => removeVariant(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="product-notes" className="form-label">
            Internal notes (not shown to members)
          </label>
          <textarea
            id="product-notes"
            rows={2}
            value={form.internalNotes}
            onChange={(e) => update('internalNotes', e.target.value)}
            className="form-input"
          />
        </div>
      </div>
    </Modal>
  );
};
