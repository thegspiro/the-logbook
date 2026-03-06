/**
 * InventoryItemsPage — Items listing with filtering, sorting, bulk ops,
 * real-time WebSocket updates, CSV export, and add/edit modal.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  RefreshCw, Search, ChevronUp, ChevronDown, Printer, Download,
  Archive, ArrowUpDown, Plus, Package, AlertTriangle, Wrench, ChevronRight,
} from 'lucide-react';
import { inventoryService, locationsService } from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ITEM_CONDITION_OPTIONS } from '../../../constants/enums';
import { useInventoryWebSocket } from '../../../hooks/useInventoryWebSocket';
import { MobileItemCard } from '../../../components/ux/MobileItemCard';
import { FloatingActionButton } from '../../../components/ux/FloatingActionButton';
import { Modal } from '../../../components/Modal';
import type {
  InventoryItem, InventoryCategory, InventorySummary,
  InventoryItemCreate, StorageAreaResponse, Location,
} from '../types';
import {
  STATUS_OPTIONS, ITEM_TYPES, ITEM_TYPE_FIELDS,
  getStatusStyle, getConditionColor, getItemTypeFromCategory,
} from '../types';

const PAGE_SIZE = 50;
const SORT_COLS = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'condition', label: 'Condition' },
  { key: 'created_at', label: 'Date Added' },
] as const;
type SortKey = (typeof SORT_COLS)[number]['key'];

function locLabel(item: InventoryItem, locs: Location[]): string {
  if (item.storage_location) return item.storage_location;
  if (item.location_id) return locs.find((l) => l.id === item.location_id)?.name ?? '';
  return item.station ?? '';
}

/* ------------------------------------------------------------------ */
/*  Item Form                                                          */
/* ------------------------------------------------------------------ */
interface FD {
  name: string; description: string; category_id: string; tracking_type: string;
  serial_number: string; asset_tag: string; barcode: string; size: string; color: string;
  purchase_price: string; purchase_date: string; vendor: string; warranty_expiration: string;
  replacement_cost: string; location_id: string; storage_area_id: string;
  quantity: string; unit_of_measure: string; inspection_interval_days: string;
  condition: string; notes: string;
}
const EMPTY: FD = {
  name: '', description: '', category_id: '', tracking_type: 'individual',
  serial_number: '', asset_tag: '', barcode: '', size: '', color: '',
  purchase_price: '', purchase_date: '', vendor: '', warranty_expiration: '',
  replacement_cost: '', location_id: '', storage_area_id: '',
  quantity: '1', unit_of_measure: '', inspection_interval_days: '',
  condition: 'good', notes: '',
};

interface FormProps {
  isOpen: boolean; onClose: () => void; onSaved: () => void;
  categories: InventoryCategory[]; locations: Location[];
  storageAreas: StorageAreaResponse[]; editItem?: InventoryItem | null;
}

const ItemFormModal: React.FC<FormProps> = ({
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
        purchase_date: editItem.purchase_date ?? '', vendor: editItem.vendor ?? '',
        warranty_expiration: editItem.warranty_expiration ?? '',
        replacement_cost: editItem.replacement_cost != null ? String(editItem.replacement_cost) : '',
        location_id: editItem.location_id ?? '', storage_area_id: editItem.storage_area_id ?? '',
        quantity: String(editItem.quantity), unit_of_measure: editItem.unit_of_measure ?? '',
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
        purchase_date: f.purchase_date || undefined,
        vendor: f.vendor.trim() || undefined,
        warranty_expiration: f.warranty_expiration || undefined,
        replacement_cost: f.replacement_cost ? Number(f.replacement_cost) : undefined,
        location_id: f.location_id || undefined,
        storage_area_id: f.storage_area_id || undefined,
        quantity: f.quantity ? Number(f.quantity) : undefined,
        unit_of_measure: f.unit_of_measure.trim() || undefined,
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
            <legend className="text-sm font-semibold text-theme-text-primary mb-2">Quantity</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={lbl}>Quantity</label><input type="number" min="0" className={inp} value={f.quantity} onChange={(e) => up('quantity', e.target.value)} /></div>
              <div><label className={lbl}>Unit of Measure</label><input className={inp} placeholder="e.g. pairs, boxes" value={f.unit_of_measure} onChange={(e) => up('unit_of_measure', e.target.value)} /></div>
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

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
const InventoryItemsPage: React.FC = () => {
  const navigate = useNavigate();
  const canManage = useAuthStore((s) => s.checkPermission)('inventory.manage');

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [storageAreas, setStorageAreas] = useState<StorageAreaResponse[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [fCat, setFCat] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fCond, setFCond] = useState('');
  const [fType, setFType] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [sortOrd, setSortOrd] = useState<'asc' | 'desc'>('asc');
  const [skip, setSkip] = useState(0);
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkNewStatus, setBulkNewStatus] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* ---- helpers ---- */
  const filterParams = useCallback(() => ({
    search: search.trim() || undefined,
    category_id: fCat || undefined,
    status: fStatus || undefined,
    condition: fCond || undefined,
    item_type: fType || undefined,
    sort_by: sortBy,
    sort_order: sortOrd,
  }), [search, fCat, fStatus, fCond, fType, sortBy, sortOrd]);

  const loadItems = useCallback(async (reset = false) => {
    const s = reset ? 0 : skip;
    try {
      const res = await inventoryService.getItems({ ...filterParams(), skip: s, limit: PAGE_SIZE });
      setItems(reset || s === 0 ? res.items : (prev) => [...prev, ...res.items]);
      setTotal(res.total);
      if (reset) setSkip(0);
    } catch (err: unknown) { toast.error(getErrorMessage(err, 'Failed to load items')); }
  }, [filterParams, skip]);

  const loadSummary = useCallback(async () => {
    try { setSummary(await inventoryService.getSummary()); } catch { /* non-critical */ }
  }, []);

  const loadRef = useCallback(async () => {
    try {
      const [c, l, a] = await Promise.all([
        inventoryService.getCategories(), locationsService.getLocations(),
        inventoryService.getStorageAreas({ flat: true }),
      ]);
      setCategories(c); setLocations(l); setStorageAreas(a);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    const go = async () => { setLoading(true); await Promise.all([loadItems(true), loadSummary(), loadRef()]); setLoading(false); };
    void go();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter / sort changes
  useEffect(() => {
    if (loading) return;
    void loadItems(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fCat, fStatus, fCond, fType, sortBy, sortOrd]);

  // Debounced search
  useEffect(() => {
    if (loading) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void loadItems(true), 350);
    return () => clearTimeout(timerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // WebSocket
  const onWs = useCallback(() => { void loadItems(true); void loadSummary(); }, [loadItems, loadSummary]);
  useInventoryWebSocket({ onEvent: onWs });

  /* ---- pagination ---- */
  const handleMore = async () => {
    const ns = skip + PAGE_SIZE; setSkip(ns); setLoadingMore(true);
    try {
      const res = await inventoryService.getItems({ ...filterParams(), skip: ns, limit: PAGE_SIZE });
      setItems((prev) => [...prev, ...res.items]); setTotal(res.total);
    } catch (err: unknown) { toast.error(getErrorMessage(err, 'Failed to load more')); }
    finally { setLoadingMore(false); }
  };

  /* ---- sorting ---- */
  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setSortOrd((p) => p === 'asc' ? 'desc' : 'asc');
    else { setSortBy(k); setSortOrd('asc'); }
  };
  const SortIc: React.FC<{ col: SortKey }> = ({ col }) => {
    if (sortBy !== col) return <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />;
    return sortOrd === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />;
  };

  /* ---- selection ---- */
  const toggle = (id: string) => setSelIds((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelIds(selIds.size === items.length ? new Set() : new Set(items.map((i) => i.id)));

  /* ---- bulk ops ---- */
  const printLabels = () => navigate(`/inventory/print-labels?ids=${Array.from(selIds).join(',')}`);

  const bulkRetire = async () => {
    if (!confirm(`Retire ${selIds.size} item(s)? This cannot be undone.`)) return;
    try {
      await Promise.all(Array.from(selIds).map((id) => inventoryService.retireItem(id)));
      toast.success(`${selIds.size} item(s) retired`); setSelIds(new Set());
      void loadItems(true); void loadSummary();
    } catch (err: unknown) { toast.error(getErrorMessage(err, 'Failed to retire items')); }
  };

  const bulkStatus = async () => {
    if (!bulkNewStatus) return; setBulkSaving(true);
    try {
      await Promise.all(Array.from(selIds).map((id) => inventoryService.updateItem(id, { status: bulkNewStatus })));
      toast.success(`Updated ${selIds.size} item(s)`); setSelIds(new Set());
      setBulkStatusOpen(false); setBulkNewStatus('');
      void loadItems(true); void loadSummary();
    } catch (err: unknown) { toast.error(getErrorMessage(err, 'Failed to update')); }
    finally { setBulkSaving(false); }
  };

  /* ---- export ---- */
  const exportCsv = async () => {
    try {
      const blob = await inventoryService.exportItemsCsv({
        category_id: fCat || undefined, status: fStatus || undefined, search: search.trim() || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `inventory-items-${new Date().toISOString().split('T')[0] ?? 'export'}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast.success('CSV exported');
    } catch (err: unknown) { toast.error(getErrorMessage(err, 'Export failed')); }
  };

  const refresh = () => { setSelIds(new Set()); void loadItems(true); void loadSummary(); };
  const openAdd = () => { setEditItem(null); setModalOpen(true); };
  const openEdit = (it: InventoryItem) => { setEditItem(it); setModalOpen(true); };
  const onSaved = () => { void loadItems(true); void loadSummary(); };

  const fabActions = useMemo(() => {
    const a = [];
    if (canManage) a.push({ id: 'add', label: 'Add Item', icon: <Plus className="w-5 h-5" />, onClick: openAdd, color: 'bg-emerald-600' });
    a.push({ id: 'export', label: 'Export CSV', icon: <Download className="w-5 h-5" />, onClick: () => void exportCsv(), color: 'bg-blue-600' });
    return a;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const hasMore = items.length < total;

  /* ================================================================ */
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">Inventory Items</h1>
          {summary && (
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-theme-text-muted">
              <span className="flex items-center gap-1.5"><Package className="w-4 h-4" /> {summary.total_items} items</span>
              <span className="flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {summary.overdue_checkouts} overdue</span>
              <span className="flex items-center gap-1.5"><Wrench className="w-4 h-4" /> {summary.maintenance_due_count} maint. due</span>
              {summary.total_value > 0 && <span>${summary.total_value.toLocaleString()}</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="btn-secondary btn-icon-sm" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => void exportCsv()} className="btn-secondary btn-md hidden sm:inline-flex items-center gap-2">
            <Download className="w-4 h-4" /> Export
          </button>
          {canManage && (
            <button onClick={openAdd} className="btn-info btn-md hidden sm:inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Item
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="card-secondary p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
            <input type="text" placeholder="Search items..." className="form-input pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="form-input" value={fCat} onChange={(e) => setFCat(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="form-input" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="form-input" value={fCond} onChange={(e) => setFCond(e.target.value)}>
            <option value="">All Conditions</option>
            {ITEM_CONDITION_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select className="form-input" value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="">All Types</option>
            {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {/* Bulk bar */}
      {selIds.size > 0 && (
        <div className="card-secondary p-3 mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-theme-text-primary">{selIds.size} selected</span>
          <button onClick={printLabels} className="btn-secondary btn-sm inline-flex items-center gap-1.5"><Printer className="w-3.5 h-3.5" /> Print Labels</button>
          <button onClick={() => setBulkStatusOpen(true)} className="btn-secondary btn-sm inline-flex items-center gap-1.5"><ArrowUpDown className="w-3.5 h-3.5" /> Change Status</button>
          {canManage && <button onClick={() => void bulkRetire()} className="btn-sm px-2.5 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-700 inline-flex items-center gap-1.5"><Archive className="w-3.5 h-3.5" /> Retire</button>}
          <button onClick={() => setSelIds(new Set())} className="text-xs text-theme-text-muted hover:text-theme-text-primary ml-auto">Clear</button>
        </div>
      )}

      {/* Bulk status modal */}
      <Modal isOpen={bulkStatusOpen} onClose={() => setBulkStatusOpen(false)} title="Bulk Status Change" size="sm"
        footer={<>
          <button onClick={() => void bulkStatus()} disabled={!bulkNewStatus || bulkSaving} className="btn-info btn-md ml-2">{bulkSaving ? 'Updating...' : 'Apply'}</button>
          <button onClick={() => setBulkStatusOpen(false)} className="btn-secondary btn-md">Cancel</button>
        </>}
      >
        <p className="text-sm text-theme-text-secondary mb-3">Set status for {selIds.size} item(s):</p>
        <select className="form-input" value={bulkNewStatus} onChange={(e) => setBulkNewStatus(e.target.value)}>
          <option value="">-- Select Status --</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Modal>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card-secondary p-4 animate-pulse">
              <div className="h-4 bg-theme-surface-hover rounded w-1/3 mb-2" />
              <div className="h-3 bg-theme-surface-hover rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && items.length === 0 && (
        <div className="text-center py-16">
          <Package className="w-12 h-12 mx-auto text-theme-text-muted mb-4" />
          <h3 className="text-lg font-medium text-theme-text-primary mb-1">No items found</h3>
          <p className="text-sm text-theme-text-muted mb-4">
            {search || fCat || fStatus || fCond || fType ? 'Try adjusting your filters.' : 'Get started by adding your first inventory item.'}
          </p>
          {canManage && <button onClick={openAdd} className="btn-info btn-md inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Add Item</button>}
        </div>
      )}

      {/* Desktop table */}
      {!loading && items.length > 0 && (
        <div className="hidden md:block card-secondary overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-theme-surface-border">
                <th className="px-3 py-3 text-left w-10">
                  <input type="checkbox" checked={selIds.size === items.length && items.length > 0} onChange={toggleAll} className="form-checkbox" aria-label="Select all" />
                </th>
                {SORT_COLS.map((c) => (
                  <th key={c.key} className="px-3 py-3 text-left">
                    <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 text-theme-text-secondary hover:text-theme-text-primary font-medium">
                      {c.label} <SortIc col={c.key} />
                    </button>
                  </th>
                ))}
                <th className="px-3 py-3 text-left text-theme-text-secondary font-medium">Category</th>
                <th className="px-3 py-3 text-left text-theme-text-secondary font-medium">Tracking</th>
                <th className="px-3 py-3 text-left text-theme-text-secondary font-medium">Serial / Tag</th>
                <th className="px-3 py-3 text-left text-theme-text-secondary font-medium">Location</th>
                <th className="px-3 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-surface-border">
              {items.map((item) => {
                const c = categories.find((ct) => ct.id === item.category_id);
                const loc = locLabel(item, locations);
                const ids = [item.serial_number, item.asset_tag].filter(Boolean).join(' / ');
                return (
                  <tr key={item.id} className={`hover:bg-theme-surface-hover transition-colors ${selIds.has(item.id) ? 'bg-theme-surface-hover/50' : ''}`}>
                    <td className="px-3 py-3"><input type="checkbox" checked={selIds.has(item.id)} onChange={() => toggle(item.id)} className="form-checkbox" aria-label={`Select ${item.name}`} /></td>
                    <td className="px-3 py-3"><Link to={`/inventory/items/${item.id}`} className="font-medium text-theme-text-primary hover:text-blue-600 dark:hover:text-blue-400">{item.name}</Link></td>
                    <td className="px-3 py-3"><span className={`inline-flex px-2 py-0.5 text-[11px] font-semibold rounded-sm border ${getStatusStyle(item.status)}`}>{item.status.replace(/_/g, ' ').toUpperCase()}</span></td>
                    <td className={`px-3 py-3 capitalize ${getConditionColor(item.condition)}`}>{item.condition.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-3 text-theme-text-muted">{c?.name ?? ''}</td>
                    <td className="px-3 py-3 text-theme-text-muted capitalize">{item.tracking_type}</td>
                    <td className="px-3 py-3 text-theme-text-muted font-mono text-xs">{ids || '-'}</td>
                    <td className="px-3 py-3 text-theme-text-muted truncate max-w-[160px]">{loc || '-'}</td>
                    <td className="px-3 py-3"><Link to={`/inventory/items/${item.id}`} className="text-theme-text-muted hover:text-theme-text-primary" aria-label={`View ${item.name}`}><ChevronRight className="w-4 h-4" /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile cards */}
      {!loading && items.length > 0 && (
        <div className="md:hidden space-y-3">
          {items.map((item) => {
            const c = categories.find((ct) => ct.id === item.category_id);
            const loc = locLabel(item, locations);
            return (
              <MobileItemCard key={item.id} name={item.name} status={item.status}
                statusStyle={getStatusStyle(item.status)} condition={item.condition}
                conditionColor={getConditionColor(item.condition)} category={c?.name}
                serialNumber={item.serial_number} assetTag={item.asset_tag}
                size={item.size} color={item.color} location={loc || undefined}
                manufacturer={[item.manufacturer, item.model_number].filter(Boolean).join(' ') || undefined}
                quantity={item.tracking_type === 'pool' ? item.quantity : undefined}
                selected={selIds.has(item.id)} onSelect={() => toggle(item.id)}
                onTap={() => navigate(`/inventory/items/${item.id}`)}
                showActions={canManage} onEdit={() => openEdit(item)}
                canRetire={item.status !== 'retired'}
                onRetire={() => { void inventoryService.retireItem(item.id).then(() => { toast.success(`${item.name} retired`); void loadItems(true); void loadSummary(); }); }}
              />
            );
          })}
        </div>
      )}

      {/* Load more */}
      {!loading && hasMore && (
        <div className="flex justify-center mt-6">
          <button onClick={() => void handleMore()} disabled={loadingMore} className="btn-secondary btn-md inline-flex items-center gap-2">
            {loadingMore ? <><RefreshCw className="w-4 h-4 animate-spin" /> Loading...</> : <>Load More ({items.length} of {total})</>}
          </button>
        </div>
      )}

      {/* Item form modal */}
      <ItemFormModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSaved={onSaved}
        categories={categories} locations={locations} storageAreas={storageAreas} editItem={editItem} />

      {/* Mobile FAB */}
      <FloatingActionButton actions={fabActions} />
    </div>
  );
};

export default InventoryItemsPage;
