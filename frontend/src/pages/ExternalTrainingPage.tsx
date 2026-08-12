/**
 * External Training Integrations Page
 *
 * Allows administrators to manage connections to external training platforms
 * like Vector Solutions, Target Solutions, Lexipol, etc.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { useConfirm } from '../contexts/ConfirmContext';
import { formatDateTime } from '../utils/dateFormatting';
import {
  Link2,
  Plus,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Users,
  FolderTree,
  Download,
  Trash2,
  Edit2,
  PlayCircle,
} from 'lucide-react';
import { Tooltip } from '../components/ux';
import { externalTrainingService, trainingService } from '../services/api';
import type {
  ExternalTrainingProvider,
  ExternalTrainingProviderCreate,
  ExternalProviderType,
  ExternalCategoryMapping,
  ExternalUserMapping,
  TrainingCategory,
} from '../types/training';

type TabView = 'providers' | 'imports' | 'mappings';

const PROVIDER_TYPES: { value: ExternalProviderType; label: string; description: string }[] = [
  {
    value: 'vector_solutions',
    label: 'Vector Solutions',
    description: 'Connect to Vector Solutions LMS for fire and EMS training records',
  },
  {
    value: 'target_solutions',
    label: 'Target Solutions',
    description: 'Sync training completions from Target Solutions platform',
  },
  { value: 'lexipol', label: 'Lexipol', description: 'Import policy acknowledgments and training from Lexipol' },
  { value: 'i_am_responding', label: 'I Am Responding', description: 'Track training logged through I Am Responding' },
  { value: 'custom_api', label: 'Custom API', description: 'Connect to any training platform with a compatible API' },
];

interface CreateProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CreateProviderModal: React.FC<CreateProviderModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [formData, setFormData] = useState<ExternalTrainingProviderCreate>({
    name: '',
    provider_type: 'vector_solutions',
    api_base_url: '',
    api_key: '',
    auth_type: 'api_key',
    auto_sync_enabled: false,
    sync_interval_hours: 24,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleTypeSelect = (type: ExternalProviderType) => {
    setFormData((prev) => ({
      ...prev,
      provider_type: type,
      name: PROVIDER_TYPES.find((p) => p.value === type)?.label || '',
    }));
    setStep('details');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      await externalTrainingService.createProvider(formData);
      onSuccess();
      onClose();
      setStep('type');
      setFormData({
        name: '',
        provider_type: 'vector_solutions',
        api_base_url: '',
        api_key: '',
        auth_type: 'api_key',
        auto_sync_enabled: false,
        sync_interval_hours: 24,
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to create provider'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-provider-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="bg-theme-surface-modal max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-lg">
        <div className="border-theme-surface-border border-b p-6">
          <h2 id="create-provider-title" className="text-theme-text-primary text-2xl font-bold">
            {step === 'type' ? 'Select Provider Type' : 'Configure Provider'}
          </h2>
        </div>

        {step === 'type' ? (
          <div className="space-y-4 p-6">
            {PROVIDER_TYPES.map((type) => (
              <button
                key={type.value}
                onClick={() => handleTypeSelect(type.value)}
                className="bg-theme-surface hover:bg-theme-surface-hover w-full rounded-lg p-4 text-left transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-theme-text-primary text-lg font-semibold">{type.label}</h3>
                    <p className="text-theme-text-muted mt-1 text-sm">{type.description}</p>
                  </div>
                  <ChevronRight className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                </div>
              </button>
            ))}

            <div className="flex justify-end pt-4">
              <button
                type="button"
                onClick={onClose}
                className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="space-y-4 p-6"
          >
            {error && (
              <div
                className="rounded-sm border border-red-500 bg-red-500/10 px-4 py-3 text-red-500"
                role="alert"
                aria-live="assertive"
              >
                {error}
              </div>
            )}

            <div>
              <label htmlFor="provider-name" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                Display Name <span aria-hidden="true">*</span>
              </label>
              <input
                id="provider-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                className="form-input"
                placeholder="e.g., Vector Solutions - Main Account"
                required
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="provider-api-url" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                API Base URL <span aria-hidden="true">*</span>
              </label>
              <input
                id="provider-api-url"
                type="url"
                value={formData.api_base_url}
                onChange={(e) => setFormData((prev) => ({ ...prev, api_base_url: e.target.value }))}
                className="form-input"
                placeholder={
                  formData.provider_type === 'vector_solutions'
                    ? 'https://app.targetsolutions.com/tsapp/dashboard/pl/api/v1'
                    : 'https://api.example.com'
                }
                required
                aria-required="true"
              />
              {formData.provider_type === 'vector_solutions' && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  For Vector Solutions / TargetSolutions, use your organization&apos;s API base URL (e.g.,
                  https://app.targetsolutions.com/tsapp/dashboard/pl/api/v1)
                </p>
              )}
            </div>

            {formData.provider_type !== 'vector_solutions' && (
              <div>
                <label
                  htmlFor="provider-auth-type"
                  className="text-theme-text-secondary mb-2 block text-sm font-medium"
                >
                  Authentication Type
                </label>
                <select
                  id="provider-auth-type"
                  value={formData.auth_type}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, auth_type: e.target.value as 'api_key' | 'basic' | 'oauth2' }))
                  }
                  className="form-input"
                >
                  <option value="api_key">API Key</option>
                  <option value="basic">Basic Auth</option>
                  <option value="oauth2">OAuth 2.0</option>
                </select>
              </div>
            )}

            <div>
              <label htmlFor="provider-api-key" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                {formData.provider_type === 'vector_solutions' ? 'AccessToken' : 'API Key'}{' '}
                <span aria-hidden="true">*</span>
              </label>
              <input
                id="provider-api-key"
                type="password"
                value={formData.api_key}
                onChange={(e) => setFormData((prev) => ({ ...prev, api_key: e.target.value }))}
                className="form-input"
                placeholder={
                  formData.provider_type === 'vector_solutions'
                    ? 'Enter your TargetSolutions AccessToken'
                    : 'Enter your API key'
                }
                required
                aria-required="true"
              />
              {formData.provider_type === 'vector_solutions' && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  Your AccessToken is provided by your Vector Solutions account manager. Each token has specific access
                  levels.
                </p>
              )}
            </div>

            {formData.provider_type === 'vector_solutions' && (
              <div>
                <label htmlFor="provider-site-id" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                  Site ID
                </label>
                <input
                  id="provider-site-id"
                  type="text"
                  value={formData.config?.site_id || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      config: { ...prev.config, site_id: e.target.value || undefined },
                    }))
                  }
                  className="form-input"
                  placeholder="Enter your TargetSolutions Site ID"
                />
                <p className="text-theme-text-muted mt-1 text-xs">
                  Run a connection test to discover available Site IDs. Required for syncing training records.
                </p>
              </div>
            )}

            {formData.auth_type === 'basic' && (
              <div>
                <label
                  htmlFor="provider-api-secret"
                  className="text-theme-text-secondary mb-2 block text-sm font-medium"
                >
                  API Secret
                </label>
                <input
                  id="provider-api-secret"
                  type="password"
                  value={formData.api_secret || ''}
                  onChange={(e) => setFormData((prev) => ({ ...prev, api_secret: e.target.value }))}
                  className="form-input"
                  placeholder="Enter your API secret"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="provider-description"
                className="text-theme-text-secondary mb-2 block text-sm font-medium"
              >
                Description
              </label>
              <textarea
                id="provider-description"
                value={formData.description || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                className="form-input"
                placeholder="Optional description for this integration"
                rows={3}
              />
            </div>

            <div className="border-theme-surface-border border-t pt-4">
              <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Sync Settings</h3>

              <div className="mb-4 flex items-center justify-between">
                <div>
                  <label htmlFor="provider-auto-sync" className="text-theme-text-secondary text-sm font-medium">
                    Enable Auto-Sync
                  </label>
                  <p className="text-theme-text-muted text-xs">Automatically sync training records on a schedule</p>
                </div>
                <button
                  id="provider-auto-sync"
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, auto_sync_enabled: !prev.auto_sync_enabled }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData.auto_sync_enabled ? 'bg-red-600' : 'bg-theme-surface-border'
                  }`}
                  role="switch"
                  aria-checked={formData.auto_sync_enabled}
                  aria-label="Enable auto-sync"
                >
                  <span
                    className={`toggle-knob-sm ${formData.auto_sync_enabled ? 'translate-x-6' : 'translate-x-1'}`}
                    aria-hidden="true"
                  />
                </button>
              </div>

              {formData.auto_sync_enabled && (
                <div>
                  <label
                    htmlFor="provider-sync-interval"
                    className="text-theme-text-secondary mb-2 block text-sm font-medium"
                  >
                    Sync Interval (hours)
                  </label>
                  <select
                    id="provider-sync-interval"
                    value={formData.sync_interval_hours}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, sync_interval_hours: parseInt(e.target.value) }))
                    }
                    className="form-input"
                  >
                    <option value={6}>Every 6 hours</option>
                    <option value={12}>Every 12 hours</option>
                    <option value={24}>Daily</option>
                    <option value={48}>Every 2 days</option>
                    <option value={168}>Weekly</option>
                  </select>
                </div>
              )}
            </div>

            <div className="border-theme-surface-border flex justify-between border-t pt-4">
              <button
                type="button"
                onClick={() => setStep('type')}
                className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2"
              >
                Back
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2"
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="btn-primary px-6">
                  {isSubmitting ? 'Creating...' : 'Create Provider'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

interface ProviderCardProps {
  provider: ExternalTrainingProvider;
  onTestConnection: (id: string) => void;
  onSyncCategories: (id: string) => void;
  onSync: (id: string) => void;
  onEdit: (provider: ExternalTrainingProvider) => void;
  onDelete: (id: string) => void;
  onViewMappings: (id: string) => void;
  isTestingConnection: boolean;
  isSyncingCategories: boolean;
  isSyncing: boolean;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  onTestConnection,
  onSyncCategories,
  onSync,
  onEdit,
  onDelete,
  onViewMappings,
  isTestingConnection,
  isSyncingCategories,
  isSyncing,
}) => {
  const tz = useTimezone();

  const getStatusIcon = () => {
    if (provider.connection_verified) {
      return <CheckCircle className="h-5 w-5 text-green-500" aria-hidden="true" />;
    }
    if (provider.connection_error) {
      return <XCircle className="h-5 w-5 text-red-500" aria-hidden="true" />;
    }
    return <AlertTriangle className="h-5 w-5 text-yellow-500" aria-hidden="true" />;
  };

  const getStatusLabel = () => {
    if (provider.connection_verified) return 'Connection verified';
    if (provider.connection_error) return 'Connection error';
    return 'Connection not verified';
  };

  const getProviderTypeLabel = () => {
    return PROVIDER_TYPES.find((p) => p.value === provider.provider_type)?.label || provider.provider_type;
  };

  return (
    <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-6">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-theme-surface-secondary rounded-lg p-2">
            <Link2 className="h-6 w-6 text-red-500" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-theme-text-primary text-lg font-semibold">{provider.name}</h3>
            <p className="text-theme-text-muted text-sm">{getProviderTypeLabel()}</p>
          </div>
        </div>
        {/* Two independent facts sit side by side here: whether the connection
            has been proved to work, and whether the provider is switched on.
            The first was conveyed by icon colour alone, so a sighted reader saw
            an unexplained amber triangle next to the word "Active" and had no
            way to tell which of the two it referred to. The label is the icon's
            accessible name and its tooltip. */}
        <div className="flex items-center gap-2">
          <Tooltip content={getStatusLabel()}>
            <span aria-label={getStatusLabel()} className="flex">
              {getStatusIcon()}
            </span>
          </Tooltip>
          <span
            className={`text-sm ${provider.active ? 'text-green-700 dark:text-green-400' : 'text-theme-text-muted'}`}
          >
            {provider.active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {provider.description && <p className="text-theme-text-muted mb-4 text-sm">{provider.description}</p>}

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="bg-theme-surface-secondary rounded-lg p-3">
          <p className="text-theme-text-muted text-xs">Last Sync</p>
          <p className="text-theme-text-primary text-sm">
            {provider.last_sync_at ? formatDateTime(provider.last_sync_at, tz) : 'Never'}
          </p>
        </div>
        <div className="bg-theme-surface-secondary rounded-lg p-3">
          <p className="text-theme-text-muted text-xs">Auto-Sync</p>
          <p className="text-theme-text-primary text-sm">
            {provider.auto_sync_enabled ? `Every ${provider.sync_interval_hours}h` : 'Disabled'}
          </p>
        </div>
      </div>

      {provider.connection_error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert" aria-live="assertive">
          <p className="text-xs text-red-700 dark:text-red-400">Connection Error:</p>
          <p className="text-sm text-red-700 dark:text-red-300">{provider.connection_error}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onTestConnection(provider.id)}
          disabled={isTestingConnection}
          className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary flex items-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
        >
          {isTestingConnection ? (
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle className="h-4 w-4" aria-hidden="true" />
          )}
          Test
        </button>
        <button
          onClick={() => onSyncCategories(provider.id)}
          disabled={isSyncingCategories}
          className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
        >
          {isSyncingCategories ? (
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <FolderTree className="h-4 w-4" aria-hidden="true" />
          )}
          Fetch Categories
        </button>
        <button
          onClick={() => onSync(provider.id)}
          disabled={isSyncing}
          className="btn-primary flex items-center gap-2 px-3 text-sm"
        >
          {isSyncing ? (
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
          )}
          Sync Now
        </button>
        <button
          onClick={() => onViewMappings(provider.id)}
          className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
        >
          <FolderTree className="h-4 w-4" aria-hidden="true" />
          Mappings
        </button>
        <button
          onClick={() => onEdit(provider)}
          className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
          aria-label="Edit provider"
        >
          <Edit2 className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          onClick={() => onDelete(provider.id)}
          className="bg-theme-surface text-theme-text-primary flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-red-600"
          aria-label="Delete provider"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

interface EditProviderModalProps {
  isOpen: boolean;
  provider: ExternalTrainingProvider | null;
  onClose: () => void;
  onSuccess: () => void;
}

const EditProviderModal: React.FC<EditProviderModalProps> = ({ isOpen, provider, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    api_base_url: '',
    api_key: '',
    api_secret: '',
    auth_type: 'api_key' as 'api_key' | 'basic' | 'oauth2',
    auto_sync_enabled: false,
    sync_interval_hours: 24,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (provider && isOpen) {
      setFormData({
        name: provider.name || '',
        description: provider.description || '',
        api_base_url: provider.api_base_url || '',
        api_key: '',
        api_secret: '',
        auth_type: provider.auth_type || 'api_key',
        auto_sync_enabled: provider.auto_sync_enabled || false,
        sync_interval_hours: provider.sync_interval_hours || 24,
      });
      setError('');
    }
  }, [provider, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provider) return;

    setIsSubmitting(true);
    setError('');

    try {
      const updates: Record<string, unknown> = {
        name: formData.name,
        description: formData.description || undefined,
        api_base_url: formData.api_base_url,
        auth_type: formData.auth_type,
        auto_sync_enabled: formData.auto_sync_enabled,
        sync_interval_hours: formData.sync_interval_hours,
      };
      // Only send credentials if user entered new ones
      if (formData.api_key) {
        updates.api_key = formData.api_key;
      }
      if (formData.api_secret) {
        updates.api_secret = formData.api_secret;
      }
      await externalTrainingService.updateProvider(provider.id, updates);
      toast.success('Provider updated successfully');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to update provider');
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !provider) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-provider-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="bg-theme-surface-modal max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-lg">
        <div className="border-theme-surface-border border-b p-6">
          <h2 id="edit-provider-title" className="text-theme-text-primary text-2xl font-bold">
            Edit Provider: {provider.name}
          </h2>
          <p className="text-theme-text-muted mt-1 text-sm">
            {PROVIDER_TYPES.find((p) => p.value === provider.provider_type)?.label || provider.provider_type}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4 p-6"
        >
          {error && (
            <div
              className="rounded-sm border border-red-500 bg-red-500/10 px-4 py-3 text-red-500"
              role="alert"
              aria-live="assertive"
            >
              {error}
            </div>
          )}

          <div>
            <label htmlFor="edit-provider-name" className="text-theme-text-secondary mb-2 block text-sm font-medium">
              Display Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="edit-provider-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className="form-input"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="edit-provider-api-url" className="text-theme-text-secondary mb-2 block text-sm font-medium">
              API Base URL <span aria-hidden="true">*</span>
            </label>
            <input
              id="edit-provider-api-url"
              type="url"
              value={formData.api_base_url}
              onChange={(e) => setFormData((prev) => ({ ...prev, api_base_url: e.target.value }))}
              className="form-input"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="edit-provider-api-key" className="text-theme-text-secondary mb-2 block text-sm font-medium">
              API Key (leave blank to keep current)
            </label>
            <input
              id="edit-provider-api-key"
              type="password"
              value={formData.api_key}
              onChange={(e) => setFormData((prev) => ({ ...prev, api_key: e.target.value }))}
              className="form-input"
              placeholder="Enter new API key to update"
            />
          </div>

          {formData.auth_type === 'basic' && (
            <div>
              <label
                htmlFor="edit-provider-api-secret"
                className="text-theme-text-secondary mb-2 block text-sm font-medium"
              >
                API Secret (leave blank to keep current)
              </label>
              <input
                id="edit-provider-api-secret"
                type="password"
                value={formData.api_secret}
                onChange={(e) => setFormData((prev) => ({ ...prev, api_secret: e.target.value }))}
                className="form-input"
                placeholder="Enter new API secret to update"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="edit-provider-description"
              className="text-theme-text-secondary mb-2 block text-sm font-medium"
            >
              Description
            </label>
            <textarea
              id="edit-provider-description"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              className="form-input"
              rows={3}
            />
          </div>

          <div className="border-theme-surface-border border-t pt-4">
            <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Sync Settings</h3>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <label htmlFor="edit-provider-auto-sync" className="text-theme-text-secondary text-sm font-medium">
                  Enable Auto-Sync
                </label>
                <p className="text-theme-text-muted text-xs">Automatically sync training records on a schedule</p>
              </div>
              <button
                id="edit-provider-auto-sync"
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, auto_sync_enabled: !prev.auto_sync_enabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  formData.auto_sync_enabled ? 'bg-red-600' : 'bg-theme-surface-border'
                }`}
                role="switch"
                aria-checked={formData.auto_sync_enabled}
                aria-label="Enable auto-sync"
              >
                <span
                  className={`toggle-knob-sm ${formData.auto_sync_enabled ? 'translate-x-6' : 'translate-x-1'}`}
                  aria-hidden="true"
                />
              </button>
            </div>

            {formData.auto_sync_enabled && (
              <div>
                <label
                  htmlFor="edit-provider-sync-interval"
                  className="text-theme-text-secondary mb-2 block text-sm font-medium"
                >
                  Sync Interval (hours)
                </label>
                <select
                  id="edit-provider-sync-interval"
                  value={formData.sync_interval_hours}
                  onChange={(e) => setFormData((prev) => ({ ...prev, sync_interval_hours: parseInt(e.target.value) }))}
                  className="form-input"
                >
                  <option value={6}>Every 6 hours</option>
                  <option value={12}>Every 12 hours</option>
                  <option value={24}>Daily</option>
                  <option value={48}>Every 2 days</option>
                  <option value={168}>Weekly</option>
                </select>
              </div>
            )}
          </div>

          <div className="border-theme-surface-border flex justify-end gap-3 border-t pt-4">
            <button
              type="button"
              onClick={onClose}
              className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2"
            >
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="btn-primary px-6">
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface MappingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  providerName: string;
}

const MappingsModal: React.FC<MappingsModalProps> = ({ isOpen, onClose, providerId, providerName }) => {
  const [activeTab, setActiveTab] = useState<'categories' | 'users'>('categories');
  const [categoryMappings, setCategoryMappings] = useState<ExternalCategoryMapping[]>([]);
  const [userMappings, setUserMappings] = useState<ExternalUserMapping[]>([]);
  // The internal categories an external one can be pointed at. Without them the
  // Map Category button had nothing to offer and did nothing at all.
  const [internalCategories, setInternalCategories] = useState<TrainingCategory[]>([]);
  const [savingMappingId, setSavingMappingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMappings = useCallback(async () => {
    setLoading(true);
    try {
      const [categories, users, internal] = await Promise.all([
        externalTrainingService.getCategoryMappings(providerId),
        externalTrainingService.getUserMappings(providerId),
        trainingService.getCategories(),
      ]);
      setCategoryMappings(categories);
      setUserMappings(users);
      setInternalCategories(internal);
    } catch (_err) {
      // Error silently handled - mappings modal will show empty state
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    if (isOpen && providerId) {
      void loadMappings();
    }
  }, [isOpen, providerId, loadMappings]);

  const mapCategory = async (mapping: ExternalCategoryMapping, internalCategoryId: string) => {
    setSavingMappingId(mapping.id);
    try {
      const updated = await externalTrainingService.updateCategoryMapping(providerId, mapping.id, {
        internal_category_id: internalCategoryId,
        is_mapped: Boolean(internalCategoryId),
      });
      setCategoryMappings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      toast.success(
        internalCategoryId
          ? `"${mapping.external_category_name}" now imports as ${
              internalCategories.find((c) => c.id === internalCategoryId)?.name ?? 'the chosen category'
            }`
          : `"${mapping.external_category_name}" is unmapped again`
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the category mapping'));
    } finally {
      setSavingMappingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mappings-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="bg-theme-surface-modal flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-lg">
        <div className="border-theme-surface-border border-b p-6">
          <h2 id="mappings-modal-title" className="text-2xl font-bold text-white">
            Mappings - {providerName}
          </h2>
          <p className="text-theme-text-muted mt-1 text-sm">
            Map external categories and users to your internal records
          </p>
        </div>

        <div className="tab-scroll" role="tablist" aria-label="Mapping types">
          <button
            onClick={() => setActiveTab('categories')}
            role="tab"
            aria-selected={activeTab === 'categories'}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'categories'
                ? 'border-b-2 border-red-500 text-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <FolderTree className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
            Categories ({categoryMappings.filter((m) => !m.is_mapped).length} unmapped)
          </button>
          <button
            onClick={() => setActiveTab('users')}
            role="tab"
            aria-selected={activeTab === 'users'}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'users'
                ? 'border-b-2 border-red-500 text-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <Users className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
            Users ({userMappings.filter((m) => !m.is_mapped).length} unmapped)
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6" role="tabpanel">
          {loading ? (
            <div className="text-theme-text-muted py-8 text-center" role="status" aria-live="polite">
              Loading mappings...
            </div>
          ) : activeTab === 'categories' ? (
            <div className="space-y-3">
              {categoryMappings.length === 0 ? (
                <p className="text-theme-text-muted py-8 text-center">
                  No category mappings yet. Run a sync to discover categories.
                </p>
              ) : (
                categoryMappings.map((mapping) => (
                  <div
                    key={mapping.id}
                    className={`rounded-lg border p-4 ${
                      mapping.is_mapped
                        ? 'bg-theme-surface-secondary border-theme-surface-border'
                        : 'border-yellow-500/30 bg-yellow-500/10'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-theme-text-primary font-medium">{mapping.external_category_name}</p>
                        <p className="text-theme-text-muted text-xs">
                          External ID: {mapping.external_category_id}
                          {mapping.external_category_code && ` | Code: ${mapping.external_category_code}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {mapping.is_mapped && (
                          <span className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400">
                            <CheckCircle className="h-4 w-4" aria-hidden="true" />
                            Mapped
                            {mapping.auto_mapped && <span className="text-xs">(auto)</span>}
                          </span>
                        )}
                        <select
                          value={mapping.internal_category_id ?? ''}
                          disabled={savingMappingId === mapping.id}
                          onChange={(e) => {
                            void mapCategory(mapping, e.target.value);
                          }}
                          aria-label={`Internal category for ${mapping.external_category_name}`}
                          className="form-input-sm w-56"
                        >
                          <option value="">Not mapped</option>
                          {internalCategories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {userMappings.length === 0 ? (
                <p className="text-theme-text-muted py-8 text-center">
                  No user mappings yet. Run a sync to discover users.
                </p>
              ) : (
                userMappings.map((mapping) => (
                  <div
                    key={mapping.id}
                    className={`rounded-lg border p-4 ${
                      mapping.is_mapped
                        ? 'bg-theme-surface-secondary border-theme-surface-border'
                        : 'border-yellow-500/30 bg-yellow-500/10'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-theme-text-primary font-medium">
                          {mapping.external_name || mapping.external_username || 'Unknown User'}
                        </p>
                        <p className="text-theme-text-muted text-xs">
                          {mapping.external_email && `Email: ${mapping.external_email} | `}
                          External ID: {mapping.external_user_id}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {mapping.is_mapped ? (
                          <span className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400">
                            <CheckCircle className="h-4 w-4" aria-hidden="true" />
                            Mapped
                            {mapping.auto_mapped && <span className="text-xs">(auto)</span>}
                          </span>
                        ) : (
                          <button className="rounded-sm bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700">
                            Map User
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="border-theme-surface-border flex justify-end border-t p-4">
          <button onClick={onClose} className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const ExternalTrainingPage: React.FC = () => {
  // Never window.confirm: a browser that suppresses it returns false, which is
  // indistinguishable from the officer pressing Cancel.
  const { confirm } = useConfirm();
  const [activeTab, setActiveTab] = useState<TabView>('providers');
  const [providers, setProviders] = useState<ExternalTrainingProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<{ isOpen: boolean; provider: ExternalTrainingProvider | null }>({
    isOpen: false,
    provider: null,
  });
  const [mappingsModal, setMappingsModal] = useState<{ isOpen: boolean; providerId: string; providerName: string }>({
    isOpen: false,
    providerId: '',
    providerName: '',
  });

  useEffect(() => {
    void loadProviders();
  }, []);

  const loadProviders = async () => {
    setLoading(true);
    try {
      const data = await externalTrainingService.getProviders(false);
      setProviders(data);
    } catch (_err) {
      // Error silently handled - empty provider list shown
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async (providerId: string) => {
    setTestingProvider(providerId);
    try {
      const result = await externalTrainingService.testConnection(providerId);
      // Reload providers to get updated connection status
      await loadProviders();
      if (result.success) {
        toast.success('Connection successful!');
      } else {
        toast.error(`Connection failed: ${result.message}`);
      }
    } catch (err: unknown) {
      toast.error(`Connection test failed: ${getErrorMessage(err)}`);
    } finally {
      setTestingProvider(null);
    }
  };

  const [syncingCategoriesProvider, setSyncingCategoriesProvider] = useState<string | null>(null);

  const handleSyncCategories = async (providerId: string) => {
    setSyncingCategoriesProvider(providerId);
    try {
      const result = await externalTrainingService.syncCategories(providerId);
      toast.success(result.message || 'Categories fetched successfully');
    } catch (err: unknown) {
      toast.error(`Category sync failed: ${getErrorMessage(err)}`);
    } finally {
      setSyncingCategoriesProvider(null);
    }
  };

  const handleSync = async (providerId: string) => {
    setSyncingProvider(providerId);
    try {
      const result = await externalTrainingService.triggerSync(providerId, { sync_type: 'incremental' });
      toast.success(result.message || 'Sync initiated. Check sync logs for progress.');
      // Reload providers after a short delay to show updated last_sync_at
      setTimeout(() => {
        void loadProviders();
      }, 2000);
    } catch (err: unknown) {
      toast.error(`Sync failed: ${getErrorMessage(err)}`);
    } finally {
      setSyncingProvider(null);
    }
  };

  const handleEdit = (provider: ExternalTrainingProvider) => {
    setEditModal({ isOpen: true, provider });
  };

  const handleDelete = async (providerId: string) => {
    const agreed = await confirm({
      title: 'Delete this integration?',
      message:
        'Every training record imported through it is removed with it. Records logged in The Logbook directly are untouched.',
      confirmLabel: 'Delete integration',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!agreed) return;
    try {
      await externalTrainingService.deleteProvider(providerId);
      await loadProviders();
      toast.success('Provider deleted successfully');
    } catch (err: unknown) {
      toast.error(`Failed to delete: ${getErrorMessage(err)}`);
    }
  };

  const handleViewMappings = (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    setMappingsModal({
      isOpen: true,
      providerId,
      providerName: provider?.name || 'Provider',
    });
  };

  return (
    <div className="min-h-screen">
      <div className="p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-theme-text-primary text-2xl font-bold">External Training Integrations</h1>
            <p className="text-theme-text-muted mt-1">
              Connect external training platforms to automatically sync completed training records
            </p>
          </div>
          <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2">
            <Plus className="h-5 w-5" aria-hidden="true" />
            Add Provider
          </button>
        </div>

        {/* Tabs */}
        <div className="tab-scroll mb-6" role="tablist" aria-label="External training views">
          <button
            onClick={() => setActiveTab('providers')}
            role="tab"
            aria-selected={activeTab === 'providers'}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'providers'
                ? 'border-b-2 border-red-500 text-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <Link2 className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
            Providers
          </button>
          <button
            onClick={() => setActiveTab('imports')}
            role="tab"
            aria-selected={activeTab === 'imports'}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'imports'
                ? 'border-b-2 border-red-500 text-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <Download className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
            Import Queue
          </button>
          <button
            onClick={() => setActiveTab('mappings')}
            role="tab"
            aria-selected={activeTab === 'mappings'}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'mappings'
                ? 'border-b-2 border-red-500 text-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <FolderTree className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
            All Mappings
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
            <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
            <span className="sr-only">Loading providers...</span>
          </div>
        ) : activeTab === 'providers' ? (
          <div className="grid gap-6 md:grid-cols-2" role="tabpanel">
            {providers.length === 0 ? (
              <div className="bg-theme-surface border-theme-surface-border col-span-2 rounded-lg border py-12 text-center">
                <Link2 className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
                <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">No Integrations Yet</h3>
                <p className="text-theme-text-muted mb-4">
                  Connect an external training platform to start syncing records
                </p>
                <button onClick={() => setShowCreateModal(true)} className="btn-primary inline-flex items-center gap-2">
                  <Plus className="h-5 w-5" aria-hidden="true" />
                  Add Provider
                </button>
              </div>
            ) : (
              providers.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onTestConnection={(id) => {
                    void handleTestConnection(id);
                  }}
                  onSyncCategories={(id) => {
                    void handleSyncCategories(id);
                  }}
                  onSync={(id) => {
                    void handleSync(id);
                  }}
                  onEdit={handleEdit}
                  onDelete={(id) => {
                    void handleDelete(id);
                  }}
                  onViewMappings={handleViewMappings}
                  isTestingConnection={testingProvider === provider.id}
                  isSyncingCategories={syncingCategoriesProvider === provider.id}
                  isSyncing={syncingProvider === provider.id}
                />
              ))
            )}
          </div>
        ) : activeTab === 'imports' ? (
          <div
            className="bg-theme-surface border-theme-surface-border rounded-lg border p-8 text-center"
            role="tabpanel"
          >
            <Download className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
            <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">Import Queue</h3>
            <p className="text-theme-text-muted">
              After syncing, pending imports will appear here for review and processing
            </p>
          </div>
        ) : (
          <div
            className="bg-theme-surface border-theme-surface-border rounded-lg border p-8 text-center"
            role="tabpanel"
          >
            <FolderTree className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
            <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">All Mappings</h3>
            <p className="text-theme-text-muted">View and manage all category and user mappings across providers</p>
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateProviderModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => {
          void loadProviders();
        }}
      />
      <EditProviderModal
        isOpen={editModal.isOpen}
        provider={editModal.provider}
        onClose={() => setEditModal({ isOpen: false, provider: null })}
        onSuccess={() => {
          void loadProviders();
        }}
      />
      <MappingsModal
        isOpen={mappingsModal.isOpen}
        onClose={() => setMappingsModal((prev) => ({ ...prev, isOpen: false }))}
        providerId={mappingsModal.providerId}
        providerName={mappingsModal.providerName}
      />
    </div>
  );
};

export default ExternalTrainingPage;
