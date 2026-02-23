/**
 * Waiver Management Page
 *
 * Unified page for managing all waivers (training, meetings, shifts).
 * Shows who has active waivers, lets admins create new ones, and
 * provides a history view of past waivers.
 *
 * Tabs:
 *   - Active Waivers: All members with currently active waivers
 *   - Create Waiver: Form to generate a new waiver
 *   - History: All waivers (past, present, future) with filtering
 *
 * Requires: members.manage or training.manage permission
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { memberStatusService, userService } from '../services/api';
import type { LeaveOfAbsenceResponse, TrainingWaiverResponse } from '../services/api';
import type { User } from '../types/user';
import { useAuthStore } from '../stores/authStore';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';

type WaiverTab = 'active' | 'create' | 'history';

const WAIVER_TYPES = [
  { value: 'leave_of_absence', label: 'Leave of Absence' },
  { value: 'medical', label: 'Medical' },
  { value: 'military', label: 'Military' },
  { value: 'personal', label: 'Personal' },
  { value: 'administrative', label: 'Administrative' },
  { value: 'other', label: 'Other' },
];

const APPLIES_TO_OPTIONS = [
  { value: 'training', label: 'Training Requirements' },
  { value: 'meetings', label: 'Meeting Attendance' },
  { value: 'shifts', label: 'Shift Requirements' },
  { value: 'all', label: 'All (Training, Meetings, Shifts)' },
];

function getWaiverTypeLabel(type: string): string {
  return WAIVER_TYPES.find((t) => t.value === type)?.label || type.replace(/_/g, ' ');
}

function getStatusBadge(waiver: { start_date: string; end_date: string; active: boolean }) {
  if (!waiver.active) {
    return { label: 'Inactive', color: 'bg-gray-500/20 text-gray-400' };
  }
  const today = new Date().toISOString().split('T')[0];
  if (waiver.start_date > today) {
    return { label: 'Future', color: 'bg-blue-500/20 text-blue-400' };
  }
  if (waiver.end_date < today) {
    return { label: 'Expired', color: 'bg-yellow-500/20 text-yellow-400' };
  }
  return { label: 'Active', color: 'bg-green-500/20 text-green-400' };
}

// Unified waiver type combining leaves and training waivers
interface UnifiedWaiver {
  id: string;
  user_id: string;
  member_name: string;
  waiver_type: string;
  applies_to: string; // 'training' | 'meetings' | 'all'
  reason: string | null;
  start_date: string;
  end_date: string;
  granted_by: string | null;
  granted_at: string | null;
  active: boolean;
  source: 'leave' | 'training_waiver';
  exempt_from_training_waiver?: boolean;
  linked_training_waiver_id?: string | null;
}

export const WaiverManagementPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as WaiverTab | null;
  const [activeTab, setActiveTab] = useState<WaiverTab>(
    tabParam && ['active', 'create', 'history'].includes(tabParam) ? tabParam : 'active'
  );
  const tz = useTimezone();
  const { checkPermission } = useAuthStore();

  // Data
  const [leaves, setLeaves] = useState<LeaveOfAbsenceResponse[]>([]);
  const [trainingWaivers, setTrainingWaivers] = useState<TrainingWaiverResponse[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [formData, setFormData] = useState({
    user_id: '',
    waiver_type: 'leave_of_absence',
    applies_to: 'all',
    reason: '',
    start_date: '',
    end_date: '',
    exempt_from_training_waiver: false,
  });
  const [creating, setCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // History filter
  const [historyFilter, setHistoryFilter] = useState<'all' | 'active' | 'inactive' | 'future'>('all');
  const [memberFilter, setMemberFilter] = useState('');

  const tabs: { id: WaiverTab; label: string }[] = [
    { id: 'active', label: 'Active Waivers' },
    { id: 'create', label: 'Create Waiver' },
    { id: 'history', label: 'All Waivers' },
  ];

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (tabParam && ['active', 'create', 'history'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [leavesData, waiversData, membersData] = await Promise.all([
        memberStatusService.listLeavesOfAbsence({ active_only: false }),
        memberStatusService.listTrainingWaivers({ active_only: false }),
        userService.getUsers(),
      ]);
      setLeaves(leavesData);
      setTrainingWaivers(waiversData);
      setMembers(membersData);
    } catch (err) {
      setError('Failed to load waiver data');
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (tab: WaiverTab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // Build members lookup
  const membersById = useMemo(() => {
    const map: Record<string, User> = {};
    members.forEach((m) => { map[m.id] = m; });
    return map;
  }, [members]);

  // Build unified waiver list
  const unifiedWaivers: UnifiedWaiver[] = useMemo(() => {
    const result: UnifiedWaiver[] = [];

    // Leaves of absence (apply to meetings, shifts, and optionally training)
    for (const leave of leaves) {
      const member = membersById[leave.user_id];
      result.push({
        id: leave.id,
        user_id: leave.user_id,
        member_name: member?.full_name || member?.username || leave.user_id,
        waiver_type: leave.leave_type,
        applies_to: leave.exempt_from_training_waiver ? 'meetings' : 'all',
        reason: leave.reason,
        start_date: leave.start_date,
        end_date: leave.end_date,
        granted_by: leave.granted_by,
        granted_at: leave.granted_at,
        active: leave.active,
        source: 'leave',
        exempt_from_training_waiver: leave.exempt_from_training_waiver,
        linked_training_waiver_id: leave.linked_training_waiver_id,
      });
    }

    // Standalone training waivers (not linked from a leave)
    const linkedWaiverIds = new Set(leaves.map((l) => l.linked_training_waiver_id).filter(Boolean));
    for (const waiver of trainingWaivers) {
      if (linkedWaiverIds.has(waiver.id)) continue; // Skip auto-linked ones (shown with their leave)
      const member = membersById[waiver.user_id];
      result.push({
        id: waiver.id,
        user_id: waiver.user_id,
        member_name: member?.full_name || member?.username || waiver.user_id,
        waiver_type: waiver.waiver_type,
        applies_to: 'training',
        reason: waiver.reason,
        start_date: waiver.start_date,
        end_date: waiver.end_date,
        granted_by: waiver.granted_by,
        granted_at: waiver.granted_at,
        active: waiver.active,
        source: 'training_waiver',
      });
    }

    // Sort by start date desc
    result.sort((a, b) => b.start_date.localeCompare(a.start_date));
    return result;
  }, [leaves, trainingWaivers, membersById]);

  // Active waivers (current period)
  const activeWaivers = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return unifiedWaivers.filter(
      (w) => w.active && w.start_date <= today && w.end_date >= today
    );
  }, [unifiedWaivers]);

  // Filtered history
  const filteredHistory = useMemo(() => {
    let result = unifiedWaivers;
    const today = new Date().toISOString().split('T')[0];

    if (historyFilter === 'active') {
      result = result.filter((w) => w.active && w.start_date <= today && w.end_date >= today);
    } else if (historyFilter === 'inactive') {
      result = result.filter((w) => !w.active || w.end_date < today);
    } else if (historyFilter === 'future') {
      result = result.filter((w) => w.active && w.start_date > today);
    }

    if (memberFilter) {
      const search = memberFilter.toLowerCase();
      result = result.filter((w) => w.member_name.toLowerCase().includes(search));
    }

    return result;
  }, [unifiedWaivers, historyFilter, memberFilter]);

  const handleCreateWaiver = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    try {
      if (!formData.user_id) throw new Error('Please select a member');
      if (!formData.start_date || !formData.end_date) throw new Error('Start and end dates are required');
      if (formData.end_date < formData.start_date) throw new Error('End date must be after start date');

      if (formData.applies_to === 'training') {
        // Create standalone training waiver
        await memberStatusService.createTrainingWaiver({
          user_id: formData.user_id,
          waiver_type: formData.waiver_type,
          reason: formData.reason || undefined,
          start_date: formData.start_date,
          end_date: formData.end_date,
        });
      } else {
        // Create leave of absence (auto-links to training waiver unless exempt)
        await memberStatusService.createLeaveOfAbsence({
          user_id: formData.user_id,
          leave_type: formData.waiver_type,
          reason: formData.reason || undefined,
          start_date: formData.start_date,
          end_date: formData.end_date,
          exempt_from_training_waiver: formData.applies_to === 'meetings' || formData.exempt_from_training_waiver,
        });
      }

      const memberName = membersById[formData.user_id]?.full_name || 'Member';
      setCreateSuccess(`Waiver created for ${memberName}`);
      setFormData({
        user_id: '',
        waiver_type: 'leave_of_absence',
        applies_to: 'all',
        reason: '',
        start_date: '',
        end_date: '',
        exempt_from_training_waiver: false,
      });
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create waiver';
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivate = async (waiver: UnifiedWaiver) => {
    if (!confirm(`Deactivate waiver for ${waiver.member_name}?`)) return;

    try {
      if (waiver.source === 'leave') {
        await memberStatusService.deleteLeaveOfAbsence(waiver.id);
      } else {
        await memberStatusService.deleteTrainingWaiver(waiver.id);
      }
      fetchData();
    } catch {
      alert('Failed to deactivate waiver');
    }
  };

  // Active members sorted by name for the member picker
  const activeMembers = useMemo(() => {
    return members
      .filter((m) => m.status === 'active' || m.status === 'probationary' || m.status === 'leave')
      .sort((a, b) => (a.full_name || a.username || '').localeCompare(b.full_name || b.username || ''));
  }, [members]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <div className="flex justify-center items-center h-64">
          <div className="text-theme-text-muted">Loading waiver data...</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header + Tab Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-theme-text-primary">Waiver Management</h1>
          <p className="mt-1 text-sm text-theme-text-muted">
            Manage waivers for training, meetings, and shifts across all members
          </p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="border-b border-theme-surface-border">
          <nav className="flex space-x-1 overflow-x-auto" aria-label="Waiver tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors focus:outline-none ${
                  activeTab === tab.id
                    ? 'border-red-500 text-theme-text-primary'
                    : 'border-transparent text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border'
                }`}
              >
                {tab.label}
                {tab.id === 'active' && activeWaivers.length > 0 && (
                  <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400">
                    {activeWaivers.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Active Waivers Tab */}
        {activeTab === 'active' && (
          <div>
            {activeWaivers.length === 0 ? (
              <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
                <p className="text-theme-text-muted">No active waivers at this time.</p>
                <button
                  onClick={() => handleTabChange('create')}
                  className="mt-3 text-sm text-blue-400 hover:text-blue-300"
                >
                  Create a new waiver
                </button>
              </div>
            ) : (
              <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
                <table className="min-w-full divide-y divide-theme-surface-border">
                  <thead className="bg-theme-surface-hover">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Member</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Applies To</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Period</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Reason</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-theme-text-muted uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme-surface-border">
                    {activeWaivers.map((waiver) => (
                      <tr key={`${waiver.source}-${waiver.id}`} className="hover:bg-theme-surface-hover">
                        <td className="px-4 py-3">
                          <Link to={`/members/${waiver.user_id}`} className="text-sm font-medium text-blue-400 hover:text-blue-300">
                            {waiver.member_name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-theme-text-secondary">
                          {getWaiverTypeLabel(waiver.waiver_type)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2 py-1 rounded-full bg-theme-surface-hover text-theme-text-secondary">
                            {waiver.applies_to === 'all' ? 'Training, Meetings, Shifts' :
                             waiver.applies_to === 'training' ? 'Training Only' :
                             waiver.applies_to === 'meetings' ? 'Meetings & Shifts' :
                             waiver.applies_to}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-theme-text-secondary">
                          {formatDate(waiver.start_date, tz)} - {formatDate(waiver.end_date, tz)}
                        </td>
                        <td className="px-4 py-3 text-sm text-theme-text-muted max-w-xs truncate">
                          {waiver.reason || '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDeactivate(waiver)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            Deactivate
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Create Waiver Tab */}
        {activeTab === 'create' && (
          <div className="max-w-2xl">
            <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-6">
              <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Create New Waiver</h2>

              {createSuccess && (
                <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
                  {createSuccess}
                </div>
              )}
              {createError && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {createError}
                </div>
              )}

              <form onSubmit={handleCreateWaiver} className="space-y-4">
                {/* Member Selection */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Member</label>
                  <select
                    value={formData.user_id}
                    onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                    className="w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                    required
                  >
                    <option value="">Select a member...</option>
                    {activeMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name || m.username} {m.rank ? `(${m.rank})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Waiver Type */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Waiver Type</label>
                  <select
                    value={formData.waiver_type}
                    onChange={(e) => setFormData({ ...formData, waiver_type: e.target.value })}
                    className="w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    {WAIVER_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* Applies To */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Applies To</label>
                  <select
                    value={formData.applies_to}
                    onChange={(e) => setFormData({ ...formData, applies_to: e.target.value })}
                    className="w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    {APPLIES_TO_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-theme-text-muted">
                    {formData.applies_to === 'all'
                      ? 'Creates a leave of absence that automatically generates a training waiver.'
                      : formData.applies_to === 'training'
                      ? 'Creates a standalone training waiver without a leave of absence.'
                      : formData.applies_to === 'meetings'
                      ? 'Creates a leave of absence for meetings/shifts but keeps training requirements active.'
                      : 'Creates waivers for shift requirements only.'}
                  </p>
                </div>

                {/* Date Range */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Start Date</label>
                    <input
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                      className="w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">End Date</label>
                    <input
                      type="date"
                      value={formData.end_date}
                      onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                      className="w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                      required
                    />
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Reason</label>
                  <textarea
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    rows={3}
                    className="w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="Reason for the waiver..."
                  />
                </div>

                <button
                  type="submit"
                  disabled={creating}
                  className="w-full px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {creating ? 'Creating...' : 'Create Waiver'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div>
            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-4">
              <div className="flex rounded-lg border border-theme-surface-border overflow-hidden">
                {(['all', 'active', 'future', 'inactive'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setHistoryFilter(f)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      historyFilter === f
                        ? 'bg-red-600 text-white'
                        : 'bg-theme-surface text-theme-text-muted hover:text-theme-text-primary'
                    }`}
                  >
                    {f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'future' ? 'Future' : 'Past/Inactive'}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                placeholder="Search by member name..."
                className="rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-1.5 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500 w-64"
              />
              <div className="ml-auto text-xs text-theme-text-muted self-center">
                {filteredHistory.length} waiver{filteredHistory.length !== 1 ? 's' : ''}
              </div>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
                <p className="text-theme-text-muted">No waivers match the current filter.</p>
              </div>
            ) : (
              <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
                <table className="min-w-full divide-y divide-theme-surface-border">
                  <thead className="bg-theme-surface-hover">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Member</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Applies To</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Period</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">Reason</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-theme-text-muted uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme-surface-border">
                    {filteredHistory.map((waiver) => {
                      const badge = getStatusBadge(waiver);
                      return (
                        <tr key={`${waiver.source}-${waiver.id}`} className="hover:bg-theme-surface-hover">
                          <td className="px-4 py-3">
                            <Link to={`/members/${waiver.user_id}`} className="text-sm font-medium text-blue-400 hover:text-blue-300">
                              {waiver.member_name}
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${badge.color}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-theme-text-secondary">
                            {getWaiverTypeLabel(waiver.waiver_type)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs px-2 py-1 rounded-full bg-theme-surface-hover text-theme-text-secondary">
                              {waiver.applies_to === 'all' ? 'All' :
                               waiver.applies_to === 'training' ? 'Training' :
                               waiver.applies_to === 'meetings' ? 'Meetings/Shifts' :
                               waiver.applies_to}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-theme-text-secondary">
                            {formatDate(waiver.start_date, tz)} - {formatDate(waiver.end_date, tz)}
                          </td>
                          <td className="px-4 py-3 text-sm text-theme-text-muted max-w-xs truncate">
                            {waiver.reason || '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {waiver.active && (
                              <button
                                onClick={() => handleDeactivate(waiver)}
                                className="text-xs text-red-400 hover:text-red-300"
                              >
                                Deactivate
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WaiverManagementPage;
