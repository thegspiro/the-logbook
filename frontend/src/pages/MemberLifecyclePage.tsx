/**
 * Member Lifecycle Management Page
 *
 * Admin page for managing member lifecycle operations:
 * - Archived Members (view and reactivate)
 * - Overdue Property Returns
 * - Membership Tier Configuration
 * - Batch Tier Advancement
 */

import React, { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import toast from 'react-hot-toast';
import {
  Archive,
  RefreshCw,
  Users,
  AlertTriangle,
  ChevronUp,
  Settings,
  Plus,
  Trash2,
  Package,
  UserCheck,
  Calendar,
  X,
} from 'lucide-react';
import { memberStatusService, userService } from '../services/api';
import type { LeaveOfAbsenceResponse } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import type {
  ArchivedMember,
  OverdueMember,
  MembershipTier,
  MembershipTierBenefits,
  MembershipTierConfig,
  PropertyReturnReport,
} from '../types/user';

type TabView = 'archived' | 'overdue' | 'tiers' | 'leaves';

// ==================== Archived Members Tab ====================

const ArchivedMembersPanel: React.FC = () => {
  const [members, setMembers] = useState<ArchivedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  useEffect(() => {
    loadMembers();
  }, []);

  const loadMembers = async () => {
    setLoading(true);
    try {
      const data = await memberStatusService.getArchivedMembers();
      setMembers(data.members);
    } catch {
      toast.error('Failed to load archived members');
    } finally {
      setLoading(false);
    }
  };

  const handleReactivate = async (userId: string, name: string) => {
    if (!confirm(`Reactivate ${name}? This will restore them to active status.`)) return;
    setReactivatingId(userId);
    try {
      await memberStatusService.reactivateMember(userId, { reason: 'Reactivated from admin panel' });
      toast.success(`${name} reactivated successfully`);
      await loadMembers();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reactivate member'));
    } finally {
      setReactivatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status">
        <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-8 text-center">
        <Archive className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
        <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Archived Members</h3>
        <p className="text-theme-text-muted">
          Members that have been dropped and archived will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-theme-surface-border bg-theme-surface">
              <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Name</th>
              <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Email</th>
              <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Member #</th>
              <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Archived</th>
              <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Reason</th>
              <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Action</th>
            </tr>
          </thead>
          <tbody>
            {members.map(member => (
              <tr key={member.user_id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                <td className="p-3">
                  <p className="text-theme-text-primary font-medium">{member.name}</p>
                  {member.rank && <p className="text-xs text-theme-text-muted">{member.rank}</p>}
                </td>
                <td className="p-3 text-theme-text-secondary">{member.email || '—'}</td>
                <td className="p-3 text-theme-text-secondary">{member.membership_number || '—'}</td>
                <td className="p-3 text-theme-text-secondary">
                  {member.archived_at ? new Date(member.archived_at).toLocaleDateString() : '—'}
                </td>
                <td className="p-3 text-theme-text-secondary text-xs max-w-[200px] truncate" title={member.status_change_reason}>
                  {member.status_change_reason || '—'}
                </td>
                <td className="p-3">
                  <button
                    onClick={() => handleReactivate(member.user_id, member.name)}
                    disabled={reactivatingId === member.user_id}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg disabled:opacity-50"
                  >
                    {reactivatingId === member.user_id ? (
                      <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
                    ) : (
                      <UserCheck className="w-3 h-3" aria-hidden="true" />
                    )}
                    Reactivate
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-3 border-t border-theme-surface-border text-xs text-theme-text-muted">
        {members.length} archived member{members.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
};

// ==================== Overdue Property Returns Tab ====================

const OverdueReturnsPanel: React.FC = () => {
  const [members, setMembers] = useState<OverdueMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [reportPreview, setReportPreview] = useState<PropertyReturnReport | null>(null);
  const [loadingReport, setLoadingReport] = useState<string | null>(null);

  useEffect(() => {
    loadOverdue();
  }, []);

  const loadOverdue = async () => {
    setLoading(true);
    try {
      const data = await memberStatusService.getOverduePropertyReturns();
      setMembers(data.members);
    } catch {
      toast.error('Failed to load overdue property returns');
    } finally {
      setLoading(false);
    }
  };

  const handleProcessReminders = async () => {
    setProcessing(true);
    try {
      const result = await memberStatusService.processPropertyReturnReminders();
      toast.success(`Processed reminders: ${result.reminders_sent} sent`);
      await loadOverdue();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to process reminders'));
    } finally {
      setProcessing(false);
    }
  };

  const handlePreviewReport = async (userId: string) => {
    setLoadingReport(userId);
    try {
      const data = await memberStatusService.getPropertyReturnPreview(userId);
      setReportPreview(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load property return report'));
    } finally {
      setLoadingReport(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status">
        <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={handleProcessReminders}
          disabled={processing}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg disabled:opacity-50"
        >
          {processing ? (
            <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          )}
          Send Reminders
        </button>
      </div>

      {members.length === 0 ? (
        <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-8 text-center">
          <Package className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Overdue Returns</h3>
          <p className="text-theme-text-muted">
            All dropped members have returned their assigned property on time.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {members.map((member, idx) => (
            <div key={idx} className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-theme-text-primary font-medium">{member.member_name}</h3>
                  <p className="text-xs text-theme-text-muted">
                    Dropped: {new Date(member.drop_date).toLocaleDateString()} ({member.days_since_drop} days ago)
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  member.days_since_drop > 90
                    ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                    : member.days_since_drop > 30
                      ? 'bg-orange-500/10 text-orange-700 dark:text-orange-400'
                      : 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                }`}>
                  {member.days_since_drop} days overdue
                </span>
              </div>
              {Array.isArray(member.items_outstanding) && member.items_outstanding.length > 0 && (
                <div className="bg-theme-surface rounded p-3">
                  <p className="text-xs text-theme-text-muted mb-2">Outstanding Items ({member.items_outstanding.length}):</p>
                  <div className="space-y-1">
                    {member.items_outstanding.slice(0, 5).map((item: unknown, i: number) => (
                      <p key={i} className="text-sm text-theme-text-primary">
                        {typeof item === 'object' && item !== null ? (item as Record<string, string>).name || JSON.stringify(item) : String(item)}
                      </p>
                    ))}
                    {member.items_outstanding.length > 5 && (
                      <p className="text-xs text-theme-text-muted">
                        ...and {member.items_outstanding.length - 5} more
                      </p>
                    )}
                  </div>
                </div>
              )}
              {member.user_id && (
                <div className="mt-3 pt-3 border-t border-theme-surface-border">
                  <button
                    onClick={() => handlePreviewReport(member.user_id)}
                    disabled={loadingReport === member.user_id}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary border border-theme-surface-border rounded-lg disabled:opacity-50"
                  >
                    {loadingReport === member.user_id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Package className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    Preview Property Return Report
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Property Return Report Preview Modal */}
      {reportPreview && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-preview-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setReportPreview(null); }}
        >
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
            <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-2xl w-full border border-theme-surface-border max-h-[80vh] flex flex-col">
              <div className="px-6 pt-5 pb-3 border-b border-theme-surface-border flex justify-between items-center flex-shrink-0">
                <h3 id="report-preview-title" className="text-lg font-medium text-theme-text-primary">
                  Property Return Report - {reportPreview.member_name}
                </h3>
                <button
                  onClick={() => setReportPreview(null)}
                  className="text-theme-text-muted hover:text-theme-text-primary text-xl"
                  aria-label="Close dialog"
                >
                  &times;
                </button>
              </div>
              <div className="px-6 py-4 overflow-y-auto flex-1">
                <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                  <div>
                    <span className="text-theme-text-muted">Items: </span>
                    <span className="text-theme-text-primary font-medium">{reportPreview.item_count}</span>
                  </div>
                  <div>
                    <span className="text-theme-text-muted">Total Value: </span>
                    <span className="text-theme-text-primary font-medium">${reportPreview.total_value.toFixed(2)}</span>
                  </div>
                </div>
                {reportPreview.html ? (
                  <div
                    className="prose prose-sm max-w-none text-theme-text-primary dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(reportPreview.html) }}
                  />
                ) : reportPreview.items.length > 0 ? (
                  <div className="space-y-2">
                    {reportPreview.items.map((item: unknown, i: number) => (
                      <div key={i} className="bg-theme-surface-secondary rounded p-3 text-sm text-theme-text-primary">
                        {typeof item === 'object' && item !== null
                          ? (item as Record<string, string>).name || JSON.stringify(item)
                          : String(item)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-theme-text-muted">No items in this report.</p>
                )}
              </div>
              <div className="px-6 py-3 border-t border-theme-surface-border flex justify-end flex-shrink-0">
                <button
                  onClick={() => setReportPreview(null)}
                  className="px-4 py-2 border border-theme-surface-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== Tier Configuration Tab ====================

const DEFAULT_BENEFITS: MembershipTierBenefits = {
  training_exempt: false,
  training_exempt_types: [],
  voting_eligible: true,
  voting_requires_meeting_attendance: false,
  voting_min_attendance_pct: 0,
  voting_attendance_period_months: 12,
  can_hold_office: true,
  custom_benefits: {},
};

const TierConfigPanel: React.FC = () => {
  const [config, setConfig] = useState<MembershipTierConfig>({ auto_advance: true, tiers: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await memberStatusService.getTierConfig();
      setConfig(data);
    } catch {
      toast.error('Failed to load tier configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await memberStatusService.updateTierConfig(config);
      toast.success('Tier configuration saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save configuration'));
    } finally {
      setSaving(false);
    }
  };

  const handleAdvance = async () => {
    if (!confirm('This will auto-advance all eligible active members to their next tier. Continue?')) return;
    setAdvancing(true);
    try {
      const result = await memberStatusService.advanceMembershipTiers();
      if (result.advanced === 0) {
        toast.success('No members eligible for advancement');
      } else {
        toast.success(`Advanced ${result.advanced} member${result.advanced !== 1 ? 's' : ''}`);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to advance tiers'));
    } finally {
      setAdvancing(false);
    }
  };

  const addTier = () => {
    const nextOrder = config.tiers.length;
    setConfig(prev => ({
      ...prev,
      tiers: [...prev.tiers, {
        id: `tier_${Date.now()}`,
        name: '',
        years_required: 0,
        sort_order: nextOrder,
        benefits: { ...DEFAULT_BENEFITS },
      }],
    }));
  };

  const removeTier = (index: number) => {
    setConfig(prev => ({
      ...prev,
      tiers: prev.tiers.filter((_, i) => i !== index),
    }));
  };

  const updateTier = (index: number, updates: Partial<MembershipTier>) => {
    setConfig(prev => ({
      ...prev,
      tiers: prev.tiers.map((t, i) => i === index ? { ...t, ...updates } : t),
    }));
  };

  const updateBenefits = (index: number, updates: Partial<MembershipTierBenefits>) => {
    setConfig(prev => ({
      ...prev,
      tiers: prev.tiers.map((t, i) =>
        i === index ? { ...t, benefits: { ...t.benefits, ...updates } } : t
      ),
    }));
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status">
        <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div>
      {/* Header Actions */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={config.auto_advance}
            onChange={(e) => setConfig(prev => ({ ...prev, auto_advance: e.target.checked }))}
            className="rounded border-theme-input-border"
          />
          Auto-advance members based on years of service
        </label>
        <div className="ml-auto flex gap-2">
          <button
            onClick={handleAdvance}
            disabled={advancing}
            className="flex items-center gap-2 px-4 py-2 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary text-sm rounded-lg border border-theme-surface-border disabled:opacity-50"
          >
            {advancing ? (
              <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
            )}
            Advance Eligible Now
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>

      {/* Tier List */}
      <div className="space-y-4">
        {config.tiers
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((tier, index) => (
            <div key={tier.id} className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-theme-text-muted mb-1">Tier Name</label>
                    <input
                      type="text"
                      value={tier.name}
                      onChange={(e) => updateTier(index, { name: e.target.value })}
                      className="w-full px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                      placeholder="e.g., Senior Member"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-theme-text-muted mb-1">Years Required</label>
                    <input
                      type="number"
                      min={0}
                      value={tier.years_required}
                      onChange={(e) => updateTier(index, { years_required: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-theme-text-muted mb-1">Sort Order</label>
                    <input
                      type="number"
                      min={0}
                      value={tier.sort_order}
                      onChange={(e) => updateTier(index, { sort_order: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                    />
                  </div>
                </div>
                <button
                  onClick={() => removeTier(index)}
                  className="p-2 text-theme-text-muted hover:text-red-600 rounded"
                  aria-label={`Remove ${tier.name || 'tier'}`}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              {/* Benefits */}
              <div className="mt-3 pt-3 border-t border-theme-surface-border">
                <p className="text-xs text-theme-text-muted mb-2">Benefits</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <label className="flex items-center gap-2 text-xs text-theme-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tier.benefits.voting_eligible}
                      onChange={(e) => updateBenefits(index, { voting_eligible: e.target.checked })}
                      className="rounded border-theme-input-border"
                    />
                    Voting eligible
                  </label>
                  <label className="flex items-center gap-2 text-xs text-theme-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tier.benefits.can_hold_office}
                      onChange={(e) => updateBenefits(index, { can_hold_office: e.target.checked })}
                      className="rounded border-theme-input-border"
                    />
                    Can hold office
                  </label>
                  <label className="flex items-center gap-2 text-xs text-theme-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tier.benefits.training_exempt}
                      onChange={(e) => updateBenefits(index, { training_exempt: e.target.checked })}
                      className="rounded border-theme-input-border"
                    />
                    Training exempt
                  </label>
                  <label className="flex items-center gap-2 text-xs text-theme-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tier.benefits.voting_requires_meeting_attendance}
                      onChange={(e) => updateBenefits(index, { voting_requires_meeting_attendance: e.target.checked })}
                      className="rounded border-theme-input-border"
                    />
                    Requires attendance
                  </label>
                </div>
                {tier.benefits.voting_requires_meeting_attendance && (
                  <div className="flex items-center gap-4 mt-2">
                    <div>
                      <label className="block text-xs text-theme-text-muted mb-1">Min attendance %</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={tier.benefits.voting_min_attendance_pct}
                        onChange={(e) => updateBenefits(index, { voting_min_attendance_pct: parseFloat(e.target.value) || 0 })}
                        className="w-20 px-2 py-1 bg-theme-input-bg border border-theme-input-border rounded text-xs text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-theme-text-muted mb-1">Period (months)</label>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={tier.benefits.voting_attendance_period_months}
                        onChange={(e) => updateBenefits(index, { voting_attendance_period_months: parseInt(e.target.value) || 12 })}
                        className="w-20 px-2 py-1 bg-theme-input-bg border border-theme-input-border rounded text-xs text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
      </div>

      <button
        onClick={addTier}
        className="mt-4 flex items-center gap-2 px-4 py-2 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary text-sm rounded-lg border border-dashed border-theme-surface-border w-full justify-center"
      >
        <Plus className="w-4 h-4" aria-hidden="true" />
        Add Tier
      </button>
    </div>
  );
};

// ==================== Leave of Absence Tab ====================

const LEAVE_TYPE_LABELS: Record<string, string> = {
  leave_of_absence: 'Leave of Absence',
  medical: 'Medical',
  military: 'Military',
  personal: 'Personal',
  administrative: 'Administrative',
  other: 'Other',
};

interface MemberOption {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
}

const LeavesOfAbsencePanel: React.FC = () => {
  const [leaves, setLeaves] = useState<LeaveOfAbsenceResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    user_id: '',
    leave_type: 'leave_of_absence',
    reason: '',
    start_date: '',
    end_date: '',
  });

  useEffect(() => {
    loadLeaves();
  }, [showInactive]);

  const loadLeaves = async () => {
    setLoading(true);
    try {
      const data = await memberStatusService.listLeavesOfAbsence({
        active_only: !showInactive,
      });
      setLeaves(data);
    } catch {
      toast.error('Failed to load leaves of absence');
    } finally {
      setLoading(false);
    }
  };

  const loadMembers = async () => {
    if (members.length > 0) return;
    setMembersLoading(true);
    try {
      const data = await userService.getUsers();
      setMembers(
        data.map((u) => ({
          id: u.id,
          first_name: u.first_name ?? '',
          last_name: u.last_name ?? '',
          username: u.username,
        }))
      );
    } catch {
      toast.error('Failed to load members');
    } finally {
      setMembersLoading(false);
    }
  };

  const handleOpenForm = () => {
    loadMembers();
    setForm({ user_id: '', leave_type: 'leave_of_absence', reason: '', start_date: '', end_date: '' });
    setShowForm(true);
  };

  const handleCreate = async () => {
    if (!form.user_id || !form.start_date || !form.end_date) {
      toast.error('Please fill in member, start date, and end date');
      return;
    }
    if (form.end_date < form.start_date) {
      toast.error('End date must be after start date');
      return;
    }
    setSaving(true);
    try {
      await memberStatusService.createLeaveOfAbsence({
        user_id: form.user_id,
        leave_type: form.leave_type,
        reason: form.reason || undefined,
        start_date: form.start_date,
        end_date: form.end_date,
      });
      toast.success('Leave of absence created');
      setShowForm(false);
      await loadLeaves();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create leave'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (leaveId: string) => {
    if (!confirm('Deactivate this leave of absence?')) return;
    setDeletingId(leaveId);
    try {
      await memberStatusService.deleteLeaveOfAbsence(leaveId);
      toast.success('Leave of absence deactivated');
      await loadLeaves();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to deactivate leave'));
    } finally {
      setDeletingId(null);
    }
  };

  const getMemberName = (userId: string) => {
    const m = members.find((mem) => mem.id === userId);
    return m ? `${m.first_name} ${m.last_name}` : userId;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status">
        <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div>
      {/* Header Actions */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-theme-input-border"
          />
          Show inactive leaves
        </label>
        <div className="ml-auto">
          <button
            onClick={handleOpenForm}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add Leave of Absence
          </button>
        </div>
      </div>

      {/* Create Form Modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-form-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowForm(false); }}
        >
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
            <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border">
              <div className="px-6 pt-5 pb-3 border-b border-theme-surface-border flex justify-between items-center">
                <h3 id="leave-form-title" className="text-lg font-medium text-theme-text-primary">
                  Add Leave of Absence
                </h3>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-theme-text-muted hover:text-theme-text-primary"
                  aria-label="Close dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-4">
                {/* Member Select */}
                <div>
                  <label className="block text-xs text-theme-text-muted mb-1">Member</label>
                  {membersLoading ? (
                    <div className="flex items-center gap-2 text-sm text-theme-text-muted">
                      <RefreshCw className="w-4 h-4 animate-spin" /> Loading members...
                    </div>
                  ) : (
                    <select
                      value={form.user_id}
                      onChange={(e) => setForm((p) => ({ ...p, user_id: e.target.value }))}
                      className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
                    >
                      <option value="">Select a member...</option>
                      {members
                        .sort((a, b) => a.last_name.localeCompare(b.last_name))
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.last_name}, {m.first_name} ({m.username})
                          </option>
                        ))}
                    </select>
                  )}
                </div>

                {/* Leave Type */}
                <div>
                  <label className="block text-xs text-theme-text-muted mb-1">Leave Type</label>
                  <select
                    value={form.leave_type}
                    onChange={(e) => setForm((p) => ({ ...p, leave_type: e.target.value }))}
                    className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
                  >
                    {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                {/* Date Range */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-theme-text-muted mb-1">Start Date</label>
                    <input
                      type="date"
                      value={form.start_date}
                      onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))}
                      className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-theme-text-muted mb-1">End Date</label>
                    <input
                      type="date"
                      value={form.end_date}
                      onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
                      className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
                    />
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-xs text-theme-text-muted mb-1">Reason (optional)</label>
                  <textarea
                    value={form.reason}
                    onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 resize-none"
                    placeholder="Optional reason for the leave..."
                  />
                </div>
              </div>
              <div className="px-6 py-3 border-t border-theme-surface-border flex justify-end gap-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-theme-surface-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Create Leave'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Leave List */}
      {leaves.length === 0 ? (
        <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-8 text-center">
          <Calendar className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Leaves of Absence</h3>
          <p className="text-theme-text-muted">
            Leaves of absence will appear here. When a member takes leave, months within
            the leave period are excluded from rolling-period requirement calculations.
          </p>
        </div>
      ) : (
        <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-theme-surface-border bg-theme-surface">
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Member</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Type</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Start</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">End</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Reason</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Status</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Action</th>
                </tr>
              </thead>
              <tbody>
                {leaves.map((leave) => (
                  <tr key={leave.id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                    <td className="p-3 text-theme-text-primary font-medium">
                      {getMemberName(leave.user_id)}
                    </td>
                    <td className="p-3 text-theme-text-secondary">
                      {LEAVE_TYPE_LABELS[leave.leave_type] || leave.leave_type}
                    </td>
                    <td className="p-3 text-theme-text-secondary">
                      {new Date(leave.start_date + 'T00:00:00').toLocaleDateString()}
                    </td>
                    <td className="p-3 text-theme-text-secondary">
                      {new Date(leave.end_date + 'T00:00:00').toLocaleDateString()}
                    </td>
                    <td className="p-3 text-theme-text-secondary text-xs max-w-[200px] truncate" title={leave.reason || ''}>
                      {leave.reason || '\u2014'}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        leave.active
                          ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                          : 'bg-gray-500/10 text-gray-700 dark:text-gray-400'
                      }`}>
                        {leave.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-3">
                      {leave.active && (
                        <button
                          onClick={() => handleDelete(leave.id)}
                          disabled={deletingId === leave.id}
                          className="flex items-center gap-1 px-3 py-1.5 text-red-600 hover:bg-red-500/10 text-xs rounded-lg disabled:opacity-50"
                        >
                          {deletingId === leave.id ? (
                            <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="w-3 h-3" aria-hidden="true" />
                          )}
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-theme-surface-border text-xs text-theme-text-muted">
            {leaves.length} leave{leaves.length !== 1 ? 's' : ''} of absence
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== Main Page ====================

export const MemberLifecyclePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabView>('archived');

  return (
    <div className="min-h-screen">
      <div className="p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-theme-text-primary">Member Lifecycle Management</h1>
          <p className="text-theme-text-muted mt-1">
            Manage archived members, property returns, leaves of absence, and membership tier configuration
          </p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-theme-surface-border mb-6" role="tablist" aria-label="Member lifecycle views">
          <button
            onClick={() => setActiveTab('archived')}
            role="tab"
            aria-selected={activeTab === 'archived'}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'archived'
                ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <Archive className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
            Archived Members
          </button>
          <button
            onClick={() => setActiveTab('overdue')}
            role="tab"
            aria-selected={activeTab === 'overdue'}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'overdue'
                ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <AlertTriangle className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
            Overdue Returns
          </button>
          <button
            onClick={() => setActiveTab('leaves')}
            role="tab"
            aria-selected={activeTab === 'leaves'}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'leaves'
                ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <Calendar className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
            Leave of Absence
          </button>
          <button
            onClick={() => setActiveTab('tiers')}
            role="tab"
            aria-selected={activeTab === 'tiers'}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'tiers'
                ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <Settings className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
            Tier Configuration
          </button>
        </div>

        {/* Content */}
        <div role="tabpanel">
          {activeTab === 'archived' && <ArchivedMembersPanel />}
          {activeTab === 'overdue' && <OverdueReturnsPanel />}
          {activeTab === 'leaves' && <LeavesOfAbsencePanel />}
          {activeTab === 'tiers' && <TierConfigPanel />}
        </div>
      </div>
    </div>
  );
};

export default MemberLifecyclePage;
