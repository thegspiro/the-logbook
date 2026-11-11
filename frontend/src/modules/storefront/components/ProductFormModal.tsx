/**
 * Product Form Modal
 *
 * Create/edit a storefront catalog item and its size/color variants.
 */

import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { blankToNull, numberOrNull } from '../../../utils/formValues';
import { storefrontService } from '../services/api';
import {
  DEFAULT_EMBROIDERY_THREAD_COLOR,
  DEFAULT_PERSONALIZATION_METHOD,
  EMBROIDERY_THREAD_COLORS,
  PERSONALIZATION_METHODS,
  usesThreadColor,
  StoreProductStatus,
  type EmbroideryThreadColor,
  type PersonalizationMethod,
  type StoreProduct,
  type StoreProductInput,
  type StoreProductVariantInput,
} from '../types';

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
  personalizationThreadColor: EmbroideryThreadColor;
  personalizationMethod: PersonalizationMethod;
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
  personalizationThreadColor: DEFAULT_EMBROIDERY_THREAD_COLOR,
  personalizationMethod: DEFAULT_PERSONALIZATION_METHOD,
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

type ProductField =
  | 'name'
  | 'sku'
  | 'price'
  | 'cost'
  | 'category'
  | 'status'
  | 'imageUrl'
  | 'description'
  | 'maxPerMember'
  | 'stockQuantity'
  | 'sortOrder'
  | 'personalizationLabel'
  | 'personalizationPrice'
  | 'personalizationMaxLength'
  | 'internalNotes';

/**
 * How the catalog endpoints' field names land on this dialog (forms review
 * F-2), in screen order. Lengths are `StoreProductBase`'s max_length.
 */
const PRODUCT_FIELDS: Record<ProductField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: 255 },
  sku: { label: 'SKU', maxLength: 100 },
  price: { label: 'Price' },
  cost: { label: 'Department cost' },
  category: { label: 'Category', maxLength: 100 },
  status: { label: 'Status' },
  imageUrl: { label: 'Image URL', maxLength: 500 },
  description: { label: 'Description' },
  maxPerMember: { label: 'Max per member' },
  stockQuantity: { label: 'Stock on hand' },
  sortOrder: { label: 'Sort order' },
  personalizationLabel: { label: 'Prompt shown to the member', maxLength: 120 },
  personalizationPrice: { label: 'Upcharge per unit' },
  personalizationMaxLength: { label: 'Maximum characters' },
  internalNotes: { label: 'Internal notes' },
};

// The ids the dialog has always used, so labels and focus keep their targets.
const IDS: Record<ProductField, string> = {
  name: 'product-name',
  sku: 'product-sku',
  price: 'product-price',
  cost: 'product-cost',
  category: 'product-category',
  status: 'product-status',
  imageUrl: 'product-image',
  description: 'product-description',
  maxPerMember: 'product-max',
  stockQuantity: 'product-stock',
  sortOrder: 'product-sort',
  personalizationLabel: 'product-pers-label',
  personalizationPrice: 'product-pers-price',
  personalizationMaxLength: 'product-pers-max',
  internalNotes: 'product-notes',
};

export const ProductFormModal: React.FC<ProductFormModalProps> = ({ isOpen, product, onClose, onSaved }) => {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<ProductField, string>>>({});
  // What the form held when it opened (or last saved), so Escape, the X and
  // Cancel can ask before discarding anything typed since (forms review F-6).
  const [baseline, setBaseline] = useState('');
  const isDirty = baseline !== '' && JSON.stringify({ form, variants }) !== baseline;
  const requestClose = useDiscardGuard({ isDirty, onClose });

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
    let seeded = emptyForm;
    let seededVariants: VariantRow[] = [];
    if (product) {
      seeded = {
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
        personalizationThreadColor: product.personalizationThreadColor ?? DEFAULT_EMBROIDERY_THREAD_COLOR,
        personalizationMethod: product.personalizationMethod ?? DEFAULT_PERSONALIZATION_METHOD,
        sortOrder: String(product.sortOrder),
        internalNotes: product.internalNotes ?? '',
      };
      seededVariants = product.variants.map((variant) => ({
        id: variant.id,
        label: variant.label,
        sku: variant.sku ?? '',
        priceDelta: String(variant.priceDelta),
        stockQuantity: variant.stockQuantity != null ? String(variant.stockQuantity) : '',
        isActive: variant.isActive,
      }));
    }
    setForm(seeded);
    setVariants(seededVariants);
    setBaseline(JSON.stringify({ form: seeded, variants: seededVariants }));
    setErrors({});
  }, [isOpen, product]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key in PRODUCT_FIELDS) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const showErrors = (next: Partial<Record<ProductField, string>>) => {
    setErrors(next);
    const first = (Object.keys(IDS) as ProductField[]).find((k) => next[k]);
    if (first) window.setTimeout(() => document.getElementById(IDS[first])?.focus(), 0);
  };

  /** After an edit that wrote everything but `refused`: flag those, and count only them as unsaved. */
  const keepRefused = (refused: Partial<Record<ProductField, string>>) => {
    showErrors(refused);
    const stored = (JSON.parse(baseline) as { form: FormState }).form;
    const keys = Object.keys(refused) as ProductField[];
    const kept = { ...form, ...Object.fromEntries(keys.map((k) => [k, stored[k]])) };
    setBaseline(JSON.stringify({ form: kept, variants }));
    const first = (Object.keys(IDS) as ProductField[]).find((k) => refused[k]);
    if (first) {
      toast.error(
        `Item saved, except ${PRODUCT_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''} Fix it and save again.`
      );
    }
  };

  const addVariant = () =>
    setVariants((prev) => [...prev, { label: '', sku: '', priceDelta: '0', stockQuantity: '', isActive: true }]);

  const updateVariant = (index: number, patch: Partial<VariantRow>) =>
    setVariants((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const removeVariant = (index: number) => setVariants((prev) => prev.filter((_, i) => i !== index));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: Partial<Record<ProductField, string>> = {};
    if (!form.name.trim()) missing.name = 'Give the item a name.';
    // A blank price used to be saved as $0.00, putting a free item on sale
    // nobody meant to give away. Zero stays allowed, but only when typed.
    const price = form.price.trim() === '' ? Number.NaN : Number(form.price);
    if (!Number.isFinite(price) || price < 0) missing.price = 'Enter a price (type 0 for a free item).';
    // A new item is not created until every field is fixed; an edit saves
    // the rest and keeps the stored value of a refused one (below).
    if (!product && Object.keys(missing).length > 0) {
      showErrors(missing);
      return;
    }
    // The options are a list, not one field, so this refusal stays a message.
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

    // Blank optional fields go as an explicit null, not omitted: on update
    // that is what clears them, and on create it is equivalent to omitting
    // since each of these defaults to None server-side.
    const payload: StoreProductInput = {
      name: form.name.trim(),
      sku: blankToNull(form.sku),
      description: blankToNull(form.description),
      imageUrl: blankToNull(form.imageUrl),
      category: blankToNull(form.category),
      price,
      cost: numberOrNull(form.cost),
      isTaxable: form.isTaxable,
      status: form.status,
      maxPerMember: numberOrNull(form.maxPerMember),
      trackStock: form.trackStock,
      stockQuantity: numberOrNull(form.stockQuantity),
      requiresVariant: form.requiresVariant,
      personalizationEnabled: form.personalizationEnabled,
      personalizationRequired: form.personalizationEnabled && form.personalizationRequired,
      personalizationLabel: blankToNull(form.personalizationLabel),
      personalizationMaxLength: Number(form.personalizationMaxLength || 30),
      personalizationPrice: Number(form.personalizationPrice || 0),
      personalizationThreadColor: form.personalizationThreadColor,
      personalizationMethod: form.personalizationMethod,
      sortOrder: Number(form.sortOrder || 0),
      internalNotes: blankToNull(form.internalNotes),
      variants: variantPayload,
    };

    setSaving(true);
    try {
      if (product) {
        // Single-save rule (owner, 2026-11-05): a value the record cannot hold
        // is not written — its key is left out, which the backend reads as
        // "leave alone", so the stored value is kept — the rest saves, and the
        // field stays flagged until it is fixed.
        let refused: Partial<Record<ProductField, string>> = missing;
        const send = (skip: Partial<Record<ProductField, string>>) => {
          const rest: Record<string, unknown> = { ...payload };
          for (const key of Object.keys(skip)) delete rest[key];
          return storefrontService.updateProduct(product.id, rest);
        };
        try {
          await send(refused);
        } catch (err) {
          const mapped = mapServerFieldErrors(err, PRODUCT_FIELDS);
          if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
          refused = { ...refused, ...mapped.fieldErrors };
          await send(refused);
        }
        if (Object.keys(refused).length > 0) {
          onSaved();
          keepRefused(refused);
          return;
        }
        toast.success('Item updated');
      } else {
        await storefrontService.createProduct(payload);
        toast.success('Item added to the catalog');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      // A refused field is flagged on that field rather than named in a toast
      // (forms review F-2); a new record is not created until it is fixed.
      const mapped = mapServerFieldErrors(err, PRODUCT_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        toast.error(mapped.unmatched.join(' ') || 'Fix the fields marked below, then save again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Could not save the item'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={product ? 'Edit item' : 'New item'}
      size="xl"
      onSubmit={(e) => void handleSave(e)}
      noValidate
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary btn-md" onClick={requestClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary btn-md" disabled={saving}>
            {saving ? 'Saving…' : 'Save item'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="form-grid-2">
          <FormField
            label="Name"
            required
            error={errors.name}
            id={IDS.name}
            maxLength={PRODUCT_FIELDS.name.maxLength}
            count={form.name.length}
          >
            {(field) => (
              <input
                {...field}
                className="form-input"
                type="text"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="SKU"
            error={errors.sku}
            id={IDS.sku}
            maxLength={PRODUCT_FIELDS.sku.maxLength}
            count={form.sku.length}
            optional
          >
            {(field) => (
              <input
                {...field}
                className="form-input"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                value={form.sku}
                onChange={(e) => update('sku', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Price" required error={errors.price} id={IDS.price}>
            {(field) => (
              <input
                {...field}
                className="form-input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => update('price', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Department cost" error={errors.cost} id={IDS.cost} optional>
            {(field) => (
              <input
                {...field}
                className="form-input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.cost}
                onChange={(e) => update('cost', e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="Category"
            error={errors.category}
            id={IDS.category}
            maxLength={PRODUCT_FIELDS.category.maxLength}
            count={form.category.length}
          >
            {(field) => (
              <input
                {...field}
                className="form-input"
                type="text"
                placeholder="Apparel, Challenge coins, …"
                value={form.category}
                onChange={(e) => update('category', e.target.value)}
              />
            )}
          </FormField>
          {/* A new item starts as a draft, and a draft is offered in no order
              window — so an item saved with the defaults never reached the
              store, and members saw "Nothing listed yet". */}
          <FormField
            label="Status"
            error={errors.status}
            id={IDS.status}
            hint="Draft items aren't shown to members. Choose Active to sell it."
          >
            {(field) => (
              <select
                {...field}
                className="form-input"
                value={form.status}
                onChange={(e) => update('status', e.target.value as StoreProductStatus)}
              >
                <option value={StoreProductStatus.DRAFT}>Draft</option>
                <option value={StoreProductStatus.ACTIVE}>Active (for sale)</option>
                <option value={StoreProductStatus.ARCHIVED}>Archived</option>
              </select>
            )}
          </FormField>
        </div>

        <FormField
          label="Image URL"
          error={errors.imageUrl}
          id={IDS.imageUrl}
          maxLength={PRODUCT_FIELDS.imageUrl.maxLength}
          count={form.imageUrl.length}
          optional
        >
          {(field) => (
            <input
              {...field}
              className="form-input"
              type="url"
              inputMode="url"
              autoComplete="off"
              value={form.imageUrl}
              onChange={(e) => update('imageUrl', e.target.value)}
            />
          )}
        </FormField>

        <FormField label="Description" error={errors.description} id={IDS.description}>
          {(field) => (
            <textarea
              {...field}
              className="form-input"
              rows={3}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
            />
          )}
        </FormField>

        <div className="form-grid-3">
          <FormField label="Max per member" error={errors.maxPerMember} id={IDS.maxPerMember}>
            {(field) => (
              <input
                {...field}
                className="form-input"
                type="number"
                inputMode="numeric"
                min="1"
                placeholder="No limit"
                value={form.maxPerMember}
                onChange={(e) => update('maxPerMember', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Stock on hand" error={errors.stockQuantity} id={IDS.stockQuantity}>
            {(field) => (
              <input
                {...field}
                className="form-input"
                type="number"
                inputMode="numeric"
                min="0"
                disabled={!form.trackStock}
                value={form.stockQuantity}
                onChange={(e) => update('stockQuantity', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Sort order" error={errors.sortOrder} id={IDS.sortOrder}>
            {(field) => (
              <input
                {...field}
                className="form-input"
                type="number"
                inputMode="numeric"
                value={form.sortOrder}
                onChange={(e) => update('sortOrder', e.target.value)}
              />
            )}
          </FormField>
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
                <FormField
                  label="Prompt shown to the member"
                  error={errors.personalizationLabel}
                  id={IDS.personalizationLabel}
                  maxLength={PRODUCT_FIELDS.personalizationLabel.maxLength}
                  count={form.personalizationLabel.length}
                >
                  {(field) => (
                    <input
                      {...field}
                      className="form-input"
                      type="text"
                      placeholder="Name to embroider"
                      value={form.personalizationLabel}
                      onChange={(e) => update('personalizationLabel', e.target.value)}
                    />
                  )}
                </FormField>
                <FormField label="Upcharge per unit" error={errors.personalizationPrice} id={IDS.personalizationPrice}>
                  {(field) => (
                    <input
                      {...field}
                      className="form-input"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={form.personalizationPrice}
                      onChange={(e) => update('personalizationPrice', e.target.value)}
                    />
                  )}
                </FormField>
              </div>
              <div>
                <span className="form-label" id="product-pers-method">
                  How is it applied?
                </span>
                <p className="text-theme-text-secondary mb-2 text-xs">
                  Cloth is stitched; metal is cut. This decides what the vendor sheet asks for.
                </p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="product-pers-method">
                  {PERSONALIZATION_METHODS.map((method) => {
                    const selected = form.personalizationMethod === method.value;
                    return (
                      <button
                        key={method.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => update('personalizationMethod', method.value)}
                        className={`focus-visible:ring-theme-focus-ring mobile-touch-target flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden ${
                          selected
                            ? 'border-2 border-red-800 bg-red-50 text-red-900 dark:border-red-600 dark:bg-red-500/15 dark:text-red-200'
                            : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover bg-theme-surface'
                        }`}
                      >
                        <span className="text-[13px] font-bold">{method.label}</span>
                        <span className="text-theme-text-muted text-[11px]">{method.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Thread belongs to embroidery alone — an engraver has none, and
                  offering the picker would put a colour on the vendor sheet. */}
              {usesThreadColor(form.personalizationMethod) && (
                <div>
                  <span className="form-label" id="product-pers-thread">
                    Thread color
                  </span>
                  <p className="text-theme-text-secondary mb-2 text-xs">
                    What the vendor embroiders this item in. Members see their name previewed in it.
                  </p>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="product-pers-thread">
                    {EMBROIDERY_THREAD_COLORS.map((color) => {
                      const selected = form.personalizationThreadColor === color.value;
                      return (
                        <button
                          key={color.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => update('personalizationThreadColor', color.value)}
                          className={`focus-visible:ring-theme-focus-ring mobile-touch-target inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden ${
                            selected
                              ? 'border-2 border-red-800 bg-red-50 font-bold text-red-900 dark:border-red-600 dark:bg-red-500/15 dark:text-red-200'
                              : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover bg-theme-surface'
                          }`}
                        >
                          {/* Ringed rather than bare: the white and silver
                            swatches vanish into a light surface otherwise. */}
                          <span
                            aria-hidden="true"
                            className="h-4 w-4 shrink-0 rounded-full ring-1 ring-slate-400/60"
                            style={{ backgroundColor: color.hex }}
                          />
                          {color.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="form-grid-2">
                <FormField
                  label="Maximum characters"
                  error={errors.personalizationMaxLength}
                  id={IDS.personalizationMaxLength}
                >
                  {(field) => (
                    <input
                      {...field}
                      className="form-input"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="200"
                      value={form.personalizationMaxLength}
                      onChange={(e) => update('personalizationMaxLength', e.target.value)}
                    />
                  )}
                </FormField>
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

        <FormField label="Internal notes (not shown to members)" error={errors.internalNotes} id={IDS.internalNotes}>
          {(field) => (
            <textarea
              {...field}
              className="form-input"
              rows={2}
              value={form.internalNotes}
              onChange={(e) => update('internalNotes', e.target.value)}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};
