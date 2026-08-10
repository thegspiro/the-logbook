/**
 * InventoryItemsPage — Items listing with filtering, sorting, bulk ops,
 * real-time WebSocket updates, CSV export, and add/edit modal.
 *
 * Items are split into two tables: Available and Unavailable, so admins
 * can quickly see what's in stock vs what's checked out / in maintenance / etc.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  RefreshCw,
  Search,
  ChevronUp,
  ChevronDown,
  Printer,
  Download,
  Archive,
  ArrowUpDown,
  Plus,
  Package,
  PackagePlus,
  AlertTriangle,
  Wrench,
  ChevronRight,
  MapPin,
  UserPlus,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { inventoryService, locationsService } from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { getTodayLocalDate, formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ITEM_CONDITION_OPTIONS } from '../../../constants/enums';
import { useInventoryWebSocket } from '../../../hooks/useInventoryWebSocket';
import { useRegisterPullToRefresh } from '../../../hooks/useRegisterPullToRefresh';
import { FloatingActionButton } from '../../../components/ux/FloatingActionButton';
import { EmptyState } from '../../../components/ux/EmptyState';
import { Modal } from '../../../components/Modal';
import { MemberPickerModal } from '../../../components/MemberPickerModal';
import { InventoryScanModal } from '../../../components/InventoryScanModal';
import { ItemFormModal } from '../components/ItemFormModal';
import ReceiveStockModal from '../components/ReceiveStockModal';
import { VariantCapsules } from '../components/VariantCapsules';
import { getDisplayName } from '../utils/variantHelpers';
import type {
  InventoryItem,
  InventoryCategory,
  InventorySummary,
  LocationInventorySummary,
  StorageAreaResponse,
  Location,
} from '../types';
import {
  STATUS_OPTIONS,
  ITEM_TYPES,
  STANDARD_SIZES,
  GARMENT_STYLES,
  getStatusStyle,
  getConditionColor,
} from '../types';
import { asArray } from '../../../utils/asArray';

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

function qtyLabel(item: InventoryItem): string {
  if (item.tracking_type !== 'pool') return '-';
  const available = item.quantity - item.quantity_issued;
  return `${available} / ${item.quantity}`;
}

/* ------------------------------------------------------------------ */
/*  ItemTable — reusable table for available / unavailable sections     */
/* ------------------------------------------------------------------ */
interface ItemTableProps {
  label: string;
  icon: React.ReactNode;
  items: InventoryItem[];
  categories: InventoryCategory[];
  locations: Location[];
  selIds: Set<string>;
  toggle: (id: string) => void;
  toggleAll: () => void;
  toggleSort: (k: SortKey) => void;
  SortIc: React.FC<{ col: SortKey }>;
  showStatus: boolean;
  canManage: boolean;
  onEdit: (item: InventoryItem) => void;
  onRetire: (item: InventoryItem) => void;
}

const ItemTable: React.FC<ItemTableProps> = ({
  label,
  icon,
  items,
  categories,
  locations,
  selIds,
  toggle,
  toggleAll,
  toggleSort,
  SortIc,
  showStatus,
  canManage,
  onEdit,
  onRetire,
}) => {
  if (items.length === 0) return null;

  const allSelected = items.length > 0 && items.every((i) => selIds.has(i.id));

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h2 className="text-theme-text-secondary text-sm font-semibold tracking-wide uppercase">{label}</h2>
        <span className="text-theme-text-muted text-xs">({items.length})</span>
      </div>
      <div className="card-secondary overflow-x-auto">
        {/* Single responsive table: a table on >=md, stacked cards below.
            Cells marked `hidden` are mobile-only (revealed by the reflow);
            cells with no data-label are hidden in the stacked view. */}
        <table className="rwd-table w-full text-sm">
          <thead>
            <tr className="border-theme-surface-border border-b">
              <th scope="col" className="w-10 px-3 py-3 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="form-checkbox"
                  aria-label={`Select all ${label.toLowerCase()}`}
                />
              </th>
              <th scope="col" className="px-3 py-3 text-left">
                <button
                  onClick={() => toggleSort('name')}
                  className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1 font-medium"
                >
                  Name <SortIc col="name" />
                </button>
              </th>
              {showStatus && (
                <th scope="col" className="px-3 py-3 text-left">
                  <button
                    onClick={() => toggleSort('status')}
                    className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1 font-medium"
                  >
                    Status <SortIc col="status" />
                  </button>
                </th>
              )}
              <th scope="col" className="text-theme-text-secondary px-3 py-3 text-left font-medium">
                Category
              </th>
              <th scope="col" className="text-theme-text-secondary px-3 py-3 text-left font-medium">
                Variant
              </th>
              <th scope="col" className="text-theme-text-secondary px-3 py-3 text-center font-medium">
                Qty
              </th>
              <th scope="col" className="px-3 py-3 text-left">
                <button
                  onClick={() => toggleSort('condition')}
                  className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1 font-medium"
                >
                  Condition <SortIc col="condition" />
                </button>
              </th>
              <th scope="col" className="text-theme-text-secondary px-3 py-3 text-left font-medium">
                Location
              </th>
              <th scope="col" className="w-10 px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-theme-surface-border divide-y">
            {items.map((item) => {
              const cat = categories.find((ct) => ct.id === item.category_id);
              const loc = locLabel(item, locations);
              const manufacturer = [item.manufacturer, item.model_number].filter(Boolean).join(' ');
              const cost =
                item.purchase_price != null
                  ? `$${formatNumber(item.purchase_price, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '';
              return (
                <tr
                  key={item.id}
                  className={`hover:bg-theme-surface-hover transition-colors ${selIds.has(item.id) ? 'bg-theme-surface-hover/50' : ''}`}
                >
                  <td data-label="" className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selIds.has(item.id)}
                      onChange={() => toggle(item.id)}
                      className="form-checkbox"
                      aria-label={`Select ${item.name}`}
                    />
                  </td>
                  <td data-label="Name" className="px-3 py-3">
                    <Link
                      to={`/inventory/items/${item.id}`}
                      className="text-theme-text-primary font-medium hover:text-blue-600 dark:hover:text-blue-400"
                    >
                      {getDisplayName(item)}
                    </Link>
                  </td>
                  {/* Status: a desktop column only when showStatus, but always
                      surfaced on mobile (where items aren't column-grouped). */}
                  <td data-label="Status" className={`px-3 py-3 ${showStatus ? '' : 'md:hidden'}`}>
                    <span
                      className={`inline-flex rounded-sm border px-2 py-0.5 text-[11px] font-semibold ${getStatusStyle(item.status)}`}
                    >
                      {item.status.replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </td>
                  <td data-label="Category" className="text-theme-text-muted px-3 py-3">
                    {cat?.name ?? ''}
                  </td>
                  <td data-label="Variant" className="px-3 py-3">
                    <VariantCapsules item={item} />
                  </td>
                  <td data-label="Qty" className="text-theme-text-muted px-3 py-3 text-center tabular-nums">
                    {qtyLabel(item)}
                  </td>
                  <td data-label="Condition" className={`px-3 py-3 capitalize ${getConditionColor(item.condition)}`}>
                    {item.condition.replace(/_/g, ' ')}
                  </td>
                  <td data-label="Location" className="text-theme-text-muted max-w-[160px] truncate px-3 py-3">
                    {loc || '-'}
                  </td>
                  {/* Mobile-only detail cells (hidden on desktop, revealed by the reflow) */}
                  <td data-label="Manufacturer" className="hidden">
                    {manufacturer || '--'}
                  </td>
                  <td data-label="Serial #" className="hidden">
                    {item.serial_number || '--'}
                  </td>
                  <td data-label="Asset Tag" className="hidden">
                    {item.asset_tag || '--'}
                  </td>
                  <td data-label="Barcode" className="hidden">
                    {item.barcode || '--'}
                  </td>
                  <td data-label="Cost" className="hidden">
                    {cost || '--'}
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      to={`/inventory/items/${item.id}`}
                      className="text-theme-text-muted hover:text-theme-text-primary"
                      aria-label={`View ${item.name}`}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                  {/* Mobile-only inline actions */}
                  {canManage && (
                    <td data-label="" className="hidden">
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => onEdit(item)} className="btn-secondary btn-sm">
                          Edit
                        </button>
                        {item.status !== 'retired' && (
                          <button onClick={() => onRetire(item)} className="btn-secondary btn-sm">
                            Retire
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

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
  const [fSize, setFSize] = useState('');
  const [fColor, setFColor] = useState('');
  const [fStyle, setFStyle] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [sortOrd, setSortOrd] = useState<'asc' | 'desc'>('asc');
  const [skip, setSkip] = useState(0);
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkNewStatus, setBulkNewStatus] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ userId: string; memberName: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* ---- split items by availability ---- */
  const availableItems = useMemo(() => items.filter((i) => i.status === 'available'), [items]);
  const unavailableItems = useMemo(() => items.filter((i) => i.status !== 'available'), [items]);

  /* ---- helpers ---- */
  const filterParams = useCallback(
    () => ({
      search: search.trim() || undefined,
      category_id: fCat || undefined,
      status: fStatus || undefined,
      condition: fCond || undefined,
      item_type: fType || undefined,
      location_id: fLoc || undefined,
      size: fSize || undefined,
      color: fColor || undefined,
      style: fStyle || undefined,
      sort_by: sortBy,
      sort_order: sortOrd,
    }),
    [search, fCat, fStatus, fCond, fType, fLoc, fSize, fColor, fStyle, sortBy, sortOrd]
  );

  const loadItems = useCallback(
    async (reset = false) => {
      const s = reset ? 0 : skip;
      try {
        const res = await inventoryService.getItems({ ...filterParams(), skip: s, limit: PAGE_SIZE });
        const items = asArray(res.items);
        setItems(reset || s === 0 ? items : (prev) => [...prev, ...items]);
        setTotal(res.total ?? 0);
        if (reset) setSkip(0);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load items'));
      }
    },
    [filterParams, skip]
  );

  const loadSummary = useCallback(async () => {
    try {
      const [s, ls] = await Promise.all([inventoryService.getSummary(), inventoryService.getSummaryByLocation()]);
      setSummary(s);
      setLocSummary(ls);
    } catch {
      /* non-critical */
    }
  }, []);

  const loadRef = useCallback(async () => {
    try {
      const [c, l, a] = await Promise.all([
        inventoryService.getCategories(),
        locationsService.getLocations(),
        inventoryService.getStorageAreas({ flat: true }),
      ]);
      setCategories(c);
      setLocations(l);
      setStorageAreas(a);
    } catch {
      /* non-critical */
    }
  }, []);

  useRegisterPullToRefresh(async () => {
    await Promise.all([loadItems(true), loadSummary()]);
  });

  useEffect(() => {
    const go = async () => {
      setLoading(true);
      await Promise.all([loadItems(true), loadSummary(), loadRef()]);
      setLoading(false);
    };
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
  const onWs = useCallback(() => {
    void loadItems(true);
    void loadSummary();
  }, [loadItems, loadSummary]);
  useInventoryWebSocket({ onEvent: onWs });

  /* ---- pagination ---- */
  const handleMore = async () => {
    const ns = skip + PAGE_SIZE;
    setSkip(ns);
    setLoadingMore(true);
    try {
      const res = await inventoryService.getItems({ ...filterParams(), skip: ns, limit: PAGE_SIZE });
      setItems((prev) => [...prev, ...asArray(res.items)]);
      setTotal(res.total ?? 0);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load more'));
    } finally {
      setLoadingMore(false);
    }
  };

  /* ---- sorting ---- */
  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setSortOrd((p) => (p === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(k);
      setSortOrd('asc');
    }
  };
  const SortIc: React.FC<{ col: SortKey }> = ({ col }) => {
    if (sortBy !== col) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;
    return sortOrd === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  };

  /* ---- selection ---- */
  const toggle = (id: string) =>
    setSelIds((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /* ---- section-level toggleAll helpers ---- */
  const toggleAllAvailable = () =>
    setSelIds((prev) => {
      const allSelected = availableItems.length > 0 && availableItems.every((i) => prev.has(i.id));
      if (allSelected) {
        const next = new Set(prev);
        availableItems.forEach((i) => next.delete(i.id));
        return next;
      }
      return new Set([...prev, ...availableItems.map((i) => i.id)]);
    });
  const toggleAllUnavailable = () =>
    setSelIds((prev) => {
      const allSelected = unavailableItems.length > 0 && unavailableItems.every((i) => prev.has(i.id));
      if (allSelected) {
        const next = new Set(prev);
        unavailableItems.forEach((i) => next.delete(i.id));
        return next;
      }
      return new Set([...prev, ...unavailableItems.map((i) => i.id)]);
    });

  /* ---- bulk ops ---- */
  const printLabels = () => void navigate(`/inventory/print-labels?ids=${Array.from(selIds).join(',')}`);

  const bulkRetire = async () => {
    if (!confirm(`Retire ${selIds.size} item(s)? This cannot be undone.`)) return;
    try {
      await Promise.all(Array.from(selIds).map((id) => inventoryService.retireItem(id)));
      toast.success(`${selIds.size} item(s) retired`);
      setSelIds(new Set());
      void loadItems(true);
      void loadSummary();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to retire items'));
    }
  };

  const bulkStatus = async () => {
    if (!bulkNewStatus) return;
    setBulkSaving(true);
    try {
      await Promise.all(Array.from(selIds).map((id) => inventoryService.updateItem(id, { status: bulkNewStatus })));
      toast.success(`Updated ${selIds.size} item(s)`);
      setSelIds(new Set());
      setBulkStatusOpen(false);
      setBulkNewStatus('');
      void loadItems(true);
      void loadSummary();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update'));
    } finally {
      setBulkSaving(false);
    }
  };

  /* ---- export ---- */
  const exportCsv = async () => {
    try {
      const blob = await inventoryService.exportItemsCsv({
        category_id: fCat || undefined,
        status: fStatus || undefined,
        search: search.trim() || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventory-items-${getTodayLocalDate(tz)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('CSV exported');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Export failed'));
    }
  };

  const refresh = () => {
    setSelIds(new Set());
    void loadItems(true);
    void loadSummary();
  };
  const openAdd = () => {
    setEditItem(null);
    setModalOpen(true);
  };
  const openEdit = (it: InventoryItem) => {
    setEditItem(it);
    setModalOpen(true);
  };
  const onSaved = () => {
    void loadItems(true);
    void loadSummary();
  };
  const retireOne = (it: InventoryItem) => {
    void inventoryService
      .retireItem(it.id)
      .then(() => {
        toast.success(`${it.name} retired`);
        void loadItems(true);
        void loadSummary();
      })
      .catch((err: unknown) => toast.error(getErrorMessage(err, 'Failed to retire item')));
  };

  const fabActions = useMemo(() => {
    const a = [];
    if (canManage)
      a.push({
        id: 'add',
        label: 'Add Item',
        icon: <Plus className="h-5 w-5" />,
        onClick: openAdd,
        color: 'bg-emerald-600',
      });
    if (canManage)
      a.push({
        id: 'assign',
        label: 'Assign Items',
        icon: <UserPlus className="h-5 w-5" />,
        onClick: () => setMemberPickerOpen(true),
        color: 'bg-blue-600',
      });
    return a;
  }, [canManage]);

  const hasMore = items.length < total;

  /* ================================================================ */
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Link
        to="/inventory/admin"
        className="text-theme-text-muted hover:text-theme-text-secondary mb-6 flex items-center gap-1 text-sm max-md:min-h-[44px]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Inventory Items</h1>
          {summary && (
            <div className="text-theme-text-muted mt-2 flex flex-wrap gap-4 text-sm">
              <span className="flex items-center gap-1.5">
                <Package className="h-4 w-4" /> {summary.total_items} items
              </span>
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> {summary.overdue_checkouts} overdue
              </span>
              <span className="flex items-center gap-1.5">
                <Wrench className="h-4 w-4" /> {summary.maintenance_due_count} maint. due
              </span>
              {summary.total_value > 0 && <span>${formatNumber(summary.total_value)}</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="btn-secondary btn-icon-sm" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => void exportCsv()}
            className="btn-secondary btn-md hidden items-center gap-2 sm:inline-flex"
          >
            <Download className="h-4 w-4" /> Export
          </button>
          {canManage && (
            <button
              onClick={() => setMemberPickerOpen(true)}
              className="btn-secondary btn-md hidden items-center gap-2 sm:inline-flex"
            >
              <UserPlus className="h-4 w-4" /> Assign
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setReceiveOpen(true)}
              className="btn-secondary btn-md hidden items-center gap-2 sm:inline-flex"
            >
              <PackagePlus className="h-4 w-4" /> Receive Stock
            </button>
          )}
          {canManage && (
            <button onClick={openAdd} className="btn-info btn-md hidden items-center gap-2 sm:inline-flex">
              <Plus className="h-4 w-4" /> Add Item
            </button>
          )}
        </div>
      </div>

      {/* Location summary */}
      {locSummary.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {locSummary.map((loc) => (
            <button
              key={loc.location_id ?? 'unassigned'}
              onClick={() => {
                setFLoc(loc.location_id ?? '');
              }}
              className={`card-secondary hover:bg-theme-surface-hover p-3 text-left transition-colors ${fLoc === (loc.location_id ?? '') ? 'ring-2 ring-blue-500' : ''}`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <MapPin className="text-theme-text-muted h-3.5 w-3.5 shrink-0" />
                <span className="text-theme-text-primary truncate text-xs font-medium">{loc.location_name}</span>
              </div>
              <div className="text-theme-text-primary text-lg font-bold">{loc.total_quantity}</div>
              <div className="text-theme-text-muted text-xs">
                {loc.item_count} item{loc.item_count !== 1 ? 's' : ''}
                {loc.total_value > 0 && (
                  <span className="ml-1">&middot; ${formatNumber(loc.total_value, { maximumFractionDigits: 0 })}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="card-secondary mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <div className="relative lg:col-span-2">
            <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              type="text"
              aria-label="Search items..."
              placeholder="Search items..."
              className="form-input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter by category"
            className="form-input"
            value={fCat}
            onChange={(e) => setFCat(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            className="form-input"
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by condition"
            className="form-input"
            value={fCond}
            onChange={(e) => setFCond(e.target.value)}
          >
            <option value="">All Conditions</option>
            {ITEM_CONDITION_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by type"
            className="form-input"
            value={fType}
            onChange={(e) => setFType(e.target.value)}
          >
            <option value="">All Types</option>
            {ITEM_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by location"
            className="form-input"
            value={fLoc}
            onChange={(e) => setFLoc(e.target.value)}
          >
            <option value="">All Locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <select
            aria-label="Filter by size"
            className="form-input"
            value={fSize}
            onChange={(e) => setFSize(e.target.value)}
          >
            <option value="">All Sizes</option>
            {STANDARD_SIZES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by color"
            className="form-input"
            value={fColor}
            onChange={(e) => setFColor(e.target.value)}
          >
            <option value="">All Colors</option>
            {Array.from(new Set(items.map((i) => i.color).filter(Boolean)))
              .sort()
              .map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
          </select>
          <select
            aria-label="Filter by style"
            className="form-input"
            value={fStyle}
            onChange={(e) => setFStyle(e.target.value)}
          >
            <option value="">All Styles</option>
            {GARMENT_STYLES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Bulk bar */}
      {selIds.size > 0 && (
        <div className="card-secondary mb-4 flex flex-wrap items-center gap-3 p-3">
          <span className="text-theme-text-primary text-sm font-medium">{selIds.size} selected</span>
          <button onClick={printLabels} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
            <Printer className="h-3.5 w-3.5" /> Print Labels
          </button>
          <button
            onClick={() => setBulkStatusOpen(true)}
            className="btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <ArrowUpDown className="h-3.5 w-3.5" /> Change Status
          </button>
          {canManage && (
            <button onClick={() => void bulkRetire()} className="btn-primary btn-sm inline-flex items-center gap-1.5">
              <Archive className="h-3.5 w-3.5" /> Retire
            </button>
          )}
          <button
            onClick={() => setSelIds(new Set())}
            className="text-theme-text-muted hover:text-theme-text-primary ml-auto text-xs"
          >
            Clear
          </button>
        </div>
      )}

      {/* Bulk status modal */}
      <Modal
        isOpen={bulkStatusOpen}
        onClose={() => setBulkStatusOpen(false)}
        title="Bulk Status Change"
        size="sm"
        footer={
          <>
            <button
              onClick={() => void bulkStatus()}
              disabled={!bulkNewStatus || bulkSaving}
              className="btn-info btn-md ml-2"
            >
              {bulkSaving ? 'Updating...' : 'Apply'}
            </button>
            <button onClick={() => setBulkStatusOpen(false)} className="btn-secondary btn-md">
              Cancel
            </button>
          </>
        }
      >
        <p className="text-theme-text-secondary mb-3 text-sm">Set status for {selIds.size} item(s):</p>
        <select className="form-input" value={bulkNewStatus} onChange={(e) => setBulkNewStatus(e.target.value)}>
          <option value="">-- Select Status --</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Modal>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card-secondary animate-pulse p-4">
              <div className="bg-theme-surface-hover mb-2 h-4 w-1/3 rounded" />
              <div className="bg-theme-surface-hover h-3 w-2/3 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && items.length === 0 && (
        <EmptyState
          icon={Package}
          title="No items found"
          description={
            search || fCat || fStatus || fCond || fType || fLoc
              ? 'Try adjusting your filters.'
              : 'Get started by adding your first inventory item.'
          }
          actions={canManage ? [{ label: 'Add Item', onClick: openAdd, icon: Plus }] : undefined}
        />
      )}

      {/* Mobile sort controls — the table's header-sort buttons are hidden
          when rows reflow into cards on mobile, so expose sorting here. */}
      {!loading && items.length > 0 && (
        <div className="mb-3 flex items-center gap-2 md:hidden">
          <label className="text-theme-text-muted shrink-0 text-xs">Sort:</label>
          <select
            className="form-input flex-1 py-1.5 text-xs"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
          >
            {SORT_COLS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setSortOrd((p) => (p === 'asc' ? 'desc' : 'asc'))}
            className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary active:bg-theme-surface-hover rounded border p-2"
            aria-label={`Sort ${sortOrd === 'asc' ? 'descending' : 'ascending'}`}
          >
            {sortOrd === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      )}

      {/* Items — single responsive tables split by availability (a table on
          >=md, stacked cards below). */}
      {!loading && items.length > 0 && (
        <div className="space-y-6">
          <ItemTable
            label="Available"
            icon={<CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />}
            items={availableItems}
            categories={categories}
            locations={locations}
            selIds={selIds}
            toggle={toggle}
            toggleAll={toggleAllAvailable}
            toggleSort={toggleSort}
            SortIc={SortIc}
            showStatus={false}
            canManage={canManage}
            onEdit={openEdit}
            onRetire={retireOne}
          />
          <ItemTable
            label="Unavailable"
            icon={<XCircle className="h-4 w-4 text-red-500 dark:text-red-400" />}
            items={unavailableItems}
            categories={categories}
            locations={locations}
            selIds={selIds}
            toggle={toggle}
            toggleAll={toggleAllUnavailable}
            toggleSort={toggleSort}
            SortIc={SortIc}
            showStatus
            canManage={canManage}
            onEdit={openEdit}
            onRetire={retireOne}
          />
        </div>
      )}

      {/* Load more */}
      {!loading && hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => void handleMore()}
            disabled={loadingMore}
            className="btn-secondary btn-md inline-flex items-center gap-2"
          >
            {loadingMore ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" /> Loading...
              </>
            ) : (
              <>
                Load More ({items.length} of {total})
              </>
            )}
          </button>
        </div>
      )}

      {/* Item form modal */}
      <ItemFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={onSaved}
        categories={categories}
        locations={locations}
        storageAreas={storageAreas}
        editItem={editItem}
      />

      <ReceiveStockModal isOpen={receiveOpen} onClose={() => setReceiveOpen(false)} onReceived={refresh} />

      {/* Quick-assign: pick a member, then assign items to them */}
      <MemberPickerModal
        isOpen={memberPickerOpen}
        onClose={() => setMemberPickerOpen(false)}
        title="Assign Items — Select a Member"
        onSelect={(member) => {
          setMemberPickerOpen(false);
          setAssignTarget(member);
        }}
      />
      <InventoryScanModal
        isOpen={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        mode="checkout"
        userId={assignTarget?.userId ?? ''}
        memberName={assignTarget?.memberName ?? ''}
        onComplete={() => {
          void loadItems(true);
          void loadSummary();
        }}
      />

      {/* Mobile FAB */}
      <FloatingActionButton actions={fabActions} />
    </div>
  );
};

export default InventoryItemsPage;
