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
    active ? 'bg-blue-600 text-white' : 'text-theme-text-secondary hover:bg-theme-surface-hover'
  }`;

const inputClass = 'form-input';
const labelClass = 'form-label';

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
  }, [
    activeTab,
    statusFilter,
    fetchPendingExceptions,
    fetchAllExceptions,
    fetchBlockedAttempts,
    fetchBlockedCountries,
  ]);

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
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-600 p-2">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">IP Security</h1>
              <p className="text-theme-text-muted text-sm">Manage IP exceptions, geo-blocking, and access controls</p>
            </div>
          </div>
          <button
            onClick={refresh}
            className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <button className={tabClass(activeTab === 'pending')} onClick={() => setActiveTab('pending')}>
            Pending Requests
            {pendingExceptions.length > 0 && (
              <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                {pendingExceptions.length}
              </span>
            )}
          </button>
          <button className={tabClass(activeTab === 'all')} onClick={() => setActiveTab('all')}>
            All Exceptions
          </button>
          <button
            className={tabClass(activeTab === 'blocked-attempts')}
            onClick={() => setActiveTab('blocked-attempts')}
          >
            Blocked Attempts
          </button>
          <button
            className={tabClass(activeTab === 'blocked-countries')}
            onClick={() => setActiveTab('blocked-countries')}
          >
            Blocked Countries
          </button>
        </div>

        {/* Content */}
        <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-xl border">
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
              <div className="border-theme-surface-border flex items-center gap-3 border-b px-4 py-3">
                <label htmlFor="all-status-filter" className="sr-only">
                  Filter by status
                </label>
                <select
                  id="all-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-theme-surface border-theme-surface-border text-theme-text-primary rounded-lg border px-3 py-1.5 text-sm"
                >
                  <option value="">All statuses</option>
                  {Object.values(IPExceptionApprovalStatus).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
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

          {activeTab === 'blocked-attempts' && <BlockedAttemptsTable attempts={blockedAttempts} />}

          {activeTab === 'blocked-countries' && (
            <>
              <div className="border-theme-surface-border flex items-center justify-end border-b px-4 py-3">
                <button
                  onClick={() => setCountryModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  Add Country
                </button>
              </div>
              <BlockedCountriesTable
                countries={blockedCountries}
                onRemove={(code) => {
                  void handleRemoveCountry(code);
                }}
              />
            </>
          )}
        </div>

        {/* Approve Modal */}
        <Modal
          isOpen={approveModal.open}
          onClose={() => setApproveModal({ open: false, id: '' })}
          title="Approve Exception"
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="approved-days" className={labelClass}>
                Approved Duration (days, optional override)
              </label>
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
              <label htmlFor="approval-notes" className={labelClass}>
                Notes (optional)
              </label>
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
                className="text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg px-4 py-2 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleApprove();
                }}
                disabled={isSaving}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
              >
                {isSaving ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        </Modal>

        {/* Reject Modal */}
        <Modal
          isOpen={rejectModal.open}
          onClose={() => setRejectModal({ open: false, id: '' })}
          title="Reject Exception"
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="rejection-reason" className={labelClass}>
                Reason for Rejection
              </label>
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
                className="text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg px-4 py-2 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleReject();
                }}
                disabled={isSaving || !rejectionReason.trim()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {isSaving ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </Modal>

        {/* Revoke Modal */}
        <Modal
          isOpen={revokeModal.open}
          onClose={() => setRevokeModal({ open: false, id: '' })}
          title="Revoke Exception"
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="revoke-reason" className={labelClass}>
                Reason for Revocation
              </label>
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
                className="text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg px-4 py-2 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleRevoke();
                }}
                disabled={isSaving || !revokeReason.trim()}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
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
                <label htmlFor="country-code" className={labelClass}>
                  Country Code
                </label>
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
                <label htmlFor="country-name" className={labelClass}>
                  Country Name (optional)
                </label>
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
              <label htmlFor="risk-level" className={labelClass}>
                Risk Level
              </label>
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
              <label htmlFor="block-reason" className={labelClass}>
                Reason
              </label>
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
                className="text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg px-4 py-2 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleAddCountry();
                }}
                disabled={isSaving || !newCountry.countryCode.trim() || !newCountry.reason.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
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
