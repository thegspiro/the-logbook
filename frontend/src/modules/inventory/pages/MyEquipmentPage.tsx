/**
 * My Equipment Page
 *
 * Personal equipment view for members — shows the gear a member holds
 * open-endedly (permanent assignments and pool issuances, in one list) plus
 * active temporary loans. Supports extend, return requests, and new
 * equipment requests.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router';
import {
  Package,
  AlertTriangle,
  Clock,
  RefreshCw,
  Plus,
  ClipboardList,
  CalendarClock,
  Search,
  CornerDownLeft,
  Loader2,
  ChevronDown,
  ChevronUp,
  Ruler,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type {
  UserInventoryResponse,
  UserInventoryItem,
  UserIssuedItem,
  InventoryItem,
  EquipmentRequestItem,
  ReturnRequestItem,
} from '../types';
import { getConditionColor, REQUEST_STATUS_BADGES } from '../types';
import { useAuthStore } from '../../../stores/authStore';
import { useRanks } from '../../../hooks/useRanks';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { onHandQuantity } from '../utils/onHand';
import { RETURN_CONDITION_OPTIONS } from '../../../constants/enums';
import { Modal } from '../../../components/Modal';
import { VariantCapsules } from '../components/VariantCapsules';
import { SizePreferencesModal } from '../components/SizePreferencesModal';
import toast from 'react-hot-toast';

/* ---------- Open-ended holdings, as one list ----------
   A permanent assignment (one serialized unit, `item_assignments`) and a pool
   issuance (N units drawn from bulk stock, `item_issuances`) are separate
   custody records with separate return endpoints, and they stay separate on
   the wire — the quartermaster screens depend on the distinction. A member
   holds both with no due date, so the difference is the stockroom's rather
   than theirs, and this page renders them as one list. Active temporary loans
   keep their own section: a due date is the one difference a member has to
   act on. */
type GearRow = {
  /** `assignment_id` and `issuance_id` are unrelated id spaces; prefix so a
      collision between the two cannot silently reuse a React key. */
  key: string;
  itemId: string;
  itemName: string;
  refId: string;
  receivedAt: string;
  maxQty: number;
} & ({ kind: 'assignment'; assignment: UserInventoryItem } | { kind: 'issuance'; issuance: UserIssuedItem });

/** Sort key for the merged list. Both timestamps are UTC ISO strings from the
    same serializer, but parse rather than compare lexically so a future
    offset-suffixed value cannot silently reorder the list. */
const receivedMs = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const mergeGear = (assignments: UserInventoryItem[], issued: UserIssuedItem[]): GearRow[] =>
  [
    ...assignments.map((a): GearRow => ({
      key: `assignment:${a.assignment_id}`,
      itemId: a.item_id,
      itemName: a.item_name,
      refId: a.assignment_id,
      receivedAt: a.assigned_date,
      maxQty: 1,
      kind: 'assignment',
      assignment: a,
    })),
    ...issued.map((i): GearRow => ({
      key: `issuance:${i.issuance_id}`,
      itemId: i.item_id,
      itemName: i.item_name,
      refId: i.issuance_id,
      receivedAt: i.issued_at,
      maxQty: i.quantity_issued,
      kind: 'issuance',
      issuance: i,
    })),
  ].sort((a, b) => receivedMs(b.receivedAt) - receivedMs(a.receivedAt) || a.itemName.localeCompare(b.itemName));

/* ---------- Collapsible section ---------- */
const Section: React.FC<{
  title: string;
  count: number;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, count, icon, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card-secondary overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="hover:bg-theme-surface-secondary/50 flex w-full items-center justify-between px-4 py-3 text-left transition-colors"
      >
        <div className="text-theme-text-primary flex items-center gap-2 font-medium">
          {icon}
          {title}
          <span className="text-theme-text-muted text-sm">({count})</span>
        </div>
        {open ? (
          <ChevronUp className="text-theme-text-muted h-4 w-4" />
        ) : (
          <ChevronDown className="text-theme-text-muted h-4 w-4" />
        )}
      </button>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
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
  const [showSizes, setShowSizes] = useState(false);

  /* ---------- Modals ---------- */
  const [requestModal, setRequestModal] = useState(false);
  const [extendModal, setExtendModal] = useState<{ open: boolean; checkoutId: string }>({
    open: false,
    checkoutId: '',
  });
  const [returnModal, setReturnModal] = useState<{
    open: boolean;
    returnType: 'assignment' | 'issuance' | 'checkout';
    itemId: string;
    refId: string;
    maxQty: number;
  }>({ open: false, returnType: 'assignment', itemId: '', refId: '', maxQty: 1 });
  const [submitting, setSubmitting] = useState(false);

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
  const [reqDuration, setReqDuration] = useState<'temporary' | 'ongoing'>('temporary');
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

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);
  useEffect(() => {
    if (showRequests) void loadRequests();
  }, [showRequests, loadRequests]);

  /* ---------- Quick stats ---------- */
  const assignments = inventory?.permanent_assignments ?? [];
  const checkouts = inventory?.active_checkouts ?? [];
  const issued = inventory?.issued_items ?? [];
  const myGear = mergeGear(assignments, issued);
  const overdueCount = checkouts.filter((c) => c.is_overdue).length;
  const pendingReqCount = equipRequests.filter((r) => r.status === 'pending').length;
  const totalItems = myGear.length + checkouts.length;

  /* ---------- Item search for request modal ---------- */
  const handleReqSearch = useCallback(
    (query: string) => {
      setReqSearch(query);
      setReqSelected(null);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (!query.trim()) {
        setReqResults([]);
        return;
      }
      searchTimer.current = setTimeout(() => {
        void (async () => {
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
        })();
      }, 300);
    },
    [ranks, user?.rank, user?.positions]
  );

  /* ---------- Submit equipment request ---------- */
  const submitRequest = async () => {
    if (!reqSelected) {
      toast.error('Select an item first');
      return;
    }
    setSubmitting(true);
    try {
      await inventoryService.createEquipmentRequest({
        item_name: reqSelected.name,
        item_id: reqSelected.id,
        category_id: reqSelected.category_id || undefined,
        quantity: reqSelected.tracking_type === 'pool' ? reqQty : 1,
        requested_duration: reqDuration,
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
    setReqSearch('');
    setReqResults([]);
    setReqSelected(null);
    setReqDuration('temporary');
    setReqQty(1);
    setReqReason('');
  };

  /* ---------- Extend checkout ---------- */
  const handleExtend = async () => {
    if (!extendDate) {
      toast.error('Select a new return date');
      return;
    }
    setSubmitting(true);
    try {
      await inventoryService.extendCheckout(extendModal.checkoutId, new Date(extendDate).toISOString());
      toast.success('Temporary loan extended');
      setExtendModal({ open: false, checkoutId: '' });
      setExtendDate('');
      void loadInventory();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to extend temporary loan'));
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- Return request ---------- */
  const handleReturnRequest = async () => {
    setSubmitting(true);
    const refKey =
      returnModal.returnType === 'assignment'
        ? 'assignment_id'
        : returnModal.returnType === 'issuance'
          ? 'issuance_id'
          : 'checkout_id';
    try {
      await inventoryService.createReturnRequest({
        return_type: returnModal.returnType,
        item_id: returnModal.itemId,
        [refKey]: returnModal.refId,
        quantity_returning: returnModal.returnType === 'issuance' ? retQty : undefined,
        reported_condition: retCondition || undefined,
        member_notes: retNotes.trim() || undefined,
      });
      toast.success('Quartermaster notified; keep the item until it is physically received');
      setReturnModal({ open: false, returnType: 'assignment', itemId: '', refId: '', maxQty: 1 });
      setRetCondition('good');
      setRetNotes('');
      setRetQty(1);
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
      <div className="flex min-h-[60dvh] items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <Package className="text-theme-text-primary h-6 w-6" />
            <h1 className="text-theme-text-primary text-2xl font-bold">My Issued Gear</h1>
            <span className="text-theme-text-muted text-sm">({totalItems} items)</span>
          </div>
          <button
            type="button"
            onClick={() => void loadInventory()}
            className="text-theme-text-muted hover:text-theme-text-primary inline-flex items-center gap-1.5 text-sm transition-colors max-md:min-h-[44px]"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard icon={<Package className="h-5 w-5 text-green-500" />} label="Issued to me" value={myGear.length} />
          <StatCard
            icon={<Clock className="h-5 w-5 text-yellow-500" />}
            label="Temporary loans"
            value={checkouts.length}
            extra={
              overdueCount > 0 ? (
                <span className="text-xs font-medium text-red-600 dark:text-red-400">{overdueCount} overdue</span>
              ) : undefined
            }
          />
          <StatCard
            icon={<ClipboardList className="h-5 w-5 text-purple-500" />}
            label="Pending"
            value={pendingReqCount}
          />
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setRequestModal(true)}
            className="btn-info btn-md inline-flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" /> Request Equipment
          </button>
          <button
            type="button"
            onClick={() => setShowRequests(!showRequests)}
            className="btn-secondary btn-md inline-flex items-center gap-1.5"
          >
            <ClipboardList className="h-4 w-4" /> {showRequests ? 'Hide' : 'My'} Requests
          </button>
          <button
            type="button"
            onClick={() => setShowSizes(true)}
            className="btn-secondary btn-md inline-flex items-center gap-1.5"
          >
            <Ruler className="h-4 w-4" /> My Sizes
          </button>
        </div>

        {/* My Requests Panel */}
        {showRequests && (
          <div className="card-secondary space-y-4 p-4">
            <h2 className="text-theme-text-primary text-lg font-semibold">My Requests</h2>
            {equipRequests.length === 0 && returnRequests.length === 0 && (
              <p className="text-theme-text-muted text-sm">No requests found.</p>
            )}
            {equipRequests.length > 0 && (
              <div>
                <h3 className="text-theme-text-secondary mb-2 text-sm font-medium">Gear Requests</h3>
                <div className="space-y-2">
                  {equipRequests.map((r) => (
                    <div
                      key={r.id}
                      className="bg-theme-surface-secondary/50 flex flex-col justify-between gap-1 rounded p-2 text-sm sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0">
                        <span className="text-theme-text-primary block truncate font-medium sm:inline">
                          {r.item_name}
                        </span>
                        <span className="text-theme-text-muted ml-0 block text-xs sm:ml-2 sm:inline">
                          {r.requested_duration === 'ongoing' ? 'Ongoing need' : 'Temporary need'} &middot;{' '}
                          {formatDate(r.created_at, tz)}
                        </span>
                      </div>
                      <span
                        className={`shrink-0 self-start rounded-full px-2 py-0.5 text-xs font-medium sm:self-auto ${REQUEST_STATUS_BADGES[r.status] ?? 'text-theme-text-muted'}`}
                      >
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {returnRequests.length > 0 && (
              <div>
                <h3 className="text-theme-text-secondary mb-2 text-sm font-medium">Return Requests</h3>
                <div className="space-y-2">
                  {returnRequests.map((r) => (
                    <div
                      key={r.id}
                      className="bg-theme-surface-secondary/50 flex flex-col justify-between gap-1 rounded p-2 text-sm sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0">
                        <span className="text-theme-text-primary block truncate font-medium sm:inline">
                          {r.item_name}
                        </span>
                        <span className="text-theme-text-muted ml-0 block text-xs sm:ml-2 sm:inline">
                          {r.return_type} &middot; {formatDate(r.created_at, tz)}
                        </span>
                      </div>
                      <span
                        className={`shrink-0 self-start rounded-full px-2 py-0.5 text-xs font-medium sm:self-auto ${REQUEST_STATUS_BADGES[r.status] ?? 'text-theme-text-muted'}`}
                      >
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Gear held open-endedly: assignments and pool issuances together */}
        <Section title="Issued to Me" count={myGear.length} icon={<Package className="h-4 w-4 text-green-500" />}>
          {myGear.length === 0 && <p className="text-theme-text-muted py-2 text-sm">Nothing issued to you.</p>}
          {myGear.map((g) => (
            <div
              key={g.key}
              className="bg-theme-surface-secondary/50 flex flex-col justify-between gap-2 rounded-md p-3 sm:flex-row sm:items-center"
            >
              <div className="space-y-1">
                <Link
                  to={`/inventory/items/${g.itemId}`}
                  className="text-theme-text-primary font-medium hover:underline"
                >
                  {g.itemName}
                </Link>
                <div className="text-theme-text-muted flex flex-wrap gap-2 text-xs">
                  {g.kind === 'assignment' ? (
                    <>
                      {g.assignment.serial_number && <span>SN: {g.assignment.serial_number}</span>}
                      {g.assignment.asset_tag && <span>Tag: {g.assignment.asset_tag}</span>}
                      {/* `capitalize` as on the items list: condition is stored
                          lowercase, and without it a member's own kit reads "good"
                          where the same value on every other screen reads "Good". */}
                      <span className={`capitalize ${getConditionColor(g.assignment.condition)}`}>
                        {g.assignment.condition}
                      </span>
                      <span>Assigned {formatDate(g.receivedAt, tz)}</span>
                    </>
                  ) : (
                    <>
                      <span>Qty: {g.issuance.quantity_issued}</span>
                      <VariantCapsules item={{ size: g.issuance.size } as InventoryItem} />
                      <span>Issued {formatDate(g.receivedAt, tz)}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                // One list now carries rows whose return actions hit different
                // endpoints; naming the item keeps the buttons distinguishable
                // to a screen reader instead of repeating one label per row.
                aria-label={`Notify quartermaster of return: ${g.itemName}`}
                onClick={() => {
                  setRetQty(1);
                  setReturnModal({
                    open: true,
                    returnType: g.kind,
                    itemId: g.itemId,
                    refId: g.refId,
                    maxQty: g.maxQty,
                  });
                }}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary rounded border px-3 py-1.5 text-xs whitespace-nowrap transition-colors"
              >
                <CornerDownLeft className="mr-1 inline h-3 w-3" />
                Notify quartermaster of return
              </button>
            </div>
          ))}
        </Section>

        {/* Active temporary loans */}
        <Section
          title="Active Temporary Loans"
          count={checkouts.length}
          icon={<Clock className="h-4 w-4 text-yellow-500" />}
        >
          {checkouts.length === 0 && <p className="text-theme-text-muted py-2 text-sm">No active temporary loans.</p>}
          {checkouts.map((c) => (
            <div
              key={c.checkout_id}
              className="bg-theme-surface-secondary/50 flex flex-col justify-between gap-2 rounded-md p-3 sm:flex-row sm:items-center"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/inventory/items/${c.item_id}`}
                    className="text-theme-text-primary font-medium hover:underline"
                  >
                    {c.item_name}
                  </Link>
                  {c.is_overdue && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                      <AlertTriangle className="h-3 w-3" /> Overdue
                    </span>
                  )}
                </div>
                <div className="text-theme-text-muted flex flex-wrap gap-2 text-xs">
                  <span>Loaned: {formatDate(c.checked_out_at, tz)}</span>
                  {c.expected_return_at && <span>Due: {formatDate(c.expected_return_at, tz)}</span>}
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setExtendDate('');
                    setExtendModal({ open: true, checkoutId: c.checkout_id });
                  }}
                  className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary active:bg-theme-surface-secondary rounded border px-3 py-2 text-xs whitespace-nowrap transition-colors sm:py-1.5"
                >
                  <CalendarClock className="mr-1 inline h-3 w-3" />
                  Extend
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setReturnModal({
                      open: true,
                      returnType: 'checkout',
                      itemId: c.item_id,
                      refId: c.checkout_id,
                      maxQty: 1,
                    })
                  }
                  className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary active:bg-theme-surface-secondary rounded border px-3 py-2 text-xs whitespace-nowrap transition-colors sm:py-1.5"
                >
                  <CornerDownLeft className="mr-1 inline h-3 w-3" />
                  Notify quartermaster of return
                </button>
              </div>
            </div>
          ))}
        </Section>

        {/* ===== MODALS ===== */}

        {/* Request Equipment Modal */}
        <Modal
          isOpen={requestModal}
          onClose={() => {
            setRequestModal(false);
            resetRequestForm();
          }}
          title="Request Equipment"
          size="md"
        >
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Search Items</label>
              <div className="relative">
                <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <input
                  type="text"
                  value={reqSearch}
                  onChange={(e) => handleReqSearch(e.target.value)}
                  aria-label="Search available items..."
                  placeholder="Search available items..."
                  className={`${inputClass} pl-9`}
                />
                {reqSearching && (
                  <Loader2 className="text-theme-text-muted absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
                )}
              </div>
              {reqResults.length > 0 && !reqSelected && (
                <ul className="card divide-theme-surface-border mt-1 max-h-40 divide-y overflow-y-auto">
                  {reqResults.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setReqSelected(item);
                          setReqSearch(item.name);
                          setReqResults([]);
                        }}
                        className="hover:bg-theme-surface-secondary/50 text-theme-text-primary w-full px-3 py-2 text-left text-sm"
                      >
                        {item.name}
                        {item.serial_number && (
                          <span className="text-theme-text-muted ml-2">SN: {item.serial_number}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {reqSelected && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  Selected: <span className="text-theme-text-primary font-medium">{reqSelected.name}</span>
                  {reqSelected.tracking_type === 'pool' && ` (pool — ${onHandQuantity(reqSelected)} available)`}
                </p>
              )}
            </div>

            <div>
              <div>
                <label className={labelClass} htmlFor="requested-duration">
                  How long do you need it?
                </label>
                <select
                  id="requested-duration"
                  value={reqDuration}
                  onChange={(e) => setReqDuration(e.target.value as 'temporary' | 'ongoing')}
                  className={selectClass}
                >
                  <option value="temporary">Temporary — I expect to return it</option>
                  <option value="ongoing">Ongoing — I need it as regular assigned gear</option>
                </select>
                <p className="text-theme-text-muted mt-1 text-xs">
                  Choose Temporary if you expect to return the item, or Ongoing if you need it as regular assigned gear.
                  The quartermaster will determine the final issue method based on item availability and department
                  policy.
                </p>
              </div>
            </div>

            {reqSelected?.tracking_type === 'pool' && (
              <div>
                <label className={labelClass} htmlFor="request-quantity">
                  Quantity
                </label>
                <input
                  id="request-quantity"
                  type="number"
                  min={1}
                  max={onHandQuantity(reqSelected)}
                  value={reqQty}
                  onChange={(e) => setReqQty(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            )}

            <div>
              <label className={labelClass}>Reason (optional)</label>
              <textarea
                rows={3}
                value={reqReason}
                onChange={(e) => setReqReason(e.target.value)}
                className={inputClass}
                placeholder="Why do you need this item?"
              />
            </div>

            <div className="flex flex-col-reverse items-stretch justify-end gap-2 pt-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => {
                  setRequestModal(false);
                  resetRequestForm();
                }}
                className="btn-secondary btn-md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitRequest()}
                disabled={!reqSelected || submitting}
                className="btn-info btn-md text-center disabled:opacity-50"
              >
                {submitting ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}Submit Request
              </button>
            </div>
          </div>
        </Modal>

        {/* Extend Checkout Modal */}
        <Modal
          isOpen={extendModal.open}
          onClose={() => setExtendModal({ open: false, checkoutId: '' })}
          title="Extend Temporary Loan"
          size="sm"
        >
          <div className="space-y-4">
            <div>
              <label className={labelClass}>New Return Date</label>
              <input
                type="date"
                value={extendDate}
                onChange={(e) => setExtendDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col-reverse items-stretch justify-end gap-2 pt-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => setExtendModal({ open: false, checkoutId: '' })}
                className="btn-secondary btn-md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleExtend()}
                disabled={!extendDate || submitting}
                className="btn-info btn-md text-center disabled:opacity-50"
              >
                {submitting ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}Extend
              </button>
            </div>
          </div>
        </Modal>

        {/* Return Request Modal */}
        <Modal
          isOpen={returnModal.open}
          onClose={() => setReturnModal({ open: false, returnType: 'assignment', itemId: '', refId: '', maxQty: 1 })}
          title="Notify quartermaster of return"
          size="sm"
        >
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Condition</label>
              <select value={retCondition} onChange={(e) => setRetCondition(e.target.value)} className={selectClass}>
                {RETURN_CONDITION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {returnModal.returnType === 'issuance' && returnModal.maxQty > 1 && (
              <div>
                <label className={labelClass}>Quantity Returning</label>
                <input
                  type="number"
                  min={1}
                  max={returnModal.maxQty}
                  value={retQty}
                  onChange={(e) => setRetQty(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            )}
            <div>
              <label className={labelClass}>Notes (optional)</label>
              <textarea
                rows={3}
                value={retNotes}
                onChange={(e) => setRetNotes(e.target.value)}
                className={inputClass}
                placeholder="Any notes for the quartermaster..."
              />
            </div>
            <div className="flex flex-col-reverse items-stretch justify-end gap-2 pt-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() =>
                  setReturnModal({ open: false, returnType: 'assignment', itemId: '', refId: '', maxQty: 1 })
                }
                className="btn-secondary btn-md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleReturnRequest()}
                disabled={submitting}
                className="btn-info btn-md text-center disabled:opacity-50"
              >
                {submitting ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}Submit
              </button>
            </div>
          </div>
        </Modal>

        {/* My Sizes (self-service) */}
        <SizePreferencesModal isOpen={showSizes} onClose={() => setShowSizes(false)} />
      </div>
    </div>
  );
};

/* ---------- Stat card ---------- */
const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  extra?: React.ReactNode;
}> = ({ icon, label, value, extra }) => (
  <div className="card-secondary flex items-center gap-3 p-3">
    {icon}
    <div>
      <p className="text-theme-text-primary text-xl font-bold">{value}</p>
      <p className="text-theme-text-muted text-xs">{label}</p>
      {extra}
    </div>
  </div>
);

export default MyEquipmentPage;
