/**
 * ItemFormModal — Reusable add/edit modal for inventory items.
 * Extracted so it can be used from both the items list page and the item detail page.
 */
import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ITEM_CONDITION_OPTIONS } from '../../../constants/enums';
import { Modal } from '../../../components/Modal';
import type {
  InventoryItem, InventoryCategory, InventoryItemCreate,
  StorageAreaResponse, Location,
} from '../types';
import { ITEM_TYPE_FIELDS, getItemTypeFromCategory } from '../types';

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

export const ItemFormModal: React.FC<ItemFormModalProps> = ({
  isOpen, onClose, onSaved, categories, locations, storageAreas, editItem,
}) => {
  const [f, setF] = useState<FD>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [showFin, setShowFin] = useState(false);

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
  }, [editItem, isOpen]);

  const cat = useMemo(() => categories.find((c) => c.id === f.category_id), [categories, f.category_id]);
  const tf = ITEM_TYPE_FIELDS[getItemTypeFromCategory(cat)] ?? [];
  const areas = useMemo(
    () => f.location_id ? storageAreas.filter((a) => a.location_id === f.location_id) : storageAreas,
    [storageAreas, f.location_id],
  );
  const has = (k: string) => tf.includes(k);
  const up = (k: keyof FD, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { toast.error('Name is required'); return; }
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editItem ? 'Edit Item' : 'Add Item'} size="lg"
      footer={<>
        <button type="submit" form="item-form" disabled={saving} className="btn-info btn-md ml-2">
          {saving ? 'Saving...' : editItem ? 'Update' : 'Create'}
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

        {/* Identity */}
        {(has('serial_number') || has('asset_tag')) && (
          <fieldset>
            <legend className="text-sm font-semibold text-theme-text-primary mb-2">Identity</legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {has('serial_number') && <div><label className={lbl}>Serial #</label><input className={inp} value={f.serial_number} onChange={(e) => up('serial_number', e.target.value)} /></div>}
              {has('asset_tag') && <div><label className={lbl}>Asset Tag</label><input className={inp} value={f.asset_tag} onChange={(e) => up('asset_tag', e.target.value)} /></div>}
              <div><label className={lbl}>Barcode</label><input className={inp} value={f.barcode} onChange={(e) => up('barcode', e.target.value)} /></div>
            </div>
          </fieldset>
        )}

        {/* Physical */}
        {(has('size') || has('color')) && (
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

        {/* Quantity (pool) */}
        {f.tracking_type === 'pool' && (
          <fieldset>
            <legend className="text-sm font-semibold text-theme-text-primary mb-2">Quantity &amp; Reorder</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={lbl}>Quantity</label><input type="number" min="0" className={inp} value={f.quantity} onChange={(e) => up('quantity', e.target.value)} /></div>
              <div><label className={lbl}>Unit of Measure</label><input className={inp} placeholder="e.g. pairs, boxes" value={f.unit_of_measure} onChange={(e) => up('unit_of_measure', e.target.value)} /></div>
              <div>
                <label className={lbl}>Reorder Point</label>
                <input type="number" min="0" className={inp} value={f.reorder_point} onChange={(e) => up('reorder_point', e.target.value)} placeholder="Alert when qty falls to this level" />
                <p className="text-xs text-theme-text-muted mt-1">Leave empty to disable item-level alerts</p>
              </div>
            </div>
          </fieldset>
        )}

        {/* Maintenance */}
        {has('inspection_interval_days') && (
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
