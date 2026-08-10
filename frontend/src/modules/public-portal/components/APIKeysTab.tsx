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
import DateTimeQuarterHour from '../../../components/ux/DateTimeQuarterHour';
import { Modal } from '../../../components/Modal';

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
      setFormData({ name: '', rate_limit: undefined, expires_at: undefined });
      onClose();
    } catch (_error) {
      // Error is handled by the hook
    } finally {
      setIsSubmitting(false);
    }
  };

  const footer = (
    <>
      <button
        type="submit"
        form="create-api-key-form"
        disabled={isSubmitting}
        className="btn-info rounded-md text-center"
      >
        {isSubmitting ? 'Creating...' : 'Create API Key'}
      </button>
      <button
        type="button"
        onClick={onClose}
        disabled={isSubmitting}
        className="text-theme-text-secondary bg-theme-surface-secondary hover:bg-theme-surface-hover rounded-md px-4 py-2 disabled:opacity-50 sm:mr-3"
      >
        Cancel
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create API Key"
      size="sm"
      closeOnClickOutside={!isSubmitting}
      closeOnEscape={!isSubmitting}
      footer={footer}
    >
      <form
        id="create-api-key-form"
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="api-key-name" className="text-theme-text-secondary mb-1 block text-sm font-medium">
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
              className="form-input"
            />
            <p className="text-theme-text-muted mt-1 text-xs">A descriptive name to identify this API key</p>
          </div>

          <div>
            <label htmlFor="api-key-rate-limit" className="text-theme-text-secondary mb-1 block text-sm font-medium">
              Rate Limit (requests/hour)
            </label>
            <input
              id="api-key-rate-limit"
              type="number"
              min="1"
              max="100000"
              value={formData.rate_limit || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  rate_limit: e.target.value ? parseInt(e.target.value) : undefined,
                })
              }
              placeholder="Leave blank for default (1000)"
              className="form-input"
            />
            <p className="text-theme-text-muted mt-1 text-xs">Optional: Override the default rate limit for this key</p>
          </div>

          <div>
            <label htmlFor="api-key-expiration" className="text-theme-text-secondary mb-1 block text-sm font-medium">
              Expiration Date
            </label>
            <DateTimeQuarterHour
              id="api-key-expiration"
              value={formData.expires_at || ''}
              onChange={(val) =>
                setFormData({
                  ...formData,
                  expires_at: val || undefined,
                })
              }
              className="form-input"
            />
            <p className="text-theme-text-muted mt-1 text-xs">Optional: Set when this key should expire</p>
          </div>
        </div>
      </form>
    </Modal>
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
    void navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const footer = (
    <button onClick={onClose} className="bg-theme-nav-bg hover:bg-theme-surface-hover rounded-md px-4 py-2 text-white">
      I've Saved the Key
    </button>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="API Key Created Successfully" size="lg" footer={footer}>
      <div className="mb-4 border-l-4 border-yellow-400 bg-yellow-500/10 p-4">
        <div className="flex">
          <div className="shrink-0">
            <svg
              className="h-5 w-5 text-yellow-700 dark:text-yellow-400"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              <strong>IMPORTANT:</strong> This is the only time the full API key will be displayed. Copy it now and
              store it securely. You will not be able to see it again.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-theme-surface-secondary border-theme-surface-border mb-4 rounded-md border p-4">
        <div className="flex items-center justify-between">
          <code className="text-theme-text-primary flex-1 font-mono text-sm break-all">{apiKey}</code>
          <button
            onClick={copyToClipboard}
            className="btn-info ml-4 shrink-0 rounded-sm px-3 py-1 text-sm"
            aria-label={copied ? 'Copied to clipboard' : 'Copy API key to clipboard'}
          >
            {copied ? (
              <>
                <svg className="mr-1 inline h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Copied!
              </>
            ) : (
              'Copy'
            )}
          </button>
        </div>
      </div>

      <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-4">
        <h4 className="mb-2 text-sm font-semibold text-blue-700 dark:text-blue-300">Usage Instructions</h4>
        <p className="mb-2 text-sm text-blue-700 dark:text-blue-300">
          Include this API key in the <code className="rounded-sm bg-blue-500/20 px-1 py-0.5">X-API-Key</code> header
          when making requests to the public API:
        </p>
        <pre className="overflow-x-auto rounded-sm bg-blue-500/20 p-2 text-xs">
          {`curl -H "X-API-Key: ${apiKey}" \\
  https://your-domain.com/api/public/v1/organization/info`}
        </pre>
      </div>
    </Modal>
  );
};

interface RevokeConfirmModalProps {
  isOpen: boolean;
  keyName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const RevokeConfirmModal: React.FC<RevokeConfirmModalProps> = ({ isOpen, keyName, onConfirm, onCancel }) => {
  const footer = (
    <>
      <button onClick={onConfirm} className="btn-primary rounded-md text-center">
        Revoke Key
      </button>
      <button
        onClick={onCancel}
        className="text-theme-text-secondary bg-theme-surface-secondary hover:bg-theme-surface-hover rounded-md px-4 py-2 sm:mr-3"
      >
        Cancel
      </button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Revoke API Key?" size="sm" footer={footer}>
      <p className="text-theme-text-secondary mb-4">
        Are you sure you want to revoke the API key <strong>"{keyName}"</strong>?
      </p>
      <p className="text-theme-text-muted text-sm">
        This action will immediately stop all requests using this key. This cannot be undone.
      </p>
    </Modal>
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
      return (
        <span className="rounded-sm bg-red-100 px-2 py-1 text-xs font-semibold text-red-800 dark:bg-red-500/20 dark:text-red-400">
          Revoked
        </span>
      );
    }
    if (key.is_expired) {
      return (
        <span className="rounded-sm bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-800 dark:bg-orange-500/20 dark:text-orange-400">
          Expired
        </span>
      );
    }
    return (
      <span className="rounded-sm bg-green-100 px-2 py-1 text-xs font-semibold text-green-800 dark:bg-green-500/20 dark:text-green-400">
        Active
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
        <span className="sr-only">Loading API keys...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
        <p className="text-red-800 dark:text-red-400">Error loading API keys: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-theme-text-primary text-lg font-semibold">API Keys</h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            Manage API keys for external applications to access your public portal
          </p>
        </div>
        <button onClick={() => setIsCreateModalOpen(true)} className="btn-info flex items-center rounded-md">
          <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create API Key
        </button>
      </div>

      {/* API Keys Table */}
      {apiKeys.length === 0 ? (
        <div className="bg-theme-surface-secondary border-theme-surface-border rounded-md border p-8 text-center">
          <svg
            className="text-theme-text-muted mx-auto h-12 w-12"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            />
          </svg>
          <h3 className="text-theme-text-primary mt-2 text-sm font-medium">No API keys</h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            Get started by creating a new API key for your public portal
          </p>
          <button onClick={() => setIsCreateModalOpen(true)} className="btn-info mt-4 rounded-md">
            Create First API Key
          </button>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-3 sm:hidden">
            {apiKeys.map((key) => (
              <div
                key={key.id}
                className="bg-theme-surface border-theme-surface-border space-y-2 rounded-lg border p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-theme-text-primary truncate text-sm font-medium">{key.name}</span>
                  {getStatusBadge(key)}
                </div>
                <code className="bg-theme-surface-secondary block rounded-sm px-2 py-1 font-mono text-xs">
                  {key.key_prefix}...
                </code>
                <div className="text-theme-text-muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>{key.rate_limit || key.effective_rate_limit}/hour</span>
                  <span>Created: {formatDateTime(key.created_at, tz)}</span>
                </div>
                {key.is_active && (
                  <button
                    onClick={() => setRevokeTarget({ id: key.id, name: key.name })}
                    className="mt-1 text-xs font-medium text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="bg-theme-surface border-theme-surface-border hidden overflow-x-auto rounded-lg border sm:block">
            <table className="divide-theme-surface-border min-w-full divide-y" aria-label="API keys list">
              <thead className="bg-theme-surface-secondary">
                <tr>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Key Prefix
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Rate Limit
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Last Used
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Created
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-right text-xs font-medium tracking-wider uppercase"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-theme-surface divide-theme-surface-border divide-y">
                {apiKeys.map((key) => (
                  <tr key={key.id} className="hover:bg-theme-surface-hover">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-theme-text-primary text-sm font-medium">{key.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <code className="bg-theme-surface-secondary rounded-sm px-2 py-1 font-mono text-xs">
                        {key.key_prefix}...
                      </code>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(key)}</td>
                    <td className="text-theme-text-muted px-6 py-4 text-sm whitespace-nowrap">
                      {key.rate_limit || key.effective_rate_limit}/hour
                    </td>
                    <td className="text-theme-text-muted px-6 py-4 text-sm whitespace-nowrap">
                      {formatDateTime(key.last_used_at, tz)}
                    </td>
                    <td className="text-theme-text-muted px-6 py-4 text-sm whitespace-nowrap">
                      {formatDateTime(key.created_at, tz)}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-medium whitespace-nowrap">
                      {key.is_active && (
                        <button
                          onClick={() => setRevokeTarget({ id: key.id, name: key.name })}
                          className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
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
        </>
      )}

      {/* Modals */}
      <CreateKeyModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreate={handleCreateKey}
      />

      <KeyDisplayModal isOpen={!!newApiKey} apiKey={newApiKey || ''} onClose={() => setNewApiKey(null)} />

      <RevokeConfirmModal
        isOpen={!!revokeTarget}
        keyName={revokeTarget?.name || ''}
        onConfirm={() => {
          void handleRevokeKey();
        }}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
};
