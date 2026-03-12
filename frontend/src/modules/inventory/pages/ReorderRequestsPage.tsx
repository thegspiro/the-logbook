/**
 * ReorderRequestsPage — Manage supply reorder requests with status workflow,
 * vendor tracking, and cost management.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft, RefreshCw, Search, Plus, Package, Truck,
  CheckCircle, Clock, XCircle, AlertTriangle, DollarSign,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate as formatDateUtil } from '../../../utils/dateFormatting';
import { Modal } from '../../../components/Modal';
import type {
  ReorderRequest, ReorderRequestCreate, ReorderRequestUpdate,
  InventoryCategory, LowStockAlert,
} from '../../../services/eventServices';

const STATUS_OPTIONS = ['pending', 'approved', 'ordered', 'received', 'cancelled'] as const;
const URGENCY_OPTIONS = ['low', 'normal', 'high', 'critical'] as const;

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  approved: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  ordered: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  received: 'bg-green-500/10 text-green-700 dark:text-green-400',
  cancelled: 'bg-theme-surface-secondary text-theme-text-muted',
};

const URGENCY_COLORS: Record<string, string> = {
  low: 'bg-theme-surface-secondary text-theme-text-muted',
  normal: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  high: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
  critical: 'bg-red-500/10 text-red-700 dark:text-red-400',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="w-3.5 h-3.5" />,
  approved: <CheckCircle className="w-3.5 h-3.5" />,
  ordered: <Truck className="w-3.5 h-3.5" />,
  received: <Package className="w-3.5 h-3.5" />,
  cancelled: <XCircle className="w-3.5 h-3.5" />,
};

const lbl = 'form-label';
const inp = 'form-input';

interface CreateFD {
  item_name: string;
  item_id: string;
  category_id: string;
  quantity_requested: string;
  vendor: string;
  vendor_contact: string;
  estimated_unit_cost: string;
  expected_delivery_date: string;
  urgency: string;
  notes: string;
}

const EMPTY_CREATE: CreateFD = {
  item_name: '', item_id: '', category_id: '', quantity_requested: '1',
  vendor: '', vendor_contact: '', estimated_unit_cost: '',
  expected_delivery_date: '', urgency: 'normal', notes: '',
};

// -- Create/Edit Modal Component --
const ReorderFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  categories: InventoryCategory[];
  lowStockAlerts: LowStockAlert[];
  editRequest?: ReorderRequest | null;
}> = ({ isOpen, onClose, onSaved, categories, lowStockAlerts, editRequest }) => {
  const [f, setF] = useState<CreateFD>(EMPTY_CREATE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (editRequest) {
      setF({
        item_name: editRequest.item_name,
        item_id: editRequest.item_id ?? '',
        category_id: editRequest.category_id ?? '',
        quantity_requested: String(editRequest.quantity_requested),
        vendor: editRequest.vendor ?? '',
        vendor_contact: editRequest.vendor_contact ?? '',
        estimated_unit_cost: editRequest.estimated_unit_cost != null ? String(editRequest.estimated_unit_cost) : '',
        expected_delivery_date: editRequest.expected_delivery_date ?? '',
        urgency: editRequest.urgency,
        notes: editRequest.notes ?? '',
      });
    } else {
      setF(EMPTY_CREATE);
    }
  }, [editRequest, isOpen]);

  const up = (k: keyof CreateFD, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.item_name.trim()) { toast.error('Item name is required'); return; }
    if (!f.quantity_requested || Number(f.quantity_requested) < 1) { toast.error('Quantity must be at least 1'); return; }
    setSaving(true);
    try {
      if (editRequest) {
        const updateData: ReorderRequestUpdate = {
          item_name: f.item_name.trim(),
          quantity_requested: Number(f.quantity_requested),
          vendor: f.vendor.trim() || undefined,
          vendor_contact: f.vendor_contact.trim() || undefined,
          estimated_unit_cost: f.estimated_unit_cost ? Number(f.estimated_unit_cost) : undefined,
          expected_delivery_date: f.expected_delivery_date || undefined,
          urgency: f.urgency || undefined,
          notes: f.notes.trim() || undefined,
        };
        await inventoryService.updateReorderRequest(editRequest.id, updateData);
        toast.success('Reorder request updated');
      } else {
        const createData: ReorderRequestCreate = {
          item_name: f.item_name.trim(),
          item_id: f.item_id || undefined,
          category_id: f.category_id || undefined,
          quantity_requested: Number(f.quantity_requested),
          vendor: f.vendor.trim() || undefined,
          vendor_contact: f.vendor_contact.trim() || undefined,
          estimated_unit_cost: f.estimated_unit_cost ? Number(f.estimated_unit_cost) : undefined,
          expected_delivery_date: f.expected_delivery_date || undefined,
          urgency: f.urgency || undefined,
          notes: f.notes.trim() || undefined,
        };
        await inventoryService.createReorderRequest(createData);
        toast.success('Reorder request created');
      }
      onSaved(); onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save reorder request'));
    } finally { setSaving(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editRequest ? 'Edit Reorder Request' : 'New Reorder Request'} size="lg">
      <form onSubmit={(e) => { void submit(e); }} className="space-y-4 p-4">
        {/* Quick-fill from low stock alerts */}
        {!editRequest && lowStockAlerts.length > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-300 mb-2">Quick fill from low stock:</p>
            <div className="flex flex-wrap gap-1">
              {lowStockAlerts.slice(0, 8).map((alert) => (
                <button
                  key={alert.category_id}
                  type="button"
                  className="px-2 py-1 text-xs rounded bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-500/30"
                  onClick={() => {
                    const firstItem = alert.items?.[0];
                    setF((p) => ({
                      ...p,
                      item_name: firstItem?.name ?? alert.category_name,
                      category_id: alert.category_id,
                      quantity_requested: String(Math.max(1, alert.threshold - alert.current_stock)),
                    }));
                  }}
                >
                  {alert.category_name} ({alert.current_stock}/{alert.threshold})
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={lbl}>Item Name *</label>
            <input className={inp} value={f.item_name} onChange={(e) => up('item_name', e.target.value)} placeholder="e.g. SCBA Air Cylinders" required />
          </div>
          <div>
            <label className={lbl}>Category</label>
            <select className={inp} value={f.category_id} onChange={(e) => up('category_id', e.target.value)}>
              <option value="">— Select —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Quantity *</label>
            <input type="number" min="1" className={inp} value={f.quantity_requested} onChange={(e) => up('quantity_requested', e.target.value)} required />
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-semibold text-theme-text-primary mb-2">Vendor &amp; Cost</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={lbl}>Vendor</label><input className={inp} value={f.vendor} onChange={(e) => up('vendor', e.target.value)} placeholder="Vendor name" /></div>
            <div><label className={lbl}>Vendor Contact</label><input className={inp} value={f.vendor_contact} onChange={(e) => up('vendor_contact', e.target.value)} placeholder="Email or phone" /></div>
            <div><label className={lbl}>Est. Unit Cost ($)</label><input type="number" min="0" step="0.01" className={inp} value={f.estimated_unit_cost} onChange={(e) => up('estimated_unit_cost', e.target.value)} /></div>
            <div><label className={lbl}>Expected Delivery</label><input type="date" className={inp} value={f.expected_delivery_date} onChange={(e) => up('expected_delivery_date', e.target.value)} /></div>
          </div>
        </fieldset>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Urgency</label>
            <select className={inp} value={f.urgency} onChange={(e) => up('urgency', e.target.value)}>
              {URGENCY_OPTIONS.map((u) => <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>)}
            </select>
          </div>
          <div className="sm:col-span-1">
            <label className={lbl}>Notes</label>
            <textarea className={inp} rows={2} value={f.notes} onChange={(e) => up('notes', e.target.value)} placeholder="Additional details..." />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-theme-surface-border">
          <button type="button" onClick={onClose} className="btn-secondary btn-md">Cancel</button>
          <button type="submit" disabled={saving} className="btn-info btn-md disabled:opacity-50">
            {saving ? 'Saving...' : editRequest ? 'Update' : 'Create Request'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// -- Status Update Modal --
const StatusUpdateModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  request: ReorderRequest | null;
}> = ({ isOpen, onClose, onSaved, request }) => {
  const [status, setStatus] = useState('');
  const [poNumber, setPONumber] = useState('');
  const [actualCost, setActualCost] = useState('');
  const [qtyReceived, setQtyReceived] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !request) return;
    setStatus(request.status);
    setPONumber(request.purchase_order_number ?? '');
    setActualCost(request.actual_unit_cost != null ? String(request.actual_unit_cost) : '');
    setQtyReceived(request.quantity_received != null ? String(request.quantity_received) : '');
    setNotes('');
  }, [isOpen, request]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request) return;
    setSaving(true);
    try {
      const data: ReorderRequestUpdate = {
        status: status || undefined,
        purchase_order_number: poNumber.trim() || undefined,
        actual_unit_cost: actualCost ? Number(actualCost) : undefined,
        quantity_received: qtyReceived ? Number(qtyReceived) : undefined,
        notes: notes.trim() || undefined,
      };
      await inventoryService.updateReorderRequest(request.id, data);
      toast.success('Status updated');
      onSaved(); onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update status'));
    } finally { setSaving(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Update Reorder Status" size="md">
      <form onSubmit={(e) => { void submit(e); }} className="space-y-4 p-4">
        <div>
          <label className={lbl}>Status</label>
          <select className={inp} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
        {(status === 'ordered' || status === 'received') && (
          <div>
            <label className={lbl}>PO Number</label>
            <input className={inp} value={poNumber} onChange={(e) => setPONumber(e.target.value)} placeholder="Purchase order #" />
          </div>
        )}
        {status === 'received' && (
          <>
            <div>
              <label className={lbl}>Quantity Received</label>
              <input type="number" min="0" className={inp} value={qtyReceived} onChange={(e) => setQtyReceived(e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Actual Unit Cost ($)</label>
              <input type="number" min="0" step="0.01" className={inp} value={actualCost} onChange={(e) => setActualCost(e.target.value)} />
            </div>
          </>
        )}
        <div>
          <label className={lbl}>Notes</label>
          <textarea className={inp} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-theme-surface-border">
          <button type="button" onClick={onClose} className="btn-secondary btn-md">Cancel</button>
          <button type="submit" disabled={saving} className="btn-info btn-md disabled:opacity-50">
            {saving ? 'Updating...' : 'Update Status'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// -- Main Page --
export const ReorderRequestsPage: React.FC = () => {
  const tz = useTimezone();
  const [requests, setRequests] = useState<ReorderRequest[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [editRequest, setEditRequest] = useState<ReorderRequest | null>(null);
  const [statusRequest, setStatusRequest] = useState<ReorderRequest | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqs, cats, lowStock] = await Promise.all([
        inventoryService.getReorderRequests({
          status: statusFilter || undefined,
          urgency: urgencyFilter || undefined,
          search: search || undefined,
        }),
        inventoryService.getCategories().catch(() => [] as InventoryCategory[]),
        inventoryService.getLowStockItems().catch(() => [] as LowStockAlert[]),
      ]);
      setRequests(reqs);
      setCategories(cats);
      setLowStockAlerts(lowStock);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load reorder requests'));
    } finally { setLoading(false); }
  }, [search, statusFilter, urgencyFilter]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const pending = requests.filter((r) => r.status === 'pending').length;
    const ordered = requests.filter((r) => r.status === 'ordered').length;
    const totalEstCost = requests
      .filter((r) => r.status !== 'cancelled' && r.status !== 'received')
      .reduce((sum, r) => sum + (r.estimated_unit_cost ?? 0) * r.quantity_requested, 0);
    return { pending, ordered, totalEstCost };
  }, [requests]);

  const formatCurrency = (val: number) =>
    val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const fmtDate = (dateStr: string | undefined) => {
    if (!dateStr) return '—';
    return formatDateUtil(dateStr, tz);
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <Link to="/inventory/admin" className="text-sm text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to Admin
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-theme-text-primary">Reorder Requests</h1>
            <p className="text-sm text-theme-text-muted">Track supply orders from request to receipt</p>
          </div>
          <button onClick={() => { void load(); }} className="btn-secondary btn-md">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="btn-info btn-md flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Request</span>
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="card-secondary p-3 text-center">
            <p className="text-2xl font-bold text-theme-text-primary">{requests.length}</p>
            <p className="text-xs text-theme-text-muted">Total Requests</p>
          </div>
          <div className="card-secondary p-3 text-center">
            <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{stats.pending}</p>
            <p className="text-xs text-theme-text-muted">Pending</p>
          </div>
          <div className="card-secondary p-3 text-center">
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.ordered}</p>
            <p className="text-xs text-theme-text-muted">On Order</p>
          </div>
          <div className="card-secondary p-3 text-center">
            <p className="text-2xl font-bold text-theme-text-primary">
              <DollarSign className="w-4 h-4 inline -mt-0.5" />
              {stats.totalEstCost > 0 ? formatCurrency(stats.totalEstCost) : '—'}
            </p>
            <p className="text-xs text-theme-text-muted">Est. Outstanding</p>
          </div>
        </div>

        {/* Low stock banner */}
        {lowStockAlerts.length > 0 && (
          <div className="mb-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              {lowStockAlerts.length} categor{lowStockAlerts.length === 1 ? 'y' : 'ies'} below stock threshold
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="ml-auto text-xs font-medium text-yellow-700 dark:text-yellow-300 hover:underline"
            >
              Create reorder &rarr;
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
            <input
              className={`${inp} pl-9`}
              placeholder="Search by item name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className={inp + ' w-auto'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <select className={inp + ' w-auto'} value={urgencyFilter} onChange={(e) => setUrgencyFilter(e.target.value)}>
            <option value="">All Urgencies</option>
            {URGENCY_OPTIONS.map((u) => <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>)}
          </select>
        </div>

        {/* Table */}
        {loading && requests.length === 0 ? (
          <div className="text-center py-12 text-theme-text-muted">Loading...</div>
        ) : requests.length === 0 ? (
          <div className="text-center py-12 card-secondary rounded-lg">
            <Package className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
            <p className="text-theme-text-muted">No reorder requests found</p>
            <button onClick={() => setShowCreate(true)} className="btn-info btn-md mt-3">
              Create First Request
            </button>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block card-secondary rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-theme-surface-border bg-theme-surface-secondary">
                    <th className="text-left px-4 py-3 font-medium text-theme-text-muted">Item</th>
                    <th className="text-left px-4 py-3 font-medium text-theme-text-muted">Qty</th>
                    <th className="text-left px-4 py-3 font-medium text-theme-text-muted">Vendor</th>
                    <th className="text-left px-4 py-3 font-medium text-theme-text-muted">Est. Cost</th>
                    <th className="text-left px-4 py-3 font-medium text-theme-text-muted">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-theme-text-muted">Urgency</th>
                    <th className="text-left px-4 py-3 font-medium text-theme-text-muted">Requested</th>
                    <th className="text-right px-4 py-3 font-medium text-theme-text-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr key={req.id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                      <td className="px-4 py-3">
                        <p className="font-medium text-theme-text-primary">{req.item_name}</p>
                        {req.requester_name && <p className="text-xs text-theme-text-muted">by {req.requester_name}</p>}
                      </td>
                      <td className="px-4 py-3 text-theme-text-primary">
                        {req.quantity_requested}
                        {req.quantity_received != null && (
                          <span className="text-xs text-green-600 dark:text-green-400 ml-1">
                            ({req.quantity_received} received)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-theme-text-muted">{req.vendor ?? '—'}</td>
                      <td className="px-4 py-3 text-theme-text-primary">
                        {req.estimated_unit_cost != null ? formatCurrency(Number(req.estimated_unit_cost) * req.quantity_requested) : '—'}
                        {req.actual_unit_cost != null && (
                          <span className="text-xs text-theme-text-muted block">
                            Actual: {formatCurrency(Number(req.actual_unit_cost) * req.quantity_requested)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[req.status] ?? ''}`}>
                          {STATUS_ICONS[req.status]}
                          {req.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${URGENCY_COLORS[req.urgency] ?? ''}`}>
                          {req.urgency}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-theme-text-muted">
                        {fmtDate(req.created_at)}
                        {req.purchase_order_number && (
                          <span className="block text-theme-text-primary">PO: {req.purchase_order_number}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          {req.status !== 'received' && req.status !== 'cancelled' && (
                            <button
                              onClick={() => setStatusRequest(req)}
                              className="px-2 py-1 text-xs rounded bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-primary"
                            >
                              Update Status
                            </button>
                          )}
                          {req.status === 'pending' && (
                            <button
                              onClick={() => { setEditRequest(req); setShowCreate(true); }}
                              className="px-2 py-1 text-xs rounded bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-primary"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
              {requests.map((req) => (
                <div key={req.id} className="card-secondary rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium text-theme-text-primary">{req.item_name}</p>
                      <p className="text-xs text-theme-text-muted">
                        Qty: {req.quantity_requested} &middot; {req.vendor ?? 'No vendor'}
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[req.status] ?? ''}`}>
                      {STATUS_ICONS[req.status]}
                      {req.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${URGENCY_COLORS[req.urgency] ?? ''}`}>
                      {req.urgency}
                    </span>
                    {req.estimated_unit_cost != null && (
                      <span className="text-xs text-theme-text-muted">
                        Est: {formatCurrency(Number(req.estimated_unit_cost) * req.quantity_requested)}
                      </span>
                    )}
                    <span className="text-xs text-theme-text-muted ml-auto">{fmtDate(req.created_at)}</span>
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-theme-surface-border">
                    {req.status !== 'received' && req.status !== 'cancelled' && (
                      <button
                        onClick={() => setStatusRequest(req)}
                        className="flex-1 btn-info btn-sm"
                      >
                        Update Status
                      </button>
                    )}
                    {req.status === 'pending' && (
                      <button
                        onClick={() => { setEditRequest(req); setShowCreate(true); }}
                        className="flex-1 btn-secondary btn-sm"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Modals */}
        <ReorderFormModal
          isOpen={showCreate}
          onClose={() => { setShowCreate(false); setEditRequest(null); }}
          onSaved={() => { void load(); }}
          categories={categories}
          lowStockAlerts={lowStockAlerts}
          editRequest={editRequest}
        />
        <StatusUpdateModal
          isOpen={statusRequest !== null}
          onClose={() => setStatusRequest(null)}
          onSaved={() => { void load(); }}
          request={statusRequest}
        />
      </div>
    </div>
  );
};

export default ReorderRequestsPage;
