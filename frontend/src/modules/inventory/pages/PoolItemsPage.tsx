/** PoolItemsPage — View for pool-tracked (quantity-based) inventory items. */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Package, Plus, Search, RefreshCw, AlertTriangle,
  Users, ArrowDownToLine, Loader2, X, ChevronDown, ChevronUp,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type {
  InventoryItem, InventoryCategory, ItemIssuance,
  AllowanceCheck, LowStockAlert,
} from '../types';
import type { MemberInventorySummary } from '../../../services/eventServices';
import { getErrorMessage } from '../../../utils/errorHandling';
import { RETURN_CONDITION_OPTIONS } from '../../../constants/enums';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';

interface SummaryCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, icon, accent }) => (
  <div className="card-secondary rounded-lg p-4 flex items-center gap-3">
    <div className={`p-2 rounded-lg ${accent ?? 'bg-theme-surface'}`}>{icon}</div>
    <div>
      <p className="text-2xl font-bold text-theme-text-primary">{value}</p>
      <p className="text-sm text-theme-text-muted">{label}</p>
    </div>
  </div>
);

interface StockBarProps { onHand: number; issued: number; total: number }

const StockBar: React.FC<StockBarProps> = ({ onHand, issued, total }) => {
  const onHandPct = total > 0 ? (onHand / total) * 100 : 0;
  const issuedPct = total > 0 ? (issued / total) * 100 : 0;
  return (
    <div className="w-full bg-theme-surface rounded-full h-3 overflow-hidden flex" title={`On-hand: ${onHand}  Issued: ${issued}`}>
      <div className="bg-green-500 h-full transition-all" style={{ width: `${onHandPct}%` }} />
      <div className="bg-blue-500 h-full transition-all" style={{ width: `${issuedPct}%` }} />
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
  item, categoryName, onIssue, onReturn,
  issuances, loadingIssuances, expanded, onToggle, onLoadIssuances,
}) => {
  const onHand = item.quantity - item.quantity_issued;
  const total = item.quantity;

  const handleToggle = () => {
    if (!expanded) void onLoadIssuances();
    onToggle();
  };

  return (
    <div className="card-secondary rounded-lg p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-theme-text-primary truncate">{item.name}</h3>
          <p className="text-xs text-theme-text-muted">{categoryName}</p>
        </div>
        {onHand <= 0 && (
          <span className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400 bg-red-500/10 px-2 py-0.5 rounded">
            Out of stock
          </span>
        )}
      </div>

      {/* Stock bar */}
      <StockBar onHand={onHand} issued={item.quantity_issued} total={total} />

      {/* Counts */}
      <div className="grid grid-cols-3 text-sm gap-2">
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
          <p className="font-semibold text-theme-text-primary">{total}</p>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap gap-2 text-xs text-theme-text-muted">
        {item.unit_of_measure && <span className="bg-theme-surface px-2 py-0.5 rounded">{item.unit_of_measure}</span>}
        {item.size && <span className="bg-theme-surface px-2 py-0.5 rounded">Size: {item.size}</span>}
        {item.color && <span className="bg-theme-surface px-2 py-0.5 rounded">Color: {item.color}</span>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          className="btn-primary text-sm px-3 py-1.5 rounded-lg flex items-center gap-1 disabled:opacity-50"
          disabled={onHand <= 0}
          onClick={() => onIssue(item)}
        >
          <ArrowDownToLine size={14} /> Issue
        </button>
        <button
          type="button"
          className="text-sm px-3 py-1.5 rounded-lg border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface flex items-center gap-1"
          onClick={handleToggle}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Issuances
        </button>
      </div>

      {/* Expandable issuance log */}
      {expanded && (
        <div className="border-t border-theme-surface-border pt-3 mt-1">
          {loadingIssuances ? (
            <div className="flex justify-center py-3"><Loader2 size={18} className="animate-spin text-theme-text-muted" /></div>
          ) : issuances.length === 0 ? (
            <p className="text-sm text-theme-text-muted text-center py-2">No active issuances</p>
          ) : (
            <ul className="space-y-2 max-h-48 overflow-y-auto">
              {issuances.filter(i => !i.is_returned).map(iss => (
                <li key={iss.id} className="flex items-center justify-between text-sm bg-theme-surface rounded px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-theme-text-primary">{iss.user_id.slice(0, 8)}...</span>
                    <span className="text-theme-text-muted ml-2">qty {iss.quantity_issued}</span>
                    <span className="text-theme-text-muted ml-2">{new Date(iss.issued_at).toLocaleDateString()}</span>
                  </div>
                  <button
                    type="button"
                    className="btn-info text-xs px-2 py-1 rounded shrink-0"
                    onClick={() => onReturn(iss)}
                  >
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

  /* Return modal state */
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnIssuance, setReturnIssuance] = useState<ItemIssuance | null>(null);
  const [returnCondition, setReturnCondition] = useState('good');
  const [returnNotes, setReturnNotes] = useState('');
  const [returnQty, setReturnQty] = useState(1);
  const [returnSubmitting, setReturnSubmitting] = useState(false);

  /* Bulk issue modal state */
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkItemId, setBulkItemId] = useState('');
  const [bulkRows, setBulkRows] = useState<Array<{ userId: string; qty: number }>>([{ userId: '', qty: 1 }]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const categoryMap = useCallback((): Record<string, string> => {
    const m: Record<string, string> = {};
    for (const c of categories) { m[c.id] = c.name; }
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
      setItems(itemsRes.items.filter(i => i.tracking_type === 'pool'));
      setCategories(cats);
      setLowStockAlerts(alerts);
      setMembers(membersRes.members);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load pool items'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const loadIssuances = useCallback(async (itemId: string) => {
    if (issuancesMap[itemId]) return;
    setLoadingIssuancesFor(itemId);
    try {
      const data = await inventoryService.getItemIssuances(itemId, true);
      setIssuancesMap(prev => ({ ...prev, [itemId]: data }));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load issuances'));
    } finally {
      setLoadingIssuancesFor(null);
    }
  }, [issuancesMap]);

  /* Filtering */
  const filtered = items.filter(item => {
    if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (categoryFilter && item.category_id !== categoryFilter) return false;
    if (lowStockOnly) {
      const onHand = item.quantity - item.quantity_issued;
      const cat = categories.find(c => c.id === item.category_id);
      const threshold = cat?.low_stock_threshold ?? 0;
      if (onHand > threshold) return false;
    }
    return true;
  });

  const totalOnHand = items.reduce((s, i) => s + (i.quantity - i.quantity_issued), 0);
  const totalIssued = items.reduce((s, i) => s + i.quantity_issued, 0);
  const lowStockCount = lowStockAlerts.length;

  const openIssueModal = (item: InventoryItem) => {
    setIssueItem(item);
    setIssueUserId('');
    setIssueQty(1);
    setIssueReason('');
    setMemberSearch('');
    setAllowanceCheck(null);
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
      );
      toast.success(`Issued ${issueQty} ${issueItem.name}`);
      setIssueModalOpen(false);
      // Clear cached issuances for this item so they reload
      setIssuancesMap(prev => { const n = { ...prev }; delete n[issueItem.id]; return n; });
      void loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Issue failed'));
    } finally {
      setIssueSubmitting(false);
    }
  };

  const filteredMembers = members.filter(m => {
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
      setIssuancesMap(prev => { const n = { ...prev }; delete n[returnIssuance.item_id]; return n; });
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

  const addBulkRow = () => setBulkRows(r => [...r, { userId: '', qty: 1 }]);

  const removeBulkRow = (idx: number) =>
    setBulkRows(r => r.filter((_, i) => i !== idx));

  const updateBulkRow = (idx: number, field: 'userId' | 'qty', val: string | number) =>
    setBulkRows(r => r.map((row, i) => i === idx ? { ...row, [field]: val } : row));

  const handleBulkIssue = async () => {
    if (!bulkItemId) return;
    const targets = bulkRows
      .filter(r => r.userId)
      .map(r => ({ user_id: r.userId, quantity: r.qty }));
    if (targets.length === 0) { toast.error('Add at least one member'); return; }
    setBulkSubmitting(true);
    try {
      const res = await inventoryService.bulkIssueFromPool(bulkItemId, targets);
      toast.success(`Bulk issue: ${res.successful}/${res.total} succeeded`);
      if (res.failed > 0) {
        const errors = res.results.filter(r => !r.success).map(r => r.error ?? 'Unknown error');
        toast.error(`${res.failed} failed: ${errors[0] ?? ''}`);
      }
      setBulkModalOpen(false);
      setIssuancesMap(prev => { const n = { ...prev }; delete n[bulkItemId]; return n; });
      void loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Bulk issue failed'));
    } finally {
      setBulkSubmitting(false);
    }
  };

  /* Render */
  const catLookup = categoryMap();
  const issueItemOnHand = issueItem ? issueItem.quantity - issueItem.quantity_issued : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      <Link to="/inventory/admin" className="text-sm text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1">
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-2">
            <Package size={24} /> Pool Items
          </h1>
          <p className="text-sm text-theme-text-muted mt-1">
            Quantity-based items issued from shared pools — uniforms, consumables, and supplies.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-info px-3 py-2 rounded-lg flex items-center gap-1 text-sm" onClick={() => void loadData()}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button type="button" className="btn-primary px-3 py-2 rounded-lg flex items-center gap-1 text-sm" onClick={openBulkModal}>
            <Users size={15} /> Bulk Issue
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Pool Items" value={items.length} icon={<Package size={20} className="text-blue-600 dark:text-blue-400" />} accent="bg-blue-500/10" />
        <SummaryCard label="Total On-Hand" value={totalOnHand} icon={<ArrowDownToLine size={20} className="text-green-600 dark:text-green-400" />} accent="bg-green-500/10" />
        <SummaryCard label="Total Issued" value={totalIssued} icon={<Users size={20} className="text-indigo-600 dark:text-indigo-400" />} accent="bg-indigo-500/10" />
        <SummaryCard label="Low Stock Alerts" value={lowStockCount} icon={<AlertTriangle size={20} className="text-amber-600 dark:text-amber-400" />} accent="bg-amber-500/10" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
          <input
            type="text"
            placeholder="Search pool items..."
            className="form-input w-full pl-9"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className="form-input"
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
        >
          <option value="">All Categories</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={e => setLowStockOnly(e.target.checked)}
            className="rounded"
          />
          Low stock only
        </label>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-theme-text-muted" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-theme-text-muted">
          <Package size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium">No pool items found</p>
          <p className="text-sm mt-1">Adjust your filters or add pool-tracked items in the inventory admin.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(item => (
            <PoolCard
              key={item.id}
              item={item}
              categoryName={catLookup[item.category_id ?? ''] ?? 'Uncategorized'}
              onIssue={openIssueModal}
              onReturn={openReturnModal}
              issuances={issuancesMap[item.id] ?? []}
              loadingIssuances={loadingIssuancesFor === item.id}
              expanded={expandedCard === item.id}
              onToggle={() => setExpandedCard(prev => prev === item.id ? null : item.id)}
              onLoadIssuances={() => { void loadIssuances(item.id); }}
            />
          ))}
        </div>
      )}

      {/* Quick Issue Modal */}
      <Modal isOpen={issueModalOpen} onClose={() => setIssueModalOpen(false)} title={`Issue — ${issueItem?.name ?? ''}`} size="md">
        <div className="space-y-4">
          {/* Member search */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Member</label>
            <input
              type="text"
              className="form-input w-full"
              placeholder="Search members..."
              value={memberSearch}
              onChange={e => setMemberSearch(e.target.value)}
            />
            {memberSearch && !issueUserId && (
              <ul className="mt-1 max-h-40 overflow-y-auto border border-theme-surface-border rounded-lg bg-theme-surface">
                {filteredMembers.slice(0, 20).map(m => (
                  <li key={m.user_id}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-theme-surface text-sm text-theme-text-primary"
                      onClick={() => void handleSelectMember(m.user_id)}
                    >
                      {m.full_name ?? `${m.first_name ?? ''} ${m.last_name ?? ''}`}
                      {m.membership_number ? ` (#${m.membership_number})` : ''}
                    </button>
                  </li>
                ))}
                {filteredMembers.length === 0 && (
                  <li className="px-3 py-2 text-sm text-theme-text-muted">No members found</li>
                )}
              </ul>
            )}
            {issueUserId && (
              <div className="mt-1 flex items-center gap-2 text-sm text-theme-text-primary">
                <span>
                  {(() => {
                    const m = members.find(x => x.user_id === issueUserId);
                    return m ? (m.full_name ?? `${m.first_name ?? ''} ${m.last_name ?? ''}`) : issueUserId;
                  })()}
                </span>
                <button type="button" onClick={() => { setIssueUserId(''); setAllowanceCheck(null); setMemberSearch(''); }}>
                  <X size={14} className="text-theme-text-muted" />
                </button>
              </div>
            )}
          </div>

          {/* Allowance info */}
          {allowanceCheck && (
            <div className={`text-sm rounded-lg px-3 py-2 ${allowanceCheck.remaining <= 0 ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'bg-blue-500/10 text-blue-700 dark:text-blue-400'}`}>
              Allowance: {allowanceCheck.issued_this_period}/{allowanceCheck.max_quantity} used ({allowanceCheck.period_type}).
              {allowanceCheck.remaining > 0
                ? ` ${allowanceCheck.remaining} remaining.`
                : ' Allowance exceeded — issue will be flagged.'}
            </div>
          )}

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              Quantity (max {issueItemOnHand})
            </label>
            <input
              type="number"
              min={1}
              max={issueItemOnHand}
              className="form-input w-full"
              value={issueQty}
              onChange={e => setIssueQty(Math.max(1, Math.min(issueItemOnHand, Number(e.target.value) || 1)))}
            />
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Reason (optional)</label>
            <input
              type="text"
              className="form-input w-full"
              placeholder="e.g. Annual uniform issue"
              value={issueReason}
              onChange={e => setIssueReason(e.target.value)}
            />
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="px-4 py-2 rounded-lg border border-theme-surface-border text-theme-text-secondary text-sm" onClick={() => setIssueModalOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"
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
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              Quantity to return (max {returnIssuance?.quantity_issued ?? 0})
            </label>
            <input
              type="number"
              min={1}
              max={returnIssuance?.quantity_issued ?? 1}
              className="form-input w-full"
              value={returnQty}
              onChange={e => setReturnQty(Math.max(1, Math.min(returnIssuance?.quantity_issued ?? 1, Number(e.target.value) || 1)))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Condition</label>
            <select className="form-input w-full" value={returnCondition} onChange={e => setReturnCondition(e.target.value)}>
              {RETURN_CONDITION_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Notes (optional)</label>
            <input type="text" className="form-input w-full" value={returnNotes} onChange={e => setReturnNotes(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="px-4 py-2 rounded-lg border border-theme-surface-border text-theme-text-secondary text-sm" onClick={() => setReturnModalOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"
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
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Pool Item</label>
            <select className="form-input w-full" value={bulkItemId} onChange={e => setBulkItemId(e.target.value)}>
              <option value="">Select an item...</option>
              {items.filter(i => i.quantity - i.quantity_issued > 0).map(i => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.quantity - i.quantity_issued} available)
                </option>
              ))}
            </select>
          </div>

          {/* Member rows */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Recipients</label>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {bulkRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    className="form-input flex-1"
                    value={row.userId}
                    onChange={e => updateBulkRow(idx, 'userId', e.target.value)}
                  >
                    <option value="">Select member...</option>
                    {members.map(m => (
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
                    onChange={e => updateBulkRow(idx, 'qty', Math.max(1, Number(e.target.value) || 1))}
                  />
                  {bulkRows.length > 1 && (
                    <button type="button" onClick={() => removeBulkRow(idx)} className="text-theme-text-muted hover:text-red-500">
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" className="mt-2 text-sm text-blue-600 dark:text-blue-400 flex items-center gap-1" onClick={addBulkRow}>
              <Plus size={14} /> Add recipient
            </button>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="px-4 py-2 rounded-lg border border-theme-surface-border text-theme-text-secondary text-sm" onClick={() => setBulkModalOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"
              disabled={!bulkItemId || bulkRows.every(r => !r.userId) || bulkSubmitting}
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
