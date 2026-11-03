/**
 * External Training Integrations Page
 *
 * Allows administrators to manage connections to external training platforms
 * like Vector Solutions, Target Solutions, Lexipol, etc.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useDialog } from '../hooks/useDialog';
import toast from 'react-hot-toast';
import { getErrorDetail, getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { useConfirm } from '../contexts/ConfirmContext';
import { formatDate, formatDateTime } from '../utils/dateFormatting';
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
  Power,
  Edit2,
  PlayCircle,
  Upload,
  GraduationCap,
  History,
} from 'lucide-react';
import { Tooltip } from '../components/ux';
import { externalTrainingService, trainingService, userService } from '../services/api';
import type {
  ExternalTrainingProvider,
  ExternalTrainingProviderCreate,
  ExternalProviderType,
  ExternalCategoryMapping,
  ExternalCourseMapping,
  ExternalUserMapping,
  ExternalTrainingImport,
  TrainingCategory,
  TrainingCourse,
} from '../types/training';
import type { User } from '../types/user';
import { useTablist } from '../hooks/useTablist';
import ExternalSyncHistoryPanel from '../components/training/ExternalSyncHistoryPanel';

type TabView = 'providers' | 'imports' | 'history' | 'mappings';

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

// Target Solutions' Training Records API: one GET returning a CSV of
// completions, authenticated by key and secret query parameters.
const TARGET_SOLUTIONS_REPORT_URL = 'https://app.targetsolutions.com/tsapp/api/';

// Target Solutions pulls recent completions every hour and re-checks the last
// 30 days once a day at its review time (config.review_time, read by the
// backend's review_time_for, which assumes this same default when unset).
const DEFAULT_REVIEW_TIME = '02:00';
const TS_DEFAULT_PULL_HOURS = 1;

interface SyncScheduleFieldsProps {
  idPrefix: string;
  intervalHours: number;
  // null hides the review time: only Target Solutions has a daily review.
  reviewTime: string | null;
  onChange: (next: { intervalHours: number; reviewTime: string | null }) => void;
}

const SyncScheduleFields: React.FC<SyncScheduleFieldsProps> = ({ idPrefix, intervalHours, reviewTime, onChange }) => {
  const tz = useTimezone();

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor={`${idPrefix}-sync-interval`}
          className="text-theme-text-secondary mb-2 block text-sm font-medium"
        >
          {reviewTime !== null ? 'Pull new completions' : 'Sync Interval'}
        </label>
        <select
          id={`${idPrefix}-sync-interval`}
          value={intervalHours}
          onChange={(e) => onChange({ intervalHours: parseInt(e.target.value), reviewTime })}
          className="form-input"
        >
          <option value={1}>Every hour</option>
          <option value={6}>Every 6 hours</option>
          <option value={12}>Every 12 hours</option>
          <option value={24}>Daily</option>
          <option value={48}>Every 2 days</option>
          <option value={168}>Weekly</option>
        </select>
      </div>

      {reviewTime !== null && (
        <div>
          <label
            htmlFor={`${idPrefix}-review-time`}
            className="text-theme-text-secondary mb-2 block text-sm font-medium"
          >
            Daily 30-day review at
          </label>
          <input
            id={`${idPrefix}-review-time`}
            type="time"
            value={reviewTime}
            onChange={(e) => onChange({ intervalHours, reviewTime: e.target.value || DEFAULT_REVIEW_TIME })}
            className="form-input w-40"
            required
          />
          <p className="text-theme-text-muted mt-1 text-xs">
            Each pull fetches completions since the last one. Once a day the review re-checks the last 30 days, which
            catches completions recorded for a past date. Times are in the department&apos;s timezone ({tz}); runs start
            within 30 minutes of their time.
          </p>
        </div>
      )}
    </div>
  );
};

interface CreateProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CreateProviderModal: React.FC<CreateProviderModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const dialogRef1 = useDialog<HTMLDivElement>({ isOpen, onClose });

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
  const isTargetSolutions = formData.provider_type === 'target_solutions';

  const handleTypeSelect = (type: ExternalProviderType) => {
    setFormData((prev) => ({
      ...prev,
      provider_type: type,
      name: PROVIDER_TYPES.find((p) => p.value === type)?.label || '',
      ...(type === 'target_solutions'
        ? {
            sync_interval_hours: TS_DEFAULT_PULL_HOURS,
            config: { ...prev.config, review_time: DEFAULT_REVIEW_TIME },
          }
        : {}),
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
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-provider-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div ref={dialogRef1} className="modal-panel max-h-[90dvh] w-full max-w-2xl overflow-y-auto">
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
                    : isTargetSolutions
                      ? TARGET_SOLUTIONS_REPORT_URL
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
              {isTargetSolutions && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  The Training Records API address, without the query string: {TARGET_SOLUTIONS_REPORT_URL}
                </p>
              )}
            </div>

            {formData.provider_type !== 'vector_solutions' && !isTargetSolutions && (
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
                    : isTargetSolutions
                      ? 'The key= value from your Training Records API URL'
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
              {isTargetSolutions && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  Target Solutions issues a Training Records API URL containing a key and a secret. Enter each value
                  separately; they are stored encrypted.
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

            {(formData.auth_type === 'basic' || isTargetSolutions) && (
              <div>
                <label
                  htmlFor="provider-api-secret"
                  className="text-theme-text-secondary mb-2 block text-sm font-medium"
                >
                  API Secret {isTargetSolutions && <span aria-hidden="true">*</span>}
                </label>
                <input
                  id="provider-api-secret"
                  type="password"
                  value={formData.api_secret || ''}
                  onChange={(e) => setFormData((prev) => ({ ...prev, api_secret: e.target.value }))}
                  className="form-input"
                  placeholder={
                    isTargetSolutions ? 'The secret= value from your Training Records API URL' : 'Enter your API secret'
                  }
                  required={isTargetSolutions}
                  aria-required={isTargetSolutions}
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
                    formData.auto_sync_enabled ? 'bg-red-800' : 'bg-theme-surface-border'
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
                <SyncScheduleFields
                  idPrefix="provider"
                  intervalHours={formData.sync_interval_hours ?? 24}
                  reviewTime={isTargetSolutions ? (formData.config?.review_time ?? DEFAULT_REVIEW_TIME) : null}
                  onChange={({ intervalHours, reviewTime }) =>
                    setFormData((prev) => ({
                      ...prev,
                      sync_interval_hours: intervalHours,
                      ...(reviewTime !== null ? { config: { ...prev.config, review_time: reviewTime } } : {}),
                    }))
                  }
                />
              )}
            </div>

            <div className="border-theme-surface-border flex flex-wrap justify-between gap-2 border-t pt-4">
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
  onUploadReport: (id: string, file: File) => void;
  onEdit: (provider: ExternalTrainingProvider) => void;
  onDelete: (id: string) => void;
  onViewMappings: (id: string) => void;
  isTestingConnection: boolean;
  isSyncingCategories: boolean;
  isSyncing: boolean;
  isUploading: boolean;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  onTestConnection,
  onSyncCategories,
  onSync,
  onUploadReport,
  onEdit,
  onDelete,
  onViewMappings,
  isTestingConnection,
  isSyncingCategories,
  isSyncing,
  isUploading,
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
    <div className="card p-6">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-theme-surface-secondary rounded-lg p-2">
            <Link2 className="h-6 w-6 text-red-500" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-theme-text-primary text-lg font-semibold">{provider.name}</h2>
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
            {/* Focusable so a keyboard user can open the tooltip too; role="img"
                because an aria-label on a role-less span is not announced. */}
            <span role="img" aria-label={getStatusLabel()} tabIndex={0} className="flex rounded">
              {getStatusIcon()}
            </span>
          </Tooltip>
          <span
            className={`text-sm ${provider.active ? 'text-green-800 dark:text-green-400' : 'text-theme-text-muted'}`}
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
            {!provider.auto_sync_enabled
              ? 'Disabled'
              : provider.provider_type === 'target_solutions'
                ? `Every ${provider.sync_interval_hours}h · review daily at ${provider.config?.review_time ?? DEFAULT_REVIEW_TIME}`
                : `Every ${provider.sync_interval_hours}h`}
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
        {provider.provider_type === 'target_solutions' && (
          // A completions report downloaded from Target Solutions, for when the
          // API is not set up or not answering. It needs no key or secret.
          <label
            className={`bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary focus-within:ring-theme-focus-ring flex items-center gap-2 rounded-lg px-3 py-2 text-sm focus-within:ring-2 ${
              isUploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'
            }`}
          >
            {isUploading ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-4 w-4" aria-hidden="true" />
            )}
            Upload Report
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={isUploading}
              aria-label="Upload a Target Solutions completions report (CSV)"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Cleared so choosing the same file again still fires onChange.
                e.target.value = '';
                if (file) onUploadReport(provider.id, file);
              }}
            />
          </label>
        )}
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
          className="bg-theme-surface text-theme-text-primary flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-red-800"
          aria-label="Deactivate provider"
          title="Deactivate"
        >
          <Power className="h-4 w-4" aria-hidden="true" />
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
  const dialogRef2 = useDialog<HTMLDivElement>({ isOpen: isOpen && Boolean(provider), onClose });

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    api_base_url: '',
    api_key: '',
    api_secret: '',
    auth_type: 'api_key' as 'api_key' | 'basic' | 'oauth2',
    review_time: null as string | null,
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
        review_time:
          provider.provider_type === 'target_solutions' ? (provider.config?.review_time ?? DEFAULT_REVIEW_TIME) : null,
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
      // The update replaces the stored config wholesale, so a schedule change
      // is sent on top of the existing settings (Site ID, endpoints, …).
      if (formData.review_time !== null && formData.review_time !== (provider.config?.review_time ?? null)) {
        updates.config = { ...(provider.config ?? {}), review_time: formData.review_time };
      }
      await externalTrainingService.updateProvider(provider.id, updates);
      toast.success('Provider updated');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to update provider');
      const detail = getErrorDetail(err);
      setError(detail || message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !provider) return null;

  return (
    <div
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-provider-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div ref={dialogRef2} className="modal-panel max-h-[90dvh] w-full max-w-2xl overflow-y-auto">
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

          {(formData.auth_type === 'basic' || provider?.provider_type === 'target_solutions') && (
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
                  formData.auto_sync_enabled ? 'bg-red-800' : 'bg-theme-surface-border'
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
              <SyncScheduleFields
                idPrefix="edit-provider"
                intervalHours={formData.sync_interval_hours}
                reviewTime={formData.review_time}
                onChange={({ intervalHours, reviewTime }) =>
                  setFormData((prev) => ({ ...prev, sync_interval_hours: intervalHours, review_time: reviewTime }))
                }
              />
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

/**
 * Unmapped rows first, each group in the order the API returned it. Settled
 * once, when the list loads, rather than at every render: a row the officer
 * has just mapped stays where their eyes are until the modal is reopened,
 * instead of dropping to the foot of a 300-row list the moment they pick a
 * member — which would hide a mis-click they still want to correct.
 */
const unmappedFirst = <T extends { is_mapped: boolean }>(items: T[]): T[] => [
  ...items.filter((item) => !item.is_mapped),
  ...items.filter((item) => item.is_mapped),
];

interface MappingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  providerName: string;
}

const MappingsModal: React.FC<MappingsModalProps> = ({ isOpen, onClose, providerId, providerName }) => {
  const tablist = useTablist();
  const dialogRef3 = useDialog<HTMLDivElement>({ isOpen, onClose });

  const [activeTab, setActiveTab] = useState<'categories' | 'users' | 'courses'>('categories');
  const [categoryMappings, setCategoryMappings] = useState<ExternalCategoryMapping[]>([]);
  const [userMappings, setUserMappings] = useState<ExternalUserMapping[]>([]);
  // The internal categories an external one can be pointed at. Without them the
  // Map Category button had nothing to offer and did nothing at all.
  const [internalCategories, setInternalCategories] = useState<TrainingCategory[]>([]);
  // The members an external user can be pointed at. Without them the Map User
  // button had nobody to offer and did nothing at all — the same gap the
  // category picker above once had.
  const [members, setMembers] = useState<User[]>([]);
  // A provider course maps to a library course, which is what requirements
  // link to — so a new version of a course is mapped here, never by editing
  // the requirement.
  const [courseMappings, setCourseMappings] = useState<ExternalCourseMapping[]>([]);
  const [libraryCourses, setLibraryCourses] = useState<TrainingCourse[]>([]);
  const [savingMappingId, setSavingMappingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMappings = useCallback(async () => {
    setLoading(true);
    try {
      const [categories, users, internal, roster, courses, library] = await Promise.all([
        externalTrainingService.getCategoryMappings(providerId),
        externalTrainingService.getUserMappings(providerId),
        trainingService.getCategories(),
        userService.getUsers(),
        externalTrainingService.getCourseMappings(providerId),
        trainingService.getCourses(true),
      ]);
      setCategoryMappings(unmappedFirst(categories));
      setUserMappings(unmappedFirst(users));
      setInternalCategories(internal);
      setMembers(roster);
      setCourseMappings(unmappedFirst(courses));
      setLibraryCourses(library);
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
        internal_category_id: internalCategoryId || null,
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

  const mapUser = async (mapping: ExternalUserMapping, internalUserId: string) => {
    setSavingMappingId(mapping.id);
    const externalLabel = mapping.external_name || mapping.external_username || mapping.external_user_id;
    try {
      // null, not undefined: the endpoint reads an omitted key as "leave the
      // mapping alone", so "Not mapped" has to send an explicit null to clear it.
      const updated = await externalTrainingService.updateUserMapping(providerId, mapping.id, {
        internal_user_id: internalUserId || null,
      });
      setUserMappings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      toast.success(
        internalUserId
          ? `${externalLabel}'s training now imports for ${updated.internal_user_name ?? 'the chosen member'}`
          : `${externalLabel} is unmapped again`
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the member mapping'));
    } finally {
      setSavingMappingId(null);
    }
  };

  const mapCourse = async (mapping: ExternalCourseMapping, internalCourseId: string) => {
    setSavingMappingId(mapping.id);
    try {
      // null, not undefined: an omitted key reads as "leave it alone".
      const updated = await externalTrainingService.updateCourseMapping(providerId, mapping.id, {
        internal_course_id: internalCourseId || null,
      });
      setCourseMappings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      const moved = updated.records_updated ?? 0;
      const records = moved ? `; ${moved} training record${moved === 1 ? '' : 's'} updated` : '';
      toast.success(
        internalCourseId
          ? `"${mapping.external_course_name}" now counts as ${updated.internal_course_name ?? 'the chosen course'}${records}`
          : `"${mapping.external_course_name}" is unmapped again${records}`
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the course mapping'));
    } finally {
      setSavingMappingId(null);
    }
  };

  const memberLabel = (member: User) => {
    const name = member.full_name || `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || member.username;
    return member.membership_number ? `${name} (#${member.membership_number})` : name;
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mappings-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div ref={dialogRef3} className="modal-panel flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden">
        <div className="border-theme-surface-border border-b p-6">
          <h2 id="mappings-modal-title" className="text-theme-text-primary text-2xl font-bold">
            Mappings - {providerName}
          </h2>
          <p className="text-theme-text-muted mt-1 text-sm">
            Map external categories, users and courses to your internal records
          </p>
        </div>

        {/* shrink-0: tab-scroll is overflow-x:auto, which lets a flex child
            shrink below its content, while the flex-1 body below has a zero
            basis and never shrinks. With hundreds of rows the tab bar was the
            one child that gave, collapsing to a sliver under the header. */}
        <div className="tab-scroll shrink-0" role="tablist" {...tablist} aria-label="Mapping types">
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
          <button
            onClick={() => setActiveTab('courses')}
            role="tab"
            aria-selected={activeTab === 'courses'}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'courses'
                ? 'border-b-2 border-red-500 text-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <GraduationCap className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
            Courses ({courseMappings.filter((m) => !m.is_mapped).length} unmapped)
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6" role="tabpanel">
          {loading ? (
            <div className="text-theme-text-muted py-8 text-center" role="status" aria-live="polite">
              Loading mappings...
            </div>
          ) : activeTab === 'courses' ? (
            <div className="space-y-3">
              <p className="text-theme-text-muted text-sm">
                Map each course to a course in your library. Requirements link to the library course, so when a new
                version arrives under a new Course ID, map it to the same course and members who completed it are
                credited.
              </p>
              {courseMappings.length === 0 ? (
                <p className="text-theme-text-muted py-8 text-center">
                  No courses yet. Run a sync or upload a report to discover courses.
                </p>
              ) : (
                courseMappings.map((mapping) => {
                  const suggestion =
                    !mapping.is_mapped && mapping.suggested_course_id && mapping.suggested_course_name
                      ? { id: mapping.suggested_course_id, name: mapping.suggested_course_name }
                      : null;
                  return (
                    <div
                      key={mapping.id}
                      className={`rounded-lg border p-4 ${
                        mapping.is_mapped
                          ? 'bg-theme-surface-secondary border-theme-surface-border'
                          : 'border-yellow-500/30 bg-yellow-500/10'
                      }`}
                    >
                      <div className="split-row gap-3 sm:items-center">
                        <div className="split-row-main">
                          <p className="text-theme-text-primary font-medium">{mapping.external_course_name}</p>
                          <p className="text-theme-text-muted text-xs">
                            Course ID: {mapping.external_course_id} | {mapping.members_completed} member
                            {mapping.members_completed === 1 ? '' : 's'} completed
                          </p>
                        </div>
                        <div className="split-row-aside flex flex-wrap items-center gap-2">
                          {mapping.is_mapped && (
                            <span className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400">
                              <CheckCircle className="h-4 w-4" aria-hidden="true" />
                              Mapped
                            </span>
                          )}
                          <select
                            value={mapping.internal_course_id ?? ''}
                            disabled={savingMappingId === mapping.id}
                            onChange={(e) => {
                              void mapCourse(mapping, e.target.value);
                            }}
                            aria-label={`Library course for ${mapping.external_course_name}`}
                            className="form-input-sm w-full sm:w-56"
                          >
                            <option value="">Not mapped</option>
                            {/* A course retired from the library still holds
                                this mapping; without it the select would read
                                "Not mapped" while records still count toward it. */}
                            {mapping.internal_course_id &&
                              !libraryCourses.some((c) => c.id === mapping.internal_course_id) && (
                                <option value={mapping.internal_course_id}>
                                  {mapping.internal_course_name ?? 'A retired course'}
                                </option>
                              )}
                            {libraryCourses.map((course) => (
                              <option key={course.id} value={course.id}>
                                {course.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {suggestion && (
                        <div className="split-row mt-3 gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 p-3 sm:items-center">
                          <p className="split-row-main text-theme-text-primary text-sm">
                            Looks like <strong>{suggestion.name}</strong> in your library — likely a new version of it.
                          </p>
                          <button
                            onClick={() => {
                              void mapCourse(mapping, suggestion.id);
                            }}
                            disabled={savingMappingId === mapping.id}
                            className="split-row-aside btn-primary px-3 text-sm whitespace-nowrap"
                          >
                            Map to {suggestion.name}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
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
                    <div className="split-row gap-3 sm:items-center">
                      <div className="split-row-main">
                        <p className="text-theme-text-primary font-medium">{mapping.external_category_name}</p>
                        <p className="text-theme-text-muted text-xs">
                          External ID: {mapping.external_category_id}
                          {mapping.external_category_code && ` | Code: ${mapping.external_category_code}`}
                        </p>
                      </div>
                      <div className="split-row-aside flex flex-wrap items-center gap-2">
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
                          className="form-input-sm w-full sm:w-56"
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
                    <div className="split-row gap-3 sm:items-center">
                      <div className="split-row-main">
                        <p className="text-theme-text-primary font-medium">
                          {mapping.external_name || mapping.external_username || 'Unknown User'}
                        </p>
                        <p className="text-theme-text-muted text-xs">
                          {mapping.external_email && `Email: ${mapping.external_email} | `}
                          External ID: {mapping.external_user_id}
                        </p>
                      </div>
                      <div className="split-row-aside flex flex-wrap items-center gap-2">
                        {mapping.is_mapped && (
                          <span className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400">
                            <CheckCircle className="h-4 w-4" aria-hidden="true" />
                            Mapped
                            {mapping.auto_mapped && <span className="text-xs">(auto)</span>}
                          </span>
                        )}
                        <select
                          value={mapping.internal_user_id ?? ''}
                          disabled={savingMappingId === mapping.id}
                          onChange={(e) => {
                            void mapUser(mapping, e.target.value);
                          }}
                          aria-label={`Member for ${mapping.external_name || mapping.external_username || mapping.external_user_id}`}
                          className="form-input-sm w-full sm:w-56"
                        >
                          <option value="">Not mapped</option>
                          {/* A member the roster no longer lists (deleted since)
                              would otherwise leave the select showing "Not
                              mapped" while the mapping still credits them. */}
                          {mapping.internal_user_id && !members.some((m) => m.id === mapping.internal_user_id) && (
                            <option value={mapping.internal_user_id}>
                              {mapping.internal_user_name ?? 'A former member'}
                            </option>
                          )}
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {memberLabel(member)}
                            </option>
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

        <div className="border-theme-surface-border flex justify-end border-t p-4">
          <button onClick={onClose} className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

interface ProviderMappingSummary {
  providerId: string;
  categories: ExternalCategoryMapping[];
  users: ExternalUserMapping[];
  courses: ExternalCourseMapping[];
  failed: boolean;
}

const UNMAPPED_PREVIEW_LIMIT = 5;

interface MappingCountProps {
  label: string;
  items: { is_mapped: boolean }[];
  unmappedNames: string[];
}

const MappingCount: React.FC<MappingCountProps> = ({ label, items, unmappedNames }) => {
  const unmapped = items.filter((item) => !item.is_mapped).length;
  const shown = unmappedNames.slice(0, UNMAPPED_PREVIEW_LIMIT);
  const hidden = unmappedNames.length - shown.length;

  return (
    <div>
      <p className="text-theme-text-muted text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="text-theme-text-primary text-sm">
        {items.length - unmapped} of {items.length} mapped
      </p>
      {unmapped > 0 && (
        <>
          <p className="mt-1 text-xs font-medium text-yellow-700 dark:text-yellow-400">{unmapped} unmapped</p>
          <ul className="text-theme-text-muted mt-1 space-y-0.5 text-xs">
            {shown.map((name, index) => (
              <li key={`${name}-${index}`} className="truncate">
                {name}
              </li>
            ))}
            {hidden > 0 && <li>and {hidden} more</li>}
          </ul>
        </>
      )}
    </div>
  );
};

interface AllMappingsPanelProps {
  providers: ExternalTrainingProvider[];
  // Bumped by the page when the mappings modal closes, so edits made there
  // show up here without leaving the tab.
  refreshKey: number;
  onOpenMappings: (providerId: string) => void;
}

const AllMappingsPanel: React.FC<AllMappingsPanelProps> = ({ providers, refreshKey, onOpenMappings }) => {
  const [summaries, setSummaries] = useState<Record<string, ProviderMappingSummary>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const entries = await Promise.all(
        providers.map(async (provider): Promise<ProviderMappingSummary> => {
          const [categories, users, courses] = await Promise.allSettled([
            externalTrainingService.getCategoryMappings(provider.id),
            externalTrainingService.getUserMappings(provider.id),
            externalTrainingService.getCourseMappings(provider.id),
          ]);
          return {
            providerId: provider.id,
            categories: categories.status === 'fulfilled' ? categories.value : [],
            users: users.status === 'fulfilled' ? users.value : [],
            courses: courses.status === 'fulfilled' ? courses.value : [],
            failed: [categories, users, courses].some((r) => r.status === 'rejected'),
          };
        })
      );
      if (cancelled) return;
      setSummaries(Object.fromEntries(entries.map((entry) => [entry.providerId, entry])));
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [providers, refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading mappings...</span>
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <div className="card p-8 text-center" role="tabpanel">
        <FolderTree className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
        <h2 className="text-theme-text-primary mb-2 text-lg font-semibold">No Mappings Yet</h2>
        <p className="text-theme-text-muted">
          Add a provider and sync it; its categories, users and courses appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" role="tabpanel">
      {providers.map((provider) => {
        const summary = summaries[provider.id];
        if (!summary) return null;
        return (
          <section key={provider.id} className="card p-6" aria-labelledby={`all-mappings-${provider.id}`}>
            <div className="split-row mb-4 gap-3 sm:items-center">
              <h2
                id={`all-mappings-${provider.id}`}
                className="split-row-main text-theme-text-primary text-lg font-semibold"
              >
                {provider.name}
              </h2>
              <button
                onClick={() => onOpenMappings(provider.id)}
                aria-label={`Open mappings for ${provider.name}`}
                className="split-row-aside btn-primary flex shrink-0 items-center gap-2 self-start sm:self-auto"
              >
                <FolderTree className="h-4 w-4" aria-hidden="true" />
                Open mappings
              </button>
            </div>
            {summary.failed && (
              <p className="alert-warning mb-4 text-sm" role="alert">
                Some mappings for this provider could not be loaded. Counts may be incomplete.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <MappingCount
                label="Categories"
                items={summary.categories}
                unmappedNames={summary.categories.filter((m) => !m.is_mapped).map((m) => m.external_category_name)}
              />
              <MappingCount
                label="Users"
                items={summary.users}
                unmappedNames={summary.users
                  .filter((m) => !m.is_mapped)
                  .map((m) => m.external_name || m.external_email || m.external_user_id)}
              />
              <MappingCount
                label="Courses"
                items={summary.courses}
                unmappedNames={summary.courses.filter((m) => !m.is_mapped).map((m) => m.external_course_name)}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
};

interface ProviderImportSummary {
  providerId: string;
  pending: ExternalTrainingImport[];
  failed: ExternalTrainingImport[];
  failedToLoad: boolean;
}

// Matches the endpoint's maximum page, so a count at this size is a floor.
const IMPORT_QUEUE_FETCH_LIMIT = 200;

const formatQueueCount = (items: unknown[]): string =>
  items.length >= IMPORT_QUEUE_FETCH_LIMIT ? `${IMPORT_QUEUE_FETCH_LIMIT}+` : String(items.length);

interface ImportQueueListProps {
  label: string;
  items: ExternalTrainingImport[];
  showError: boolean;
}

const ImportQueueList: React.FC<ImportQueueListProps> = ({ label, items, showError }) => {
  const tz = useTimezone();
  const shown = items.slice(0, UNMAPPED_PREVIEW_LIMIT);
  const hidden = items.length - shown.length;

  return (
    <div>
      <p className="text-theme-text-muted text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="text-theme-text-primary text-sm">{formatQueueCount(items)}</p>
      {shown.length > 0 && (
        <ul className="text-theme-text-muted mt-1 space-y-1 text-xs">
          {shown.map((item) => (
            <li key={item.id}>
              <span className="text-theme-text-primary block truncate">{item.course_title}</span>
              {item.completion_date ? formatDate(item.completion_date, tz) : 'No completion date'}
              {showError && item.import_error ? ` — ${item.import_error}` : ''}
            </li>
          ))}
          {hidden > 0 && <li>{items.length >= IMPORT_QUEUE_FETCH_LIMIT ? 'and more' : `and ${hidden} more`}</li>}
        </ul>
      )}
    </div>
  );
};

interface ImportQueuePanelProps {
  providers: ExternalTrainingProvider[];
  // Bumped when the mappings modal closes: matching a member there is what
  // moves a record out of the queue.
  refreshKey: number;
  onOpenMappings: (providerId: string) => void;
}

const ImportQueuePanel: React.FC<ImportQueuePanelProps> = ({ providers, refreshKey, onOpenMappings }) => {
  const [summaries, setSummaries] = useState<Record<string, ProviderImportSummary>>({});
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [importingProvider, setImportingProvider] = useState<string | null>(null);

  const handleImportMatched = async (providerId: string) => {
    setImportingProvider(providerId);
    try {
      const result = await externalTrainingService.importMatched(providerId);
      if (result.failed > 0) {
        toast.error(`Imported ${result.imported} records; ${result.failed} failed. See the Failed list for details.`);
      } else {
        toast.success(`Imported ${result.imported} records`);
      }
      setReloadKey((key) => key + 1);
    } catch (err: unknown) {
      toast.error(`Import failed: ${getErrorMessage(err)}`);
    } finally {
      setImportingProvider(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const entries = await Promise.all(
        providers.map(async (provider): Promise<ProviderImportSummary> => {
          const [pending, failed] = await Promise.allSettled([
            externalTrainingService.getImportedRecords(provider.id, {
              status: 'pending',
              limit: IMPORT_QUEUE_FETCH_LIMIT,
            }),
            externalTrainingService.getImportedRecords(provider.id, {
              status: 'failed',
              limit: IMPORT_QUEUE_FETCH_LIMIT,
            }),
          ]);
          return {
            providerId: provider.id,
            pending: pending.status === 'fulfilled' ? pending.value : [],
            failed: failed.status === 'fulfilled' ? failed.value : [],
            failedToLoad: pending.status === 'rejected' || failed.status === 'rejected',
          };
        })
      );
      if (cancelled) return;
      setSummaries(Object.fromEntries(entries.map((entry) => [entry.providerId, entry])));
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [providers, refreshKey, reloadKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading import queue...</span>
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <div className="card p-8 text-center" role="tabpanel">
        <Download className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
        <h2 className="text-theme-text-primary mb-2 text-lg font-semibold">Import Queue</h2>
        <p className="text-theme-text-muted">
          After syncing, pending imports will appear here for review and processing
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" role="tabpanel">
      {providers.map((provider) => {
        const summary = summaries[provider.id];
        if (!summary) return null;
        return (
          <section key={provider.id} className="card p-6" aria-labelledby={`import-queue-${provider.id}`}>
            <div className="split-row mb-4 gap-3 sm:items-center">
              <h2
                id={`import-queue-${provider.id}`}
                className="split-row-main text-theme-text-primary text-lg font-semibold"
              >
                {provider.name}
              </h2>
              <div className="split-row-aside flex flex-wrap gap-2 self-start sm:self-auto">
                <button
                  onClick={() => void handleImportMatched(provider.id)}
                  disabled={importingProvider === provider.id}
                  aria-label={`Import matching pending records for ${provider.name}`}
                  className="btn-primary flex shrink-0 items-center gap-2"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {importingProvider === provider.id ? 'Importing...' : 'Import matching pending records'}
                </button>
                <button
                  onClick={() => onOpenMappings(provider.id)}
                  aria-label={`Open mappings for ${provider.name}`}
                  className="btn-primary flex shrink-0 items-center gap-2"
                >
                  <FolderTree className="h-4 w-4" aria-hidden="true" />
                  Open mappings
                </button>
              </div>
            </div>
            {summary.failedToLoad && (
              <p className="alert-warning mb-4 text-sm" role="alert">
                Some imports for this provider could not be loaded. Counts may be incomplete.
              </p>
            )}
            {summary.pending.length === 0 && summary.failed.length === 0 ? (
              <p className="text-theme-text-muted text-sm">Nothing waiting. Every synced record has been handled.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <ImportQueueList label="Waiting for review" items={summary.pending} showError={false} />
                <ImportQueueList label="Failed" items={summary.failed} showError />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};

const ExternalTrainingPage: React.FC = () => {
  const tablist = useTablist();
  // Never window.confirm: a browser that suppresses it returns false, which is
  // indistinguishable from the officer pressing Cancel.
  const { confirm } = useConfirm();
  const [activeTab, setActiveTab] = useState<TabView>('providers');
  const [providers, setProviders] = useState<ExternalTrainingProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [uploadingProvider, setUploadingProvider] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<{ isOpen: boolean; provider: ExternalTrainingProvider | null }>({
    isOpen: false,
    provider: null,
  });
  const [mappingsModal, setMappingsModal] = useState<{ isOpen: boolean; providerId: string; providerName: string }>({
    isOpen: false,
    providerId: '',
    providerName: '',
  });

  const [mappingsRefreshKey, setMappingsRefreshKey] = useState(0);

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
      toast.success(result.message || 'Categories synced');
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

  const handleUploadReport = async (providerId: string, file: File) => {
    setUploadingProvider(providerId);
    try {
      const result = await externalTrainingService.uploadReport(providerId, file);
      toast.success(`Report uploaded: ${result.message}`);
      void loadProviders();
    } catch (err: unknown) {
      toast.error(`Upload failed: ${getErrorMessage(err)}`);
    } finally {
      setUploadingProvider(null);
    }
  };

  const handleEdit = (provider: ExternalTrainingProvider) => {
    setEditModal({ isOpen: true, provider });
  };

  // The backend only deactivates a provider (it stays listed as Inactive and
  // its imported records are kept), so the dialog must not promise removal.
  const handleDelete = async (providerId: string) => {
    const providerName = providers.find((p) => p.id === providerId)?.name || 'this integration';
    const agreed = await confirm({
      title: `Deactivate ${providerName}?`,
      message:
        'It stops syncing, and no further records are pulled or uploaded through it. Training records already imported through it are kept, and the integration stays listed here as Inactive.',
      confirmLabel: 'Deactivate integration',
      cancelLabel: 'Keep it active',
      variant: 'danger',
    });
    if (!agreed) return;
    try {
      await externalTrainingService.deleteProvider(providerId);
      await loadProviders();
      toast.success('Integration deactivated');
    } catch (err: unknown) {
      toast.error(`Failed to deactivate: ${getErrorMessage(err)}`);
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
    // Rendered only as the Integrations tab of Training Administration, whose
    // content column already supplies the side padding; `p-6` here indented
    // the whole tab a second time on a phone.
    <div className="min-h-screen">
      <div className="py-6">
        {/* The hub's section nav already names this page, so the title stays for
            heading navigation only; the line under it says what the nav does not. */}
        <div className="split-row mb-6 gap-4 sm:items-center">
          <div className="split-row-main">
            <h2 className="sr-only">External Training Integrations</h2>
            <p className="text-theme-text-muted">
              Connect external training platforms to automatically sync completed training records
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="split-row-aside btn-primary flex shrink-0 items-center gap-2 self-start sm:self-auto"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
            Add Provider
          </button>
        </div>

        {/* Tabs */}
        <div
          className="tab-scroll mb-6"
          role="tablist"
          {...tablist}
          aria-label="External training views"
          data-mobile-scroll-region
        >
          <button
            onClick={() => setActiveTab('providers')}
            role="tab"
            aria-selected={activeTab === 'providers'}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${
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
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${
              activeTab === 'imports'
                ? 'border-b-2 border-red-500 text-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <Download className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
            Import Queue
          </button>
          <button
            onClick={() => setActiveTab('history')}
            role="tab"
            aria-selected={activeTab === 'history'}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${
              activeTab === 'history'
                ? 'border-b-2 border-red-500 text-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <History className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
            Sync History
          </button>
          <button
            onClick={() => setActiveTab('mappings')}
            role="tab"
            aria-selected={activeTab === 'mappings'}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${
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
              <div className="card col-span-2 py-12 text-center">
                <Link2 className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
                <h2 className="text-theme-text-primary mb-2 text-lg font-semibold">No Integrations Yet</h2>
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
                  onUploadReport={(id, file) => {
                    void handleUploadReport(id, file);
                  }}
                  onEdit={handleEdit}
                  onDelete={(id) => {
                    void handleDelete(id);
                  }}
                  onViewMappings={handleViewMappings}
                  isTestingConnection={testingProvider === provider.id}
                  isSyncingCategories={syncingCategoriesProvider === provider.id}
                  isSyncing={syncingProvider === provider.id}
                  isUploading={uploadingProvider === provider.id}
                />
              ))
            )}
          </div>
        ) : activeTab === 'imports' ? (
          <ImportQueuePanel providers={providers} refreshKey={mappingsRefreshKey} onOpenMappings={handleViewMappings} />
        ) : activeTab === 'history' ? (
          <ExternalSyncHistoryPanel providers={providers} />
        ) : (
          <AllMappingsPanel providers={providers} refreshKey={mappingsRefreshKey} onOpenMappings={handleViewMappings} />
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
        onClose={() => {
          setMappingsModal((prev) => ({ ...prev, isOpen: false }));
          setMappingsRefreshKey((key) => key + 1);
        }}
        providerId={mappingsModal.providerId}
        providerName={mappingsModal.providerName}
      />
    </div>
  );
};

export default ExternalTrainingPage;
