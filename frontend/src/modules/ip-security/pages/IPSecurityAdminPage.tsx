/**
 * IP Security Admin Page
 *
 * Main admin page for managing IP exceptions, blocked attempts, and blocked countries.
 * Tabbed interface for IT administrators.
 */

import React, { useEffect, useState } from 'react';
import { Shield, RefreshCw, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useIPSecurityStore } from '../store/ipSecurityStore';
import { IPExceptionTable } from '../components/IPExceptionTable';
import { BlockedAttemptsTable } from '../components/BlockedAttemptsTable';
import { BlockedCountriesTable } from '../components/BlockedCountriesTable';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { IPExceptionApprovalStatus } from '../../../constants/enums';
import type { CountryBlockRuleCreate } from '../types';

const tabClass = (active: boolean) =>
  `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
    active
      ? 'bg-blue-600 text-white'
      : 'text-theme-text-secondary hover:bg-theme-surface-hover'
  }`;

const inputClass =
  'w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500/40';
const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';

type Tab = 'pending' | 'all' | 'blocked-attempts' | 'blocked-countries';

const IPSecurityAdminPage: React.FC = () => {
  const {
    pendingExceptions,
    allExceptions,
    blockedAttempts,
    blockedCountries,
    isLoading,
    isSaving,
    error,
    fetchPendingExceptions,
    fetchAllExceptions,
    fetchBlockedAttempts,
    fetchBlockedCountries,
    approveException,
    rejectException,
    revokeException,
    addBlockedCountry,
    removeBlockedCountry,
    clearError,
  } = useIPSecurityStore();

  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [statusFilter, setStatusFilter] = useState('');

  // Action modals
  const [approveModal, setApproveModal] = useState<{ open: boolean; id: string }>({ open: false, id: '' });
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: string }>({ open: false, id: '' });
  const [revokeModal, setRevokeModal] = useState<{ open: boolean; id: string }>({ open: false, id: '' });
  const [countryModal, setCountryModal] = useState(false);

  // Form states
  const [approvalNotes, setApprovalNotes] = useState('');
  const [approvedDays, setApprovedDays] = useState<number | ''>('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [newCountry, setNewCountry] = useState<CountryBlockRuleCreate>({
    countryCode: '',
    reason: '',
    riskLevel: 'high',
  });

  useEffect(() => {
    if (activeTab === 'pending') void fetchPendingExceptions();
    if (activeTab === 'all') void fetchAllExceptions(statusFilter || undefined);
    if (activeTab === 'blocked-attempts') void fetchBlockedAttempts();
    if (activeTab === 'blocked-countries') void fetchBlockedCountries();
  }, [activeTab, statusFilter, fetchPendingExceptions, fetchAllExceptions, fetchBlockedAttempts, fetchBlockedCountries]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  const handleApprove = async () => {
    try {
      const trimmedNotes = approvalNotes.trim();
      await approveException(approveModal.id, {
        ...(approvedDays ? { approvedDurationDays: approvedDays } : {}),
        ...(trimmedNotes ? { approvalNotes: trimmedNotes } : {}),
      });
      toast.success('Exception approved');
      setApproveModal({ open: false, id: '' });
      setApprovalNotes('');
      setApprovedDays('');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to approve'));
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) return;
    try {
      await rejectException(rejectModal.id, { rejectionReason: rejectionReason.trim() });
      toast.success('Exception rejected');
      setRejectModal({ open: false, id: '' });
      setRejectionReason('');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reject'));
    }
  };

  const handleRevoke = async () => {
    if (!revokeReason.trim()) return;
    try {
      await revokeException(revokeModal.id, { revokeReason: revokeReason.trim() });
      toast.success('Exception revoked');
      setRevokeModal({ open: false, id: '' });
      setRevokeReason('');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to revoke'));
    }
  };

  const handleAddCountry = async () => {
    if (!newCountry.countryCode.trim() || !newCountry.reason.trim()) return;
    try {
      const trimmedCountryName = newCountry.countryName?.trim();
      await addBlockedCountry({
        countryCode: newCountry.countryCode.trim().toUpperCase(),
        reason: newCountry.reason.trim(),
        riskLevel: newCountry.riskLevel,
        ...(trimmedCountryName ? { countryName: trimmedCountryName } : {}),
      });
      toast.success('Country added to block list');
      setCountryModal(false);
      setNewCountry({ countryCode: '', reason: '', riskLevel: 'high' });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add country'));
    }
  };

  const handleRemoveCountry = async (code: string) => {
    if (!confirm(`Remove ${code} from the blocked countries list?`)) return;
    try {
      await removeBlockedCountry(code);
      toast.success(`${code} unblocked`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to remove country'));
    }
  };

  const refresh = () => {
    if (activeTab === 'pending') void fetchPendingExceptions();
    if (activeTab === 'all') void fetchAllExceptions(statusFilter || undefined);
    if (activeTab === 'blocked-attempts') void fetchBlockedAttempts();
    if (activeTab === 'blocked-countries') void fetchBlockedCountries();
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-red-600 rounded-lg p-2">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-theme-text-primary">IP Security</h1>
              <p className="text-sm text-theme-text-muted">
                Manage IP exceptions, geo-blocking, and access controls
              </p>
            </div>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-2 px-3 py-2 border border-theme-surface-border rounded-lg text-sm text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <button className={tabClass(activeTab === 'pending')} onClick={() => setActiveTab('pending')}>
            Pending Requests
            {pendingExceptions.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold">
                {pendingExceptions.length}
              </span>
            )}
          </button>
          <button className={tabClass(activeTab === 'all')} onClick={() => setActiveTab('all')}>
            All Exceptions
          </button>
          <button className={tabClass(activeTab === 'blocked-attempts')} onClick={() => setActiveTab('blocked-attempts')}>
            Blocked Attempts
          </button>
          <button className={tabClass(activeTab === 'blocked-countries')} onClick={() => setActiveTab('blocked-countries')}>
            Blocked Countries
          </button>
        </div>

        {/* Content */}
        <div className="bg-theme-surface border border-theme-surface-border rounded-xl overflow-hidden">
          {activeTab === 'pending' && (
            <IPExceptionTable
              exceptions={pendingExceptions}
              showActions
              onApprove={(id) => setApproveModal({ open: true, id })}
              onReject={(id) => setRejectModal({ open: true, id })}
            />
          )}

          {activeTab === 'all' && (
            <>
              <div className="px-4 py-3 border-b border-theme-surface-border flex items-center gap-3">
                <label htmlFor="all-status-filter" className="sr-only">Filter by status</label>
                <select
                  id="all-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-1.5 bg-theme-surface border border-theme-surface-border rounded-lg text-sm text-theme-text-primary"
                >
                  <option value="">All statuses</option>
                  {Object.values(IPExceptionApprovalStatus).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <IPExceptionTable
                exceptions={allExceptions}
                showActions
                onApprove={(id) => setApproveModal({ open: true, id })}
                onReject={(id) => setRejectModal({ open: true, id })}
                onRevoke={(id) => setRevokeModal({ open: true, id })}
              />
            </>
          )}

          {activeTab === 'blocked-attempts' && (
            <BlockedAttemptsTable attempts={blockedAttempts} />
          )}

          {activeTab === 'blocked-countries' && (
            <>
              <div className="px-4 py-3 border-b border-theme-surface-border flex items-center justify-end">
                <button
                  onClick={() => setCountryModal(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Country
                </button>
              </div>
              <BlockedCountriesTable
                countries={blockedCountries}
                onRemove={(code) => { void handleRemoveCountry(code); }}
              />
            </>
          )}
        </div>

        {/* Approve Modal */}
        <Modal isOpen={approveModal.open} onClose={() => setApproveModal({ open: false, id: '' })} title="Approve Exception">
          <div className="space-y-4">
            <div>
              <label htmlFor="approved-days" className={labelClass}>Approved Duration (days, optional override)</label>
              <input
                id="approved-days"
                type="number"
                value={approvedDays}
                onChange={(e) => setApprovedDays(e.target.value ? Number(e.target.value) : '')}
                min={1}
                max={90}
                placeholder="Use requested duration"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="approval-notes" className={labelClass}>Notes (optional)</label>
              <textarea
                id="approval-notes"
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                className={inputClass}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setApproveModal({ open: false, id: '' })}
                className="px-4 py-2 text-sm text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleApprove(); }}
                disabled={isSaving}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {isSaving ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        </Modal>

        {/* Reject Modal */}
        <Modal isOpen={rejectModal.open} onClose={() => setRejectModal({ open: false, id: '' })} title="Reject Exception">
          <div className="space-y-4">
            <div>
              <label htmlFor="rejection-reason" className={labelClass}>Reason for Rejection</label>
              <textarea
                id="rejection-reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className={inputClass}
                rows={3}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRejectModal({ open: false, id: '' })}
                className="px-4 py-2 text-sm text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleReject(); }}
                disabled={isSaving || !rejectionReason.trim()}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {isSaving ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </Modal>

        {/* Revoke Modal */}
        <Modal isOpen={revokeModal.open} onClose={() => setRevokeModal({ open: false, id: '' })} title="Revoke Exception">
          <div className="space-y-4">
            <div>
              <label htmlFor="revoke-reason" className={labelClass}>Reason for Revocation</label>
              <textarea
                id="revoke-reason"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                className={inputClass}
                rows={3}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRevokeModal({ open: false, id: '' })}
                className="px-4 py-2 text-sm text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleRevoke(); }}
                disabled={isSaving || !revokeReason.trim()}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {isSaving ? 'Revoking...' : 'Revoke'}
              </button>
            </div>
          </div>
        </Modal>

        {/* Add Country Modal */}
        <Modal isOpen={countryModal} onClose={() => setCountryModal(false)} title="Add Blocked Country">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="country-code" className={labelClass}>Country Code</label>
                <input
                  id="country-code"
                  type="text"
                  value={newCountry.countryCode}
                  onChange={(e) => setNewCountry({ ...newCountry, countryCode: e.target.value })}
                  placeholder="e.g. CN"
                  maxLength={2}
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <label htmlFor="country-name" className={labelClass}>Country Name (optional)</label>
                <input
                  id="country-name"
                  type="text"
                  value={newCountry.countryName ?? ''}
                  onChange={(e) => setNewCountry({ ...newCountry, countryName: e.target.value })}
                  placeholder="e.g. China"
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label htmlFor="risk-level" className={labelClass}>Risk Level</label>
              <select
                id="risk-level"
                value={newCountry.riskLevel}
                onChange={(e) => setNewCountry({ ...newCountry, riskLevel: e.target.value })}
                className={inputClass}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label htmlFor="block-reason" className={labelClass}>Reason</label>
              <textarea
                id="block-reason"
                value={newCountry.reason}
                onChange={(e) => setNewCountry({ ...newCountry, reason: e.target.value })}
                className={inputClass}
                rows={3}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCountryModal(false)}
                className="px-4 py-2 text-sm text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleAddCountry(); }}
                disabled={isSaving || !newCountry.countryCode.trim() || !newCountry.reason.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {isSaving ? 'Adding...' : 'Add Country'}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
};

export default IPSecurityAdminPage;
