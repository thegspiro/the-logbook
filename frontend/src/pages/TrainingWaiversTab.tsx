/**
 * Training Waivers Tab
 *
 * Shown within the Training Admin Hub (Dashboard > Training Waivers).
 * Displays all training waivers (past, present, and future) for the
 * training officer to review. Includes filtering by status and member.
 *
 * This is the training officer's dedicated view - the unified waiver
 * management page (which covers meetings/shifts too) lives in the
 * Members module at /members/admin/waivers.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { memberStatusService, userService } from '../services/api';
import type { TrainingWaiverResponse, LeaveOfAbsenceResponse } from '../services/api';
import type { User } from '../types/user';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';

type StatusFilter = 'all' | 'active' | 'future' | 'expired' | 'inactive';

function getStatusBadge(waiver: { start_date: string; end_date: string; active: boolean }) {
  if (!waiver.active) {
    return { label: 'Deactivated', color: 'bg-gray-500/20 text-gray-400' };
  }
  const today = new Date().toISOString().split('T')[0]!;
  if (waiver.start_date > today) {
    return { label: 'Future', color: 'bg-blue-500/20 text-blue-400' };
  }
  if (waiver.end_date < today) {
    return { label: 'Expired', color: 'bg-yellow-500/20 text-yellow-400' };
  }
  return { label: 'Active', color: 'bg-green-500/20 text-green-400' };
}

const WAIVER_TYPE_LABELS: Record<string, string> = {
  leave_of_absence: 'Leave of Absence',
  medical: 'Medical',
  military: 'Military',
  personal: 'Personal',
  administrative: 'Administrative',
  other: 'Other',
};

interface UnifiedTrainingWaiver {
  id: string;
  user_id: string;
  member_name: string;
  member_rank: string;
  waiver_type: string;
  reason: string | null;
  start_date: string;
  end_date: string;
  requirement_ids: string[] | null;
  granted_by_name: string;
  active: boolean;
  source: 'standalone' | 'leave_linked';
  leave_id?: string;
}

const TrainingWaiversTab: React.FC = () => {
  const tz = useTimezone();
  const [trainingWaivers, setTrainingWaivers] = useState<TrainingWaiverResponse[]>([]);
  const [leaves, setLeaves] = useState<LeaveOfAbsenceResponse[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [waiversData, leavesData, membersData] = await Promise.all([
        memberStatusService.listTrainingWaivers({ active_only: false }),
        memberStatusService.listLeavesOfAbsence({ active_only: false }),
        userService.getUsers(),
      ]);
      setTrainingWaivers(waiversData);
      setLeaves(leavesData);
      setMembers(membersData);
    } catch {
      setError('Failed to load training waivers');
    } finally {
      setLoading(false);
    }
  };

  const membersById = useMemo(() => {
    const map: Record<string, User> = {};
    members.forEach((m) => { map[m.id] = m; });
    return map;
  }, [members]);

  // Build unified list: all training waivers + leave-linked ones with context
  const waiverList: UnifiedTrainingWaiver[] = useMemo(() => {
    const linkedWaiverToLeave: Record<string, LeaveOfAbsenceResponse> = {};
    for (const leave of leaves) {
      if (leave.linked_training_waiver_id) {
        linkedWaiverToLeave[leave.linked_training_waiver_id] = leave;
      }
    }

    return trainingWaivers.map((w) => {
      const member = membersById[w.user_id];
      const linkedLeave = linkedWaiverToLeave[w.id];
      const grantedByMember = w.granted_by ? membersById[w.granted_by] : null;

      return {
        id: w.id,
        user_id: w.user_id,
        member_name: member?.full_name || member?.username || w.user_id,
        member_rank: member?.rank || '',
        waiver_type: w.waiver_type,
        reason: w.reason,
        start_date: w.start_date,
        end_date: w.end_date,
        requirement_ids: w.requirement_ids,
        granted_by_name: grantedByMember?.full_name || grantedByMember?.username || '',
        active: w.active,
        source: linkedLeave ? 'leave_linked' as const : 'standalone' as const,
        leave_id: linkedLeave?.id,
      };
    }).sort((a, b) => b.start_date.localeCompare(a.start_date));
  }, [trainingWaivers, leaves, membersById]);

  // Apply filters
  const filteredWaivers = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]!;
    let result = waiverList;

    if (statusFilter === 'active') {
      result = result.filter((w) => w.active && w.start_date <= today && w.end_date >= today);
    } else if (statusFilter === 'future') {
      result = result.filter((w) => w.active && w.start_date > today);
    } else if (statusFilter === 'expired') {
      result = result.filter((w) => w.active && w.end_date < today);
    } else if (statusFilter === 'inactive') {
      result = result.filter((w) => !w.active);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((w) =>
        w.member_name.toLowerCase().includes(q) ||
        w.member_rank.toLowerCase().includes(q) ||
        (w.reason || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [waiverList, statusFilter, searchQuery]);

  // Summary stats
  const stats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]!;
    const active = waiverList.filter((w) => w.active && w.start_date <= today && w.end_date >= today);
    const future = waiverList.filter((w) => w.active && w.start_date > today);
    const expired = waiverList.filter((w) => w.active && w.end_date < today);
    return { active: active.length, future: future.length, expired: expired.length, total: waiverList.length };
  }, [waiverList]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-theme-text-muted">Loading training waivers...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
          <p className="text-xs text-theme-text-muted uppercase tracking-wider">Active</p>
          <p className="text-2xl font-bold text-green-400">{stats.active}</p>
        </div>
        <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
          <p className="text-xs text-theme-text-muted uppercase tracking-wider">Future</p>
          <p className="text-2xl font-bold text-blue-400">{stats.future}</p>
        </div>
        <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
          <p className="text-xs text-theme-text-muted uppercase tracking-wider">Expired</p>
          <p className="text-2xl font-bold text-yellow-400">{stats.expired}</p>
        </div>
        <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
          <p className="text-xs text-theme-text-muted uppercase tracking-wider">Total</p>
          <p className="text-2xl font-bold text-theme-text-primary">{stats.total}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex rounded-lg border border-theme-surface-border overflow-hidden">
          {(['all', 'active', 'future', 'expired', 'inactive'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === f
                  ? 'bg-red-600 text-white'
                  : 'bg-theme-surface text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, rank, or reason..."
          className="rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-1.5 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500 w-72"
        />
        <div className="ml-auto text-xs text-theme-text-muted self-center">
          {filteredWaivers.length} waiver{filteredWaivers.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Waiver Table */}
      {filteredWaivers.length === 0 ? (
        <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
          <p className="text-theme-text-muted">No training waivers match the current filter.</p>
        </div>
      ) : (
        <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
          <table className="min-w-full divide-y divide-theme-surface-border">
            <thead className="bg-theme-surface-hover">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Member</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Period</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Scope</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Reason</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-surface-border">
              {filteredWaivers.map((waiver) => {
                const badge = getStatusBadge(waiver);
                return (
                  <tr key={waiver.id} className="hover:bg-theme-surface-hover">
                    <td className="px-4 py-3">
                      <Link to={`/members/${waiver.user_id}`} className="text-sm font-medium text-blue-400 hover:text-blue-300">
                        {waiver.member_name}
                      </Link>
                      {waiver.member_rank && (
                        <p className="text-xs text-theme-text-muted">{waiver.member_rank}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${badge.color}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-secondary">
                      {WAIVER_TYPE_LABELS[waiver.waiver_type] || waiver.waiver_type}
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-secondary">
                      <span>{formatDate(waiver.start_date, tz)}</span>
                      <span className="text-theme-text-muted mx-1">to</span>
                      <span>{formatDate(waiver.end_date, tz)}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-muted">
                      {waiver.requirement_ids
                        ? `${waiver.requirement_ids.length} requirement${waiver.requirement_ids.length !== 1 ? 's' : ''}`
                        : 'All requirements'}
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-muted max-w-xs truncate">
                      {waiver.reason || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        waiver.source === 'leave_linked'
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-theme-surface-hover text-theme-text-secondary'
                      }`}>
                        {waiver.source === 'leave_linked' ? 'Auto (LOA)' : 'Manual'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Link to full waiver management */}
      <div className="mt-4 text-center">
        <Link
          to="/members/admin/waivers"
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          Open full Waiver Management page (includes meetings & shifts)
        </Link>
      </div>
    </div>
  );
};

export default TrainingWaiversTab;
