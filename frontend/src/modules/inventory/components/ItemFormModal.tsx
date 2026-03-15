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
import { ITEM_CONDITION_OPTIONS } from '../../../constants/enums';
import { Modal } from '../../../components/Modal';
import type {
  InventoryItem, InventoryCategory, InventoryItemCreate,
  StorageAreaResponse, Location, SizeVariantCreate,
} from '../types';
import {
  ITEM_TYPE_FIELDS, getItemTypeFromCategory,
  STANDARD_SIZES, GARMENT_STYLES,
} from '../types';

interface FD {
  name: string; description: string; category_id: string; tracking_type: string;
  serial_number: string; asset_tag: string; barcode: string; size: string; color: string;
  purchase_price: string; current_value: string; purchase_date: string; vendor: string; warranty_expiration: string;
  replacement_cost: string; location_id: string; storage_area_id: string;
  quantity: string; unit_of_measure: string; reorder_point: string; inspection_interval_days: string;
  condition: string; notes: string;
}

const EMPTY: FD = {
  name: '', description: '', category_id: '', tracking_type: 'individual',
  serial_number: '', asset_tag: '', barcode: '', size: '', color: '',
  purchase_price: '', current_value: '', purchase_date: '', vendor: '', warranty_expiration: '',
  replacement_cost: '', location_id: '', storage_area_id: '',
  quantity: '1', unit_of_measure: '', reorder_point: '', inspection_interval_days: '',
  condition: 'good', notes: '',
};

export interface ItemFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  categories: InventoryCategory[];
  locations: Location[];
  storageAreas: StorageAreaResponse[];
  editItem?: InventoryItem | null;
}

/** Categories that support size/style variant generation */
const VARIANT_ITEM_TYPES = new Set(['uniform', 'ppe']);

export const ItemFormModal: React.FC<ItemFormModalProps> = ({
  isOpen, onClose, onSaved, categories, locations, storageAreas, editItem,
}) => {
  const [f, setF] = useState<FD>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [showFin, setShowFin] = useState(false);

  // Variant generation state (only for new items)
  const [generateVariants, setGenerateVariants] = useState(false);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [variantColors, setVariantColors] = useState('');

  useEffect(() => {
    if (editItem) {
      setF({
        name: editItem.name, description: editItem.description ?? '',
        category_id: editItem.category_id ?? '', tracking_type: editItem.tracking_type,
        serial_number: editItem.serial_number ?? '', asset_tag: editItem.asset_tag ?? '',
        barcode: editItem.barcode ?? '', size: editItem.size ?? '', color: editItem.color ?? '',
        purchase_price: editItem.purchase_price != null ? String(editItem.purchase_price) : '',
        current_value: editItem.current_value != null ? String(editItem.current_value) : '',
        purchase_date: editItem.purchase_date ?? '', vendor: editItem.vendor ?? '',
        warranty_expiration: editItem.warranty_expiration ?? '',
        replacement_cost: editItem.replacement_cost != null ? String(editItem.replacement_cost) : '',
        location_id: editItem.location_id ?? '', storage_area_id: editItem.storage_area_id ?? '',
        quantity: String(editItem.quantity), unit_of_measure: editItem.unit_of_measure ?? '',
        reorder_point: editItem.reorder_point != null ? String(editItem.reorder_point) : '',
        inspection_interval_days: editItem.inspection_interval_days != null
          ? String(editItem.inspection_interval_days) : '',
        condition: editItem.condition, notes: editItem.notes ?? '',
      });
    } else { setF(EMPTY); }
    setShowFin(false);
    setGenerateVariants(false);
    setSelectedSizes([]);
    setSelectedStyles([]);
    setVariantColors('');
  }, [editItem, isOpen]);

  const cat = useMemo(() => categories.find((c) => c.id === f.category_id), [categories, f.category_id]);
  const itemType = getItemTypeFromCategory(cat);
  const tf = ITEM_TYPE_FIELDS[itemType] ?? [];
  const areas = useMemo(
    () => f.location_id ? storageAreas.filter((a) => a.location_id === f.location_id) : storageAreas,
    [storageAreas, f.location_id],
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
    setSelectedSizes((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );
  }, []);

  const toggleStyle = useCallback((value: string) => {
    setSelectedStyles((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );
  }, []);

  /** Compute how many items will be generated for the preview label */
  const variantCount = useMemo(() => {
    if (!generateVariants || selectedSizes.length === 0) return 0;
    const colorList = variantColors.split(',').map((c) => c.trim()).filter(Boolean);
    const colorMult = colorList.length || 1;
    const styleMult = selectedStyles.length || 1;
    return selectedSizes.length * colorMult * styleMult;
  }, [generateVariants, selectedSizes, selectedStyles, variantColors]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { toast.error('Name is required'); return; }

    // Variant generation path
    if (generateVariants) {
      if (selectedSizes.length === 0) { toast.error('Select at least one size'); return; }
      setSaving(true);
      try {
        const colorList = variantColors.split(',').map((c) => c.trim()).filter(Boolean);
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
        onSaved(); onClose();
      } catch (err: unknown) { toast.error(getErrorMessage(err, 'Failed to create variants')); }
      finally { setSaving(false); }
      return;
    }

    // Standard single-item path
    setSaving(true);
    try {
      const p: InventoryItemCreate = {
        name: f.name.trim(),
        description: f.description.trim() || undefined,
        category_id: f.category_id || undefined,
        tracking_type: f.tracking_type || undefined,
        serial_number: f.serial_number.trim() || undefined,
        asset_tag: f.asset_tag.trim() || undefined,
        barcode: f.barcode.trim() || undefined,
        size: f.size.trim() || undefined,
        color: f.color.trim() || undefined,
        purchase_price: f.purchase_price ? Number(f.purchase_price) : undefined,
        current_value: f.current_value ? Number(f.current_value) : undefined,
        purchase_date: f.purchase_date || undefined,
        vendor: f.vendor.trim() || undefined,
        warranty_expiration: f.warranty_expiration || undefined,
        replacement_cost: f.replacement_cost ? Number(f.replacement_cost) : undefined,
        location_id: f.location_id || undefined,
        storage_area_id: f.storage_area_id || undefined,
        quantity: f.quantity ? Number(f.quantity) : undefined,
        unit_of_measure: f.unit_of_measure.trim() || undefined,
        reorder_point: f.reorder_point ? Number(f.reorder_point) : undefined,
        inspection_interval_days: f.inspection_interval_days ? Number(f.inspection_interval_days) : undefined,
        condition: f.condition || undefined,
        notes: f.notes.trim() || undefined,
      };
      if (editItem) { await inventoryService.updateItem(editItem.id, p); toast.success('Item updated'); }
      else { await inventoryService.createItem(p); toast.success('Item created'); }
      onSaved(); onClose();
    } catch (err: unknown) { toast.error(getErrorMessage(err, 'Failed to save item')); }
    finally { setSaving(false); }
  };

  const lbl = 'form-label';
  const inp = 'form-input';
  const chipBase = 'inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer select-none border transition-colors';
  const chipOn = 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/40';
  const chipOff = 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border hover:border-theme-text-muted';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editItem ? 'Edit Item' : 'Add Item'} size="lg"
      footer={<>
        <button type="submit" form="item-form" disabled={saving} className="btn-info btn-md ml-2">
          {saving ? 'Saving...' : editItem ? 'Update' : generateVariants ? `Create ${variantCount} Items` : 'Create'}
        </button>
        <button type="button" onClick={onClose} className="btn-secondary btn-md">Cancel</button>
      </>}
    >
      <form id="item-form" onSubmit={(e) => void submit(e)} className="space-y-5">
        {/* Basic */}
        <fieldset>
          <legend className="text-sm font-semibold text-theme-text-primary mb-2">Basic Info</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className={lbl}>Name *</label>
              <input className={inp} value={f.name} onChange={(e) => up('name', e.target.value)} required />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Description</label>
              <textarea className={inp} rows={2} value={f.description} onChange={(e) => up('description', e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Category</label>
              <select className={inp} value={f.category_id} onChange={(e) => up('category_id', e.target.value)}>
                <option value="">-- Select --</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Tracking Type</label>
              <select className={inp} value={f.tracking_type} onChange={(e) => up('tracking_type', e.target.value)}>
                <option value="individual">Individual</option>
                <option value="pool">Pool</option>
              </select>
            </div>
          </div>
        </fieldset>

        {/* Identity — barcode is always available; serial/asset tag depend on category */}
        {!generateVariants && (
          <fieldset>
            <legend className="text-sm font-semibold text-theme-text-primary mb-2">Identity</legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {has('serial_number') && <div><label className={lbl}>Serial #</label><input className={inp} value={f.serial_number} onChange={(e) => up('serial_number', e.target.value)} /></div>}
              {has('asset_tag') && <div><label className={lbl}>Asset Tag</label><input className={inp} value={f.asset_tag} onChange={(e) => up('asset_tag', e.target.value)} /></div>}
              <div><label className={lbl}>Barcode</label><input className={inp} value={f.barcode} onChange={(e) => up('barcode', e.target.value)} /></div>
            </div>
          </fieldset>
        )}

        {/* Generate Sizes & Styles toggle (new uniform/PPE items only) */}
        {supportsVariants && (
          <fieldset>
            <div className="flex items-center gap-2 mb-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={generateVariants}
                  onChange={(e) => setGenerateVariants(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-theme-surface-secondary rounded-full peer peer-checked:bg-blue-500 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white dark:after:bg-gray-200 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full border border-theme-surface-border" />
              </label>
              <span className="text-sm font-semibold text-theme-text-primary">
                Generate Sizes &amp; Styles
              </span>
            </div>
            {generateVariants && (
              <p className="text-xs text-theme-text-muted mb-3">
                Select the sizes and styles below. One pool item will be created for each combination and grouped together automatically.
              </p>
            )}
          </fieldset>
        )}

        {/* Variant size/style selectors */}
        {generateVariants && (
          <fieldset className="space-y-4">
            {/* Sizes */}
            <div>
              <label className={lbl}>Sizes *</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {STANDARD_SIZES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={`${chipBase} ${selectedSizes.includes(s.label) ? chipOn : chipOff}`}
                    onClick={() => toggleSize(s.label)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {selectedSizes.length > 0 && (
                <p className="text-xs text-theme-text-muted mt-1">
                  {selectedSizes.length} size{selectedSizes.length !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>

            {/* Styles */}
            <div>
              <label className={lbl}>Styles</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
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
                <p className="text-xs text-theme-text-muted mt-1">
                  {selectedStyles.length} style{selectedStyles.length !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>

            {/* Colors (comma-separated text) */}
            <div>
              <label className={lbl}>Colors</label>
              <input
                className={inp}
                value={variantColors}
                onChange={(e) => setVariantColors(e.target.value)}
                placeholder="e.g. Navy, White, Red (comma-separated, optional)"
              />
            </div>

            {/* Preview */}
            {variantCount > 0 && (
              <div className="rounded-lg border border-theme-surface-border bg-theme-surface-secondary/50 p-3">
                <p className="text-sm font-medium text-theme-text-primary">
                  {variantCount} item{variantCount !== 1 ? 's' : ''} will be created
                </p>
                <p className="text-xs text-theme-text-muted mt-0.5">
                  {selectedSizes.length} size{selectedSizes.length !== 1 ? 's' : ''}
                  {selectedStyles.length > 0 && ` × ${selectedStyles.length} style${selectedStyles.length !== 1 ? 's' : ''}`}
                  {variantColors.split(',').filter((c) => c.trim()).length > 0 && ` × ${variantColors.split(',').filter((c) => c.trim()).length} color${variantColors.split(',').filter((c) => c.trim()).length !== 1 ? 's' : ''}`}
                </p>
              </div>
            )}
          </fieldset>
        )}

        {/* Physical — only when NOT generating variants */}
        {!generateVariants && (has('size') || has('color')) && (
          <fieldset>
            <legend className="text-sm font-semibold text-theme-text-primary mb-2">Physical</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {has('size') && <div><label className={lbl}>Size</label><input className={inp} value={f.size} onChange={(e) => up('size', e.target.value)} /></div>}
              {has('color') && <div><label className={lbl}>Color</label><input className={inp} value={f.color} onChange={(e) => up('color', e.target.value)} /></div>}
            </div>
          </fieldset>
        )}

        {/* Financial (collapsible) */}
        <fieldset>
          <button type="button" className="flex items-center gap-1 text-sm font-semibold text-theme-text-primary mb-2" onClick={() => setShowFin(!showFin)}>
            Financial {showFin ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showFin && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={lbl}>Purchase Price</label><input type="number" step="0.01" className={inp} value={f.purchase_price} onChange={(e) => up('purchase_price', e.target.value)} /></div>
              <div><label className={lbl}>Current Value</label><input type="number" step="0.01" className={inp} value={f.current_value} onChange={(e) => up('current_value', e.target.value)} /></div>
              <div><label className={lbl}>Purchase Date</label><input type="date" className={inp} value={f.purchase_date} onChange={(e) => up('purchase_date', e.target.value)} /></div>
              <div><label className={lbl}>Vendor</label><input className={inp} value={f.vendor} onChange={(e) => up('vendor', e.target.value)} /></div>
              <div><label className={lbl}>Warranty Expiration</label><input type="date" className={inp} value={f.warranty_expiration} onChange={(e) => up('warranty_expiration', e.target.value)} /></div>
              <div><label className={lbl}>Replacement Cost</label><input type="number" step="0.01" className={inp} value={f.replacement_cost} onChange={(e) => up('replacement_cost', e.target.value)} /></div>
            </div>
          )}
        </fieldset>

        {/* Location */}
        <fieldset>
          <legend className="text-sm font-semibold text-theme-text-primary mb-2">Location</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Facility / Room</label>
              <select className={inp} value={f.location_id} onChange={(e) => { up('location_id', e.target.value); up('storage_area_id', ''); }}>
                <option value="">-- Select --</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Storage Area</label>
              <select className={inp} value={f.storage_area_id} onChange={(e) => up('storage_area_id', e.target.value)}>
                <option value="">-- Select --</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}{a.label ? ` (${a.label})` : ''}</option>)}
              </select>
            </div>
          </div>
        </fieldset>

        {/* Quantity (pool or variant generation) */}
        {(f.tracking_type === 'pool' || generateVariants) && (
          <fieldset>
            <legend className="text-sm font-semibold text-theme-text-primary mb-2">
              {generateVariants ? 'Quantity Per Variant' : 'Quantity & Reorder'}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={lbl}>{generateVariants ? 'Starting Quantity (each)' : 'Quantity'}</label>
                <input type="number" min="0" className={inp} value={f.quantity} onChange={(e) => up('quantity', e.target.value)} />
              </div>
              <div><label className={lbl}>Unit of Measure</label><input className={inp} placeholder="e.g. pairs, boxes" value={f.unit_of_measure} onChange={(e) => up('unit_of_measure', e.target.value)} /></div>
              {!generateVariants && (
                <div>
                  <label className={lbl}>Reorder Point</label>
                  <input type="number" min="0" className={inp} value={f.reorder_point} onChange={(e) => up('reorder_point', e.target.value)} placeholder="Alert when qty falls to this level" />
                  <p className="text-xs text-theme-text-muted mt-1">Leave empty to disable item-level alerts</p>
                </div>
              )}
            </div>
          </fieldset>
        )}

        {/* Maintenance */}
        {!generateVariants && has('inspection_interval_days') && (
          <fieldset>
            <legend className="text-sm font-semibold text-theme-text-primary mb-2">Maintenance</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={lbl}>Inspection Interval (days)</label><input type="number" min="0" className={inp} value={f.inspection_interval_days} onChange={(e) => up('inspection_interval_days', e.target.value)} /></div>
              <div>
                <label className={lbl}>Condition</label>
                <select className={inp} value={f.condition} onChange={(e) => up('condition', e.target.value)}>
                  {ITEM_CONDITION_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
          </fieldset>
        )}

        {/* Notes */}
        <fieldset>
          <legend className="text-sm font-semibold text-theme-text-primary mb-2">Notes</legend>
          <textarea className={inp} rows={2} value={f.notes} onChange={(e) => up('notes', e.target.value)} />
        </fieldset>
      </form>
    </Modal>
  );
};
