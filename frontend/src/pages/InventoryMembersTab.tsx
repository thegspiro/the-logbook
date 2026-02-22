/**
 * Inventory Members Tab
 *
 * Shows all members with their inventory holdings so the Quartermaster can see
 * what items have been assigned to each individual. Each member row is
 * expandable to show assignment details, and has buttons to launch the
 * barcode-based check-out / return modal.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Search,
  ChevronDown,
  ChevronRight,
  Users,
  Package,
  AlertTriangle,
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  Shield,
} from 'lucide-react';
import {
  inventoryService,
  type MemberInventorySummary,
  type UserInventoryResponse,
} from '../services/api';
import { InventoryScanModal } from '../components/InventoryScanModal';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';

const InventoryMembersTab: React.FC = () => {
  const tz = useTimezone();
  const [members, setMembers] = useState<MemberInventorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDebounce, setSearchDebounce] = useState('');

  // Expanded member detail
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [memberDetail, setMemberDetail] = useState<UserInventoryResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Scan modal
  const [scanModal, setScanModal] = useState<{
    isOpen: boolean;
    mode: 'checkout' | 'return';
    userId: string;
    memberName: string;
  }>({ isOpen: false, mode: 'checkout', userId: '', memberName: '' });

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounce(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getMembersSummary(searchDebounce || undefined);
      setMembers(data.members);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load members inventory data.'));
    } finally {
      setLoading(false);
    }
  }, [searchDebounce]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

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
      const detail = await inventoryService.getUserInventory(userId);
      setMemberDetail(detail);
    } catch {
      setMemberDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const openScanModal = (mode: 'checkout' | 'return', member: MemberInventorySummary) => {
    setScanModal({
      isOpen: true,
      mode,
      userId: member.user_id,
      memberName: member.full_name || member.username,
    });
  };

  const handleScanComplete = async () => {
    // Refresh member list and detail after a scan operation
    await loadMembers();
    if (expandedUserId) {
      setDetailLoading(true);
      try {
        const detail = await inventoryService.getUserInventory(expandedUserId);
        setMemberDetail(detail);
      } catch (err) {
        console.error('Failed to load member inventory detail:', err);
        setMemberDetail(null);
      } finally {
        setDetailLoading(false);
      }
    }
  };

  // Count members with items
  const membersWithItems = members.filter((m) => m.total_items > 0).length;
  const membersOverdue = members.filter((m) => m.overdue_count > 0).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-theme-surface rounded-lg p-4 border border-theme-surface-border">
          <p className="text-theme-text-muted text-xs font-medium uppercase">Total Members</p>
          <p className="text-theme-text-primary text-2xl font-bold mt-1">{members.length}</p>
        </div>
        <div className="bg-theme-surface rounded-lg p-4 border border-theme-surface-border">
          <p className="text-theme-text-muted text-xs font-medium uppercase">With Equipment</p>
          <p className="text-emerald-700 dark:text-emerald-400 text-2xl font-bold mt-1">{membersWithItems}</p>
        </div>
        <div className="bg-theme-surface rounded-lg p-4 border border-theme-surface-border">
          <p className="text-theme-text-muted text-xs font-medium uppercase">Overdue Returns</p>
          <p className={`text-2xl font-bold mt-1 ${membersOverdue > 0 ? 'text-red-700 dark:text-red-400' : 'text-theme-text-primary'}`}>
            {membersOverdue}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="bg-theme-surface rounded-lg p-4 border border-theme-surface-border mb-6">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, username, or membership number..."
              className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            />
          </div>
          <button
            onClick={loadMembers}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-400 flex-shrink-0" />
          <p className="text-red-700 dark:text-red-300 text-sm flex-1">{error}</p>
          <button onClick={loadMembers} className="text-red-700 dark:text-red-400 hover:text-red-500 text-sm flex items-center gap-1">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="bg-theme-surface rounded-lg p-12 border border-theme-surface-border text-center">
          <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-secondary text-sm">Loading members...</p>
        </div>
      ) : members.length === 0 ? (
        <div className="bg-theme-surface rounded-lg p-12 border border-theme-surface-border text-center">
          <Users className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <h3 className="text-theme-text-primary text-lg font-semibold mb-1">No Members Found</h3>
          <p className="text-theme-text-secondary text-sm">
            {searchQuery ? 'Try adjusting your search.' : 'No active members in the organization.'}
          </p>
        </div>
      ) : (
        /* Member list */
        <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead className="bg-theme-input-bg border-b border-theme-surface-border">
              <tr>
                <th className="w-8 px-2 sm:px-4 py-3" />
                <th className="px-2 sm:px-4 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Member</th>
                <th className="hidden md:table-cell px-4 py-3 text-center text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Assigned</th>
                <th className="hidden md:table-cell px-4 py-3 text-center text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Checked Out</th>
                <th className="hidden lg:table-cell px-4 py-3 text-center text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Issued</th>
                <th className="px-2 sm:px-4 py-3 text-center text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Total</th>
                <th className="px-2 sm:px-4 py-3 text-right text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-surface-border">
              {members.map((member) => {
                const isExpanded = expandedUserId === member.user_id;
                return (
                  <React.Fragment key={member.user_id}>
                    {/* Member row */}
                    <tr
                      className="hover:bg-theme-surface-secondary transition-colors cursor-pointer"
                      onClick={() => handleExpand(member.user_id)}
                    >
                      <td className="px-2 sm:px-4 py-3">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-theme-text-muted" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-theme-text-muted" />
                        )}
                      </td>
                      <td className="px-2 sm:px-4 py-3">
                        <div>
                          <span className="text-theme-text-primary font-medium text-sm">
                            {member.full_name || member.username}
                          </span>
                          <div className="flex items-center gap-2 mt-0.5">
                            {member.full_name && (
                              <span className="text-theme-text-muted text-xs">@{member.username}</span>
                            )}
                            {member.membership_number && (
                              <span className="hidden sm:inline-flex items-center gap-1 text-xs text-theme-text-muted">
                                <Shield className="w-3 h-3" /> {member.membership_number}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="hidden md:table-cell px-4 py-3 text-center">
                        <span className={`text-sm font-medium ${member.permanent_count > 0 ? 'text-blue-700 dark:text-blue-400' : 'text-theme-text-muted'}`}>
                          {member.permanent_count}
                        </span>
                      </td>
                      <td className="hidden md:table-cell px-4 py-3 text-center">
                        <span className={`text-sm font-medium ${member.checkout_count > 0 ? 'text-yellow-700 dark:text-yellow-400' : 'text-theme-text-muted'}`}>
                          {member.checkout_count}
                        </span>
                        {member.overdue_count > 0 && (
                          <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 text-xs font-semibold rounded bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30">
                            {member.overdue_count} overdue
                          </span>
                        )}
                      </td>
                      <td className="hidden lg:table-cell px-4 py-3 text-center">
                        <span className={`text-sm font-medium ${member.issued_count > 0 ? 'text-purple-700 dark:text-purple-400' : 'text-theme-text-muted'}`}>
                          {member.issued_count}
                        </span>
                      </td>
                      <td className="px-2 sm:px-4 py-3 text-center">
                        <span className={`text-sm font-bold ${member.total_items > 0 ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}>
                          {member.total_items}
                        </span>
                      </td>
                      <td className="px-2 sm:px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1 sm:gap-2">
                          <button
                            onClick={() => openScanModal('checkout', member)}
                            className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                            title="Check out items to this member"
                          >
                            <ArrowDownToLine className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Check Out</span><span className="sm:hidden">Out</span>
                          </button>
                          {member.total_items > 0 && (
                            <button
                              onClick={() => openScanModal('return', member)}
                              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-medium rounded-lg border border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
                              title="Return items from this member"
                            >
                              <ArrowUpFromLine className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Return</span><span className="sm:hidden">Ret</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="bg-theme-surface-secondary px-6 py-4">
                          {detailLoading ? (
                            <div className="flex items-center justify-center py-6">
                              <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted mr-2" />
                              <span className="text-sm text-theme-text-muted">Loading inventory details...</span>
                            </div>
                          ) : memberDetail ? (
                            <div className="space-y-4">
                              {/* Permanent Assignments */}
                              {memberDetail.permanent_assignments.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-semibold uppercase text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-1.5">
                                    <Package className="w-3.5 h-3.5" /> Permanent Assignments ({memberDetail.permanent_assignments.length})
                                  </h4>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {memberDetail.permanent_assignments.map((item) => (
                                      <div key={item.assignment_id} className="bg-theme-surface rounded-lg p-3 border border-theme-surface-border">
                                        <p className="text-sm font-medium text-theme-text-primary">{item.item_name}</p>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-theme-text-muted">
                                          {item.serial_number && <span className="font-mono">SN: {item.serial_number}</span>}
                                          {item.asset_tag && <span className="font-mono">AT: {item.asset_tag}</span>}
                                          <span className="capitalize">{item.condition.replace('_', ' ')}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Active Checkouts */}
                              {memberDetail.active_checkouts.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-semibold uppercase text-yellow-700 dark:text-yellow-400 mb-2 flex items-center gap-1.5">
                                    <Package className="w-3.5 h-3.5" /> Active Checkouts ({memberDetail.active_checkouts.length})
                                  </h4>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {memberDetail.active_checkouts.map((item) => (
                                      <div
                                        key={item.checkout_id}
                                        className={`bg-theme-surface rounded-lg p-3 border ${
                                          item.is_overdue
                                            ? 'border-red-500/40 bg-red-500/5'
                                            : 'border-theme-surface-border'
                                        }`}
                                      >
                                        <p className="text-sm font-medium text-theme-text-primary">{item.item_name}</p>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-theme-text-muted">
                                          <span>Out: {formatDate(item.checked_out_at, tz)}</span>
                                          {item.expected_return_at && (
                                            <span>Due: {formatDate(item.expected_return_at, tz)}</span>
                                          )}
                                          {item.is_overdue && (
                                            <span className="text-red-700 dark:text-red-400 font-semibold">OVERDUE</span>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Issued Items */}
                              {memberDetail.issued_items.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-semibold uppercase text-purple-700 dark:text-purple-400 mb-2 flex items-center gap-1.5">
                                    <Package className="w-3.5 h-3.5" /> Issued Items ({memberDetail.issued_items.length})
                                  </h4>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {memberDetail.issued_items.map((item) => (
                                      <div key={item.issuance_id} className="bg-theme-surface rounded-lg p-3 border border-theme-surface-border">
                                        <p className="text-sm font-medium text-theme-text-primary">{item.item_name}</p>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-theme-text-muted">
                                          <span>Qty: {item.quantity_issued}</span>
                                          {item.size && <span>Size: {item.size}</span>}
                                          <span>{formatDate(item.issued_at, tz)}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Empty state */}
                              {memberDetail.permanent_assignments.length === 0 &&
                                memberDetail.active_checkouts.length === 0 &&
                                memberDetail.issued_items.length === 0 && (
                                  <p className="text-sm text-theme-text-muted text-center py-4">
                                    No items currently assigned to this member.
                                  </p>
                                )}
                            </div>
                          ) : (
                            <p className="text-sm text-theme-text-muted text-center py-4">
                              Unable to load details.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Scan Modal */}
      <InventoryScanModal
        isOpen={scanModal.isOpen}
        onClose={() => setScanModal((prev) => ({ ...prev, isOpen: false }))}
        mode={scanModal.mode}
        userId={scanModal.userId}
        memberName={scanModal.memberName}
        onComplete={handleScanComplete}
      />
    </div>
  );
};

export default InventoryMembersTab;
