/**
 * My Equipment Page
 *
 * Personal equipment view for members — shows permanent assignments,
 * active checkouts, and issued items. Supports check-in, extend,
 * return requests, and new equipment requests.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Package, AlertTriangle, Clock, CheckCircle, RefreshCw, Plus,
  ClipboardList, CalendarClock, Search, CornerDownLeft, Loader2,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type {
  UserInventoryResponse, InventoryItem, EquipmentRequestItem, ReturnRequestItem,
} from '../types';
import { getConditionColor, REQUEST_STATUS_BADGES } from '../types';
import { useAuthStore } from '../../../stores/authStore';
import { useRanks } from '../../../hooks/useRanks';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { RETURN_CONDITION_OPTIONS } from '../../../constants/enums';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';

/* ---------- Status badge colors ---------- */
const STATUS_BADGE = REQUEST_STATUS_BADGES;

/* ---------- Collapsible section ---------- */
const Section: React.FC<{
  title: string; count: number; icon: React.ReactNode;
  defaultOpen?: boolean; children: React.ReactNode;
}> = ({ title, count, icon, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card-secondary overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-theme-surface-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2 text-theme-text-primary font-medium">
          {icon}
          {title}
          <span className="text-sm text-theme-text-muted">({count})</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-theme-text-muted" /> : <ChevronDown className="h-4 w-4 text-theme-text-muted" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
};

const MyEquipmentPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const { ranks } = useRanks();
  const tz = useTimezone();

  /* ---------- Data ---------- */
  const [inventory, setInventory] = useState<UserInventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [equipRequests, setEquipRequests] = useState<EquipmentRequestItem[]>([]);
  const [returnRequests, setReturnRequests] = useState<ReturnRequestItem[]>([]);
  const [showRequests, setShowRequests] = useState(false);

  /* ---------- Modals ---------- */
  const [requestModal, setRequestModal] = useState(false);
  const [checkInModal, setCheckInModal] = useState<{ open: boolean; checkoutId: string }>({ open: false, checkoutId: '' });
  const [extendModal, setExtendModal] = useState<{ open: boolean; checkoutId: string }>({ open: false, checkoutId: '' });
  const [returnModal, setReturnModal] = useState<{
    open: boolean; returnType: 'assignment' | 'issuance' | 'checkout';
    itemId: string; refId: string; maxQty: number;
  }>({ open: false, returnType: 'assignment', itemId: '', refId: '', maxQty: 1 });
  const [submitting, setSubmitting] = useState(false);

  /* ---------- Check-in form ---------- */
  const [ciCondition, setCiCondition] = useState('good');
  const [ciNotes, setCiNotes] = useState('');

  /* ---------- Extend form ---------- */
  const [extendDate, setExtendDate] = useState('');

  /* ---------- Return form ---------- */
  const [retCondition, setRetCondition] = useState('good');
  const [retNotes, setRetNotes] = useState('');
  const [retQty, setRetQty] = useState(1);

  /* ---------- Request form ---------- */
  const [reqSearch, setReqSearch] = useState('');
  const [reqResults, setReqResults] = useState<InventoryItem[]>([]);
  const [reqSelected, setReqSelected] = useState<InventoryItem | null>(null);
  const [reqType, setReqType] = useState<'checkout' | 'assignment'>('checkout');
  const [reqPriority, setReqPriority] = useState<'normal' | 'high' | 'urgent'>('normal');
  const [reqQty, setReqQty] = useState(1);
  const [reqReason, setReqReason] = useState('');
  const [reqSearching, setReqSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------- Load data ---------- */
  const loadInventory = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const data = await inventoryService.getUserInventory(user.id);
      setInventory(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load your equipment'));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const loadRequests = useCallback(async () => {
    try {
      const [eqData, retData] = await Promise.all([
        inventoryService.getEquipmentRequests({ mine_only: true }),
        inventoryService.getReturnRequests({ mine_only: true }),
      ]);
      setEquipRequests(eqData.requests ?? []);
      setReturnRequests(retData ?? []);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load requests'));
    }
  }, []);

  useEffect(() => { void loadInventory(); }, [loadInventory]);
  useEffect(() => { if (showRequests) void loadRequests(); }, [showRequests, loadRequests]);

  /* ---------- Quick stats ---------- */
  const assignments = inventory?.permanent_assignments ?? [];
  const checkouts = inventory?.active_checkouts ?? [];
  const issued = inventory?.issued_items ?? [];
  const overdueCount = checkouts.filter((c) => c.is_overdue).length;
  const pendingReqCount = equipRequests.filter((r) => r.status === 'pending').length;
  const totalItems = assignments.length + checkouts.length + issued.length;

  /* ---------- Item search for request modal ---------- */
  const handleReqSearch = useCallback((query: string) => {
    setReqSearch(query);
    setReqSelected(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) { setReqResults([]); return; }
    searchTimer.current = setTimeout(() => { void (async () => {
      setReqSearching(true);
      try {
        const data = await inventoryService.getItems({ search: query, status: 'available', limit: 15 });
        const items = data.items ?? [];
        // Filter by rank / position eligibility
        const userRank = ranks.find((r) => r.rank_code === user?.rank);
        const userOrder = userRank?.sort_order ?? 0;
        const userPositions = user?.positions ?? [];
        const eligible = items.filter((item) => {
          if (item.min_rank_order != null && userOrder < item.min_rank_order) return false;
          if (item.restricted_to_positions && item.restricted_to_positions.length > 0) {
            return item.restricted_to_positions.some((p) => userPositions.includes(p));
          }
          return true;
        });
        setReqResults(eligible);
      } catch {
        setReqResults([]);
      } finally {
        setReqSearching(false);
      }
    })(); }, 300);
  }, [ranks, user?.rank, user?.positions]);

  /* ---------- Submit equipment request ---------- */
  const submitRequest = async () => {
    if (!reqSelected) { toast.error('Select an item first'); return; }
    setSubmitting(true);
    try {
      await inventoryService.createEquipmentRequest({
        item_name: reqSelected.name,
        item_id: reqSelected.id,
        category_id: reqSelected.category_id || undefined,
        quantity: reqSelected.tracking_type === 'pool' ? reqQty : 1,
        request_type: reqType,
        priority: reqPriority,
        reason: reqReason.trim() || undefined,
      });
      toast.success('Equipment request submitted');
      setRequestModal(false);
      resetRequestForm();
      if (showRequests) void loadRequests();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to submit request'));
    } finally {
      setSubmitting(false);
    }
  };

  const resetRequestForm = () => {
    setReqSearch(''); setReqResults([]); setReqSelected(null);
    setReqType('checkout'); setReqPriority('normal'); setReqQty(1); setReqReason('');
  };

  /* ---------- Check in ---------- */
  const handleCheckIn = async () => {
    setSubmitting(true);
    try {
      await inventoryService.checkInItem(checkInModal.checkoutId, ciCondition, ciNotes.trim() || undefined);
      toast.success('Item checked in');
      setCheckInModal({ open: false, checkoutId: '' });
      setCiCondition('good'); setCiNotes('');
      void loadInventory();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to check in'));
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- Extend checkout ---------- */
  const handleExtend = async () => {
    if (!extendDate) { toast.error('Select a new return date'); return; }
    setSubmitting(true);
    try {
      await inventoryService.extendCheckout(extendModal.checkoutId, new Date(extendDate).toISOString());
      toast.success('Checkout extended');
      setExtendModal({ open: false, checkoutId: '' }); setExtendDate('');
      void loadInventory();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to extend checkout'));
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- Return request ---------- */
  const handleReturnRequest = async () => {
    setSubmitting(true);
    const refKey = returnModal.returnType === 'assignment' ? 'assignment_id'
      : returnModal.returnType === 'issuance' ? 'issuance_id' : 'checkout_id';
    try {
      await inventoryService.createReturnRequest({
        return_type: returnModal.returnType,
        item_id: returnModal.itemId,
        [refKey]: returnModal.refId,
        quantity_returning: returnModal.returnType === 'issuance' ? retQty : undefined,
        reported_condition: retCondition || undefined,
        member_notes: retNotes.trim() || undefined,
      });
      toast.success('Return request submitted');
      setReturnModal({ open: false, returnType: 'assignment', itemId: '', refId: '', maxQty: 1 });
      setRetCondition('good'); setRetNotes(''); setRetQty(1);
      if (showRequests) void loadRequests();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to submit return request'));
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- Shared styles ---------- */
  const inputClass = 'form-input';
  const selectClass = 'form-input';
  const labelClass = 'form-label';

  if (loading && !inventory) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Package className="h-6 w-6 text-theme-text-primary" />
            <h1 className="text-2xl font-bold text-theme-text-primary">My Equipment</h1>
            <span className="text-sm text-theme-text-muted">({totalItems} items)</span>
          </div>
          <button
            type="button"
            onClick={() => void loadInventory()}
            className="inline-flex items-center gap-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={<CheckCircle className="h-5 w-5 text-blue-500" />} label="Assignments" value={assignments.length} />
          <StatCard
            icon={<Clock className="h-5 w-5 text-yellow-500" />}
            label="Checkouts"
            value={checkouts.length}
            extra={overdueCount > 0 ? <span className="text-xs text-red-600 dark:text-red-400 font-medium">{overdueCount} overdue</span> : undefined}
          />
          <StatCard icon={<Package className="h-5 w-5 text-green-500" />} label="Issued" value={issued.length} />
          <StatCard icon={<ClipboardList className="h-5 w-5 text-purple-500" />} label="Pending" value={pendingReqCount} />
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setRequestModal(true)} className="btn-info btn-md inline-flex items-center gap-1.5">
            <Plus className="h-4 w-4" /> Request Equipment
          </button>
          <button
            type="button"
            onClick={() => setShowRequests(!showRequests)}
            className="btn-secondary btn-md inline-flex items-center gap-1.5"
          >
            <ClipboardList className="h-4 w-4" /> {showRequests ? 'Hide' : 'My'} Requests
          </button>
        </div>

        {/* My Requests Panel */}
        {showRequests && (
          <div className="card-secondary p-4 space-y-4">
            <h2 className="text-lg font-semibold text-theme-text-primary">My Requests</h2>
            {equipRequests.length === 0 && returnRequests.length === 0 && (
              <p className="text-sm text-theme-text-muted">No requests found.</p>
            )}
            {equipRequests.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-theme-text-secondary mb-2">Equipment Requests</h3>
                <div className="space-y-2">
                  {equipRequests.map((r) => (
                    <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2 rounded bg-theme-surface-secondary/50 text-sm">
                      <div className="min-w-0">
                        <span className="font-medium text-theme-text-primary truncate block sm:inline">{r.item_name}</span>
                        <span className="text-theme-text-muted ml-0 sm:ml-2 text-xs block sm:inline">{r.request_type} &middot; {formatDate(r.created_at, tz)}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 self-start sm:self-auto ${STATUS_BADGE[r.status] ?? 'text-theme-text-muted'}`}>{r.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {returnRequests.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-theme-text-secondary mb-2">Return Requests</h3>
                <div className="space-y-2">
                  {returnRequests.map((r) => (
                    <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2 rounded bg-theme-surface-secondary/50 text-sm">
                      <div className="min-w-0">
                        <span className="font-medium text-theme-text-primary truncate block sm:inline">{r.item_name}</span>
                        <span className="text-theme-text-muted ml-0 sm:ml-2 text-xs block sm:inline">{r.return_type} &middot; {formatDate(r.created_at, tz)}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 self-start sm:self-auto ${STATUS_BADGE[r.status] ?? 'text-theme-text-muted'}`}>{r.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Permanent Assignments */}
        <Section title="Permanent Assignments" count={assignments.length} icon={<CheckCircle className="h-4 w-4 text-blue-500" />}>
          {assignments.length === 0 && <p className="text-sm text-theme-text-muted py-2">No permanent assignments.</p>}
          {assignments.map((a) => (
            <div key={a.assignment_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-md bg-theme-surface-secondary/50">
              <div className="space-y-1">
                <Link to={`/inventory/items/${a.item_id}`} className="font-medium text-theme-text-primary hover:underline">{a.item_name}</Link>
                <div className="flex flex-wrap gap-2 text-xs text-theme-text-muted">
                  {a.serial_number && <span>SN: {a.serial_number}</span>}
                  {a.asset_tag && <span>Tag: {a.asset_tag}</span>}
                  <span className={getConditionColor(a.condition)}>{a.condition}</span>
                  <span>Assigned {formatDate(a.assigned_date, tz)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReturnModal({ open: true, returnType: 'assignment', itemId: a.item_id, refId: a.assignment_id, maxQty: 1 })}
                className="text-xs px-3 py-1.5 rounded border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary transition-colors whitespace-nowrap"
              >
                <CornerDownLeft className="h-3 w-3 inline mr-1" />Request Return
              </button>
            </div>
          ))}
        </Section>

        {/* Active Checkouts */}
        <Section
          title="Active Checkouts"
          count={checkouts.length}
          icon={<Clock className="h-4 w-4 text-yellow-500" />}
        >
          {checkouts.length === 0 && <p className="text-sm text-theme-text-muted py-2">No active checkouts.</p>}
          {checkouts.map((c) => (
            <div key={c.checkout_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-md bg-theme-surface-secondary/50">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Link to={`/inventory/items/${c.item_id}`} className="font-medium text-theme-text-primary hover:underline">{c.item_name}</Link>
                  {c.is_overdue && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30">
                      <AlertTriangle className="h-3 w-3" /> Overdue
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-theme-text-muted">
                  <span>Out: {formatDate(c.checked_out_at, tz)}</span>
                  {c.expected_return_at && <span>Due: {formatDate(c.expected_return_at, tz)}</span>}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:flex-wrap">
                <button
                  type="button"
                  onClick={() => { setCiCondition('good'); setCiNotes(''); setCheckInModal({ open: true, checkoutId: c.checkout_id }); }}
                  className="text-xs px-3 py-2 sm:py-1.5 rounded border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary active:bg-theme-surface-secondary transition-colors whitespace-nowrap"
                >
                  Check In
                </button>
                <button
                  type="button"
                  onClick={() => { setExtendDate(''); setExtendModal({ open: true, checkoutId: c.checkout_id }); }}
                  className="text-xs px-3 py-2 sm:py-1.5 rounded border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary active:bg-theme-surface-secondary transition-colors whitespace-nowrap"
                >
                  <CalendarClock className="h-3 w-3 inline mr-1" />Extend
                </button>
                <button
                  type="button"
                  onClick={() => setReturnModal({ open: true, returnType: 'checkout', itemId: c.item_id, refId: c.checkout_id, maxQty: 1 })}
                  className="text-xs px-3 py-2 sm:py-1.5 rounded border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary active:bg-theme-surface-secondary transition-colors whitespace-nowrap"
                >
                  <CornerDownLeft className="h-3 w-3 inline mr-1" />Request Return
                </button>
              </div>
            </div>
          ))}
        </Section>

        {/* Issued Items */}
        <Section title="Issued Items" count={issued.length} icon={<Package className="h-4 w-4 text-green-500" />}>
          {issued.length === 0 && <p className="text-sm text-theme-text-muted py-2">No issued items.</p>}
          {issued.map((iss) => (
            <div key={iss.issuance_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-md bg-theme-surface-secondary/50">
              <div className="space-y-1">
                <Link to={`/inventory/items/${iss.item_id}`} className="font-medium text-theme-text-primary hover:underline">{iss.item_name}</Link>
                <div className="flex flex-wrap gap-2 text-xs text-theme-text-muted">
                  <span>Qty: {iss.quantity_issued}</span>
                  {iss.size && <span>Size: {iss.size}</span>}
                  <span>Issued {formatDate(iss.issued_at, tz)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setRetQty(1); setReturnModal({ open: true, returnType: 'issuance', itemId: iss.item_id, refId: iss.issuance_id, maxQty: iss.quantity_issued }); }}
                className="text-xs px-3 py-1.5 rounded border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary transition-colors whitespace-nowrap"
              >
                <CornerDownLeft className="h-3 w-3 inline mr-1" />Request Return
              </button>
            </div>
          ))}
        </Section>

        {/* ===== MODALS ===== */}

        {/* Request Equipment Modal */}
        <Modal isOpen={requestModal} onClose={() => { setRequestModal(false); resetRequestForm(); }} title="Request Equipment" size="md">
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Search Items</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-text-muted" />
                <input
                  type="text"
                  value={reqSearch}
                  onChange={(e) => handleReqSearch(e.target.value)}
                  placeholder="Search available items..."
                  className={`${inputClass} pl-9`}
                />
                {reqSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-theme-text-muted" />}
              </div>
              {reqResults.length > 0 && !reqSelected && (
                <ul className="mt-1 max-h-40 overflow-y-auto border border-theme-surface-border rounded-md bg-theme-surface divide-y divide-theme-surface-border">
                  {reqResults.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => { setReqSelected(item); setReqSearch(item.name); setReqResults([]); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-theme-surface-secondary/50 text-theme-text-primary"
                      >
                        {item.name}
                        {item.serial_number && <span className="text-theme-text-muted ml-2">SN: {item.serial_number}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {reqSelected && (
                <p className="mt-1 text-xs text-theme-text-muted">
                  Selected: <span className="font-medium text-theme-text-primary">{reqSelected.name}</span>
                  {reqSelected.tracking_type === 'pool' && ` (pool — ${reqSelected.quantity - reqSelected.quantity_issued} available)`}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Request Type</label>
                <select value={reqType} onChange={(e) => setReqType(e.target.value as 'checkout' | 'assignment')} className={selectClass}>
                  <option value="checkout">Checkout</option>
                  <option value="assignment">Assignment</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Priority</label>
                <select value={reqPriority} onChange={(e) => setReqPriority(e.target.value as 'normal' | 'high' | 'urgent')} className={selectClass}>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            {reqSelected?.tracking_type === 'pool' && (
              <div>
                <label className={labelClass}>Quantity</label>
                <input type="number" min={1} max={reqSelected.quantity - reqSelected.quantity_issued} value={reqQty} onChange={(e) => setReqQty(Number(e.target.value))} className={inputClass} />
              </div>
            )}

            <div>
              <label className={labelClass}>Reason (optional)</label>
              <textarea rows={3} value={reqReason} onChange={(e) => setReqReason(e.target.value)} className={inputClass} placeholder="Why do you need this item?" />
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setRequestModal(false); resetRequestForm(); }} className="btn-secondary btn-md">
                Cancel
              </button>
              <button type="button" onClick={() => void submitRequest()} disabled={!reqSelected || submitting} className="btn-info btn-md disabled:opacity-50 text-center">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null}Submit Request
              </button>
            </div>
          </div>
        </Modal>

        {/* Check-In Modal */}
        <Modal isOpen={checkInModal.open} onClose={() => setCheckInModal({ open: false, checkoutId: '' })} title="Check In Item" size="sm">
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Condition</label>
              <select value={ciCondition} onChange={(e) => setCiCondition(e.target.value)} className={selectClass}>
                {RETURN_CONDITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Damage Notes (optional)</label>
              <textarea rows={3} value={ciNotes} onChange={(e) => setCiNotes(e.target.value)} className={inputClass} placeholder="Describe any damage..." />
            </div>
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
              <button type="button" onClick={() => setCheckInModal({ open: false, checkoutId: '' })} className="btn-secondary btn-md">
                Cancel
              </button>
              <button type="button" onClick={() => void handleCheckIn()} disabled={submitting} className="btn-info btn-md disabled:opacity-50 text-center">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null}Check In
              </button>
            </div>
          </div>
        </Modal>

        {/* Extend Checkout Modal */}
        <Modal isOpen={extendModal.open} onClose={() => setExtendModal({ open: false, checkoutId: '' })} title="Extend Checkout" size="sm">
          <div className="space-y-4">
            <div>
              <label className={labelClass}>New Return Date</label>
              <input type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)} className={inputClass} />
            </div>
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
              <button type="button" onClick={() => setExtendModal({ open: false, checkoutId: '' })} className="btn-secondary btn-md">
                Cancel
              </button>
              <button type="button" onClick={() => void handleExtend()} disabled={!extendDate || submitting} className="btn-info btn-md disabled:opacity-50 text-center">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null}Extend
              </button>
            </div>
          </div>
        </Modal>

        {/* Return Request Modal */}
        <Modal isOpen={returnModal.open} onClose={() => setReturnModal({ open: false, returnType: 'assignment', itemId: '', refId: '', maxQty: 1 })} title="Request Return" size="sm">
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Condition</label>
              <select value={retCondition} onChange={(e) => setRetCondition(e.target.value)} className={selectClass}>
                {RETURN_CONDITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {returnModal.returnType === 'issuance' && returnModal.maxQty > 1 && (
              <div>
                <label className={labelClass}>Quantity Returning</label>
                <input type="number" min={1} max={returnModal.maxQty} value={retQty} onChange={(e) => setRetQty(Number(e.target.value))} className={inputClass} />
              </div>
            )}
            <div>
              <label className={labelClass}>Notes (optional)</label>
              <textarea rows={3} value={retNotes} onChange={(e) => setRetNotes(e.target.value)} className={inputClass} placeholder="Any notes for the quartermaster..." />
            </div>
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
              <button type="button" onClick={() => setReturnModal({ open: false, returnType: 'assignment', itemId: '', refId: '', maxQty: 1 })} className="btn-secondary btn-md">
                Cancel
              </button>
              <button type="button" onClick={() => void handleReturnRequest()} disabled={submitting} className="btn-info btn-md disabled:opacity-50 text-center">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null}Submit
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
};

/* ---------- Stat card ---------- */
const StatCard: React.FC<{
  icon: React.ReactNode; label: string; value: number; extra?: React.ReactNode;
}> = ({ icon, label, value, extra }) => (
  <div className="card-secondary p-3 flex items-center gap-3">
    {icon}
    <div>
      <p className="text-xl font-bold text-theme-text-primary">{value}</p>
      <p className="text-xs text-theme-text-muted">{label}</p>
      {extra}
    </div>
  </div>
);

export default MyEquipmentPage;
