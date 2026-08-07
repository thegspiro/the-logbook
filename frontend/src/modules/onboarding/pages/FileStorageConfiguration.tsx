import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { HardDrive, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api-client';
import {
  OnboardingHeader,
  ProgressIndicator,
  BackButton,
  ResetProgressButton,
  ErrorAlert,
  AutoSaveNotification,
} from '../components';
import { useApiRequest } from '../hooks';
import { useOnboardingStore } from '../store';

const inputClass =
  'w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder:text-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';
const labelClass = 'block text-xs font-medium text-theme-text-secondary mb-1';

interface FileStorageConfig {
  googleDriveClientId?: string;
  googleDriveClientSecret?: string;
  googleDriveFolderId?: string;

  oneDriveTenantId?: string;
  oneDriveClientId?: string;
  oneDriveClientSecret?: string;
  sharePointSiteUrl?: string;

  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3BucketName?: string;
  s3Region?: string;
  s3EndpointUrl?: string;

  localStoragePath?: string;
}

type FieldSpec = {
  key: keyof FileStorageConfig;
  label: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
  help?: string;
  fullWidth?: boolean;
};

/**
 * Per-platform credential fields. Keys are camelCase and map to the snake_case
 * FileStorageSettings fields when the session is persisted at completion.
 */
const PLATFORM_FIELDS: Record<string, { title: string; fields: FieldSpec[] }> = {
  googledrive: {
    title: 'Google Drive',
    fields: [
      { key: 'googleDriveClientId', label: 'OAuth Client ID', required: true, fullWidth: true },
      { key: 'googleDriveClientSecret', label: 'OAuth Client Secret', secret: true, required: true, fullWidth: true },
      {
        key: 'googleDriveFolderId',
        label: 'Root Folder ID',
        help: 'The folder documents are stored under. Leave blank to use the drive root.',
        fullWidth: true,
      },
    ],
  },
  onedrive: {
    title: 'OneDrive / SharePoint',
    fields: [
      { key: 'oneDriveTenantId', label: 'Tenant ID', required: true },
      { key: 'oneDriveClientId', label: 'Client ID', required: true },
      { key: 'oneDriveClientSecret', label: 'Client Secret', secret: true, required: true, fullWidth: true },
      {
        key: 'sharePointSiteUrl',
        label: 'SharePoint Site URL',
        placeholder: 'https://contoso.sharepoint.com/sites/fire',
        help: 'Only needed if documents live in a SharePoint document library.',
        fullWidth: true,
      },
    ],
  },
  s3: {
    title: 'Amazon S3',
    fields: [
      { key: 's3BucketName', label: 'Bucket Name', required: true },
      { key: 's3Region', label: 'Region', placeholder: 'us-east-1', required: true },
      { key: 's3AccessKeyId', label: 'Access Key ID', required: true, fullWidth: true },
      { key: 's3SecretAccessKey', label: 'Secret Access Key', secret: true, required: true, fullWidth: true },
      {
        key: 's3EndpointUrl',
        label: 'Custom Endpoint',
        placeholder: 'https://minio.example.org',
        help: 'For S3-compatible storage such as MinIO or Wasabi. Leave blank for AWS.',
        fullWidth: true,
      },
    ],
  },
  local: {
    title: 'Local Storage',
    fields: [
      {
        key: 'localStoragePath',
        label: 'Storage Path',
        placeholder: '/var/lib/logbook/uploads',
        help: 'Leave blank to use the server default. The path must be writable and included in your backups.',
        fullWidth: true,
      },
    ],
  },
};

/**
 * File storage configuration step.
 *
 * This replaced a placeholder that showed a green checkmark, said
 * "configuration can be done later in Settings", and redirected after two
 * seconds — while discarding the choice entirely. A department that picked S3
 * during setup silently ran on local disk.
 */
const FileStorageConfiguration: React.FC = () => {
  const navigate = useNavigate();
  const departmentName = useOnboardingStore(state => state.departmentName);
  const logoPreview = useOnboardingStore(state => state.logoData);
  const lastSaved = useOnboardingStore(state => state.lastSaved);
  const storedPlatform = useOnboardingStore(state => state.fileStoragePlatform);

  const [config, setConfig] = useState<FileStorageConfig>({});
  const { execute, isLoading, error, canRetry, clearError } = useApiRequest();

  const platform = storedPlatform || 'local';
  const spec = PLATFORM_FIELDS[platform];

  useEffect(() => {
    if (!departmentName) {
      void navigate('/onboarding/start');
    }
  }, [departmentName, navigate]);

  // A platform with no credential form has nothing to ask for.
  useEffect(() => {
    if (departmentName && !spec) {
      void navigate('/onboarding/authentication');
    }
  }, [departmentName, spec, navigate]);

  const missingRequired = (spec?.fields ?? [])
    .filter(field => field.required)
    // `||` not `??`: an untouched field is '', which must count as missing.
    .filter(field => !(config[field.key] || '').trim());

  const save = async (payload: FileStorageConfig) => {
    const { error: apiError } = await execute(
      async () => {
        const response = await apiClient.saveFileStorageConfig({
          platform,
          config: payload as Record<string, unknown>,
        });
        if (response.error) {
          throw new Error(response.error);
        }
        return response;
      },
      {
        step: 'File Storage Configuration',
        action: 'Save file storage credentials',
        userContext: `Platform: ${platform}`,
      }
    );
    return !apiError;
  };

  const handleContinue = async () => {
    clearError();
    if (missingRequired.length > 0) {
      toast.error(`Fill in ${missingRequired.map(f => f.label).join(', ')}`);
      return;
    }

    // Trim and drop empties so optional fields aren't stored as ''.
    const cleaned: FileStorageConfig = {};
    for (const field of spec?.fields ?? []) {
      const trimmed = (config[field.key] || '').trim();
      if (trimmed) {
        cleaned[field.key] = trimmed;
      }
    }

    if (!(await save(cleaned))) return;
    toast.success(`${spec?.title} configured`);
    void navigate('/onboarding/authentication');
  };

  const handleSkip = async () => {
    clearError();
    // Record the platform choice with no credentials rather than dropping the
    // step: an admin who skips still gets their platform saved, and the
    // Settings page shows exactly what is missing.
    if (!(await save({}))) return;
    toast('Saved without credentials — finish in Settings before uploading files.', {
      icon: '⚠️',
    });
    void navigate('/onboarding/authentication');
  };

  if (!spec) return null;

  return (
    <div className="min-h-screen bg-linear-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex flex-col safe-top">
      <OnboardingHeader
        departmentName={departmentName}
        logoPreview={logoPreview}
        icon={<HardDrive aria-hidden="true" className="w-6 h-6 text-white" />}
      />

      <main className="flex-1 flex items-start justify-center p-4 py-8">
        <div className="max-w-2xl w-full">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-3">
              <HardDrive className="w-7 h-7 text-red-500" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-bold text-theme-text-primary">
              Configure {spec.title}
            </h2>
            <p className="text-theme-text-secondary mt-2 text-sm max-w-lg mx-auto">
              These credentials let the app store documents, photos, and attachments in
              your {spec.title} account.
            </p>
          </div>

          {error && (
            <div className="mb-4">
              <ErrorAlert
                message={error}
                canRetry={canRetry}
                onRetry={() => void handleContinue()}
                onDismiss={clearError}
              />
            </div>
          )}

          <div className="card p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {spec.fields.map(field => (
                <div key={field.key} className={field.fullWidth ? 'sm:col-span-2' : ''}>
                  <label className={labelClass} htmlFor={field.key}>
                    {field.label}
                    {field.required && <span className="text-red-500"> *</span>}
                  </label>
                  <input
                    id={field.key}
                    type={field.secret ? 'password' : 'text'}
                    autoComplete={field.secret ? 'new-password' : 'off'}
                    className={inputClass}
                    value={config[field.key] || ''}
                    onChange={e =>
                      setConfig(prev => ({ ...prev, [field.key]: e.target.value }))
                    }
                    {...(field.placeholder ? { placeholder: field.placeholder } : {})}
                  />
                  {field.help && (
                    <p className="text-[11px] text-theme-text-muted mt-1">{field.help}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-start gap-2 mt-5 pt-4 border-t border-theme-surface-border">
              <ShieldCheck
                className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <p className="text-xs text-theme-text-muted">
                Secrets are encrypted with AES-256 before they are stored, and are never
                sent back to the browser once saved.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button
              onClick={() => void handleContinue()}
              disabled={isLoading}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : 'Save & Continue'}
            </button>
            <button
              onClick={() => void handleSkip()}
              disabled={isLoading}
              className="flex-1 px-4 py-3 rounded-lg border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover transition-colors disabled:opacity-50 mobile-touch-target"
            >
              I&apos;ll add these later
            </button>
          </div>

          <div className="flex items-center justify-between mt-6">
            <BackButton to="/onboarding/file-storage" />
            <ResetProgressButton />
          </div>

          <ProgressIndicator
            step="file_storage"
            className="mt-6 pt-6 border-t border-theme-nav-border"
          />
        </div>
      </main>

      <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mb-4" />
    </div>
  );
};

export default FileStorageConfiguration;
