/**
 * External Training Integrations Page
 *
 * Allows administrators to manage connections to external training platforms
 * like Vector Solutions, Target Solutions, Lexipol, etc.
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandling';
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
  History,
  ArrowRight,
  Check,
  Filter,
  UploadCloud,
} from 'lucide-react';
import { externalTrainingService, trainingService, userService } from '../services/api';
import type {
  ExternalTrainingProvider,
  ExternalTrainingProviderCreate,
  ExternalProviderType,
  ExternalCategoryMapping,
  ExternalUserMapping,
  ExternalTrainingSyncLog,
  ExternalTrainingImport,
  TrainingCategory,
} from '../types/training';
import type { User } from '../types/user';

type TabView = 'providers' | 'imports' | 'mappings';

const PROVIDER_TYPES: { value: ExternalProviderType; label: string; description: string }[] = [
  { value: 'vector_solutions', label: 'Vector Solutions', description: 'Connect to Vector Solutions LMS for fire and EMS training records' },
  { value: 'target_solutions', label: 'Target Solutions', description: 'Sync training completions from Target Solutions platform' },
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
    setFormData(prev => ({
      ...prev,
      provider_type: type,
      name: PROVIDER_TYPES.find(p => p.value === type)?.label || '',
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
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-provider-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-secondary rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-theme-surface-border">
          <h2 id="create-provider-title" className="text-2xl font-bold text-theme-text-primary">
            {step === 'type' ? 'Select Provider Type' : 'Configure Provider'}
          </h2>
        </div>

        {step === 'type' ? (
          <div className="p-6 space-y-4">
            {PROVIDER_TYPES.map(type => (
              <button
                key={type.value}
                onClick={() => handleTypeSelect(type.value)}
                className="w-full p-4 bg-theme-surface hover:bg-theme-surface-hover rounded-lg text-left transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-theme-text-primary">{type.label}</h3>
                    <p className="text-sm text-theme-text-muted mt-1">{type.description}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />
                </div>
              </button>
            ))}

            <div className="flex justify-end pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500 text-red-700 dark:text-red-500 px-4 py-3 rounded" role="alert">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="provider-name" className="block text-sm font-medium text-theme-text-secondary mb-2">
                Display Name <span aria-hidden="true">*</span>
              </label>
              <input
                id="provider-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
                placeholder="e.g., Vector Solutions - Main Account"
                required
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="provider-api-url" className="block text-sm font-medium text-theme-text-secondary mb-2">
                API Base URL <span aria-hidden="true">*</span>
              </label>
              <input
                id="provider-api-url"
                type="url"
                value={formData.api_base_url}
                onChange={(e) => setFormData(prev => ({ ...prev, api_base_url: e.target.value }))}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
                placeholder={formData.provider_type === 'vector_solutions' ? 'https://app.targetsolutions.com/v1' : 'https://api.example.com'}
                required
                aria-required="true"
              />
              {formData.provider_type === 'vector_solutions' && (
                <p className="mt-1 text-xs text-theme-text-muted">
                  For Vector Solutions / TargetSolutions, use your organization's API base URL (e.g., https://app.targetsolutions.com/v1)
                </p>
              )}
            </div>

            {formData.provider_type !== 'vector_solutions' && (
              <div>
                <label htmlFor="provider-auth-type" className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Authentication Type
                </label>
                <select
                  id="provider-auth-type"
                  value={formData.auth_type}
                  onChange={(e) => setFormData(prev => ({ ...prev, auth_type: e.target.value as 'api_key' | 'basic' | 'oauth2' }))}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
                >
                  <option value="api_key">API Key</option>
                  <option value="basic">Basic Auth</option>
                  <option value="oauth2">OAuth 2.0</option>
                </select>
              </div>
            )}

            <div>
              <label htmlFor="provider-api-key" className="block text-sm font-medium text-theme-text-secondary mb-2">
                {formData.provider_type === 'vector_solutions' ? 'AccessToken' : 'API Key'} <span aria-hidden="true">*</span>
              </label>
              <input
                id="provider-api-key"
                type="password"
                value={formData.api_key}
                onChange={(e) => setFormData(prev => ({ ...prev, api_key: e.target.value }))}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
                placeholder={formData.provider_type === 'vector_solutions' ? 'Enter your TargetSolutions AccessToken' : 'Enter your API key'}
                required
                aria-required="true"
              />
              {formData.provider_type === 'vector_solutions' && (
                <p className="mt-1 text-xs text-theme-text-muted">
                  Your AccessToken is provided by your Vector Solutions account manager. Each token has specific access levels.
                </p>
              )}
            </div>

            {formData.provider_type === 'vector_solutions' && (
              <div>
                <label htmlFor="provider-site-id" className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Site ID
                </label>
                <input
                  id="provider-site-id"
                  type="text"
                  value={formData.config?.site_id || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    config: { ...prev.config, site_id: e.target.value || undefined }
                  }))}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
                  placeholder="Enter your TargetSolutions Site ID"
                />
                <p className="mt-1 text-xs text-theme-text-muted">
                  Run a connection test to discover available Site IDs. Required for syncing training records.
                </p>
              </div>
            )}

            {formData.auth_type === 'basic' && (
              <div>
                <label htmlFor="provider-api-secret" className="block text-sm font-medium text-theme-text-secondary mb-2">
                  API Secret
                </label>
                <input
                  id="provider-api-secret"
                  type="password"
                  value={formData.api_secret || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, api_secret: e.target.value }))}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
                  placeholder="Enter your API secret"
                />
              </div>
            )}

            <div>
              <label htmlFor="provider-description" className="block text-sm font-medium text-theme-text-secondary mb-2">
                Description
              </label>
              <textarea
                id="provider-description"
                value={formData.description || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
                placeholder="Optional description for this integration"
                rows={3}
              />
            </div>

            <div className="border-t border-theme-surface-border pt-4">
              <h3 className="text-lg font-semibold text-theme-text-primary mb-4">Sync Settings</h3>

              <div className="flex items-center justify-between mb-4">
                <div>
                  <label htmlFor="provider-auto-sync" className="text-sm font-medium text-theme-text-secondary">
                    Enable Auto-Sync
                  </label>
                  <p className="text-xs text-theme-text-muted">
                    Automatically sync training records on a schedule
                  </p>
                </div>
                <button
                  id="provider-auto-sync"
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, auto_sync_enabled: !prev.auto_sync_enabled }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData.auto_sync_enabled ? 'bg-red-600' : 'bg-theme-surface-hover'
                  }`}
                  role="switch"
                  aria-checked={formData.auto_sync_enabled}
                  aria-label="Enable auto-sync"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      formData.auto_sync_enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                    aria-hidden="true"
                  />
                </button>
              </div>

              {formData.auto_sync_enabled && (
                <div>
                  <label htmlFor="provider-sync-interval" className="block text-sm font-medium text-theme-text-secondary mb-2">
                    Sync Interval (hours)
                  </label>
                  <select
                    id="provider-sync-interval"
                    value={formData.sync_interval_hours}
                    onChange={(e) => setFormData(prev => ({ ...prev, sync_interval_hours: parseInt(e.target.value) }))}
                    className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
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

            <div className="flex justify-between pt-4 border-t border-theme-surface-border">
              <button
                type="button"
                onClick={() => setStep('type')}
                className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary"
              >
                Back
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
                >
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
  onSync: (id: string) => void;
  onEdit: (provider: ExternalTrainingProvider) => void;
  onDelete: (id: string) => void;
  onViewMappings: (id: string) => void;
  onViewSyncLogs: (id: string) => void;
  isTestingConnection: boolean;
  isSyncing: boolean;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  onTestConnection,
  onSync,
  onEdit,
  onDelete,
  onViewMappings,
  onViewSyncLogs,
  isTestingConnection,
  isSyncing,
}) => {
  const getStatusIcon = () => {
    if (provider.connection_verified) {
      return <CheckCircle className="w-5 h-5 text-green-700 dark:text-green-500" aria-hidden="true" />;
    }
    if (provider.connection_error) {
      return <XCircle className="w-5 h-5 text-red-700 dark:text-red-500" aria-hidden="true" />;
    }
    return <AlertTriangle className="w-5 h-5 text-yellow-700 dark:text-yellow-500" aria-hidden="true" />;
  };

  const getStatusLabel = () => {
    if (provider.connection_verified) return 'Connection verified';
    if (provider.connection_error) return 'Connection error';
    return 'Connection not verified';
  };

  const getProviderTypeLabel = () => {
    return PROVIDER_TYPES.find(p => p.value === provider.provider_type)?.label || provider.provider_type;
  };

  return (
    <div className="bg-theme-surface-secondary rounded-lg p-6 border border-theme-surface-border">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-theme-surface rounded-lg">
            <Link2 className="w-6 h-6 text-red-700 dark:text-red-500" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-theme-text-primary">{provider.name}</h3>
            <p className="text-sm text-theme-text-muted">{getProviderTypeLabel()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span aria-label={getStatusLabel()}>{getStatusIcon()}</span>
          <span className={`text-sm ${provider.active ? 'text-green-700 dark:text-green-400' : 'text-theme-text-muted'}`}>
            {provider.active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {provider.description && (
        <p className="text-sm text-theme-text-muted mb-4">{provider.description}</p>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-theme-surface rounded-lg p-3">
          <p className="text-xs text-theme-text-muted">Last Sync</p>
          <p className="text-sm text-theme-text-primary">
            {provider.last_sync_at
              ? new Date(provider.last_sync_at).toLocaleString()
              : 'Never'}
          </p>
        </div>
        <div className="bg-theme-surface rounded-lg p-3">
          <p className="text-xs text-theme-text-muted">Auto-Sync</p>
          <p className="text-sm text-theme-text-primary">
            {provider.auto_sync_enabled
              ? `Every ${provider.sync_interval_hours}h`
              : 'Disabled'}
          </p>
        </div>
      </div>

      {provider.connection_error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4" role="alert">
          <p className="text-xs text-red-700 dark:text-red-400">Connection Error:</p>
          <p className="text-sm text-red-700 dark:text-red-300">{provider.connection_error}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onTestConnection(provider.id)}
          disabled={isTestingConnection}
          className="flex items-center gap-2 px-3 py-2 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary text-sm rounded-lg disabled:opacity-50"
        >
          {isTestingConnection ? (
            <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle className="w-4 h-4" aria-hidden="true" />
          )}
          Test
        </button>
        <button
          onClick={() => onSync(provider.id)}
          disabled={isSyncing}
          className="flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg disabled:opacity-50"
        >
          {isSyncing ? (
            <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <PlayCircle className="w-4 h-4" aria-hidden="true" />
          )}
          Sync Now
        </button>
        <button
          onClick={() => onViewMappings(provider.id)}
          className="flex items-center gap-2 px-3 py-2 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary text-sm rounded-lg"
        >
          <FolderTree className="w-4 h-4" aria-hidden="true" />
          Mappings
        </button>
        <button
          onClick={() => onViewSyncLogs(provider.id)}
          className="flex items-center gap-2 px-3 py-2 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary text-sm rounded-lg"
        >
          <History className="w-4 h-4" aria-hidden="true" />
          Logs
        </button>
        <button
          onClick={() => onEdit(provider)}
          className="flex items-center gap-2 px-3 py-2 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary text-sm rounded-lg"
          aria-label="Edit provider"
        >
          <Edit2 className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          onClick={() => onDelete(provider.id)}
          className="flex items-center gap-2 px-3 py-2 bg-theme-surface hover:bg-red-600 text-white text-sm rounded-lg"
          aria-label="Delete provider"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
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
        auth_type: (provider.auth_type as 'api_key' | 'basic' | 'oauth2') || 'api_key',
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
      const message = err instanceof Error ? err.message : 'Failed to update provider';
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !provider) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-provider-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-secondary rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-theme-surface-border">
          <h2 id="edit-provider-title" className="text-2xl font-bold text-theme-text-primary">
            Edit Provider: {provider.name}
          </h2>
          <p className="text-sm text-theme-text-muted mt-1">
            {PROVIDER_TYPES.find(p => p.value === provider.provider_type)?.label || provider.provider_type}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500 text-red-700 dark:text-red-500 px-4 py-3 rounded" role="alert">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="edit-provider-name" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Display Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="edit-provider-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="edit-provider-api-url" className="block text-sm font-medium text-theme-text-secondary mb-2">
              API Base URL <span aria-hidden="true">*</span>
            </label>
            <input
              id="edit-provider-api-url"
              type="url"
              value={formData.api_base_url}
              onChange={(e) => setFormData(prev => ({ ...prev, api_base_url: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="edit-provider-api-key" className="block text-sm font-medium text-theme-text-secondary mb-2">
              API Key (leave blank to keep current)
            </label>
            <input
              id="edit-provider-api-key"
              type="password"
              value={formData.api_key}
              onChange={(e) => setFormData(prev => ({ ...prev, api_key: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
              placeholder="Enter new API key to update"
            />
          </div>

          {formData.auth_type === 'basic' && (
            <div>
              <label htmlFor="edit-provider-api-secret" className="block text-sm font-medium text-theme-text-secondary mb-2">
                API Secret (leave blank to keep current)
              </label>
              <input
                id="edit-provider-api-secret"
                type="password"
                value={formData.api_secret}
                onChange={(e) => setFormData(prev => ({ ...prev, api_secret: e.target.value }))}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
                placeholder="Enter new API secret to update"
              />
            </div>
          )}

          <div>
            <label htmlFor="edit-provider-description" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Description
            </label>
            <textarea
              id="edit-provider-description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
              rows={3}
            />
          </div>

          <div className="border-t border-theme-surface-border pt-4">
            <h3 className="text-lg font-semibold text-theme-text-primary mb-4">Sync Settings</h3>
            <div className="flex items-center justify-between mb-4">
              <div>
                <label htmlFor="edit-provider-auto-sync" className="text-sm font-medium text-theme-text-secondary">
                  Enable Auto-Sync
                </label>
                <p className="text-xs text-theme-text-muted">Automatically sync training records on a schedule</p>
              </div>
              <button
                id="edit-provider-auto-sync"
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, auto_sync_enabled: !prev.auto_sync_enabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  formData.auto_sync_enabled ? 'bg-red-600' : 'bg-theme-surface-hover'
                }`}
                role="switch"
                aria-checked={formData.auto_sync_enabled}
                aria-label="Enable auto-sync"
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    formData.auto_sync_enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                  aria-hidden="true"
                />
              </button>
            </div>

            {formData.auto_sync_enabled && (
              <div>
                <label htmlFor="edit-provider-sync-interval" className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Sync Interval (hours)
                </label>
                <select
                  id="edit-provider-sync-interval"
                  value={formData.sync_interval_hours}
                  onChange={(e) => setFormData(prev => ({ ...prev, sync_interval_hours: parseInt(e.target.value) }))}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
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

          <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ==================== Sync Logs Modal ====================

interface SyncLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  providerName: string;
}

const SyncLogsModal: React.FC<SyncLogsModalProps> = ({ isOpen, onClose, providerId, providerName }) => {
  const [logs, setLogs] = useState<ExternalTrainingSyncLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && providerId) {
      loadLogs();
    }
  }, [isOpen, providerId]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await externalTrainingService.getSyncLogs(providerId, 50);
      setLogs(data);
    } catch {
      toast.error('Failed to load sync logs');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      completed: 'bg-green-500/10 text-green-700 dark:text-green-400',
      failed: 'bg-red-500/10 text-red-700 dark:text-red-400',
      in_progress: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
      pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
      partial: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] || 'bg-theme-surface-secondary text-theme-text-primary'}`}>
        {status.replace('_', ' ')}
      </span>
    );
  };

  const formatDuration = (start: string, end?: string) => {
    if (!end) return 'In progress...';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return '<1s';
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m`;
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-logs-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-secondary rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-theme-surface-border">
          <h2 id="sync-logs-title" className="text-2xl font-bold text-theme-text-primary">
            Sync History - {providerName}
          </h2>
          <p className="text-sm text-theme-text-muted mt-1">
            View past sync operations and their results
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-theme-text-muted py-8" role="status">Loading sync logs...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8">
              <History className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <p className="text-theme-text-muted">No sync history yet. Run a sync to get started.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {logs.map(log => (
                <div key={log.id} className="bg-theme-surface rounded-lg p-4 border border-theme-surface-border">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      {getStatusBadge(log.status)}
                      <span className="text-sm font-medium text-theme-text-primary capitalize">{log.sync_type} sync</span>
                    </div>
                    <span className="text-xs text-theme-text-muted">
                      {new Date(log.started_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-2 text-xs">
                    <div>
                      <span className="text-theme-text-muted">Duration</span>
                      <p className="text-theme-text-primary font-medium">{formatDuration(log.started_at, log.completed_at)}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Fetched</span>
                      <p className="text-theme-text-primary font-medium">{log.records_fetched}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Imported</span>
                      <p className="text-green-700 dark:text-green-400 font-medium">{log.records_imported}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Skipped</span>
                      <p className="text-theme-text-primary font-medium">{log.records_skipped}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Failed</span>
                      <p className={`font-medium ${log.records_failed > 0 ? 'text-red-700 dark:text-red-400' : 'text-theme-text-primary'}`}>
                        {log.records_failed}
                      </p>
                    </div>
                  </div>
                  {log.error_message && (
                    <div className="mt-2 bg-red-500/10 border border-red-500/30 rounded p-2">
                      <p className="text-xs text-red-700 dark:text-red-400">{log.error_message}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-theme-surface-border flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== Mappings Modal ====================

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
  const [internalCategories, setInternalCategories] = useState<TrainingCategory[]>([]);
  const [internalUsers, setInternalUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingMapping, setSavingMapping] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && providerId) {
      loadMappings();
    }
  }, [isOpen, providerId]);

  const loadMappings = async () => {
    setLoading(true);
    try {
      const [categories, users, intCategories, intUsers] = await Promise.all([
        externalTrainingService.getCategoryMappings(providerId),
        externalTrainingService.getUserMappings(providerId),
        trainingService.getCategories(true),
        userService.getUsers(),
      ]);
      setCategoryMappings(categories);
      setUserMappings(users);
      setInternalCategories(intCategories);
      setInternalUsers(intUsers);
    } catch {
      toast.error('Failed to load mappings');
    } finally {
      setLoading(false);
    }
  };

  const handleMapCategory = async (mappingId: string, internalCategoryId: string) => {
    setSavingMapping(mappingId);
    try {
      await externalTrainingService.updateCategoryMapping(providerId, mappingId, {
        internal_category_id: internalCategoryId,
        is_mapped: true,
      });
      setCategoryMappings(prev =>
        prev.map(m => m.id === mappingId ? { ...m, is_mapped: true, internal_category_id: internalCategoryId, internal_category_name: internalCategories.find(c => c.id === internalCategoryId)?.name } : m)
      );
      toast.success('Category mapped successfully');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to map category'));
    } finally {
      setSavingMapping(null);
    }
  };

  const handleMapUser = async (mappingId: string, internalUserId: string) => {
    setSavingMapping(mappingId);
    try {
      await externalTrainingService.updateUserMapping(providerId, mappingId, {
        internal_user_id: internalUserId,
        is_mapped: true,
      });
      const user = internalUsers.find(u => u.id === internalUserId);
      setUserMappings(prev =>
        prev.map(m => m.id === mappingId ? { ...m, is_mapped: true, internal_user_id: internalUserId, internal_user_name: user?.full_name || user?.username, internal_user_email: user?.email } : m)
      );
      toast.success('User mapped successfully');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to map user'));
    } finally {
      setSavingMapping(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mappings-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-secondary rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-theme-surface-border">
          <h2 id="mappings-modal-title" className="text-2xl font-bold text-theme-text-primary">Mappings - {providerName}</h2>
          <p className="text-sm text-theme-text-muted mt-1">
            Map external categories and users to your internal records
          </p>
        </div>

        <div className="flex border-b border-theme-surface-border" role="tablist" aria-label="Mapping types">
          <button
            onClick={() => setActiveTab('categories')}
            role="tab"
            aria-selected={activeTab === 'categories'}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'categories'
                ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <FolderTree className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
            Categories ({categoryMappings.filter(m => !m.is_mapped).length} unmapped)
          </button>
          <button
            onClick={() => setActiveTab('users')}
            role="tab"
            aria-selected={activeTab === 'users'}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'users'
                ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <Users className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
            Users ({userMappings.filter(m => !m.is_mapped).length} unmapped)
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6" role="tabpanel">
          {loading ? (
            <div className="text-center text-theme-text-muted py-8" role="status" aria-live="polite">Loading mappings...</div>
          ) : activeTab === 'categories' ? (
            <div className="space-y-3">
              {categoryMappings.length === 0 ? (
                <p className="text-theme-text-muted text-center py-8">
                  No category mappings yet. Run a sync to discover categories.
                </p>
              ) : (
                categoryMappings.map(mapping => (
                  <div
                    key={mapping.id}
                    className={`p-4 rounded-lg border ${
                      mapping.is_mapped
                        ? 'bg-theme-surface border-theme-surface-border'
                        : 'bg-yellow-500/10 border-yellow-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-theme-text-primary font-medium">{mapping.external_category_name}</p>
                        <p className="text-xs text-theme-text-muted">
                          External ID: {mapping.external_category_id}
                          {mapping.external_category_code && ` | Code: ${mapping.external_category_code}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {mapping.is_mapped ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1">
                              <CheckCircle className="w-4 h-4" aria-hidden="true" />
                              {mapping.internal_category_name || 'Mapped'}
                              {mapping.auto_mapped && <span className="text-xs">(auto)</span>}
                            </span>
                            <select
                              value={mapping.internal_category_id || ''}
                              onChange={(e) => { if (e.target.value) handleMapCategory(mapping.id, e.target.value); }}
                              disabled={savingMapping === mapping.id}
                              className="px-2 py-1 bg-theme-input-bg border border-theme-input-border rounded text-xs text-theme-text-primary focus:outline-none focus:border-red-500"
                              aria-label="Change category mapping"
                            >
                              <option value="">Change...</option>
                              {internalCategories.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <ArrowRight className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                            <select
                              defaultValue=""
                              onChange={(e) => { if (e.target.value) handleMapCategory(mapping.id, e.target.value); }}
                              disabled={savingMapping === mapping.id}
                              className="px-3 py-1.5 bg-theme-input-bg border border-red-500 rounded text-sm text-theme-text-primary focus:outline-none focus:border-red-600"
                              aria-label={`Map ${mapping.external_category_name} to internal category`}
                            >
                              <option value="" disabled>Select category...</option>
                              {internalCategories.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                              ))}
                            </select>
                            {savingMapping === mapping.id && (
                              <RefreshCw className="w-4 h-4 animate-spin text-theme-text-muted" aria-hidden="true" />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {userMappings.length === 0 ? (
                <p className="text-theme-text-muted text-center py-8">
                  No user mappings yet. Run a sync to discover users.
                </p>
              ) : (
                userMappings.map(mapping => (
                  <div
                    key={mapping.id}
                    className={`p-4 rounded-lg border ${
                      mapping.is_mapped
                        ? 'bg-theme-surface border-theme-surface-border'
                        : 'bg-yellow-500/10 border-yellow-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-theme-text-primary font-medium">
                          {mapping.external_name || mapping.external_username || 'Unknown User'}
                        </p>
                        <p className="text-xs text-theme-text-muted">
                          {mapping.external_email && `Email: ${mapping.external_email} | `}
                          External ID: {mapping.external_user_id}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {mapping.is_mapped ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1">
                              <CheckCircle className="w-4 h-4" aria-hidden="true" />
                              {mapping.internal_user_name || 'Mapped'}
                              {mapping.auto_mapped && <span className="text-xs">(auto)</span>}
                            </span>
                            <select
                              value={mapping.internal_user_id || ''}
                              onChange={(e) => { if (e.target.value) handleMapUser(mapping.id, e.target.value); }}
                              disabled={savingMapping === mapping.id}
                              className="px-2 py-1 bg-theme-input-bg border border-theme-input-border rounded text-xs text-theme-text-primary focus:outline-none focus:border-red-500"
                              aria-label="Change user mapping"
                            >
                              <option value="">Change...</option>
                              {internalUsers.map(u => (
                                <option key={u.id} value={u.id}>{u.full_name || u.username}{u.email ? ` (${u.email})` : ''}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <ArrowRight className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                            <select
                              defaultValue=""
                              onChange={(e) => { if (e.target.value) handleMapUser(mapping.id, e.target.value); }}
                              disabled={savingMapping === mapping.id}
                              className="px-3 py-1.5 bg-theme-input-bg border border-red-500 rounded text-sm text-theme-text-primary focus:outline-none focus:border-red-600"
                              aria-label={`Map ${mapping.external_name || mapping.external_username || 'user'} to internal user`}
                            >
                              <option value="" disabled>Select member...</option>
                              {internalUsers.map(u => (
                                <option key={u.id} value={u.id}>{u.full_name || u.username}{u.email ? ` (${u.email})` : ''}</option>
                              ))}
                            </select>
                            {savingMapping === mapping.id && (
                              <RefreshCw className="w-4 h-4 animate-spin text-theme-text-muted" aria-hidden="true" />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-theme-surface-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== Import Queue Panel ====================

interface ImportQueuePanelProps {
  providers: ExternalTrainingProvider[];
}

const ImportQueuePanel: React.FC<ImportQueuePanelProps> = ({ providers }) => {
  const [selectedProviderId, setSelectedProviderId] = useState<string>(providers[0]?.id || '');
  const [imports, setImports] = useState<ExternalTrainingImport[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [internalUsers, setInternalUsers] = useState<User[]>([]);
  const [internalCategories, setInternalCategories] = useState<TrainingCategory[]>([]);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);

  useEffect(() => {
    if (selectedProviderId) {
      loadImports();
    }
  }, [selectedProviderId, statusFilter]);

  useEffect(() => {
    loadReferenceData();
  }, []);

  const loadReferenceData = async () => {
    try {
      const [users, categories] = await Promise.all([
        userService.getUsers(),
        trainingService.getCategories(true),
      ]);
      setInternalUsers(users);
      setInternalCategories(categories);
    } catch {
      // Reference data will be empty - imports still viewable
    }
  };

  const loadImports = async () => {
    setLoading(true);
    try {
      const data = await externalTrainingService.getImportedRecords(selectedProviderId, {
        status: statusFilter || undefined,
        limit: 200,
      });
      setImports(data);
      setSelectedIds(new Set());
    } catch {
      toast.error('Failed to load import records');
    } finally {
      setLoading(false);
    }
  };

  const handleImportSingle = async (importRecord: ExternalTrainingImport) => {
    if (!importRecord.user_id) {
      toast.error('This record has no mapped user. Map the user first in the Mappings tab.');
      return;
    }
    setImportingId(importRecord.id);
    try {
      await externalTrainingService.importRecord(selectedProviderId, importRecord.id, {
        external_import_id: importRecord.id,
        user_id: importRecord.user_id,
      });
      toast.success(`Imported: ${importRecord.course_title}`);
      await loadImports();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to import record'));
    } finally {
      setImportingId(null);
    }
  };

  const handleBulkImport = async () => {
    if (selectedIds.size === 0) {
      toast.error('Select records to import');
      return;
    }
    setBulkImporting(true);
    try {
      const result = await externalTrainingService.bulkImport(selectedProviderId, {
        external_import_ids: Array.from(selectedIds),
        auto_map_users: true,
      });
      toast.success(`Bulk import: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed`);
      if (result.errors.length > 0) {
        result.errors.slice(0, 3).forEach(err => toast.error(err));
      }
      await loadImports();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Bulk import failed'));
    } finally {
      setBulkImporting(false);
    }
  };

  const toggleSelectAll = () => {
    const pendingIds = imports.filter(i => i.import_status === 'pending').map(i => i.id);
    if (selectedIds.size === pendingIds.length && pendingIds.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingIds));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
      imported: 'bg-green-500/10 text-green-700 dark:text-green-400',
      failed: 'bg-red-500/10 text-red-700 dark:text-red-400',
      skipped: 'bg-theme-surface-secondary text-theme-text-primary',
      duplicate: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] || 'bg-theme-surface-secondary text-theme-text-primary'}`}>
        {status}
      </span>
    );
  };

  if (providers.length === 0) {
    return (
      <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-8 text-center" role="tabpanel">
        <Download className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
        <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Providers Configured</h3>
        <p className="text-theme-text-muted">Add an external training provider first, then sync to populate the import queue.</p>
      </div>
    );
  }

  const pendingCount = imports.filter(i => i.import_status === 'pending').length;

  return (
    <div role="tabpanel">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <label htmlFor="import-provider-filter" className="text-sm text-theme-text-secondary">Provider:</label>
          <select
            id="import-provider-filter"
            value={selectedProviderId}
            onChange={(e) => setSelectedProviderId(e.target.value)}
            className="px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary focus:outline-none focus:border-red-500"
          >
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary focus:outline-none focus:border-red-500"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="imported">Imported</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
            <option value="duplicate">Duplicate</option>
          </select>
        </div>
        {pendingCount > 0 && (
          <button
            onClick={handleBulkImport}
            disabled={selectedIds.size === 0 || bulkImporting}
            className="ml-auto flex items-center gap-2 px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg disabled:opacity-50"
          >
            {bulkImporting ? (
              <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <UploadCloud className="w-4 h-4" aria-hidden="true" />
            )}
            Import Selected ({selectedIds.size})
          </button>
        )}
      </div>

      {/* Import Table */}
      {loading ? (
        <div className="flex justify-center py-12" role="status">
          <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
        </div>
      ) : imports.length === 0 ? (
        <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-8 text-center">
          <Download className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Import Records</h3>
          <p className="text-theme-text-muted">Run a sync on a provider to fetch training records for import.</p>
        </div>
      ) : (
        <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-theme-surface-border bg-theme-surface">
                  <th className="p-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedIds.size > 0 && selectedIds.size === imports.filter(i => i.import_status === 'pending').length}
                      onChange={toggleSelectAll}
                      className="rounded border-theme-input-border"
                      aria-label="Select all pending records"
                    />
                  </th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Course</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Category</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Completion</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Duration</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Score</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Status</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Action</th>
                </tr>
              </thead>
              <tbody>
                {imports.map(record => (
                  <tr key={record.id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                    <td className="p-3">
                      {record.import_status === 'pending' && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(record.id)}
                          onChange={() => toggleSelect(record.id)}
                          className="rounded border-theme-input-border"
                          aria-label={`Select ${record.course_title}`}
                        />
                      )}
                    </td>
                    <td className="p-3">
                      <p className="text-theme-text-primary font-medium">{record.course_title}</p>
                      {record.course_code && <p className="text-xs text-theme-text-muted">{record.course_code}</p>}
                    </td>
                    <td className="p-3 text-theme-text-secondary">{record.external_category_name || '—'}</td>
                    <td className="p-3 text-theme-text-secondary">
                      {record.completion_date ? new Date(record.completion_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="p-3 text-theme-text-secondary">
                      {record.duration_minutes ? `${record.duration_minutes}m` : '—'}
                    </td>
                    <td className="p-3 text-theme-text-secondary">
                      {record.score != null ? `${record.score}%` : '—'}
                    </td>
                    <td className="p-3">{getStatusBadge(record.import_status)}</td>
                    <td className="p-3">
                      {record.import_status === 'pending' && (
                        <button
                          onClick={() => handleImportSingle(record)}
                          disabled={importingId === record.id}
                          className="flex items-center gap-1 px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded disabled:opacity-50"
                        >
                          {importingId === record.id ? (
                            <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
                          ) : (
                            <Check className="w-3 h-3" aria-hidden="true" />
                          )}
                          Import
                        </button>
                      )}
                      {record.import_status === 'failed' && record.import_error && (
                        <span className="text-xs text-red-700 dark:text-red-400" title={record.import_error}>
                          {record.import_error.substring(0, 30)}...
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-theme-surface-border text-xs text-theme-text-muted">
            Showing {imports.length} records | {pendingCount} pending
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== All Mappings Panel ====================

interface AllMappingsPanelProps {
  providers: ExternalTrainingProvider[];
}

const AllMappingsPanel: React.FC<AllMappingsPanelProps> = ({ providers }) => {
  const [selectedProviderId, setSelectedProviderId] = useState<string>(providers[0]?.id || '');
  const [mappingTab, setMappingTab] = useState<'categories' | 'users'>('categories');
  const [categoryMappings, setCategoryMappings] = useState<ExternalCategoryMapping[]>([]);
  const [userMappings, setUserMappings] = useState<ExternalUserMapping[]>([]);
  const [internalCategories, setInternalCategories] = useState<TrainingCategory[]>([]);
  const [internalUsers, setInternalUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingMapping, setSavingMapping] = useState<string | null>(null);
  const [showUnmappedOnly, setShowUnmappedOnly] = useState(false);

  useEffect(() => {
    if (selectedProviderId) {
      loadData();
    }
  }, [selectedProviderId, showUnmappedOnly]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [catMappings, usrMappings, intCats, intUsers] = await Promise.all([
        externalTrainingService.getCategoryMappings(selectedProviderId, showUnmappedOnly),
        externalTrainingService.getUserMappings(selectedProviderId, showUnmappedOnly),
        trainingService.getCategories(true),
        userService.getUsers(),
      ]);
      setCategoryMappings(catMappings);
      setUserMappings(usrMappings);
      setInternalCategories(intCats);
      setInternalUsers(intUsers);
    } catch {
      toast.error('Failed to load mappings');
    } finally {
      setLoading(false);
    }
  };

  const handleMapCategory = async (mappingId: string, internalCategoryId: string) => {
    setSavingMapping(mappingId);
    try {
      await externalTrainingService.updateCategoryMapping(selectedProviderId, mappingId, {
        internal_category_id: internalCategoryId,
        is_mapped: true,
      });
      setCategoryMappings(prev =>
        prev.map(m => m.id === mappingId ? { ...m, is_mapped: true, internal_category_id: internalCategoryId, internal_category_name: internalCategories.find(c => c.id === internalCategoryId)?.name } : m)
      );
      toast.success('Category mapped');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to map category'));
    } finally {
      setSavingMapping(null);
    }
  };

  const handleMapUser = async (mappingId: string, internalUserId: string) => {
    setSavingMapping(mappingId);
    try {
      await externalTrainingService.updateUserMapping(selectedProviderId, mappingId, {
        internal_user_id: internalUserId,
        is_mapped: true,
      });
      const user = internalUsers.find(u => u.id === internalUserId);
      setUserMappings(prev =>
        prev.map(m => m.id === mappingId ? { ...m, is_mapped: true, internal_user_id: internalUserId, internal_user_name: user?.full_name || user?.username, internal_user_email: user?.email } : m)
      );
      toast.success('User mapped');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to map user'));
    } finally {
      setSavingMapping(null);
    }
  };

  if (providers.length === 0) {
    return (
      <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-8 text-center" role="tabpanel">
        <FolderTree className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
        <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Providers Configured</h3>
        <p className="text-theme-text-muted">Add an external training provider and sync to discover mappings.</p>
      </div>
    );
  }

  const unmappedCatCount = categoryMappings.filter(m => !m.is_mapped).length;
  const unmappedUserCount = userMappings.filter(m => !m.is_mapped).length;

  return (
    <div role="tabpanel">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <label htmlFor="mappings-provider-filter" className="text-sm text-theme-text-secondary">Provider:</label>
          <select
            id="mappings-provider-filter"
            value={selectedProviderId}
            onChange={(e) => setSelectedProviderId(e.target.value)}
            className="px-3 py-1.5 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary focus:outline-none focus:border-red-500"
          >
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={showUnmappedOnly}
            onChange={(e) => setShowUnmappedOnly(e.target.checked)}
            className="rounded border-theme-input-border"
          />
          Show unmapped only
        </label>
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b border-theme-surface-border mb-4" role="tablist" aria-label="Mapping types">
        <button
          onClick={() => setMappingTab('categories')}
          role="tab"
          aria-selected={mappingTab === 'categories'}
          className={`px-4 py-2 text-sm font-medium ${
            mappingTab === 'categories'
              ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <FolderTree className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
          Categories ({unmappedCatCount} unmapped)
        </button>
        <button
          onClick={() => setMappingTab('users')}
          role="tab"
          aria-selected={mappingTab === 'users'}
          className={`px-4 py-2 text-sm font-medium ${
            mappingTab === 'users'
              ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Users className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
          Users ({unmappedUserCount} unmapped)
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12" role="status">
          <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
        </div>
      ) : mappingTab === 'categories' ? (
        <div className="space-y-3">
          {categoryMappings.length === 0 ? (
            <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-8 text-center">
              <p className="text-theme-text-muted">No category mappings found. Run a sync to discover categories.</p>
            </div>
          ) : (
            categoryMappings.map(mapping => (
              <div
                key={mapping.id}
                className={`p-4 rounded-lg border ${
                  mapping.is_mapped
                    ? 'bg-theme-surface-secondary border-theme-surface-border'
                    : 'bg-yellow-500/10 border-yellow-500/30'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-theme-text-primary font-medium">{mapping.external_category_name}</p>
                    <p className="text-xs text-theme-text-muted">
                      External ID: {mapping.external_category_id}
                      {mapping.external_category_code && ` | Code: ${mapping.external_category_code}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {mapping.is_mapped ? (
                      <span className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1">
                        <CheckCircle className="w-4 h-4" aria-hidden="true" />
                        {mapping.internal_category_name || 'Mapped'}
                      </span>
                    ) : (
                      <ArrowRight className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                    )}
                    <select
                      value={mapping.is_mapped ? (mapping.internal_category_id || '') : ''}
                      onChange={(e) => { if (e.target.value) handleMapCategory(mapping.id, e.target.value); }}
                      disabled={savingMapping === mapping.id}
                      className="px-2 py-1 bg-theme-input-bg border border-theme-input-border rounded text-xs text-theme-text-primary focus:outline-none focus:border-red-500"
                      aria-label={`Map ${mapping.external_category_name}`}
                    >
                      <option value="">{mapping.is_mapped ? 'Change...' : 'Select category...'}</option>
                      {internalCategories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
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
            <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-8 text-center">
              <p className="text-theme-text-muted">No user mappings found. Run a sync to discover users.</p>
            </div>
          ) : (
            userMappings.map(mapping => (
              <div
                key={mapping.id}
                className={`p-4 rounded-lg border ${
                  mapping.is_mapped
                    ? 'bg-theme-surface-secondary border-theme-surface-border'
                    : 'bg-yellow-500/10 border-yellow-500/30'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-theme-text-primary font-medium">
                      {mapping.external_name || mapping.external_username || 'Unknown User'}
                    </p>
                    <p className="text-xs text-theme-text-muted">
                      {mapping.external_email && `${mapping.external_email} | `}
                      ID: {mapping.external_user_id}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {mapping.is_mapped ? (
                      <span className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1">
                        <CheckCircle className="w-4 h-4" aria-hidden="true" />
                        {mapping.internal_user_name || 'Mapped'}
                      </span>
                    ) : (
                      <ArrowRight className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                    )}
                    <select
                      value={mapping.is_mapped ? (mapping.internal_user_id || '') : ''}
                      onChange={(e) => { if (e.target.value) handleMapUser(mapping.id, e.target.value); }}
                      disabled={savingMapping === mapping.id}
                      className="px-2 py-1 bg-theme-input-bg border border-theme-input-border rounded text-xs text-theme-text-primary focus:outline-none focus:border-red-500"
                      aria-label={`Map ${mapping.external_name || mapping.external_username || 'user'}`}
                    >
                      <option value="">{mapping.is_mapped ? 'Change...' : 'Select member...'}</option>
                      {internalUsers.map(u => (
                        <option key={u.id} value={u.id}>{u.full_name || u.username}{u.email ? ` (${u.email})` : ''}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ==================== Main Page ====================

const ExternalTrainingPage: React.FC = () => {
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
  const [syncLogsModal, setSyncLogsModal] = useState<{ isOpen: boolean; providerId: string; providerName: string }>({
    isOpen: false,
    providerId: '',
    providerName: '',
  });

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    setLoading(true);
    try {
      const data = await externalTrainingService.getProviders(false);
      setProviders(data);
    } catch {
      // Error silently handled - empty provider list shown
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async (providerId: string) => {
    setTestingProvider(providerId);
    try {
      const result = await externalTrainingService.testConnection(providerId);
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

  const handleSync = async (providerId: string) => {
    setSyncingProvider(providerId);
    try {
      const result = await externalTrainingService.triggerSync(providerId, { sync_type: 'incremental' });
      toast.success(result.message || 'Sync initiated. Check sync logs for progress.');
      setTimeout(() => loadProviders(), 2000);
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
    if (!confirm('Are you sure you want to delete this provider? This will also remove all imported records.')) {
      return;
    }
    try {
      await externalTrainingService.deleteProvider(providerId);
      await loadProviders();
      toast.success('Provider deleted successfully');
    } catch (err: unknown) {
      toast.error(`Failed to delete: ${getErrorMessage(err)}`);
    }
  };

  const handleViewMappings = (providerId: string) => {
    const provider = providers.find(p => p.id === providerId);
    setMappingsModal({
      isOpen: true,
      providerId,
      providerName: provider?.name || 'Provider',
    });
  };

  const handleViewSyncLogs = (providerId: string) => {
    const provider = providers.find(p => p.id === providerId);
    setSyncLogsModal({
      isOpen: true,
      providerId,
      providerName: provider?.name || 'Provider',
    });
  };

  return (
    <div className="min-h-screen">
      <div className="p-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-theme-text-primary">External Training Integrations</h1>
            <p className="text-theme-text-muted mt-1">
              Connect external training platforms to automatically sync completed training records
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
          >
            <Plus className="w-5 h-5" aria-hidden="true" />
            Add Provider
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-theme-surface-border mb-6" role="tablist" aria-label="External training views">
          <button
            onClick={() => setActiveTab('providers')}
            role="tab"
            aria-selected={activeTab === 'providers'}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'providers'
                ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <Link2 className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
            Providers
          </button>
          <button
            onClick={() => setActiveTab('imports')}
            role="tab"
            aria-selected={activeTab === 'imports'}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'imports'
                ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <Download className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
            Import Queue
          </button>
          <button
            onClick={() => setActiveTab('mappings')}
            role="tab"
            aria-selected={activeTab === 'mappings'}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'mappings'
                ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <FolderTree className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
            All Mappings
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center items-center py-12" role="status" aria-live="polite">
            <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
            <span className="sr-only">Loading providers...</span>
          </div>
        ) : activeTab === 'providers' ? (
          <div className="grid gap-6 md:grid-cols-2" role="tabpanel">
            {providers.length === 0 ? (
              <div className="col-span-2 text-center py-12 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
                <Link2 className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Integrations Yet</h3>
                <p className="text-theme-text-muted mb-4">
                  Connect an external training platform to start syncing records
                </p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
                >
                  <Plus className="w-5 h-5" aria-hidden="true" />
                  Add Provider
                </button>
              </div>
            ) : (
              providers.map(provider => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onTestConnection={handleTestConnection}
                  onSync={handleSync}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onViewMappings={handleViewMappings}
                  onViewSyncLogs={handleViewSyncLogs}
                  isTestingConnection={testingProvider === provider.id}
                  isSyncing={syncingProvider === provider.id}
                />
              ))
            )}
          </div>
        ) : activeTab === 'imports' ? (
          <ImportQueuePanel providers={providers} />
        ) : (
          <AllMappingsPanel providers={providers} />
        )}
      </div>

      {/* Modals */}
      <CreateProviderModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={loadProviders}
      />
      <EditProviderModal
        isOpen={editModal.isOpen}
        provider={editModal.provider}
        onClose={() => setEditModal({ isOpen: false, provider: null })}
        onSuccess={loadProviders}
      />
      <MappingsModal
        isOpen={mappingsModal.isOpen}
        onClose={() => setMappingsModal(prev => ({ ...prev, isOpen: false }))}
        providerId={mappingsModal.providerId}
        providerName={mappingsModal.providerName}
      />
      <SyncLogsModal
        isOpen={syncLogsModal.isOpen}
        onClose={() => setSyncLogsModal(prev => ({ ...prev, isOpen: false }))}
        providerId={syncLogsModal.providerId}
        providerName={syncLogsModal.providerName}
      />
    </div>
  );
};

export default ExternalTrainingPage;
