/** PoolItemsPage — View for pool-tracked (quantity-based) inventory items. */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft,
  Package,
  Plus,
  Search,
  RefreshCw,
  AlertTriangle,
  Users,
  ArrowDownToLine,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { InventoryItem, InventoryCategory, ItemIssuance, AllowanceCheck, LowStockAlert } from '../types';
import type { MemberInventorySummary } from '../../../services/eventServices';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { RETURN_CONDITION_OPTIONS } from '../../../constants/enums';
import { Modal } from '../../../components/Modal';
import { Pagination } from '../../../components/ux/Pagination';
import { EmptyState } from '../../../components/ux/EmptyState';
import { VariantCapsules } from '../components/VariantCapsules';
import { getDisplayName } from '../utils/variantHelpers';
import toast from 'react-hot-toast';

interface SummaryCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, icon, accent }) => (
  <div className="card-secondary flex items-center gap-3 rounded-lg p-4">
    <div className={`rounded-lg p-2 ${accent ?? 'bg-theme-surface'}`}>{icon}</div>
    <div>
      <p className="text-theme-text-primary text-2xl font-bold">{value}</p>
      <p className="text-theme-text-muted text-sm">{label}</p>
    </div>
  </div>
);

interface StockBarProps {
  onHand: number;
  issued: number;
  total: number;
}

const StockBar: React.FC<StockBarProps> = ({ onHand, issued, total }) => {
  const onHandPct = total > 0 ? (onHand / total) * 100 : 0;
  const issuedPct = total > 0 ? (issued / total) * 100 : 0;
  return (
    <div
      className="bg-theme-surface flex h-3 w-full overflow-hidden rounded-full"
      title={`On-hand: ${onHand}  Issued: ${issued}`}
    >
      <div className="h-full bg-green-500 transition-all" style={{ width: `${onHandPct}%` }} />
      <div className="h-full bg-blue-500 transition-all" style={{ width: `${issuedPct}%` }} />
    </div>
  );
};

interface PoolCardProps {
  item: InventoryItem;
  categoryName: string;
  onIssue: (item: InventoryItem) => void;
  onReturn: (issuance: ItemIssuance) => void;
  issuances: ItemIssuance[];
  loadingIssuances: boolean;
  expanded: boolean;
  onToggle: () => void;
  onLoadIssuances: () => void;
}

const PoolCard: React.FC<PoolCardProps> = ({
  item,
  categoryName,
  onIssue,
  onReturn,
  issuances,
  loadingIssuances,
  expanded,
  onToggle,
  onLoadIssuances,
}) => {
  const tz = useTimezone();
  // `quantity` is the on-hand count, not the total owned: issuing decrements
  // it and increments quantity_issued, and a return reverses both. The total is
  // therefore the sum of the two — subtracting instead counted every issued
  // unit twice and showed a fully-issued item at a negative on-hand.
  const onHand = item.quantity;
  const total = item.quantity + item.quantity_issued;

  const handleToggle = () => {
    if (!expanded) void onLoadIssuances();
    onToggle();
  };

  return (
    <div className="card-secondary flex flex-col gap-3 rounded-lg p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-theme-text-primary truncate font-semibold">{getDisplayName(item)}</h3>
          <p className="text-theme-text-muted text-xs">{categoryName}</p>
        </div>
        {onHand <= 0 && (
          <span className="shrink-0 rounded bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
            Out of stock
          </span>
        )}
      </div>

      {/* Stock bar */}
      <StockBar onHand={onHand} issued={item.quantity_issued} total={total} />

      {/* Counts */}
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <span className="text-theme-text-muted">On-hand</span>
          <p className="font-semibold text-green-700 dark:text-green-400">{onHand}</p>
        </div>
        <div>
          <span className="text-theme-text-muted">Issued</span>
          <p className="font-semibold text-blue-700 dark:text-blue-400">{item.quantity_issued}</p>
        </div>
        <div>
          <span className="text-theme-text-muted">Total</span>
          <p className="text-theme-text-primary font-semibold">{total}</p>
        </div>
      </div>

      {/* Meta row */}
      <div className="text-theme-text-muted flex flex-wrap items-center gap-2 text-xs">
        {item.unit_of_measure && <span className="bg-theme-surface rounded px-2 py-0.5">{item.unit_of_measure}</span>}
        <VariantCapsules item={item} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          className="btn-info btn-sm flex items-center gap-1 disabled:opacity-50"
          disabled={onHand <= 0}
          onClick={() => onIssue(item)}
        >
          <ArrowDownToLine size={14} /> Issue
        </button>
        <button type="button" className="btn-secondary btn-sm flex items-center gap-1" onClick={handleToggle}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Issuances
        </button>
      </div>

      {/* Expandable issuance log */}
      {expanded && (
        <div className="border-theme-surface-border mt-1 border-t pt-3">
          {loadingIssuances ? (
            <div className="flex justify-center py-3" role="status" aria-live="polite">
              <Loader2 size={18} className="text-theme-text-muted animate-spin" />
            </div>
          ) : issuances.length === 0 ? (
            <p className="text-theme-text-muted py-2 text-center text-sm">No active issuances</p>
          ) : (
            <ul className="max-h-48 space-y-2 overflow-y-auto">
              {issuances
                .filter((i) => !i.is_returned)
                .map((iss) => (
                  <li
                    key={iss.id}
                    className="bg-theme-surface flex items-center justify-between rounded px-3 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="text-theme-text-primary">{iss.user_id.slice(0, 8)}...</span>
                      <span className="text-theme-text-muted ml-2">qty {iss.quantity_issued}</span>
                      <span className="text-theme-text-muted ml-2">{formatDate(iss.issued_at, tz)}</span>
                    </div>
                    <button type="button" className="btn-info shrink-0 px-3 py-2 text-xs" onClick={() => onReturn(iss)}>
                      Return
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

const PoolItemsPage: React.FC = () => {
  /* Data state */
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[]>([]);
  const [members, setMembers] = useState<MemberInventorySummary[]>([]);
  const [issuancesMap, setIssuancesMap] = useState<Record<string, ItemIssuance[]>>({});
  const [loadingIssuancesFor, setLoadingIssuancesFor] = useState<string | null>(null);

  /* UI state */
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  /* Modal state */
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [issueItem, setIssueItem] = useState<InventoryItem | null>(null);
  const [issueUserId, setIssueUserId] = useState('');
  const [issueQty, setIssueQty] = useState(1);
  const [issueReason, setIssueReason] = useState('');
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [allowanceCheck, setAllowanceCheck] = useState<AllowanceCheck | null>(null);
  const [issueOverride, setIssueOverride] = useState(false);

  /* Return modal state */
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnIssuance, setReturnIssuance] = useState<ItemIssuance | null>(null);
  const [returnCondition, setReturnCondition] = useState('good');
  const [returnNotes, setReturnNotes] = useState('');
  const [returnQty, setReturnQty] = useState(1);
  const [returnSubmitting, setReturnSubmitting] = useState(false);

  /* Pagination */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);

  /* Bulk issue modal state */
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkItemId, setBulkItemId] = useState('');
  const [bulkRows, setBulkRows] = useState<Array<{ userId: string; qty: number }>>([{ userId: '', qty: 1 }]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const categoryMap = useCallback((): Record<string, string> => {
    const m: Record<string, string> = {};
    for (const c of categories) {
      m[c.id] = c.name;
    }
    return m;
  }, [categories]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsRes, cats, alerts, membersRes] = await Promise.all([
        inventoryService.getItems({ active_only: true, limit: 500 }),
        inventoryService.getCategories(),
        inventoryService.getLowStockItems(),
        inventoryService.getMembersSummary(),
      ]);
      setItems(itemsRes.items.filter((i) => i.tracking_type === 'pool'));
      setCategories(cats);
      setLowStockAlerts(alerts);
      setMembers(membersRes.members);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load pool items'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadIssuances = useCallback(
    async (itemId: string) => {
      if (issuancesMap[itemId]) return;
      setLoadingIssuancesFor(itemId);
      try {
        const data = await inventoryService.getItemIssuances(itemId, true);
        setIssuancesMap((prev) => ({ ...prev, [itemId]: data }));
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load issuances'));
      } finally {
        setLoadingIssuancesFor(null);
      }
    },
    [issuancesMap]
  );

  /* Filtering */
  const filtered = items.filter((item) => {
    if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (categoryFilter && item.category_id !== categoryFilter) return false;
    if (lowStockOnly) {
      const onHand = item.quantity;
      const cat = categories.find((c) => c.id === item.category_id);
      const threshold = cat?.low_stock_threshold ?? 0;
      if (onHand > threshold) return false;
    }
    return true;
  });

  const totalOnHand = items.reduce((s, i) => s + i.quantity, 0);
  const totalIssued = items.reduce((s, i) => s + i.quantity_issued, 0);
  const lowStockCount = lowStockAlerts.length;

  const openIssueModal = (item: InventoryItem) => {
    setIssueItem(item);
    setIssueUserId('');
    setIssueQty(1);
    setIssueReason('');
    setMemberSearch('');
    setAllowanceCheck(null);
    setIssueOverride(false);
    setIssueModalOpen(true);
  };

  const handleSelectMember = async (userId: string) => {
    setIssueUserId(userId);
    if (!issueItem?.category_id) return;
    try {
      const check = await inventoryService.checkAllowance(userId, issueItem.category_id);
      setAllowanceCheck(check);
    } catch {
      setAllowanceCheck(null);
    }
  };

  const handleIssue = async () => {
    if (!issueItem || !issueUserId) return;
    setIssueSubmitting(true);
    try {
      await inventoryService.issueFromPool(
        issueItem.id,
        issueUserId,
        issueQty,
        issueReason.trim() || undefined,
        issueOverride
      );
      toast.success(`Issued ${issueQty} ${issueItem.name}`);
      setIssueModalOpen(false);
      // Clear cached issuances for this item so they reload
      setIssuancesMap((prev) => {
        const n = { ...prev };
        delete n[issueItem.id];
        return n;
      });
      void loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Issue failed'));
    } finally {
      setIssueSubmitting(false);
    }
  };

  const filteredMembers = members.filter((m) => {
    if (!memberSearch) return true;
    const q = memberSearch.toLowerCase();
    const name = (m.full_name ?? `${m.first_name ?? ''} ${m.last_name ?? ''}`).toLowerCase();
    return name.includes(q) || (m.membership_number ?? '').toLowerCase().includes(q);
  });

  const openReturnModal = (iss: ItemIssuance) => {
    setReturnIssuance(iss);
    setReturnCondition('good');
    setReturnNotes('');
    setReturnQty(iss.quantity_issued);
    setReturnModalOpen(true);
  };

  const handleReturn = async () => {
    if (!returnIssuance) return;
    setReturnSubmitting(true);
    try {
      const returnOpts: { return_condition: string; quantity_returned: number; return_notes?: string } = {
        return_condition: returnCondition,
        quantity_returned: returnQty,
      };
      if (returnNotes.trim()) returnOpts.return_notes = returnNotes.trim();
      await inventoryService.returnToPool(returnIssuance.id, returnOpts);
      toast.success('Item returned to pool');
      setReturnModalOpen(false);
      setIssuancesMap((prev) => {
        const n = { ...prev };
        delete n[returnIssuance.item_id];
        return n;
      });
      void loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Return failed'));
    } finally {
      setReturnSubmitting(false);
    }
  };

  const openBulkModal = () => {
    setBulkItemId('');
    setBulkRows([{ userId: '', qty: 1 }]);
    setBulkModalOpen(true);
  };

  const addBulkRow = () => setBulkRows((r) => [...r, { userId: '', qty: 1 }]);

  const removeBulkRow = (idx: number) => setBulkRows((r) => r.filter((_, i) => i !== idx));

  const updateBulkRow = (idx: number, field: 'userId' | 'qty', val: string | number) =>
    setBulkRows((r) => r.map((row, i) => (i === idx ? { ...row, [field]: val } : row)));

  const handleBulkIssue = async () => {
    if (!bulkItemId) return;
    const targets = bulkRows.filter((r) => r.userId).map((r) => ({ user_id: r.userId, quantity: r.qty }));
    if (targets.length === 0) {
      toast.error('Add at least one member');
      return;
    }
    setBulkSubmitting(true);
    try {
      const res = await inventoryService.bulkIssueFromPool(bulkItemId, targets);
      toast.success(`Bulk issue: ${res.successful}/${res.total} succeeded`);
      if (res.failed > 0) {
        const errors = res.results.filter((r) => !r.success).map((r) => r.error ?? 'Unknown error');
        toast.error(`${res.failed} failed: ${errors[0] ?? ''}`);
      }
      setBulkModalOpen(false);
      setIssuancesMap((prev) => {
        const n = { ...prev };
        delete n[bulkItemId];
        return n;
      });
      void loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Bulk issue failed'));
    } finally {
      setBulkSubmitting(false);
    }
  };

  /* Render */
  const catLookup = categoryMap();
  const issueItemOnHand = issueItem ? issueItem.quantity : 0;

  // The backend *rejects* an over-allowance issue with a 400 unless
  // override_allowance is set — it does not merely flag it. Mirror its test
  // (max_quantity of -1 means no cap configured) so the dialog can offer the
  // override before the quartermaster hits the error instead of after.
  const issueExceedsAllowance =
    allowanceCheck !== null && allowanceCheck.max_quantity !== -1 && issueQty > allowanceCheck.remaining;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Link
        to="/inventory/admin"
        className="text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
            <Package size={24} /> Pool Items
          </h1>
          <p className="text-theme-text-muted mt-1 text-sm">
            Quantity-based items issued from shared pools — uniforms, consumables, and supplies.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary btn-md flex items-center gap-1"
            onClick={() => void loadData()}
          >
            <RefreshCw size={15} /> Refresh
          </button>
          <button type="button" className="btn-info btn-md flex items-center gap-1" onClick={openBulkModal}>
            <Users size={15} /> Bulk Issue
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard
          label="Pool Items"
          value={items.length}
          icon={<Package size={20} className="text-blue-600 dark:text-blue-400" />}
          accent="bg-blue-500/10"
        />
        <SummaryCard
          label="Total On-Hand"
          value={totalOnHand}
          icon={<ArrowDownToLine size={20} className="text-green-600 dark:text-green-400" />}
          accent="bg-green-500/10"
        />
        <SummaryCard
          label="Total Issued"
          value={totalIssued}
          icon={<Users size={20} className="text-indigo-600 dark:text-indigo-400" />}
          accent="bg-indigo-500/10"
        />
        <SummaryCard
          label="Low Stock Alerts"
          value={lowStockCount}
          icon={<AlertTriangle size={20} className="text-amber-600 dark:text-amber-400" />}
          accent="bg-amber-500/10"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="text-theme-text-muted absolute top-1/2 left-3 -translate-y-1/2" />
          <input
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            type="text"
            aria-label="Search pool items..."
            placeholder="Search pool items..."
            className="form-input w-full pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select className="form-input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="text-theme-text-secondary flex cursor-pointer items-center gap-2 text-sm whitespace-nowrap">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => setLowStockOnly(e.target.checked)}
            className="rounded"
          />
          Low stock only
        </label>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16" role="status" aria-live="polite">
          <Loader2 size={28} className="text-theme-text-muted animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No pool items found"
          description="Adjust your filters or add pool-tracked items in the inventory admin."
        />
      ) : (
        (() => {
          const paginatedItems = filtered.slice((page - 1) * pageSize, page * pageSize);
          return (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {paginatedItems.map((item) => (
                  <PoolCard
                    key={item.id}
                    item={item}
                    categoryName={catLookup[item.category_id ?? ''] ?? 'Uncategorized'}
                    onIssue={openIssueModal}
                    onReturn={openReturnModal}
                    issuances={issuancesMap[item.id] ?? []}
                    loadingIssuances={loadingIssuancesFor === item.id}
                    expanded={expandedCard === item.id}
                    onToggle={() => setExpandedCard((prev) => (prev === item.id ? null : item.id))}
                    onLoadIssuances={() => {
                      void loadIssuances(item.id);
                    }}
                  />
                ))}
              </div>
              {filtered.length > pageSize && (
                <Pagination
                  currentPage={page}
                  totalItems={filtered.length}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={(s) => {
                    setPageSize(s);
                    setPage(1);
                  }}
                  pageSizeOptions={[12, 24, 48, 96]}
                  className="mt-4"
                />
              )}
            </>
          );
        })()
      )}

      {/* Quick Issue Modal */}
      <Modal
        isOpen={issueModalOpen}
        onClose={() => setIssueModalOpen(false)}
        title={`Issue — ${issueItem?.name ?? ''}`}
        size="md"
      >
        <div className="space-y-4">
          {/* Member search */}
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Member</label>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              type="text"
              className="form-input w-full"
              aria-label="Search members..."
              placeholder="Search members..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
            {memberSearch && !issueUserId && (
              <ul className="border-theme-surface-border bg-theme-surface mt-1 max-h-40 overflow-y-auto rounded-lg border">
                {filteredMembers.slice(0, 20).map((m) => (
                  <li key={m.user_id}>
                    <button
                      type="button"
                      className="hover:bg-theme-surface text-theme-text-primary w-full px-3 py-2 text-left text-sm"
                      onClick={() => void handleSelectMember(m.user_id)}
                    >
                      {m.full_name ?? `${m.first_name ?? ''} ${m.last_name ?? ''}`}
                      {m.membership_number ? ` (#${m.membership_number})` : ''}
                    </button>
                  </li>
                ))}
                {filteredMembers.length === 0 && (
                  <li className="text-theme-text-muted px-3 py-2 text-sm">No members found</li>
                )}
              </ul>
            )}
            {issueUserId && (
              <div className="text-theme-text-primary mt-1 flex items-center gap-2 text-sm">
                <span>
                  {(() => {
                    const m = members.find((x) => x.user_id === issueUserId);
                    return m ? (m.full_name ?? `${m.first_name ?? ''} ${m.last_name ?? ''}`) : issueUserId;
                  })()}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIssueUserId('');
                    setAllowanceCheck(null);
                    setIssueOverride(false);
                    setMemberSearch('');
                  }}
                >
                  <X size={14} className="text-theme-text-muted" />
                </button>
              </div>
            )}
          </div>

          {/* Allowance info */}
          {allowanceCheck && (
            <div
              className={`rounded-lg px-3 py-2 text-sm ${issueExceedsAllowance ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'bg-blue-500/10 text-blue-700 dark:text-blue-400'}`}
            >
              Allowance: {allowanceCheck.issued_this_period}/{allowanceCheck.max_quantity} used (
              {allowanceCheck.period_type}). {allowanceCheck.remaining} remaining.
              {issueExceedsAllowance && (
                <>
                  {' '}
                  Issuing {issueQty} would exceed it — check <strong>Override allowance</strong> to issue anyway.
                </>
              )}
            </div>
          )}

          {issueExceedsAllowance && (
            <label className="text-theme-text-primary flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5"
                checked={issueOverride}
                onChange={(e) => setIssueOverride(e.target.checked)}
              />
              <span>Override allowance</span>
            </label>
          )}

          {/* Quantity */}
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
              Quantity (max {issueItemOnHand})
            </label>
            <input
              type="number"
              min={1}
              max={issueItemOnHand}
              className="form-input w-full"
              value={issueQty}
              onChange={(e) => setIssueQty(Math.max(1, Math.min(issueItemOnHand, Number(e.target.value) || 1)))}
            />
          </div>

          {/* Reason */}
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Reason (optional)</label>
            <input
              type="text"
              className="form-input w-full"
              placeholder="e.g. Annual uniform issue"
              value={issueReason}
              onChange={(e) => setIssueReason(e.target.value)}
            />
          </div>

          {/* Submit */}
          <div className="flex flex-col-reverse items-stretch justify-end gap-2 pt-2 sm:flex-row sm:items-center">
            <button type="button" className="btn-secondary btn-md" onClick={() => setIssueModalOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-info btn-md flex items-center justify-center gap-1 disabled:opacity-50"
              disabled={!issueUserId || issueQty < 1 || issueSubmitting}
              onClick={() => void handleIssue()}
            >
              {issueSubmitting && <Loader2 size={14} className="animate-spin" />}
              Issue
            </button>
          </div>
        </div>
      </Modal>

      {/* Return Modal */}
      <Modal isOpen={returnModalOpen} onClose={() => setReturnModalOpen(false)} title="Return to Pool" size="sm">
        <div className="space-y-4">
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
              Quantity to return (max {returnIssuance?.quantity_issued ?? 0})
            </label>
            <input
              type="number"
              min={1}
              max={returnIssuance?.quantity_issued ?? 1}
              className="form-input w-full"
              value={returnQty}
              onChange={(e) =>
                setReturnQty(Math.max(1, Math.min(returnIssuance?.quantity_issued ?? 1, Number(e.target.value) || 1)))
              }
            />
          </div>
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Condition</label>
            <select
              className="form-input w-full"
              value={returnCondition}
              onChange={(e) => setReturnCondition(e.target.value)}
            >
              {RETURN_CONDITION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Notes (optional)</label>
            <input
              type="text"
              className="form-input w-full"
              value={returnNotes}
              onChange={(e) => setReturnNotes(e.target.value)}
            />
          </div>
          <div className="flex flex-col-reverse items-stretch justify-end gap-2 pt-2 sm:flex-row sm:items-center">
            <button type="button" className="btn-secondary btn-md" onClick={() => setReturnModalOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-info btn-md flex items-center justify-center gap-1 disabled:opacity-50"
              disabled={returnSubmitting}
              onClick={() => void handleReturn()}
            >
              {returnSubmitting && <Loader2 size={14} className="animate-spin" />}
              Return
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk Issue Modal */}
      <Modal isOpen={bulkModalOpen} onClose={() => setBulkModalOpen(false)} title="Bulk Issue" size="lg">
        <div className="space-y-4">
          {/* Item select */}
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Pool Item</label>
            <select className="form-input w-full" value={bulkItemId} onChange={(e) => setBulkItemId(e.target.value)}>
              <option value="">Select an item...</option>
              {items
                .filter((i) => i.quantity > 0)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.quantity} available)
                  </option>
                ))}
            </select>
          </div>

          {/* Member rows */}
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Recipients</label>
            <div className="max-h-60 space-y-2 overflow-y-auto">
              {bulkRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    className="form-input flex-1"
                    value={row.userId}
                    onChange={(e) => updateBulkRow(idx, 'userId', e.target.value)}
                  >
                    <option value="">Select member...</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name ?? `${m.first_name ?? ''} ${m.last_name ?? ''}`}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    className="form-input w-20"
                    value={row.qty}
                    onChange={(e) => updateBulkRow(idx, 'qty', Math.max(1, Number(e.target.value) || 1))}
                  />
                  {bulkRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeBulkRow(idx)}
                      className="text-theme-text-muted hover:text-red-500"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-2 flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400"
              onClick={addBulkRow}
            >
              <Plus size={14} /> Add recipient
            </button>
          </div>

          {/* Submit */}
          <div className="flex flex-col-reverse items-stretch justify-end gap-2 pt-2 sm:flex-row sm:items-center">
            <button type="button" className="btn-secondary btn-md" onClick={() => setBulkModalOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-info btn-md flex items-center justify-center gap-1 disabled:opacity-50"
              disabled={!bulkItemId || bulkRows.every((r) => !r.userId) || bulkSubmitting}
              onClick={() => void handleBulkIssue()}
            >
              {bulkSubmitting && <Loader2 size={14} className="animate-spin" />}
              Issue to All
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PoolItemsPage;
