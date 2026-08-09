/**
 * Inventory Members Page — Quartermaster view of all members and their equipment.
 * Expandable cards with bidirectional links to member profiles and item details.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft,
  Users,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  Package,
  AlertTriangle,
  User,
  Loader2,
  ArrowUpDown,
  ArrowDownToLine,
  ArrowUpFromLine,
  ScanLine,
  Ruler,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type {
  MembersInventoryListResponse,
  MemberInventorySummary,
  UserInventoryResponse,
} from '../../../services/eventServices';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { useInventoryWebSocket } from '../../../hooks/useInventoryWebSocket';
import { InventoryScanModal } from '../../../components/InventoryScanModal';
import { VariantCapsules } from '../components/VariantCapsules';
import type { InventoryItem } from '../types';
import { ReturnItemsModal } from '../../../components/ReturnItemsModal';
import { MemberIdScannerModal } from '../../../components/MemberIdScannerModal';
import { SizePreferencesModal } from '../components/SizePreferencesModal';

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
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
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

  // Barcode scan modal (assign / checkout)
  const [scanModal, setScanModal] = useState<{
    isOpen: boolean;
    mode: 'checkout' | 'return';
    userId: string;
    memberName: string;
  }>({ isOpen: false, mode: 'checkout', userId: '', memberName: '' });

  // Return modal
  const [returnModal, setReturnModal] = useState<{
    isOpen: boolean;
    userId: string;
    memberName: string;
  }>({ isOpen: false, userId: '', memberName: '' });

  // Size-preferences modal (admin editing a specific member)
  const [sizesTarget, setSizesTarget] = useState<{ userId: string; memberName: string } | null>(null);

  // Member ID scanner modal
  const [memberScannerOpen, setMemberScannerOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounce(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data: MembersInventoryListResponse = await inventoryService.getMembersSummary(searchDebounce || undefined);
      setMembers(data.members);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load members inventory data.'));
    } finally {
      setLoading(false);
    }
  }, [searchDebounce]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useInventoryWebSocket({
    onEvent: useCallback(() => {
      void loadMembers();
    }, [loadMembers]),
  });

  const handleExpand = async (userId: string) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      setMemberDetail(null);
      return;
    }
    setExpandedUserId(userId);
    setMemberDetail(null);
    setDetailLoading(true);
    try {
      setMemberDetail(await inventoryService.getUserInventory(userId));
    } catch {
      setMemberDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const openScanModal = (m: MemberInventorySummary) => {
    setScanModal({
      isOpen: true,
      mode: 'checkout',
      userId: m.user_id,
      memberName: m.full_name || m.username,
    });
  };

  const handleMemberScanned = (scanned: { userId: string; memberName: string }) => {
    setMemberScannerOpen(false);
    setScanModal({
      isOpen: true,
      mode: 'checkout',
      userId: scanned.userId,
      memberName: scanned.memberName,
    });
  };

  const openReturnModal = (m: MemberInventorySummary) => {
    setReturnModal({
      isOpen: true,
      userId: m.user_id,
      memberName: m.full_name || m.username,
    });
  };

  const handleScanComplete = async () => {
    await loadMembers();
    if (expandedUserId) {
      setDetailLoading(true);
      try {
        setMemberDetail(await inventoryService.getUserInventory(expandedUserId));
      } catch {
        setMemberDetail(null);
      } finally {
        setDetailLoading(false);
      }
    }
  };

  const sortedMembers = useMemo(() => {
    const s = [...members];
    switch (sortBy) {
      case 'name':
        s.sort((a, b) => (a.full_name || a.username).localeCompare(b.full_name || b.username));
        break;
      case 'total_items':
        s.sort((a, b) => b.total_items - a.total_items);
        break;
      case 'overdue':
        s.sort((a, b) => b.overdue_count - a.overdue_count || b.total_items - a.total_items);
        break;
      case 'assigned':
        s.sort((a, b) => b.permanent_count - a.permanent_count);
        break;
    }
    return s;
  }, [members, sortBy]);

  const membersWithEquipment = members.filter((m) => m.total_items > 0).length;
  const totalAssigned = members.reduce((acc, m) => acc + m.total_items, 0);
  const totalOverdue = members.reduce((acc, m) => acc + m.overdue_count, 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <Link
        to="/inventory/admin"
        className="text-theme-text-muted hover:text-theme-text-secondary mb-4 flex items-center gap-1 text-sm"
        title="Back to Inventory Admin"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Admin
      </Link>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Members Equipment</h1>
          <p className="text-theme-text-muted text-sm">View and manage equipment assigned to members</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <button
              onClick={() => setMemberScannerOpen(true)}
              className="btn-success btn-md flex items-center gap-2"
              title="Scan a member's digital ID to start assigning items"
            >
              <ScanLine className="h-4 w-4" /> <span className="hidden sm:inline">Scan Member ID</span>
              <span className="sm:hidden">Scan</span>
            </button>
          )}
          <button
            onClick={() => {
              void loadMembers();
            }}
            className="btn-secondary btn-md flex items-center gap-1.5"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card-secondary p-4">
          <div className="mb-1 flex items-center gap-2">
            <Users className="text-theme-text-muted h-4 w-4" />
            <p className="text-theme-text-muted text-xs font-medium uppercase">Members with Equipment</p>
          </div>
          <p className="text-theme-text-primary text-2xl font-bold">{membersWithEquipment}</p>
        </div>
        <div className="card-secondary p-4">
          <div className="mb-1 flex items-center gap-2">
            <Package className="text-theme-text-muted h-4 w-4" />
            <p className="text-theme-text-muted text-xs font-medium uppercase">Total Items Assigned</p>
          </div>
          <p className="text-theme-text-primary text-2xl font-bold">{totalAssigned}</p>
        </div>
        <div className="card-secondary p-4">
          <div className="mb-1 flex items-center gap-2">
            <AlertTriangle className="text-theme-text-muted h-4 w-4" />
            <p className="text-theme-text-muted text-xs font-medium uppercase">Overdue Returns</p>
          </div>
          <p
            className={`text-2xl font-bold ${totalOverdue > 0 ? 'text-red-700 dark:text-red-400' : 'text-theme-text-primary'}`}
          >
            {totalOverdue}
          </p>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="mb-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search by name, username, or membership number..."
            placeholder="Search by name, username, or membership number..."
            className="form-input placeholder-theme-text-muted pr-4 pl-10 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="text-theme-text-muted h-4 w-4 shrink-0" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="form-input py-2 text-sm"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
          <p className="flex-1 text-sm text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => {
              void loadMembers();
            }}
            className="flex items-center gap-1 text-sm text-red-700 hover:text-red-500 dark:text-red-400"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="card-secondary p-12 text-center" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted mx-auto mb-3 h-8 w-8 animate-spin" />
          <p className="text-theme-text-secondary text-sm">Loading members...</p>
        </div>
      ) : members.length === 0 ? (
        <div className="card-secondary p-12 text-center">
          <Users className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <h3 className="text-theme-text-primary mb-1 text-lg font-semibold">No Members Found</h3>
          <p className="text-theme-text-secondary text-sm">
            {searchQuery ? 'Try adjusting your search.' : 'No members with inventory assignments.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedMembers.map((member) => {
            const isExpanded = expandedUserId === member.user_id;
            const name = member.full_name || member.username;
            return (
              <div key={member.user_id} className="card-secondary overflow-hidden">
                {/* Row — a clickable region (not a <button>) so the nested
                    profile link and action buttons remain valid HTML. */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  className="hover:bg-theme-surface-hover flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors"
                  onClick={() => {
                    void handleExpand(member.user_id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void handleExpand(member.user_id);
                    }
                  }}
                >
                  <div className="text-theme-text-muted shrink-0">
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                  <User className="text-theme-text-muted h-5 w-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/members/${member.user_id}`}
                        className="text-theme-text-primary text-sm font-semibold hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {name}
                      </Link>
                      {member.membership_number && (
                        <span className="text-theme-text-muted text-xs">#{member.membership_number}</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <CountBadge
                        label="permanent"
                        count={member.permanent_count}
                        color="bg-blue-500/10 text-blue-700 dark:text-blue-400"
                      />
                      <CountBadge
                        label="checked out"
                        count={member.checkout_count}
                        color="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                      />
                      <CountBadge
                        label="issued"
                        count={member.issued_count}
                        color="bg-purple-500/10 text-purple-700 dark:text-purple-400"
                      />
                      {member.overdue_count > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-400">
                          <AlertTriangle className="h-3 w-3" />
                          {member.overdue_count} overdue
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-theme-text-primary text-lg font-bold">{member.total_items}</span>
                    <p className="text-theme-text-muted text-xs">items</p>
                  </div>
                  {canManage && (
                    <div
                      className="flex shrink-0 flex-col items-stretch gap-1.5 sm:flex-row sm:items-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="btn-success btn-sm flex items-center justify-center gap-1 active:opacity-80"
                        onClick={() => openScanModal(member)}
                        title="Assign items to this member"
                      >
                        <ArrowDownToLine className="h-3.5 w-3.5" /> Assign
                      </button>
                      {member.total_items > 0 && (
                        <button
                          type="button"
                          className="btn-secondary btn-sm flex items-center justify-center gap-1 active:opacity-80"
                          onClick={() => openReturnModal(member)}
                          title="Return items from this member"
                        >
                          <ArrowUpFromLine className="h-3.5 w-3.5" /> Return
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-secondary btn-sm flex items-center justify-center gap-1 active:opacity-80"
                        onClick={() =>
                          setSizesTarget({ userId: member.user_id, memberName: member.full_name || member.username })
                        }
                        title="Edit this member's sizes"
                      >
                        <Ruler className="h-3.5 w-3.5" /> Sizes
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-theme-surface-border bg-theme-surface-secondary border-t px-4 py-4">
                    {detailLoading ? (
                      <div className="flex items-center justify-center py-6" role="status" aria-live="polite">
                        <Loader2 className="text-theme-text-muted mr-2 h-5 w-5 animate-spin" />
                        <span className="text-theme-text-muted text-sm">Loading inventory details...</span>
                      </div>
                    ) : memberDetail ? (
                      <div className="space-y-5">
                        {/* Permanent */}
                        {memberDetail.permanent_assignments.length > 0 && (
                          <div>
                            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-blue-700 uppercase dark:text-blue-400">
                              <Package className="h-3.5 w-3.5" /> Permanent Assignments (
                              {memberDetail.permanent_assignments.length})
                            </h4>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {memberDetail.permanent_assignments.map((it) => (
                                <div key={it.assignment_id} className="card-secondary p-3">
                                  <Link
                                    to={`/inventory/items/${it.item_id}`}
                                    className="text-theme-text-primary text-sm font-medium hover:underline"
                                  >
                                    {it.item_name}
                                  </Link>
                                  <div className="text-theme-text-muted mt-1 flex flex-wrap items-center gap-3 text-xs">
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
                            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-yellow-700 uppercase dark:text-yellow-400">
                              <Package className="h-3.5 w-3.5" /> Active Checkouts (
                              {memberDetail.active_checkouts.length})
                            </h4>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {memberDetail.active_checkouts.map((it) => (
                                <div
                                  key={it.checkout_id}
                                  className={`card-secondary p-3 ${it.is_overdue ? 'border-red-500/40 bg-red-500/5' : ''}`}
                                >
                                  <Link
                                    to={`/inventory/items/${it.item_id}`}
                                    className="text-theme-text-primary text-sm font-medium hover:underline"
                                  >
                                    {it.item_name}
                                  </Link>
                                  <div className="text-theme-text-muted mt-1 flex flex-wrap items-center gap-3 text-xs">
                                    <span>Out: {formatDate(it.checked_out_at, tz)}</span>
                                    {it.expected_return_at && <span>Due: {formatDate(it.expected_return_at, tz)}</span>}
                                    {it.is_overdue && (
                                      <span className="font-semibold text-red-700 dark:text-red-400">OVERDUE</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Issued */}
                        {memberDetail.issued_items.length > 0 && (
                          <div>
                            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-purple-700 uppercase dark:text-purple-400">
                              <Package className="h-3.5 w-3.5" /> Issued Items ({memberDetail.issued_items.length})
                            </h4>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {memberDetail.issued_items.map((it) => (
                                <div key={it.issuance_id} className="card-secondary p-3">
                                  <Link
                                    to={`/inventory/items/${it.item_id}`}
                                    className="text-theme-text-primary text-sm font-medium hover:underline"
                                  >
                                    {it.item_name}
                                  </Link>
                                  <div className="text-theme-text-muted mt-1 flex flex-wrap items-center gap-3 text-xs">
                                    <span>Qty: {it.quantity_issued}</span>
                                    <VariantCapsules item={{ size: it.size } as InventoryItem} />
                                    <span>{formatDate(it.issued_at, tz)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {memberDetail.permanent_assignments.length === 0 &&
                          memberDetail.active_checkouts.length === 0 &&
                          memberDetail.issued_items.length === 0 && (
                            <p className="text-theme-text-muted py-4 text-center text-sm">
                              No items currently assigned to this member.
                            </p>
                          )}
                      </div>
                    ) : (
                      <p className="text-theme-text-muted py-4 text-center text-sm">Unable to load details.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Barcode Scan Modal (Assign) */}
      <InventoryScanModal
        isOpen={scanModal.isOpen}
        onClose={() => setScanModal((prev) => ({ ...prev, isOpen: false }))}
        mode={scanModal.mode}
        userId={scanModal.userId}
        memberName={scanModal.memberName}
        onComplete={() => {
          void handleScanComplete();
        }}
      />

      {/* Return Items Modal */}
      <ReturnItemsModal
        isOpen={returnModal.isOpen}
        onClose={() => setReturnModal((prev) => ({ ...prev, isOpen: false }))}
        userId={returnModal.userId}
        memberName={returnModal.memberName}
        onComplete={() => {
          void handleScanComplete();
        }}
      />

      {/* Member ID Scanner Modal */}
      <MemberIdScannerModal
        isOpen={memberScannerOpen}
        onClose={() => setMemberScannerOpen(false)}
        onMemberIdentified={handleMemberScanned}
      />

      <SizePreferencesModal
        isOpen={sizesTarget !== null}
        onClose={() => setSizesTarget(null)}
        userId={sizesTarget?.userId}
        memberName={sizesTarget?.memberName}
      />
    </div>
  );
};

export default InventoryMembersPage;
