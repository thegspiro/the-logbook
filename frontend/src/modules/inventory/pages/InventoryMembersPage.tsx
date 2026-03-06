/**
 * Inventory Members Page — Quartermaster view of all members and their equipment.
 * Expandable cards with bidirectional links to member profiles and item details.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Users, RefreshCw, Search, ChevronDown, ChevronUp,
  Package, AlertTriangle, User, Loader2, ArrowUpDown,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type {
  MembersInventoryListResponse, MemberInventorySummary, UserInventoryResponse,
} from '../../../services/eventServices';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { useInventoryWebSocket } from '../../../hooks/useInventoryWebSocket';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';

type SortOption = 'name' | 'total_items' | 'overdue' | 'assigned';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'name', label: 'Name (A\u2013Z)' },
  { value: 'total_items', label: 'Total Items' },
  { value: 'overdue', label: 'Overdue First' },
  { value: 'assigned', label: 'Most Assigned' },
];

const CountBadge: React.FC<{ label: string; count: number; color: string }> = ({ label, count, color }) => {
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${color}`}>
      {count} {label}
    </span>
  );
};

const InventoryMembersPage: React.FC = () => {
  const tz = useTimezone();
  const canManage = useAuthStore((s) => s.checkPermission)('inventory.manage');

  const [members, setMembers] = useState<MemberInventorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDebounce, setSearchDebounce] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('name');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [memberDetail, setMemberDetail] = useState<UserInventoryResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [assignModal, setAssignModal] = useState<{ open: boolean; userId: string; memberName: string }>(
    { open: false, userId: '', memberName: '' }
  );
  const [assignSearch, setAssignSearch] = useState('');
  const [assignItems, setAssignItems] = useState<{ id: string; name: string; serial_number?: string | undefined }[]>([]);
  const [assignItemsLoading, setAssignItemsLoading] = useState(false);
  const [assigningItemId, setAssigningItemId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounce(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data: MembersInventoryListResponse = await inventoryService.getMembersSummary(
        searchDebounce || undefined,
      );
      setMembers(data.members);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load members inventory data.'));
    } finally {
      setLoading(false);
    }
  }, [searchDebounce]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  useInventoryWebSocket({ onEvent: useCallback(() => { void loadMembers(); }, [loadMembers]) });

  const handleExpand = async (userId: string) => {
    if (expandedUserId === userId) { setExpandedUserId(null); setMemberDetail(null); return; }
    setExpandedUserId(userId);
    setMemberDetail(null);
    setDetailLoading(true);
    try { setMemberDetail(await inventoryService.getUserInventory(userId)); }
    catch { setMemberDetail(null); }
    finally { setDetailLoading(false); }
  };

  const openAssignModal = (m: MemberInventorySummary) => {
    setAssignModal({ open: true, userId: m.user_id, memberName: m.full_name || m.username });
    setAssignSearch(''); setAssignItems([]);
  };
  const closeAssignModal = () => {
    setAssignModal((p) => ({ ...p, open: false }));
    setAssignSearch(''); setAssignItems([]); setAssigningItemId(null);
  };

  useEffect(() => {
    if (!assignModal.open || !assignSearch.trim()) { setAssignItems([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      setAssignItemsLoading(true);
      void inventoryService.getItems({ search: assignSearch.trim() || undefined, status: 'available', limit: 20 })
        .then((res) => {
          if (!cancelled) setAssignItems(res.items.map((i) => ({ id: i.id, name: i.name, ...(i.serial_number ? { serial_number: i.serial_number } : {}) })));
        })
        .catch(() => { if (!cancelled) setAssignItems([]); })
        .finally(() => { if (!cancelled) setAssignItemsLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [assignModal.open, assignSearch]);

  const handleAssignItem = async (itemId: string) => {
    setAssigningItemId(itemId);
    try {
      await inventoryService.assignItem(itemId, assignModal.userId);
      toast.success('Item assigned successfully.');
      void loadMembers();
      if (expandedUserId === assignModal.userId) {
        try { setMemberDetail(await inventoryService.getUserInventory(assignModal.userId)); } catch { /* ignore */ }
      }
      setAssignItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to assign item.'));
    } finally { setAssigningItemId(null); }
  };

  const sortedMembers = useMemo(() => {
    const s = [...members];
    switch (sortBy) {
      case 'name': s.sort((a, b) => (a.full_name || a.username).localeCompare(b.full_name || b.username)); break;
      case 'total_items': s.sort((a, b) => b.total_items - a.total_items); break;
      case 'overdue': s.sort((a, b) => b.overdue_count - a.overdue_count || b.total_items - a.total_items); break;
      case 'assigned': s.sort((a, b) => b.permanent_count - a.permanent_count); break;
    }
    return s;
  }, [members, sortBy]);

  const membersWithEquipment = members.filter((m) => m.total_items > 0).length;
  const totalAssigned = members.reduce((acc, m) => acc + m.total_items, 0);
  const totalOverdue = members.reduce((acc, m) => acc + m.overdue_count, 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/inventory/admin" className="p-2 rounded-lg hover:bg-theme-surface-hover text-theme-text-muted transition-colors" title="Back to Inventory Admin">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-theme-text-primary">Members Equipment</h1>
            <p className="text-sm text-theme-text-muted">View and manage equipment assigned to members</p>
          </div>
        </div>
        <button onClick={() => { void loadMembers(); }} className="flex items-center gap-1.5 px-3 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary rounded-lg hover:bg-theme-surface-hover transition-colors" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-theme-surface rounded-lg p-4 border border-theme-surface-border">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-theme-text-muted" />
            <p className="text-theme-text-muted text-xs font-medium uppercase">Members with Equipment</p>
          </div>
          <p className="text-theme-text-primary text-2xl font-bold">{membersWithEquipment}</p>
        </div>
        <div className="bg-theme-surface rounded-lg p-4 border border-theme-surface-border">
          <div className="flex items-center gap-2 mb-1">
            <Package className="w-4 h-4 text-theme-text-muted" />
            <p className="text-theme-text-muted text-xs font-medium uppercase">Total Items Assigned</p>
          </div>
          <p className="text-theme-text-primary text-2xl font-bold">{totalAssigned}</p>
        </div>
        <div className="bg-theme-surface rounded-lg p-4 border border-theme-surface-border">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-theme-text-muted" />
            <p className="text-theme-text-muted text-xs font-medium uppercase">Overdue Returns</p>
          </div>
          <p className={`text-2xl font-bold ${totalOverdue > 0 ? 'text-red-700 dark:text-red-400' : 'text-theme-text-primary'}`}>{totalOverdue}</p>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by name, username, or membership number..." className="form-input pl-10 pr-4 text-sm placeholder-theme-text-muted" />
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="w-4 h-4 text-theme-text-muted shrink-0" />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="form-input text-sm py-2">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0" />
          <p className="text-red-700 dark:text-red-300 text-sm flex-1">{error}</p>
          <button onClick={() => { void loadMembers(); }} className="text-red-700 dark:text-red-400 hover:text-red-500 text-sm flex items-center gap-1">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="bg-theme-surface rounded-lg p-12 border border-theme-surface-border text-center">
          <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-secondary text-sm">Loading members...</p>
        </div>
      ) : members.length === 0 ? (
        <div className="bg-theme-surface rounded-lg p-12 border border-theme-surface-border text-center">
          <Users className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <h3 className="text-theme-text-primary text-lg font-semibold mb-1">No Members Found</h3>
          <p className="text-theme-text-secondary text-sm">{searchQuery ? 'Try adjusting your search.' : 'No members with inventory assignments.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedMembers.map((member) => {
            const isExpanded = expandedUserId === member.user_id;
            const name = member.full_name || member.username;
            return (
              <div key={member.user_id} className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
                {/* Row */}
                <button type="button" className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-theme-surface-hover transition-colors" onClick={() => { void handleExpand(member.user_id); }}>
                  <div className="shrink-0 text-theme-text-muted">{isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</div>
                  <User className="w-5 h-5 text-theme-text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to={`/members/${member.user_id}`} className="text-sm font-semibold text-theme-text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{name}</Link>
                      {member.membership_number && <span className="text-xs text-theme-text-muted">#{member.membership_number}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <CountBadge label="permanent" count={member.permanent_count} color="bg-blue-500/10 text-blue-700 dark:text-blue-400" />
                      <CountBadge label="checked out" count={member.checkout_count} color="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" />
                      <CountBadge label="issued" count={member.issued_count} color="bg-purple-500/10 text-purple-700 dark:text-purple-400" />
                      {member.overdue_count > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30">
                          <AlertTriangle className="w-3 h-3" />{member.overdue_count} overdue
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-lg font-bold text-theme-text-primary">{member.total_items}</span>
                    <p className="text-xs text-theme-text-muted">items</p>
                  </div>
                  {canManage && (
                    <button type="button" className="shrink-0 btn-info px-3 py-1.5 text-xs font-medium rounded-lg" onClick={(e) => { e.stopPropagation(); openAssignModal(member); }}>
                      Assign
                    </button>
                  )}
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-theme-surface-border bg-theme-surface-secondary px-4 py-4">
                    {detailLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted mr-2" />
                        <span className="text-sm text-theme-text-muted">Loading inventory details...</span>
                      </div>
                    ) : memberDetail ? (
                      <div className="space-y-5">
                        {/* Permanent */}
                        {memberDetail.permanent_assignments.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold uppercase text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-1.5">
                              <Package className="w-3.5 h-3.5" /> Permanent Assignments ({memberDetail.permanent_assignments.length})
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {memberDetail.permanent_assignments.map((it) => (
                                <div key={it.assignment_id} className="card-secondary p-3">
                                  <Link to={`/inventory/items/${it.item_id}`} className="text-sm font-medium text-theme-text-primary hover:underline">{it.item_name}</Link>
                                  <div className="flex items-center gap-3 mt-1 text-xs text-theme-text-muted flex-wrap">
                                    {it.serial_number && <span className="font-mono">SN: {it.serial_number}</span>}
                                    {it.asset_tag && <span className="font-mono">AT: {it.asset_tag}</span>}
                                    <span className="capitalize">{it.condition.replace('_', ' ')}</span>
                                    <span>Assigned {formatDate(it.assigned_date, tz)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Checkouts */}
                        {memberDetail.active_checkouts.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold uppercase text-yellow-700 dark:text-yellow-400 mb-2 flex items-center gap-1.5">
                              <Package className="w-3.5 h-3.5" /> Active Checkouts ({memberDetail.active_checkouts.length})
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {memberDetail.active_checkouts.map((it) => (
                                <div key={it.checkout_id} className={`card-secondary p-3 ${it.is_overdue ? 'border-red-500/40 bg-red-500/5' : ''}`}>
                                  <Link to={`/inventory/items/${it.item_id}`} className="text-sm font-medium text-theme-text-primary hover:underline">{it.item_name}</Link>
                                  <div className="flex items-center gap-3 mt-1 text-xs text-theme-text-muted flex-wrap">
                                    <span>Out: {formatDate(it.checked_out_at, tz)}</span>
                                    {it.expected_return_at && <span>Due: {formatDate(it.expected_return_at, tz)}</span>}
                                    {it.is_overdue && <span className="text-red-700 dark:text-red-400 font-semibold">OVERDUE</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Issued */}
                        {memberDetail.issued_items.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold uppercase text-purple-700 dark:text-purple-400 mb-2 flex items-center gap-1.5">
                              <Package className="w-3.5 h-3.5" /> Issued Items ({memberDetail.issued_items.length})
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {memberDetail.issued_items.map((it) => (
                                <div key={it.issuance_id} className="card-secondary p-3">
                                  <Link to={`/inventory/items/${it.item_id}`} className="text-sm font-medium text-theme-text-primary hover:underline">{it.item_name}</Link>
                                  <div className="flex items-center gap-3 mt-1 text-xs text-theme-text-muted flex-wrap">
                                    <span>Qty: {it.quantity_issued}</span>
                                    {it.size && <span>Size: {it.size}</span>}
                                    <span>{formatDate(it.issued_at, tz)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {memberDetail.permanent_assignments.length === 0 && memberDetail.active_checkouts.length === 0 && memberDetail.issued_items.length === 0 && (
                          <p className="text-sm text-theme-text-muted text-center py-4">No items currently assigned to this member.</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-theme-text-muted text-center py-4">Unable to load details.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Assign Modal */}
      <Modal isOpen={assignModal.open} onClose={closeAssignModal} title={`Assign Item to ${assignModal.memberName}`}>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
            <input type="text" value={assignSearch} onChange={(e) => setAssignSearch(e.target.value)} placeholder="Search available items..." className="form-input pl-10 pr-4 text-sm placeholder-theme-text-muted" autoFocus />
          </div>
          <div className="max-h-72 overflow-y-auto space-y-2">
            {assignItemsLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted mr-2" />
                <span className="text-sm text-theme-text-muted">Searching...</span>
              </div>
            ) : assignItems.length > 0 ? (
              assignItems.map((item) => (
                <div key={item.id} className="card-secondary p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-theme-text-primary truncate">{item.name}</p>
                    {item.serial_number && <p className="text-xs text-theme-text-muted font-mono">SN: {item.serial_number}</p>}
                  </div>
                  <button type="button" disabled={assigningItemId === item.id} onClick={() => { void handleAssignItem(item.id); }} className="shrink-0 btn-info px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50">
                    {assigningItemId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Assign'}
                  </button>
                </div>
              ))
            ) : assignSearch.trim() ? (
              <p className="text-sm text-theme-text-muted text-center py-6">No available items match your search.</p>
            ) : (
              <p className="text-sm text-theme-text-muted text-center py-6">Type to search for items to assign.</p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default InventoryMembersPage;
