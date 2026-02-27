/**
 * Proxy Voting Management Component
 *
 * Secretary tool for managing proxy voting authorizations in elections.
 * Allows authorizing one member to vote on behalf of another absent member.
 */

import React, { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { electionService } from '../services/api';
import type { ProxyAuthorization, ProxyAuthorizationCreate } from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';

interface ProxyVotingManagementProps {
  electionId: string;
  canManage: boolean;
}

interface ProxyFormState {
  delegating_user_id: string;
  proxy_user_id: string;
  proxy_type: 'single_election' | 'regular';
  reason: string;
}

const emptyForm: ProxyFormState = {
  delegating_user_id: '',
  proxy_user_id: '',
  proxy_type: 'single_election',
  reason: '',
};

export const ProxyVotingManagement: React.FC<ProxyVotingManagementProps> = ({
  electionId,
  canManage,
}) => {
  const [authorizations, setAuthorizations] = useState<ProxyAuthorization[]>([]);
  const [proxyVotingEnabled, setProxyVotingEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<ProxyFormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchAuthorizations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await electionService.getProxyAuthorizations(electionId);
      setAuthorizations(data.authorizations);
      setProxyVotingEnabled(data.proxy_voting_enabled);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load proxy authorizations'));
    } finally {
      setLoading(false);
    }
  }, [electionId]);

  useEffect(() => {
    void fetchAuthorizations();
  }, [fetchAuthorizations]);

  const handleAdd = async () => {
    if (!formData.delegating_user_id.trim() || !formData.proxy_user_id.trim() || !formData.reason.trim()) {
      toast.error('All fields are required');
      return;
    }

    if (formData.delegating_user_id.trim() === formData.proxy_user_id.trim()) {
      toast.error('Delegating member and proxy member must be different');
      return;
    }

    try {
      setSubmitting(true);
      const createData: ProxyAuthorizationCreate = {
        delegating_user_id: formData.delegating_user_id.trim(),
        proxy_user_id: formData.proxy_user_id.trim(),
        proxy_type: formData.proxy_type,
        reason: formData.reason.trim(),
      };
      const newAuth = await electionService.addProxyAuthorization(electionId, createData);
      setAuthorizations((prev) => [...prev, newAuth]);
      setFormData(emptyForm);
      setShowForm(false);
      toast.success('Proxy authorization added');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add proxy authorization'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (authId: string, delegatingName?: string) => {
    const label = delegatingName || 'this member';
    if (!confirm(`Are you sure you want to revoke the proxy authorization for ${label}?`)) return;

    try {
      setRevokingId(authId);
      await electionService.revokeProxyAuthorization(electionId, authId);
      setAuthorizations((prev) =>
        prev.map((a) => (a.id === authId ? { ...a, revoked_at: new Date().toISOString() } : a))
      );
      toast.success('Proxy authorization revoked');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to revoke proxy authorization'));
    } finally {
      setRevokingId(null);
    }
  };

  const activeAuthorizations = authorizations.filter((a) => !a.revoked_at);
  const revokedAuthorizations = authorizations.filter((a) => a.revoked_at);

  if (loading) {
    return (
      <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6">
        <div className="text-theme-text-muted text-center py-4">Loading proxy authorizations...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6">
        <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded p-3">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
        <button
          type="button"
          onClick={fetchAuthorizations}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-theme-text-primary">
          Proxy Voting ({activeAuthorizations.length} active)
        </h3>
        {canManage && proxyVotingEnabled && (
          <button
            type="button"
            onClick={() => { setShowForm(!showForm); setFormData(emptyForm); }}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : '+ Add Authorization'}
          </button>
        )}
      </div>

      {/* Proxy voting status */}
      <div className={`mb-4 rounded p-3 text-sm ${
        proxyVotingEnabled
          ? 'bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-300'
          : 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-700 dark:text-yellow-300'
      }`}>
        {proxyVotingEnabled
          ? 'Proxy voting is enabled for this organization.'
          : 'Proxy voting is not enabled for this organization. Contact an administrator to enable it.'}
      </div>

      {/* Add Authorization Form */}
      {showForm && canManage && (
        <div className="mb-6 p-4 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
          <h4 className="text-sm font-semibold text-theme-text-primary mb-3">New Proxy Authorization</h4>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-theme-text-primary">
                Delegating Member (Absent) *
              </label>
              <input
                type="text"
                value={formData.delegating_user_id}
                onChange={(e) => setFormData((prev) => ({ ...prev, delegating_user_id: e.target.value }))}
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="User ID of the absent member"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-primary">
                Proxy Member (Voting on behalf) *
              </label>
              <input
                type="text"
                value={formData.proxy_user_id}
                onChange={(e) => setFormData((prev) => ({ ...prev, proxy_user_id: e.target.value }))}
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="User ID of the proxy voter"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-primary">Type *</label>
              <select
                value={formData.proxy_type}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    proxy_type: e.target.value as 'single_election' | 'regular',
                  }))
                }
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="single_election">Single Election</option>
                <option value="regular">Regular (Ongoing)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-primary">Reason *</label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData((prev) => ({ ...prev, reason: e.target.value }))}
                rows={2}
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Reason for proxy authorization (e.g., medical leave, out of town)"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-3 py-2 text-sm border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={submitting || !formData.delegating_user_id.trim() || !formData.proxy_user_id.trim() || !formData.reason.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Adding...' : 'Add Authorization'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Authorizations List */}
      {activeAuthorizations.length === 0 && revokedAuthorizations.length === 0 ? (
        <div className="text-center py-8 text-theme-text-muted">
          <p>No proxy authorizations for this election.</p>
          {canManage && proxyVotingEnabled && (
            <p className="text-sm mt-1">Click &quot;Add Authorization&quot; to authorize a proxy voter.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {activeAuthorizations.map((auth) => (
            <div
              key={auth.id}
              className="p-4 rounded-lg border border-theme-surface-border bg-theme-surface-secondary"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-theme-text-primary">
                      {auth.delegating_user_name || auth.delegating_user_id}
                    </span>
                    <span className="text-theme-text-muted text-sm">via</span>
                    <span className="font-medium text-theme-text-primary">
                      {auth.proxy_user_name || auth.proxy_user_id}
                    </span>
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      auth.proxy_type === 'single_election'
                        ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                        : 'bg-purple-500/20 text-purple-700 dark:text-purple-300'
                    }`}>
                      {auth.proxy_type === 'single_election' ? 'Single Election' : 'Regular'}
                    </span>
                    <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-700 dark:text-green-300 rounded">
                      Active
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-theme-text-muted truncate">{auth.reason}</p>
                  <p className="text-xs text-theme-text-muted mt-1">
                    Authorized {new Date(auth.authorized_at).toLocaleDateString()}
                    {auth.authorized_by_name ? ` by ${auth.authorized_by_name}` : ''}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(auth.id, auth.delegating_user_name)}
                    disabled={revokingId === auth.id}
                    className="ml-4 px-3 py-1 text-xs bg-red-500/20 text-red-700 dark:text-red-300 rounded hover:bg-red-500/30 disabled:opacity-50"
                  >
                    {revokingId === auth.id ? 'Revoking...' : 'Revoke'}
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Revoked Authorizations */}
          {revokedAuthorizations.length > 0 && (
            <>
              <h4 className="text-sm font-semibold text-theme-text-muted uppercase tracking-wider mt-6 mb-2">
                Revoked ({revokedAuthorizations.length})
              </h4>
              {revokedAuthorizations.map((auth) => (
                <div
                  key={auth.id}
                  className="p-4 rounded-lg border border-theme-surface-border bg-theme-surface-secondary opacity-50"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-theme-text-muted">
                      {auth.delegating_user_name || auth.delegating_user_id}
                    </span>
                    <span className="text-theme-text-muted text-sm">via</span>
                    <span className="font-medium text-theme-text-muted">
                      {auth.proxy_user_name || auth.proxy_user_id}
                    </span>
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      auth.proxy_type === 'single_election'
                        ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                        : 'bg-purple-500/20 text-purple-700 dark:text-purple-300'
                    }`}>
                      {auth.proxy_type === 'single_election' ? 'Single Election' : 'Regular'}
                    </span>
                    <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-700 dark:text-red-300 rounded">
                      Revoked
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-theme-text-muted truncate">{auth.reason}</p>
                  <p className="text-xs text-theme-text-muted mt-1">
                    Revoked {auth.revoked_at ? new Date(auth.revoked_at).toLocaleDateString() : ''}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ProxyVotingManagement;
