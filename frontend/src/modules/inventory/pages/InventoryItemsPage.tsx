/**
 * InventoryItemsPage — Items listing with filtering, sorting, bulk ops,
 * real-time WebSocket updates, CSV export, and add/edit modal.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft, RefreshCw, Search, ChevronUp, ChevronDown, Printer, Download,
  Archive, ArrowUpDown, Plus, Package, AlertTriangle, Wrench, ChevronRight, MapPin, UserPlus,
} from 'lucide-react';
import { inventoryService, locationsService } from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { getTodayLocalDate, formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ITEM_CONDITION_OPTIONS } from '../../../constants/enums';
import { useInventoryWebSocket } from '../../../hooks/useInventoryWebSocket';
import { MobileItemCard } from '../../../components/ux/MobileItemCard';
import { FloatingActionButton } from '../../../components/ux/FloatingActionButton';
import { Modal } from '../../../components/Modal';
import { ItemFormModal } from '../components/ItemFormModal';
import type {
  InventoryItem, InventoryCategory, InventorySummary, LocationInventorySummary,
  StorageAreaResponse, Location,
} from '../types';
import {
  STATUS_OPTIONS, ITEM_TYPES,
  getStatusStyle, getConditionColor,
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
/*  Page                                                               */
/* ------------------------------------------------------------------ */
const InventoryItemsPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const canManage = useAuthStore((s) => s.checkPermission)('inventory.manage');

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [storageAreas, setStorageAreas] = useState<StorageAreaResponse[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [locSummary, setLocSummary] = useState<LocationInventorySummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [fCat, setFCat] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fCond, setFCond] = useState('');
  const [fType, setFType] = useState('');
  const [fLoc, setFLoc] = useState('');
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
    location_id: fLoc || undefined,
    sort_by: sortBy,
    sort_order: sortOrd,
  }), [search, fCat, fStatus, fCond, fType, fLoc, sortBy, sortOrd]);

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
    try {
      const [s, ls] = await Promise.all([
        inventoryService.getSummary(),
        inventoryService.getSummaryByLocation(),
      ]);
      setSummary(s);
      setLocSummary(ls);
    } catch { /* non-critical */ }
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
      a.href = url; a.download = `inventory-items-${getTodayLocalDate(tz)}.csv`;
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
    if (canManage) a.push({ id: 'assign', label: 'Assign Items', icon: <UserPlus className="w-5 h-5" />, onClick: () => navigate('/inventory/admin/members'), color: 'bg-blue-600' });
    return a;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const hasMore = items.length < total;

  /* ================================================================ */
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <Link to="/inventory/admin" className="text-sm text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 mb-6">
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">Inventory Items</h1>
          {summary && (
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-theme-text-muted">
              <span className="flex items-center gap-1.5"><Package className="w-4 h-4" /> {summary.total_items} items</span>
              <span className="flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {summary.overdue_checkouts} overdue</span>
              <span className="flex items-center gap-1.5"><Wrench className="w-4 h-4" /> {summary.maintenance_due_count} maint. due</span>
              {summary.total_value > 0 && <span>${formatNumber(summary.total_value)}</span>}
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

      {/* Location summary */}
      {locSummary.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          {locSummary.map((loc) => (
            <button
              key={loc.location_id ?? 'unassigned'}
              onClick={() => { setFLoc(loc.location_id ?? ''); }}
              className={`card-secondary p-3 text-left hover:bg-theme-surface-hover transition-colors ${fLoc === (loc.location_id ?? '') ? 'ring-2 ring-blue-500' : ''}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <MapPin className="w-3.5 h-3.5 text-theme-text-muted shrink-0" />
                <span className="text-xs font-medium text-theme-text-primary truncate">{loc.location_name}</span>
              </div>
              <div className="text-lg font-bold text-theme-text-primary">{loc.total_quantity}</div>
              <div className="text-xs text-theme-text-muted">
                {loc.item_count} item{loc.item_count !== 1 ? 's' : ''}
                {loc.total_value > 0 && <span className="ml-1">&middot; ${formatNumber(loc.total_value, { maximumFractionDigits: 0 })}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="card-secondary p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
            <input type="text" aria-label="Search items..." placeholder="Search items..." className="form-input pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
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
          <select className="form-input" value={fLoc} onChange={(e) => setFLoc(e.target.value)}>
            <option value="">All Locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>

      {/* Bulk bar */}
      {selIds.size > 0 && (
        <div className="card-secondary p-3 mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-theme-text-primary">{selIds.size} selected</span>
          <button onClick={printLabels} className="btn-secondary btn-sm inline-flex items-center gap-1.5"><Printer className="w-3.5 h-3.5" /> Print Labels</button>
          <button onClick={() => setBulkStatusOpen(true)} className="btn-secondary btn-sm inline-flex items-center gap-1.5"><ArrowUpDown className="w-3.5 h-3.5" /> Change Status</button>
          {canManage && <button onClick={() => void bulkRetire()} className="btn-primary btn-sm inline-flex items-center gap-1.5"><Archive className="w-3.5 h-3.5" /> Retire</button>}
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
            {search || fCat || fStatus || fCond || fType || fLoc ? 'Try adjusting your filters.' : 'Get started by adding your first inventory item.'}
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
                <th scope="col" className="px-3 py-3 text-left w-10">
                  <input type="checkbox" checked={selIds.size === items.length && items.length > 0} onChange={toggleAll} className="form-checkbox" aria-label="Select all" />
                </th>
                {SORT_COLS.map((c) => (
                  <th key={c.key} className="px-3 py-3 text-left">
                    <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 text-theme-text-secondary hover:text-theme-text-primary font-medium">
                      {c.label} <SortIc col={c.key} />
                    </button>
                  </th>
                ))}
                <th scope="col" className="px-3 py-3 text-left text-theme-text-secondary font-medium">Category</th>
                <th scope="col" className="px-3 py-3 text-left text-theme-text-secondary font-medium">Tracking</th>
                <th scope="col" className="px-3 py-3 text-left text-theme-text-secondary font-medium">Barcode / Serial / Tag</th>
                <th scope="col" className="px-3 py-3 text-left text-theme-text-secondary font-medium">Location</th>
                <th scope="col" className="px-3 py-3 text-right text-theme-text-secondary font-medium">Cost</th>
                <th scope="col" className="px-3 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-surface-border">
              {items.map((item) => {
                const c = categories.find((ct) => ct.id === item.category_id);
                const loc = locLabel(item, locations);
                const ids = [item.barcode, item.serial_number, item.asset_tag].filter(Boolean).join(' / ');
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
                    <td className="px-3 py-3 text-right text-theme-text-muted tabular-nums">{item.purchase_price != null ? `$${formatNumber(item.purchase_price, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}</td>
                    <td className="px-3 py-3"><Link to={`/inventory/items/${item.id}`} className="text-theme-text-muted hover:text-theme-text-primary" aria-label={`View ${item.name}`}><ChevronRight className="w-4 h-4" /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile sort controls */}
      {!loading && items.length > 0 && (
        <div className="md:hidden flex items-center gap-2 mb-3">
          <label className="text-xs text-theme-text-muted shrink-0">Sort:</label>
          <select
            className="form-input text-xs py-1.5 flex-1"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
          >
            {SORT_COLS.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <button
            onClick={() => setSortOrd((p) => p === 'asc' ? 'desc' : 'asc')}
            className="p-2 rounded border border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary active:bg-theme-surface-hover"
            aria-label={`Sort ${sortOrd === 'asc' ? 'descending' : 'ascending'}`}
          >
            {sortOrd === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
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
                serialNumber={item.serial_number} barcode={item.barcode} assetTag={item.asset_tag}
                size={item.size} color={item.color} location={loc || undefined}
                manufacturer={[item.manufacturer, item.model_number].filter(Boolean).join(' ') || undefined}
                quantity={item.tracking_type === 'pool' ? item.quantity : undefined}
                cost={item.purchase_price != null ? `$${formatNumber(item.purchase_price, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : undefined}
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
