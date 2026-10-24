import React from 'react';
import { Loader2, Cloud, Database, HardDrive, Info, Eye, EyeOff } from 'lucide-react';
import type { FileStorageSettings } from '../../types/user';
import StorageLocationPanel from './StorageLocationPanel';

interface StorageSettingsSectionProps {
  storageSettings: FileStorageSettings;
  onStorageSettingsChange: React.Dispatch<React.SetStateAction<FileStorageSettings>>;
  savingStorage: boolean;
  storageSecretVisible: boolean;
  onToggleSecretVisible: () => void;
  onSave: () => void;
}

const StorageSettingsSection: React.FC<StorageSettingsSectionProps> = ({
  storageSettings,
  onStorageSettingsChange,
  savingStorage,
  storageSecretVisible,
  onToggleSecretVisible,
  onSave,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-theme-text-primary text-lg font-semibold">File Storage</h3>
        <p className="text-theme-text-muted mt-1 text-sm">Where department files, documents, and images are stored.</p>
      </div>

      {/* Info banner */}
      <div className="border-theme-accent-blue/20 bg-theme-accent-blue-muted flex items-start gap-3 rounded-lg border p-4">
        <Info className="text-theme-accent-blue mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-theme-text-secondary text-sm">
          First set during onboarding. Choosing Amazon S3 takes effect only after the connection test below passes with
          the settings you saved.
        </p>
      </div>

      <StorageLocationPanel savingStorage={savingStorage} />

      {/* Platform selection */}
      <div>
        <label className="text-theme-text-primary mb-2 block text-sm font-medium">Storage Platform</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(
            [
              { id: 'googledrive', label: 'Google Drive', icon: <Cloud className="h-4 w-4" /> },
              { id: 'onedrive', label: 'OneDrive', icon: <Cloud className="h-4 w-4" /> },
              { id: 's3', label: 'Amazon S3', icon: <Database className="h-4 w-4" /> },
              { id: 'local', label: 'Local Storage', icon: <HardDrive className="h-4 w-4" /> },
              { id: 'other', label: 'Other', icon: <HardDrive className="h-4 w-4" /> },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onStorageSettingsChange((s) => ({ ...s, platform: p.id }))}
              className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                storageSettings.platform === p.id
                  ? 'border-theme-accent-blue bg-theme-accent-blue-muted text-theme-accent-blue'
                  : 'border-theme-surface-border text-theme-text-secondary hover:border-theme-surface-hover'
              }`}
            >
              {p.icon}
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Google Drive config */}
      {storageSettings.platform === 'googledrive' && (
        <div className="border-theme-surface-border space-y-4 border-t pt-4">
          <p className="text-theme-text-primary text-sm font-medium">Google Drive (Shared Drive)</p>
          <p className="text-theme-text-muted text-xs">
            The server signs in as a service account and stores files in a Shared Drive. Add the service account to the
            drive as a Content manager. Shared Drives need Google Workspace.
          </p>
          <div>
            <label htmlFor="google-drive-key" className="text-theme-text-muted mb-1 block text-xs">
              Service account key (JSON)
            </label>
            <div className="relative">
              {storageSecretVisible ? (
                <textarea
                  id="google-drive-key"
                  rows={5}
                  spellCheck={false}
                  autoComplete="off"
                  value={storageSettings.google_drive_service_account_key || ''}
                  onChange={(e) =>
                    onStorageSettingsChange((s) => ({ ...s, google_drive_service_account_key: e.target.value }))
                  }
                  placeholder='{"type": "service_account", …}'
                  className="form-input pr-10 font-mono text-xs"
                />
              ) : (
                <input
                  id="google-drive-key"
                  type="password"
                  autoComplete="new-password"
                  value={storageSettings.google_drive_service_account_key || ''}
                  onChange={(e) =>
                    onStorageSettingsChange((s) => ({ ...s, google_drive_service_account_key: e.target.value }))
                  }
                  placeholder="Paste the key file’s contents"
                  className="form-input pr-10"
                />
              )}
              <button
                type="button"
                onClick={onToggleSecretVisible}
                aria-label={storageSecretVisible ? 'Hide the key' : 'Show the key'}
                className="text-theme-text-muted hover:text-theme-text-primary absolute top-2 right-2"
              >
                {storageSecretVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="google-drive-shared-drive" className="text-theme-text-muted mb-1 block text-xs">
                Shared Drive ID
              </label>
              <input
                id="google-drive-shared-drive"
                type="text"
                value={storageSettings.google_drive_shared_drive_id || ''}
                onChange={(e) =>
                  onStorageSettingsChange((s) => ({ ...s, google_drive_shared_drive_id: e.target.value }))
                }
                placeholder="0AbCdEfGhIjKlMnOp"
                className="form-input"
              />
              <p className="text-theme-text-muted mt-1 text-xs">From the drive’s address: drive/folders/&lt;ID&gt;.</p>
            </div>
            <div>
              <label htmlFor="google-drive-folder" className="text-theme-text-muted mb-1 block text-xs">
                Folder ID (optional)
              </label>
              <input
                id="google-drive-folder"
                type="text"
                value={storageSettings.google_drive_folder_id || ''}
                onChange={(e) => onStorageSettingsChange((s) => ({ ...s, google_drive_folder_id: e.target.value }))}
                placeholder="Blank for the drive’s root"
                className="form-input"
              />
            </div>
          </div>
        </div>
      )}

      {/* OneDrive config */}
      {storageSettings.platform === 'onedrive' && (
        <div className="border-theme-surface-border space-y-4 border-t pt-4">
          <p className="text-theme-text-primary text-sm font-medium">OneDrive / SharePoint Configuration</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Tenant ID</label>
              <input
                type="text"
                value={storageSettings.onedrive_tenant_id || ''}
                onChange={(e) => onStorageSettingsChange((s) => ({ ...s, onedrive_tenant_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="form-input"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Client ID</label>
              <input
                type="text"
                value={storageSettings.onedrive_client_id || ''}
                onChange={(e) => onStorageSettingsChange((s) => ({ ...s, onedrive_client_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="form-input"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Client Secret</label>
              <div className="relative">
                <input
                  type={storageSecretVisible ? 'text' : 'password'}
                  value={storageSettings.onedrive_client_secret || ''}
                  onChange={(e) => onStorageSettingsChange((s) => ({ ...s, onedrive_client_secret: e.target.value }))}
                  className="form-input pr-10"
                />
                <button
                  type="button"
                  onClick={onToggleSecretVisible}
                  className="text-theme-text-muted hover:text-theme-text-primary absolute top-1/2 right-2 -translate-y-1/2"
                >
                  {storageSecretVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">SharePoint Site URL (optional)</label>
              <input
                type="text"
                value={storageSettings.sharepoint_site_url || ''}
                onChange={(e) => onStorageSettingsChange((s) => ({ ...s, sharepoint_site_url: e.target.value }))}
                placeholder="https://your-org.sharepoint.com/sites/..."
                className="form-input"
              />
            </div>
          </div>
        </div>
      )}

      {/* S3 config */}
      {storageSettings.platform === 's3' && (
        <div className="border-theme-surface-border space-y-4 border-t pt-4">
          <p className="text-theme-text-primary text-sm font-medium">Amazon S3 / S3-Compatible Storage</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Access Key ID</label>
              <input
                type="text"
                value={storageSettings.s3_access_key_id || ''}
                onChange={(e) => onStorageSettingsChange((s) => ({ ...s, s3_access_key_id: e.target.value }))}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                className="form-input"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Secret Access Key</label>
              <div className="relative">
                <input
                  type={storageSecretVisible ? 'text' : 'password'}
                  value={storageSettings.s3_secret_access_key || ''}
                  onChange={(e) => onStorageSettingsChange((s) => ({ ...s, s3_secret_access_key: e.target.value }))}
                  className="form-input pr-10"
                />
                <button
                  type="button"
                  onClick={onToggleSecretVisible}
                  className="text-theme-text-muted hover:text-theme-text-primary absolute top-1/2 right-2 -translate-y-1/2"
                >
                  {storageSecretVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Bucket Name</label>
              <input
                type="text"
                value={storageSettings.s3_bucket_name || ''}
                onChange={(e) => onStorageSettingsChange((s) => ({ ...s, s3_bucket_name: e.target.value }))}
                placeholder="my-department-files"
                className="form-input"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Region</label>
              <input
                type="text"
                value={storageSettings.s3_region || ''}
                onChange={(e) => onStorageSettingsChange((s) => ({ ...s, s3_region: e.target.value }))}
                placeholder="us-east-1"
                className="form-input"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Endpoint URL (optional, for MinIO)</label>
              <input
                type="text"
                value={storageSettings.s3_endpoint_url || ''}
                onChange={(e) => onStorageSettingsChange((s) => ({ ...s, s3_endpoint_url: e.target.value }))}
                placeholder="https://minio.example.com"
                className="form-input"
              />
            </div>
          </div>
        </div>
      )}

      {/* Local storage config */}
      {storageSettings.platform === 'local' && (
        <div className="border-theme-surface-border space-y-4 border-t pt-4">
          <p className="text-theme-text-primary text-sm font-medium">Local Storage</p>
          <div>
            <label className="text-theme-text-muted mb-1 block text-xs">Storage Path (optional)</label>
            <input
              type="text"
              value={storageSettings.local_storage_path || ''}
              onChange={(e) => onStorageSettingsChange((s) => ({ ...s, local_storage_path: e.target.value }))}
              placeholder="/var/data/uploads (defaults to server upload directory)"
              className="form-input"
            />
            <p className="text-theme-text-muted mt-1 text-xs">
              Files are stored on the server. Ensure adequate disk space and a backup strategy.
            </p>
          </div>
        </div>
      )}

      {/* Save */}
      <div className="flex justify-end pt-2">
        <button
          onClick={onSave}
          disabled={savingStorage}
          className="btn-info inline-flex items-center gap-2 rounded-md text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {savingStorage && <Loader2 className="h-4 w-4 animate-spin" />}
          {savingStorage ? 'Saving...' : 'Save Storage Settings'}
        </button>
      </div>
    </div>
  );
};

export default StorageSettingsSection;
