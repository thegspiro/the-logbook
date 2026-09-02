/**
 * ItemFormModal — Reusable add/edit modal for inventory items.
 * Extracted so it can be used from both the items list page and the item detail page.
 *
 * When creating a new uniform or PPE item, a "Generate Sizes & Styles" toggle
 * lets the user pick multiple standard sizes and garment styles.  The backend
 * then creates one pool item per combination and groups them under a variant group.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull, formCoercions } from '../../../utils/formValues';
import { ITEM_CONDITION_OPTIONS } from '../../../constants/enums';
import { Modal } from '../../../components/Modal';
import type {
  InventoryItem,
  InventoryCategory,
  InventoryItemCreate,
  InventoryVendor,
  StorageAreaResponse,
  Location,
  SizeVariantCreate,
} from '../types';
import { ITEM_TYPE_FIELDS, getItemTypeFromCategory, STANDARD_SIZES, GARMENT_STYLES } from '../types';

interface FD {
  name: string;
  description: string;
  category_id: string;
  tracking_type: string;
  serial_number: string;
  asset_tag: string;
  barcode: string;
  size: string;
  color: string;
  purchase_price: string;
  current_value: string;
  purchase_date: string;
  vendor: string;
  vendor_id: string;
  warranty_expiration: string;
  replacement_cost: string;
  location_id: string;
  storage_area_id: string;
  quantity: string;
  unit_of_measure: string;
  reorder_point: string;
  inspection_interval_days: string;
  condition: string;
  notes: string;
}

const EMPTY: FD = {
  name: '',
  description: '',
  category_id: '',
  tracking_type: 'individual',
  serial_number: '',
  asset_tag: '',
  barcode: '',
  size: '',
  color: '',
  purchase_price: '',
  current_value: '',
  purchase_date: '',
  vendor: '',
  vendor_id: '',
  warranty_expiration: '',
  replacement_cost: '',
  location_id: '',
  storage_area_id: '',
  quantity: '1',
  unit_of_measure: '',
  reorder_point: '',
  inspection_interval_days: '',
  condition: 'good',
  notes: '',
};

/** Fields a caller can pre-fill on a new item. Ignored when editing. */
export interface ItemFormDefaults {
  category_id?: string | undefined;
  location_id?: string | undefined;
  storage_area_id?: string | undefined;
  tracking_type?: string | undefined;
}

/**
 * Status an unsafe condition forces, mirroring
 * ``InventoryService._status_from_condition``. Returns nothing when the pair
 * is already legal, so the field stays absent from the payload and the backend
 * leaves the stored status alone.
 */
function statusForUnsafeCondition(currentStatus: string, condition: string): { status: string } | undefined {
  if (currentStatus !== 'available') return undefined;
  if (condition === 'poor' || condition === 'damaged' || condition === 'out_of_service') {
    return { status: 'in_maintenance' };
  }
  if (condition === 'retired') return { status: 'retired' };
  return undefined;
}

export interface ItemFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  categories: InventoryCategory[];
  locations: Location[];
  storageAreas: StorageAreaResponse[];
  editItem?: InventoryItem | null;
  /**
   * Pre-selected category/room/storage area for a new item. The setup workflow
   * has already asked for these a step earlier, so re-asking is the repetition
   * that makes adding the first item feel like paperwork.
   */
  defaults?: ItemFormDefaults;
}

/** All item types support size/style variant generation (uniforms, PPE,
 *  batteries, lights, etc. — any category where items come in different
 *  sizes, colors, or styles). */
const VARIANT_ITEM_TYPES = new Set([
  'uniform',
  'ppe',
  'tool',
  'equipment',
  'vehicle',
  'electronics',
  'consumable',
  'other',
]);

export const ItemFormModal: React.FC<ItemFormModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  categories,
  locations,
  storageAreas,
  editItem,
  defaults,
}) => {
  const [f, setF] = useState<FD>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [showFin, setShowFin] = useState(false);
  // Fetched here rather than threaded through every page that opens this modal.
  // A failed load leaves the picker empty and the free-text name still usable,
  // so it never blocks adding an item.
  const [vendors, setVendors] = useState<InventoryVendor[]>([]);

  // Variant generation state (only for new items)
  const [generateVariants, setGenerateVariants] = useState(false);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [variantColors, setVariantColors] = useState('');

  // Read as primitives so an inline `defaults={{...}}` at the call site does
  // not re-run the reset effect on every parent render and wipe what is typed.
  const defaultCategoryId = defaults?.category_id ?? '';
  const defaultLocationId = defaults?.location_id ?? '';
  const defaultStorageAreaId = defaults?.storage_area_id ?? '';
  const defaultTrackingType = defaults?.tracking_type ?? '';

  useEffect(() => {
    if (!isOpen) return;
    void (async () => {
      try {
        // Inactive vendors are fetched too: an item linked to one before it was
        // deactivated must still show that name rather than reading as unlinked
        // while quietly submitting the old id. Only active ones are offered.
        setVendors(await inventoryService.getVendors({ active_only: false }));
      } catch {
        setVendors([]);
      }
    })();
  }, [isOpen]);

  useEffect(() => {
    if (editItem) {
      setF({
        name: editItem.name,
        description: editItem.description ?? '',
        category_id: editItem.category_id ?? '',
        tracking_type: editItem.tracking_type,
        serial_number: editItem.serial_number ?? '',
        asset_tag: editItem.asset_tag ?? '',
        barcode: editItem.barcode ?? '',
        size: editItem.size ?? '',
        color: editItem.color ?? '',
        purchase_price: editItem.purchase_price != null ? String(editItem.purchase_price) : '',
        current_value: editItem.current_value != null ? String(editItem.current_value) : '',
        purchase_date: editItem.purchase_date ?? '',
        vendor: editItem.vendor ?? '',
        vendor_id: editItem.vendor_id ?? '',
        warranty_expiration: editItem.warranty_expiration ?? '',
        replacement_cost: editItem.replacement_cost != null ? String(editItem.replacement_cost) : '',
        location_id: editItem.location_id ?? '',
        storage_area_id: editItem.storage_area_id ?? '',
        quantity: String(editItem.quantity),
        unit_of_measure: editItem.unit_of_measure ?? '',
        reorder_point: editItem.reorder_point != null ? String(editItem.reorder_point) : '',
        inspection_interval_days:
          editItem.inspection_interval_days != null ? String(editItem.inspection_interval_days) : '',
        condition: editItem.condition,
        notes: editItem.notes ?? '',
      });
    } else {
      setF({
        ...EMPTY,
        category_id: defaultCategoryId,
        location_id: defaultLocationId,
        storage_area_id: defaultStorageAreaId,
        tracking_type: defaultTrackingType || EMPTY.tracking_type,
      });
    }
    setShowFin(false);
    setGenerateVariants(false);
    setSelectedSizes([]);
    setSelectedStyles([]);
    setVariantColors('');
  }, [editItem, isOpen, defaultCategoryId, defaultLocationId, defaultStorageAreaId, defaultTrackingType]);

  const cat = useMemo(() => categories.find((c) => c.id === f.category_id), [categories, f.category_id]);
  const itemType = getItemTypeFromCategory(cat);
  const tf = ITEM_TYPE_FIELDS[itemType] ?? [];
  const areas = useMemo(
    () => (f.location_id ? storageAreas.filter((a) => a.location_id === f.location_id) : storageAreas),
    [storageAreas, f.location_id]
  );
  const has = (k: string) => tf.includes(k);
  const up = (k: keyof FD, v: string) => setF((p) => ({ ...p, [k]: v }));

  /** Whether the selected category supports variant generation */
  const supportsVariants = !editItem && VARIANT_ITEM_TYPES.has(itemType);

  // Turn off variant generation when category changes to one that doesn't support it
  useEffect(() => {
    if (!supportsVariants) setGenerateVariants(false);
  }, [supportsVariants]);

  const toggleSize = useCallback((value: string) => {
    setSelectedSizes((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));
  }, []);

  const toggleStyle = useCallback((value: string) => {
    setSelectedStyles((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));
  }, []);

  /** Compute how many items will be generated for the preview label */
  const variantCount = useMemo(() => {
    if (!generateVariants || selectedSizes.length === 0) return 0;
    const colorList = variantColors
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    const colorMult = colorList.length || 1;
    const styleMult = selectedStyles.length || 1;
    return selectedSizes.length * colorMult * styleMult;
  }, [generateVariants, selectedSizes, selectedStyles, variantColors]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) {
      toast.error('Name is required');
      return;
    }

    // Variant generation path
    if (generateVariants) {
      if (selectedSizes.length === 0) {
        toast.error('Select at least one size');
        return;
      }
      setSaving(true);
      try {
        const colorList = variantColors
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
        const data: SizeVariantCreate = {
          base_name: f.name.trim(),
          sizes: selectedSizes,
          colors: colorList.length > 0 ? colorList : undefined,
          styles: selectedStyles.length > 0 ? selectedStyles : undefined,
          category_id: f.category_id || undefined,
          quantity_per_variant: f.quantity ? Number(f.quantity) : 0,
          replacement_cost: f.replacement_cost ? Number(f.replacement_cost) : undefined,
          purchase_price: f.purchase_price ? Number(f.purchase_price) : undefined,
          unit_of_measure: f.unit_of_measure.trim() || undefined,
          location_id: f.location_id || undefined,
          storage_area_id: f.storage_area_id || undefined,
          notes: f.notes.trim() || undefined,
          create_variant_group: true,
        };
        const result = await inventoryService.createSizeVariants(data);
        toast.success(`Created ${result.created_count} variant items`);
        onSaved();
        onClose();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to create variants'));
      } finally {
        setSaving(false);
      }
      return;
    }

    // Standard single-item path
    setSaving(true);
    try {
      // Create and edit want opposite things from a blank box, so the mode
      // decides once here rather than per field. On create a blank is omitted so
      // `""` never reaches a Pydantic validator; on edit it goes as an explicit
      // null, because the backend dumps update payloads with `exclude_unset` and
      // an omitted key means "leave this alone" — the clear was being lost
      // behind a success toast (CLAUDE.md pitfall #1).
      const isEdit = Boolean(editItem);
      const { text, pick, num } = formCoercions(isEdit);

      const p: InventoryItemCreate = {
        name: f.name.trim(),
        description: text(f.description),
        category_id: pick(f.category_id),
        serial_number: text(f.serial_number),
        asset_tag: text(f.asset_tag),
        barcode: text(f.barcode),
        size: text(f.size),
        color: text(f.color),
        purchase_price: num(f.purchase_price),
        current_value: num(f.current_value),
        purchase_date: pick(f.purchase_date),
        vendor: isEdit ? blankToNull(f.vendor) : f.vendor.trim() || undefined,
        vendor_id: f.vendor_id || (isEdit ? null : undefined),
        warranty_expiration: pick(f.warranty_expiration),
        replacement_cost: num(f.replacement_cost),
        location_id: pick(f.location_id),
        storage_area_id: pick(f.storage_area_id),
        unit_of_measure: text(f.unit_of_measure),
        reorder_point: num(f.reorder_point),
        inspection_interval_days: num(f.inspection_interval_days),
        notes: text(f.notes),
        // Deliberately omitted rather than nulled on edit, all three for
        // backend reasons rather than schema ones: `condition` is a NOT NULL
        // enum column, and `update_item` builds `ItemCondition(value)` and
        // compares `quantity < 0` for a pool item — both raise on None.
        // `tracking_type` re-shapes how the item is counted and is not a field
        // a blank box should clear.
        tracking_type: f.tracking_type || undefined,
        quantity: f.quantity ? Number(f.quantity) : undefined,
        condition: f.condition || undefined,
        // This form has no Status control, but the backend requires an
        // AVAILABLE item to be in excellent/good/fair condition — so the last
        // four options of the Condition dropdown above produced a 400 naming a
        // field that does not exist anywhere on the screen, with no way to
        // satisfy it. Derive the status the same way the service's
        // _status_from_condition does.
        //
        // Only when the item would otherwise be AVAILABLE: an ASSIGNED item
        // recorded as damaged is a legal pair, and overriding it here would
        // quietly pull a member's issued gear out of service on an unrelated
        // edit.
        ...(statusForUnsafeCondition(editItem?.status ?? 'available', f.condition) ?? {}),
      };
      if (editItem) {
        await inventoryService.updateItem(editItem.id, p);
        toast.success('Item updated');
      } else {
        await inventoryService.createItem(p);
        toast.success('Item created');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save item'));
    } finally {
      setSaving(false);
    }
  };

  const lbl = 'form-label';
  const inp = 'form-input';
  const chipBase =
    'inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer select-none border transition-colors';
  const chipOn = 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/40';
  const chipOff =
    'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border hover:border-theme-text-muted';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editItem ? 'Edit Item' : 'Add Item'}
      size="lg"
      footer={
        <>
          <button type="submit" form="item-form" disabled={saving} className="btn-info btn-md ml-2">
            {saving ? 'Saving...' : editItem ? 'Update' : generateVariants ? `Create ${variantCount} Items` : 'Create'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary btn-md">
            Cancel
          </button>
        </>
      }
    >
      <form id="item-form" onSubmit={(e) => void submit(e)} className="space-y-5">
        {/* Basic */}
        <fieldset>
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Basic Info</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={lbl} htmlFor="item-name">
                Name *
              </label>
              <input
                id="item-name"
                className={inp}
                value={f.name}
                onChange={(e) => up('name', e.target.value)}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl} htmlFor="item-description">
                Description
              </label>
              <textarea
                id="item-description"
                className={inp}
                rows={2}
                value={f.description}
                onChange={(e) => up('description', e.target.value)}
              />
            </div>
            <div>
              <label className={lbl} htmlFor="item-category_id">
                Category
              </label>
              <select
                id="item-category_id"
                className={inp}
                value={f.category_id}
                onChange={(e) => up('category_id', e.target.value)}
              >
                <option value="">-- Select --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={lbl} htmlFor="item-tracking_type">
                Tracking Type
              </label>
              <select
                id="item-tracking_type"
                className={inp}
                value={f.tracking_type}
                onChange={(e) => up('tracking_type', e.target.value)}
              >
                <option value="individual">Individual</option>
                <option value="pool">Pool</option>
              </select>
            </div>
          </div>
        </fieldset>

        {/* Identity — barcode is always available; serial/asset tag depend on category */}
        {!generateVariants && (
          <fieldset>
            <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Identity</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {has('serial_number') && (
                <div>
                  <label className={lbl} htmlFor="item-serial_number">
                    Serial #
                  </label>
                  <input
                    id="item-serial_number"
                    className={inp}
                    value={f.serial_number}
                    onChange={(e) => up('serial_number', e.target.value)}
                  />
                </div>
              )}
              {has('asset_tag') && (
                <div>
                  <label className={lbl} htmlFor="item-asset_tag">
                    Asset Tag
                  </label>
                  <input
                    id="item-asset_tag"
                    className={inp}
                    value={f.asset_tag}
                    onChange={(e) => up('asset_tag', e.target.value)}
                  />
                </div>
              )}
              <div>
                <label className={lbl} htmlFor="item-barcode">
                  Barcode
                </label>
                <input
                  id="item-barcode"
                  className={inp}
                  value={f.barcode}
                  onChange={(e) => up('barcode', e.target.value)}
                />
              </div>
            </div>
          </fieldset>
        )}

        {/* Generate Sizes & Styles toggle (new uniform/PPE items only) */}
        {supportsVariants && (
          <fieldset>
            <div className="mb-2">
              <label className="relative inline-flex min-h-[44px] cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={generateVariants}
                  onChange={(e) => setGenerateVariants(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="bg-theme-surface-secondary peer border-theme-surface-border h-5 w-9 rounded-full border peer-checked:bg-blue-500 after:absolute after:top-0.5 after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full dark:after:bg-gray-200" />
                <span className="text-theme-text-primary text-sm font-semibold">Generate Sizes &amp; Styles</span>
              </label>
            </div>
            {generateVariants && (
              <p className="text-theme-text-muted mb-3 text-xs">
                Select the sizes and styles below. One pool item will be created for each combination and grouped
                together automatically.
              </p>
            )}
          </fieldset>
        )}

        {/* Variant size/style selectors */}
        {generateVariants && (
          <fieldset className="space-y-4">
            {/* Sizes — a toggle-button group, so it is labelled as a group
                rather than with a <label> that names no single control. */}
            <div>
              <span className={lbl} id="item-sizes-label">
                Sizes *
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-labelledby="item-sizes-label">
                {STANDARD_SIZES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={`${chipBase} ${selectedSizes.includes(s.value) ? chipOn : chipOff}`}
                    onClick={() => toggleSize(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {selectedSizes.length > 0 && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  {selectedSizes.length} size{selectedSizes.length !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>

            {/* Styles */}
            <div>
              <span className={lbl} id="item-styles-label">
                Styles
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-labelledby="item-styles-label">
                {GARMENT_STYLES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={`${chipBase} ${selectedStyles.includes(s.value) ? chipOn : chipOff}`}
                    onClick={() => toggleStyle(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {selectedStyles.length > 0 && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  {selectedStyles.length} style{selectedStyles.length !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>

            {/* Colors (comma-separated text) */}
            <div>
              <label className={lbl} htmlFor="item-variant_colors">
                Colors
              </label>
              <input
                id="item-variant_colors"
                className={inp}
                value={variantColors}
                onChange={(e) => setVariantColors(e.target.value)}
                placeholder="e.g. Navy, White, Red (comma-separated, optional)"
              />
            </div>

            {/* Preview */}
            {variantCount > 0 && (
              <div className="border-theme-surface-border bg-theme-surface-secondary/50 rounded-lg border p-3">
                <p className="text-theme-text-primary text-sm font-medium">
                  {variantCount} item{variantCount !== 1 ? 's' : ''} will be created
                </p>
                <p className="text-theme-text-muted mt-0.5 text-xs">
                  {selectedSizes.length} size{selectedSizes.length !== 1 ? 's' : ''}
                  {selectedStyles.length > 0 &&
                    ` × ${selectedStyles.length} style${selectedStyles.length !== 1 ? 's' : ''}`}
                  {(() => {
                    const n = variantColors.split(',').filter((c) => c.trim()).length;
                    return n > 0 ? ` × ${n} color${n !== 1 ? 's' : ''}` : '';
                  })()}
                </p>
              </div>
            )}
          </fieldset>
        )}

        {/* Physical — only when NOT generating variants */}
        {!generateVariants && (has('size') || has('color')) && (
          <fieldset>
            <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Physical</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {has('size') && (
                <div>
                  <label className={lbl} htmlFor="item-size">
                    Size
                  </label>
                  <input id="item-size" className={inp} value={f.size} onChange={(e) => up('size', e.target.value)} />
                </div>
              )}
              {has('color') && (
                <div>
                  <label className={lbl} htmlFor="item-color">
                    Color
                  </label>
                  <input
                    id="item-color"
                    className={inp}
                    value={f.color}
                    onChange={(e) => up('color', e.target.value)}
                  />
                </div>
              )}
            </div>
          </fieldset>
        )}

        {/* Financial (collapsible) */}
        <fieldset>
          <button
            type="button"
            className="text-theme-text-primary mb-2 flex min-h-[44px] items-center gap-1 text-sm font-semibold"
            onClick={() => setShowFin(!showFin)}
          >
            Financial {showFin ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showFin && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={lbl} htmlFor="item-purchase_price">
                  Purchase Price
                </label>
                <input
                  id="item-purchase_price"
                  type="number"
                  step="0.01"
                  className={inp}
                  value={f.purchase_price}
                  onChange={(e) => up('purchase_price', e.target.value)}
                />
              </div>
              <div>
                <label className={lbl} htmlFor="item-current_value">
                  Current Value
                </label>
                <input
                  id="item-current_value"
                  type="number"
                  step="0.01"
                  className={inp}
                  value={f.current_value}
                  onChange={(e) => up('current_value', e.target.value)}
                />
              </div>
              <div>
                <label className={lbl} htmlFor="item-purchase_date">
                  Purchase Date
                </label>
                <input
                  id="item-purchase_date"
                  type="date"
                  className={inp}
                  value={f.purchase_date}
                  onChange={(e) => up('purchase_date', e.target.value)}
                />
              </div>
              <div>
                <label className={lbl} htmlFor="item-vendor">
                  Vendor
                </label>
                <select
                  id="item-vendor"
                  className={inp}
                  value={f.vendor_id}
                  onChange={(e) => {
                    const id = e.target.value;
                    // Linking wins over the typed-in name: keeping both would
                    // leave two answers to "who did we buy this from".
                    setF((p) => ({ ...p, vendor_id: id, vendor: id ? '' : p.vendor }));
                  }}
                >
                  <option value="">— Not linked —</option>
                  {vendors
                    .filter((v) => v.is_active || v.id === f.vendor_id)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                        {v.is_active ? '' : ' (inactive)'}
                      </option>
                    ))}
                </select>
                {!f.vendor_id && (
                  <input
                    className={`${inp} mt-2`}
                    value={f.vendor}
                    onChange={(e) => up('vendor', e.target.value)}
                    aria-label="Vendor name (not on file)"
                    placeholder="Or type a name not on file"
                  />
                )}
              </div>
              <div>
                <label className={lbl} htmlFor="item-warranty_expiration">
                  Warranty Expiration
                </label>
                <input
                  id="item-warranty_expiration"
                  type="date"
                  className={inp}
                  value={f.warranty_expiration}
                  onChange={(e) => up('warranty_expiration', e.target.value)}
                />
              </div>
              <div>
                <label className={lbl} htmlFor="item-replacement_cost">
                  Replacement Cost
                </label>
                <input
                  id="item-replacement_cost"
                  type="number"
                  step="0.01"
                  className={inp}
                  value={f.replacement_cost}
                  onChange={(e) => up('replacement_cost', e.target.value)}
                />
              </div>
            </div>
          )}
        </fieldset>

        {/* Location */}
        <fieldset>
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Location</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={lbl} htmlFor="item-location_id">
                Facility / Room
              </label>
              <select
                id="item-location_id"
                className={inp}
                value={f.location_id}
                onChange={(e) => {
                  up('location_id', e.target.value);
                  up('storage_area_id', '');
                }}
              >
                <option value="">-- Select --</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={lbl} htmlFor="item-storage_area_id">
                Storage Area
              </label>
              <select
                id="item-storage_area_id"
                className={inp}
                value={f.storage_area_id}
                onChange={(e) => up('storage_area_id', e.target.value)}
              >
                <option value="">-- Select --</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.label ? ` (${a.label})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        {/* Quantity (pool or variant generation) */}
        {(f.tracking_type === 'pool' || generateVariants) && (
          <fieldset>
            <legend className="text-theme-text-primary mb-2 text-sm font-semibold">
              {generateVariants ? 'Quantity Per Variant' : 'Quantity & Reorder'}
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={lbl} htmlFor="item-quantity">
                  {generateVariants ? 'Starting Quantity (each)' : 'Quantity'}
                </label>
                <input
                  id="item-quantity"
                  type="number"
                  min="0"
                  className={inp}
                  value={f.quantity}
                  onChange={(e) => up('quantity', e.target.value)}
                />
              </div>
              <div>
                <label className={lbl} htmlFor="item-unit_of_measure">
                  Unit of Measure
                </label>
                <input
                  id="item-unit_of_measure"
                  className={inp}
                  placeholder="e.g. pairs, boxes"
                  value={f.unit_of_measure}
                  onChange={(e) => up('unit_of_measure', e.target.value)}
                />
              </div>
              {!generateVariants && (
                <div>
                  <label className={lbl} htmlFor="item-reorder_point">
                    Reorder Point
                  </label>
                  <input
                    id="item-reorder_point"
                    type="number"
                    min="0"
                    className={inp}
                    value={f.reorder_point}
                    onChange={(e) => up('reorder_point', e.target.value)}
                    placeholder="Alert when qty falls to this level"
                  />
                  <p className="text-theme-text-muted mt-1 text-xs">Leave empty to disable item-level alerts</p>
                </div>
              )}
            </div>
          </fieldset>
        )}

        {/* Maintenance */}
        {!generateVariants && has('inspection_interval_days') && (
          <fieldset>
            <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Maintenance</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={lbl} htmlFor="item-inspection_interval_days">
                  Inspection Interval (days)
                </label>
                <input
                  id="item-inspection_interval_days"
                  type="number"
                  min="0"
                  className={inp}
                  value={f.inspection_interval_days}
                  onChange={(e) => up('inspection_interval_days', e.target.value)}
                />
              </div>
              <div>
                <label className={lbl} htmlFor="item-condition">
                  Condition
                </label>
                <select
                  id="item-condition"
                  className={inp}
                  value={f.condition}
                  onChange={(e) => up('condition', e.target.value)}
                >
                  {ITEM_CONDITION_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>
        )}

        {/* Notes */}
        <fieldset>
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Notes</legend>
          <textarea
            id="item-notes"
            aria-label="Notes"
            className={inp}
            rows={2}
            value={f.notes}
            onChange={(e) => up('notes', e.target.value)}
          />
        </fieldset>
      </form>
    </Modal>
  );
};
