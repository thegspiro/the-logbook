/**
 * API Keys Management Tab
 *
 * Allows admins to create, view, and revoke API keys for the public portal.
 * CRITICAL: Full API key is shown ONLY ONCE on creation.
 */

import React, { useState } from 'react';
import { useAPIKeys } from '../hooks/usePublicPortal';
import type { CreateAPIKeyRequest, PublicPortalAPIKey } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime, localToUTC } from '../../../utils/dateFormatting';

interface CreateKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: CreateAPIKeyRequest) => Promise<void>;
}

const CreateKeyModal: React.FC<CreateKeyModalProps> = ({ isOpen, onClose, onCreate }) => {
  const tz = useTimezone();
  const [formData, setFormData] = useState<CreateAPIKeyRequest>({
    name: '',
    rate_limit: undefined,
    expires_at: undefined,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const submitData = {
        ...formData,
        expires_at: formData.expires_at ? localToUTC(formData.expires_at, tz) : undefined,
      };
      await onCreate(submitData);
      // Reset form and close
      setFormData({ name: '', rate_limit: undefined, expires_at: undefined });
      onClose();
    } catch (_error) {
      // Error is handled by the hook
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-api-key-title"
      onKeyDown={(e) => { if (e.key === 'Escape' && !isSubmitting) onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 id="create-api-key-title" className="text-lg font-semibold text-theme-text-primary">Create API Key</h3>
          <button
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text-muted"
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label htmlFor="api-key-name" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Key Name <span aria-hidden="true">*</span>
              </label>
              <input
                id="api-key-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Website Integration Key"
                required
                aria-required="true"
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-theme-text-muted mt-1">
                A descriptive name to identify this API key
              </p>
            </div>

            {/* Rate Limit Override */}
            <div>
              <label htmlFor="api-key-rate-limit" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Rate Limit (requests/hour)
              </label>
              <input
                id="api-key-rate-limit"
                type="number"
                min="1"
                max="100000"
                value={formData.rate_limit || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  rate_limit: e.target.value ? parseInt(e.target.value) : undefined
                })}
                placeholder="Leave blank for default (1000)"
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Optional: Override the default rate limit for this key
              </p>
            </div>

            {/* Expiration Date */}
            <div>
              <label htmlFor="api-key-expiration" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Expiration Date
              </label>
              <input
                id="api-key-expiration"
                type="datetime-local"
                step="900"
                value={formData.expires_at || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  expires_at: e.target.value || undefined
                })}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-theme-text-muted mt-1">
                Optional: Set when this key should expire
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-theme-text-secondary bg-theme-surface-secondary rounded-md hover:bg-theme-surface-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create API Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface KeyDisplayModalProps {
  isOpen: boolean;
  apiKey: string;
  onClose: () => void;
}

const KeyDisplayModal: React.FC<KeyDisplayModalProps> = ({ isOpen, apiKey, onClose }) => {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-key-created-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-2xl w-full p-6">
        <div className="mb-4">
          <h3 id="api-key-created-title" className="text-lg font-semibold text-theme-text-primary">API Key Created Successfully</h3>
        </div>

        {/* Warning Banner */}
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                <strong>IMPORTANT:</strong> This is the only time the full API key will be displayed.
                Copy it now and store it securely. You will not be able to see it again.
              </p>
            </div>
          </div>
        </div>

        {/* API Key Display */}
        <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-md p-4 mb-4">
          <div className="flex items-center justify-between">
            <code className="text-sm font-mono text-theme-text-primary break-all flex-1">
              {apiKey}
            </code>
            <button
              onClick={copyToClipboard}
              className="ml-4 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 flex-shrink-0"
              aria-label={copied ? 'Copied to clipboard' : 'Copy API key to clipboard'}
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4 inline mr-1" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Copied!
                </>
              ) : (
                'Copy'
              )}
            </button>
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Usage Instructions</h4>
          <p className="text-sm text-blue-800 mb-2">
            Include this API key in the <code className="bg-blue-100 px-1 py-0.5 rounded">X-API-Key</code> header
            when making requests to the public API:
          </p>
          <pre className="bg-blue-100 p-2 rounded text-xs overflow-x-auto">
{`curl -H "X-API-Key: ${apiKey}" \\
  https://your-domain.com/api/public/v1/organization/info`}
          </pre>
        </div>

        {/* Close Button */}
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800"
          >
            I've Saved the Key
          </button>
        </div>
      </div>
    </div>
  );
};

interface RevokeConfirmModalProps {
  isOpen: boolean;
  keyName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const RevokeConfirmModal: React.FC<RevokeConfirmModalProps> = ({
  isOpen,
  keyName,
  onConfirm,
  onCancel
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="revoke-api-key-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full p-6">
        <h3 id="revoke-api-key-title" className="text-lg font-semibold text-theme-text-primary mb-4">Revoke API Key?</h3>

        <p className="text-theme-text-secondary mb-4">
          Are you sure you want to revoke the API key <strong>"{keyName}"</strong>?
        </p>

        <p className="text-sm text-theme-text-muted mb-6">
          This action will immediately stop all requests using this key. This cannot be undone.
        </p>

        <div className="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-theme-text-secondary bg-theme-surface-secondary rounded-md hover:bg-theme-surface-hover"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
          >
            Revoke Key
          </button>
        </div>
      </div>
    </div>
  );
};

export const APIKeysTab: React.FC = () => {
  const tz = useTimezone();
  const { apiKeys, loading, error, createKey, revokeKey } = useAPIKeys(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);

  const handleCreateKey = async (data: CreateAPIKeyRequest) => {
    const result = await createKey(data);
    setNewApiKey(result.api_key);
  };

  const handleRevokeKey = async () => {
    if (!revokeTarget) return;
    await revokeKey(revokeTarget.id);
    setRevokeTarget(null);
  };

  const getStatusBadge = (key: PublicPortalAPIKey) => {
    if (!key.is_active) {
      return <span className="px-2 py-1 text-xs font-semibold rounded bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400">Revoked</span>;
    }
    if (key.is_expired) {
      return <span className="px-2 py-1 text-xs font-semibold rounded bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400">Expired</span>;
    }
    return <span className="px-2 py-1 text-xs font-semibold rounded bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400">Active</span>;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <span className="sr-only">Loading API keys...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <p className="text-red-800">Error loading API keys: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-theme-text-primary">API Keys</h3>
          <p className="text-sm text-theme-text-muted mt-1">
            Manage API keys for external applications to access your public portal
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create API Key
        </button>
      </div>

      {/* API Keys Table */}
      {apiKeys.length === 0 ? (
        <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-md p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-theme-text-primary">No API keys</h3>
          <p className="mt-1 text-sm text-theme-text-muted">
            Get started by creating a new API key for your public portal
          </p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Create First API Key
          </button>
        </div>
      ) : (
        <div className="bg-theme-surface border border-theme-surface-border rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-theme-surface-border" aria-label="API keys list">
            <thead className="bg-theme-surface-secondary">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Name
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Key Prefix
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Status
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Rate Limit
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Last Used
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Created
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-theme-surface divide-y divide-theme-surface-border">
              {apiKeys.map((key) => (
                <tr key={key.id} className="hover:bg-theme-surface-hover">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-theme-text-primary">{key.name}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <code className="text-xs font-mono bg-theme-surface-secondary px-2 py-1 rounded">
                      {key.key_prefix}...
                    </code>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(key)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-text-muted">
                    {key.rate_limit || key.effective_rate_limit}/hour
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-text-muted">
                    {formatDateTime(key.last_used_at, tz)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-text-muted">
                    {formatDateTime(key.created_at, tz)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {key.is_active && (
                      <button
                        onClick={() => setRevokeTarget({ id: key.id, name: key.name })}
                        className="text-red-600 hover:text-red-900"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <CreateKeyModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreate={handleCreateKey}
      />

      <KeyDisplayModal
        isOpen={!!newApiKey}
        apiKey={newApiKey || ''}
        onClose={() => setNewApiKey(null)}
      />

      <RevokeConfirmModal
        isOpen={!!revokeTarget}
        keyName={revokeTarget?.name || ''}
        onConfirm={handleRevokeKey}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
};
