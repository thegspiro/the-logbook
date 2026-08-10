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
import { Link } from 'react-router';
import { useSearchParams } from 'react-router';
import { memberStatusService, userService } from '../services/api';
import type { LeaveOfAbsenceResponse, TrainingWaiverResponse } from '../services/api';
import type { User } from '../types/user';
import { useAuthStore } from '../stores/authStore';
import { formatDate, getTodayLocalDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { getErrorMessage } from '../utils/errorHandling';
import { UserStatus } from '../constants/enums';

type WaiverTab = 'active' | 'create' | 'history';

const WAIVER_TYPES = [
  { value: 'leave_of_absence', label: 'Leave of Absence' },
  { value: 'medical', label: 'Medical' },
  { value: 'military', label: 'Military' },
  { value: 'personal', label: 'Personal' },
  { value: 'administrative', label: 'Administrative' },
  { value: 'new_member', label: 'New Member' },
  { value: 'other', label: 'Other' },
];

const APPLIES_TO_OPTIONS = [
  { value: 'training', label: 'Training Requirements' },
  { value: 'meetings', label: 'Meeting Attendance' },
  { value: 'shifts', label: 'Shift Requirements' },
];

function getWaiverTypeLabel(type: string): string {
  return WAIVER_TYPES.find((t) => t.value === type)?.label || type.replace(/_/g, ' ');
}

function getStatusBadge(waiver: { start_date: string; end_date: string | null; active: boolean }, today: string) {
  if (!waiver.active) {
    return { label: 'Inactive', color: 'bg-theme-surface-secondary text-theme-text-muted' };
  }
  if (waiver.start_date > today) {
    return { label: 'Future', color: 'bg-blue-500/20 text-blue-700 dark:text-blue-400' };
  }
  if (!waiver.end_date) {
    return { label: 'Permanent', color: 'bg-purple-500/20 text-purple-700 dark:text-purple-400' };
  }
  if (waiver.end_date < today) {
    return { label: 'Expired', color: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' };
  }
  return { label: 'Active', color: 'bg-green-500/20 text-green-700 dark:text-green-400' };
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
  end_date: string | null;
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
  const { checkPermission: _checkPermission } = useAuthStore();

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
    applies_to: ['training', 'meetings', 'shifts'] as string[],
    reason: '',
    start_date: '',
    end_date: '',
    is_permanent: false,
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
    void fetchData();
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
    } catch (_err) {
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
    members.forEach((m) => {
      map[m.id] = m;
    });
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

  const today = getTodayLocalDate(tz);

  // Active waivers (current period)
  const activeWaivers = useMemo(() => {
    return unifiedWaivers.filter((w) => w.active && w.start_date <= today && (!w.end_date || w.end_date >= today));
  }, [unifiedWaivers, today]);

  // Filtered history
  const filteredHistory = useMemo(() => {
    let result = unifiedWaivers;

    if (historyFilter === 'active') {
      result = result.filter((w) => w.active && w.start_date <= today && (!w.end_date || w.end_date >= today));
    } else if (historyFilter === 'inactive') {
      result = result.filter((w) => !w.active || (w.end_date && w.end_date < today));
    } else if (historyFilter === 'future') {
      result = result.filter((w) => w.active && w.start_date > today);
    }

    if (memberFilter) {
      const search = memberFilter.toLowerCase();
      result = result.filter((w) => w.member_name.toLowerCase().includes(search));
    }

    return result;
  }, [unifiedWaivers, historyFilter, memberFilter, today]);

  const handleCreateWaiver = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    try {
      if (!formData.user_id) throw new Error('Please select a member');
      if (formData.applies_to.length === 0) throw new Error('Please select at least one area');
      if (!formData.start_date) throw new Error('Start date is required');
      if (!formData.is_permanent && !formData.end_date) throw new Error('End date is required (or select Permanent)');
      if (!formData.is_permanent && formData.end_date < formData.start_date)
        throw new Error('End date must be after start date');

      const endDate = formData.is_permanent ? undefined : formData.end_date;
      const hasTraining = formData.applies_to.includes('training');
      const hasMeetingsOrShifts = formData.applies_to.includes('meetings') || formData.applies_to.includes('shifts');

      if (hasTraining && !hasMeetingsOrShifts) {
        // Training only — create standalone training waiver
        await memberStatusService.createTrainingWaiver({
          user_id: formData.user_id,
          waiver_type: formData.waiver_type,
          ...(formData.reason ? { reason: formData.reason } : {}),
          start_date: formData.start_date,
          end_date: endDate,
        });
      } else if (hasMeetingsOrShifts) {
        // Meetings/shifts selected — create leave of absence
        // If training is also selected, the LOA auto-generates a training waiver
        await memberStatusService.createLeaveOfAbsence({
          user_id: formData.user_id,
          leave_type: formData.waiver_type,
          ...(formData.reason ? { reason: formData.reason } : {}),
          start_date: formData.start_date,
          end_date: endDate,
          exempt_from_training_waiver: !hasTraining || formData.exempt_from_training_waiver,
        });
      }

      const memberName = membersById[formData.user_id]?.full_name || 'Member';
      setCreateSuccess(`Waiver created for ${memberName}`);
      setFormData({
        user_id: '',
        waiver_type: 'leave_of_absence',
        applies_to: ['training', 'meetings', 'shifts'],
        reason: '',
        start_date: '',
        end_date: '',
        is_permanent: false,
        exempt_from_training_waiver: false,
      });
      void fetchData();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to create waiver');
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
      void fetchData();
    } catch {
      alert('Failed to deactivate waiver');
    }
  };

  // Active members sorted by name for the member picker
  const activeMembers = useMemo(() => {
    return members
      .filter(
        (m) => m.status === UserStatus.ACTIVE || m.status === UserStatus.PROBATIONARY || m.status === UserStatus.LEAVE
      )
      .sort((a, b) => (a.full_name || a.username || '').localeCompare(b.full_name || b.username || ''));
  }, [members]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        <div className="flex h-64 items-center justify-center">
          <div className="text-theme-text-muted">Loading waiver data...</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header + Tab Bar */}
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-theme-text-primary text-2xl font-bold">Waiver Management</h1>
          <p className="text-theme-text-muted mt-1 text-sm">
            Manage waivers for training, meetings, and shifts across all members
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="border-theme-surface-border border-b">
          <nav className="flex space-x-1 overflow-x-auto" aria-label="Waiver tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors focus:outline-hidden ${
                  activeTab === tab.id
                    ? 'text-theme-text-primary border-red-500'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border border-transparent'
                }`}
              >
                {tab.label}
                {tab.id === 'active' && activeWaivers.length > 0 && (
                  <span className="ml-2 rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">
                    {activeWaivers.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Active Waivers Tab */}
        {activeTab === 'active' && (
          <div>
            {activeWaivers.length === 0 ? (
              <div className="bg-theme-surface border-theme-surface-border rounded-lg border py-12 text-center">
                <p className="text-theme-text-muted">No active waivers at this time.</p>
                <button
                  onClick={() => handleTabChange('create')}
                  className="mt-3 text-sm text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Create a new waiver
                </button>
              </div>
            ) : (
              <div className="bg-theme-surface border-theme-surface-border overflow-hidden overflow-x-auto rounded-lg border">
                <table className="divide-theme-surface-border min-w-full divide-y">
                  <thead className="bg-theme-surface-hover">
                    <tr>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        Member
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        Type
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        Applies To
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        Period
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        Reason
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-theme-surface-border divide-y">
                    {activeWaivers.map((waiver) => (
                      <tr key={`${waiver.source}-${waiver.id}`} className="hover:bg-theme-surface-hover">
                        <td className="px-4 py-3">
                          <Link
                            to={`/members/${waiver.user_id}`}
                            className="text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            {waiver.member_name}
                          </Link>
                        </td>
                        <td className="text-theme-text-secondary px-4 py-3 text-sm">
                          {getWaiverTypeLabel(waiver.waiver_type)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="bg-theme-surface-hover text-theme-text-secondary rounded-full px-2 py-1 text-xs">
                            {waiver.applies_to === 'all'
                              ? 'Training, Meetings, Shifts'
                              : waiver.applies_to === 'training'
                                ? 'Training Only'
                                : waiver.applies_to === 'meetings'
                                  ? 'Meetings & Shifts'
                                  : waiver.applies_to}
                          </span>
                        </td>
                        <td className="text-theme-text-secondary px-4 py-3 text-sm">
                          {formatDate(waiver.start_date, tz)} -{' '}
                          {waiver.end_date ? formatDate(waiver.end_date, tz) : 'Permanent'}
                        </td>
                        <td className="text-theme-text-muted max-w-xs truncate px-4 py-3 text-sm">
                          {waiver.reason || '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => {
                              void handleDeactivate(waiver);
                            }}
                            className="text-xs text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
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
            <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-6">
              <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Create New Waiver</h2>

              {createSuccess && (
                <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
                  {createSuccess}
                </div>
              )}
              {createError && (
                <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
                  {createError}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  void handleCreateWaiver(e);
                }}
                className="space-y-4"
              >
                {/* Member Selection */}
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Member</label>
                  <select
                    value={formData.user_id}
                    onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                    className="form-input"
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
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Waiver Type</label>
                  <select
                    value={formData.waiver_type}
                    onChange={(e) => setFormData({ ...formData, waiver_type: e.target.value })}
                    className="form-input"
                  >
                    {WAIVER_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Applies To */}
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Applies To</label>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
                    {APPLIES_TO_OPTIONS.map((o) => (
                      <label
                        key={o.value}
                        className="text-theme-text-primary flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={formData.applies_to.includes(o.value)}
                          onChange={(e) => {
                            const updated = e.target.checked
                              ? [...formData.applies_to, o.value]
                              : formData.applies_to.filter((v) => v !== o.value);
                            setFormData({ ...formData, applies_to: updated });
                          }}
                          className="border-theme-surface-border focus:ring-theme-focus-ring rounded-sm text-blue-600"
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    {formData.applies_to.length === 0
                      ? 'Select at least one area to waive.'
                      : formData.applies_to.includes('training') &&
                          !formData.applies_to.includes('meetings') &&
                          !formData.applies_to.includes('shifts')
                        ? 'Creates a standalone training waiver without a leave of absence.'
                        : !formData.applies_to.includes('training') &&
                            (formData.applies_to.includes('meetings') || formData.applies_to.includes('shifts'))
                          ? 'Creates a leave of absence but keeps training requirements active.'
                          : 'Creates a leave of absence that automatically generates a training waiver.'}
                  </p>
                </div>

                {/* Date Range */}
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Start Date</label>
                      <input
                        type="date"
                        value={formData.start_date}
                        onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                        className="form-input"
                        required
                      />
                    </div>
                    {!formData.is_permanent && (
                      <div>
                        <label className="text-theme-text-secondary mb-1 block text-sm font-medium">End Date</label>
                        <input
                          type="date"
                          value={formData.end_date}
                          onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                          className="form-input"
                          required
                        />
                      </div>
                    )}
                  </div>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.is_permanent}
                      onChange={(e) => setFormData({ ...formData, is_permanent: e.target.checked, end_date: '' })}
                      className="border-theme-surface-border focus:ring-theme-focus-ring rounded-sm text-blue-600"
                    />
                    <span className="text-theme-text-secondary text-sm">Permanent (no end date)</span>
                  </label>
                  {formData.is_permanent && (
                    <p className="text-theme-text-muted text-xs">
                      This waiver will remain active indefinitely until manually deactivated. Use for long-service
                      members exempt from certain requirements.
                    </p>
                  )}
                </div>

                {/* Reason */}
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Reason</label>
                  <textarea
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    rows={3}
                    className="form-input"
                    placeholder="Reason for the waiver..."
                  />
                </div>

                <button type="submit" disabled={creating} className="btn-primary w-full text-sm font-medium">
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
            <div className="mb-4 flex flex-wrap gap-3">
              <div className="border-theme-surface-border flex overflow-hidden rounded-lg border">
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
                aria-label="Search by member name..."
                placeholder="Search by member name..."
                className="border-theme-surface-border bg-theme-surface text-theme-text-primary focus:ring-theme-focus-ring w-64 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:outline-hidden"
              />
              <div className="text-theme-text-muted ml-auto self-center text-xs">
                {filteredHistory.length} waiver{filteredHistory.length !== 1 ? 's' : ''}
              </div>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="bg-theme-surface border-theme-surface-border rounded-lg border py-12 text-center">
                <p className="text-theme-text-muted">No waivers match the current filter.</p>
              </div>
            ) : (
              <div className="bg-theme-surface border-theme-surface-border overflow-hidden overflow-x-auto rounded-lg border">
                <table className="divide-theme-surface-border min-w-full divide-y">
                  <thead className="bg-theme-surface-hover">
                    <tr>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        Member
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        Status
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        Type
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        Applies To
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        Period
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        Reason
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-theme-surface-border divide-y">
                    {filteredHistory.map((waiver) => {
                      const badge = getStatusBadge(waiver, today);
                      return (
                        <tr key={`${waiver.source}-${waiver.id}`} className="hover:bg-theme-surface-hover">
                          <td className="px-4 py-3">
                            <Link
                              to={`/members/${waiver.user_id}`}
                              className="text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              {waiver.member_name}
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-1 text-xs font-medium ${badge.color}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="text-theme-text-secondary px-4 py-3 text-sm">
                            {getWaiverTypeLabel(waiver.waiver_type)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="bg-theme-surface-hover text-theme-text-secondary rounded-full px-2 py-1 text-xs">
                              {waiver.applies_to === 'all'
                                ? 'All'
                                : waiver.applies_to === 'training'
                                  ? 'Training'
                                  : waiver.applies_to === 'meetings'
                                    ? 'Meetings/Shifts'
                                    : waiver.applies_to}
                            </span>
                          </td>
                          <td className="text-theme-text-secondary px-4 py-3 text-sm">
                            {formatDate(waiver.start_date, tz)} -{' '}
                            {waiver.end_date ? formatDate(waiver.end_date, tz) : 'Permanent'}
                          </td>
                          <td className="text-theme-text-muted max-w-xs truncate px-4 py-3 text-sm">
                            {waiver.reason || '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {waiver.active && (
                              <button
                                onClick={() => {
                                  void handleDeactivate(waiver);
                                }}
                                className="text-xs text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
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
