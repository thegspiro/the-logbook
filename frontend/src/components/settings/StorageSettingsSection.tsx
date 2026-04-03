import React from 'react';
import {
  Loader2,
  Cloud,
  Database,
  HardDrive,
  Info,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { FileStorageSettings } from '../../types/user';

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
        <h3 className="text-lg font-semibold text-theme-text-primary">File Storage</h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Configure where department files, documents, and images are stored.
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-lg border border-theme-accent-blue/20 bg-theme-accent-blue-muted p-4">
        <Info className="w-5 h-5 text-theme-accent-blue shrink-0 mt-0.5" />
        <p className="text-sm text-theme-text-secondary">
          These settings were initially configured during onboarding. Changing the storage platform may require migrating existing files.
        </p>
      </div>

      {/* Platform selection */}
      <div>
        <label className="block text-sm font-medium text-theme-text-primary mb-2">Storage Platform</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {([
            { id: 'googledrive', label: 'Google Drive', icon: <Cloud className="w-4 h-4" /> },
            { id: 'onedrive', label: 'OneDrive', icon: <Cloud className="w-4 h-4" /> },
            { id: 's3', label: 'Amazon S3', icon: <Database className="w-4 h-4" /> },
            { id: 'local', label: 'Local Storage', icon: <HardDrive className="w-4 h-4" /> },
            { id: 'other', label: 'Other', icon: <HardDrive className="w-4 h-4" /> },
          ] as const).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onStorageSettingsChange(s => ({ ...s, platform: p.id }))}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
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
        <div className="space-y-4 border-t border-theme-surface-border pt-4">
          <p className="text-sm font-medium text-theme-text-primary">Google Drive Configuration</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Client ID</label>
              <input
                type="text"
                value={storageSettings.google_drive_client_id || ''}
                onChange={(e) => onStorageSettingsChange(s => ({ ...s, google_drive_client_id: e.target.value }))}
                placeholder="123456789-abc.apps.googleusercontent.com"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Client Secret</label>
              <div className="relative">
                <input
                  type={storageSecretVisible ? 'text' : 'password'}
                  value={storageSettings.google_drive_client_secret || ''}
                  onChange={(e) => onStorageSettingsChange(s => ({ ...s, google_drive_client_secret: e.target.value }))}
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 pr-10 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
                <button type="button" onClick={onToggleSecretVisible} className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary">
                  {storageSecretVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Folder ID (optional)</label>
            <input
              type="text"
              value={storageSettings.google_drive_folder_id || ''}
              onChange={(e) => onStorageSettingsChange(s => ({ ...s, google_drive_folder_id: e.target.value }))}
              placeholder="Root folder ID for department files"
              className="w-full sm:w-1/2 rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
            />
          </div>
        </div>
      )}

      {/* OneDrive config */}
      {storageSettings.platform === 'onedrive' && (
        <div className="space-y-4 border-t border-theme-surface-border pt-4">
          <p className="text-sm font-medium text-theme-text-primary">OneDrive / SharePoint Configuration</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Tenant ID</label>
              <input
                type="text"
                value={storageSettings.onedrive_tenant_id || ''}
                onChange={(e) => onStorageSettingsChange(s => ({ ...s, onedrive_tenant_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Client ID</label>
              <input
                type="text"
                value={storageSettings.onedrive_client_id || ''}
                onChange={(e) => onStorageSettingsChange(s => ({ ...s, onedrive_client_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Client Secret</label>
              <div className="relative">
                <input
                  type={storageSecretVisible ? 'text' : 'password'}
                  value={storageSettings.onedrive_client_secret || ''}
                  onChange={(e) => onStorageSettingsChange(s => ({ ...s, onedrive_client_secret: e.target.value }))}
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 pr-10 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
                <button type="button" onClick={onToggleSecretVisible} className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary">
                  {storageSecretVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">SharePoint Site URL (optional)</label>
              <input
                type="text"
                value={storageSettings.sharepoint_site_url || ''}
                onChange={(e) => onStorageSettingsChange(s => ({ ...s, sharepoint_site_url: e.target.value }))}
                placeholder="https://your-org.sharepoint.com/sites/..."
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
          </div>
        </div>
      )}

      {/* S3 config */}
      {storageSettings.platform === 's3' && (
        <div className="space-y-4 border-t border-theme-surface-border pt-4">
          <p className="text-sm font-medium text-theme-text-primary">Amazon S3 / S3-Compatible Storage</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Access Key ID</label>
              <input
                type="text"
                value={storageSettings.s3_access_key_id || ''}
                onChange={(e) => onStorageSettingsChange(s => ({ ...s, s3_access_key_id: e.target.value }))}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Secret Access Key</label>
              <div className="relative">
                <input
                  type={storageSecretVisible ? 'text' : 'password'}
                  value={storageSettings.s3_secret_access_key || ''}
                  onChange={(e) => onStorageSettingsChange(s => ({ ...s, s3_secret_access_key: e.target.value }))}
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 pr-10 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
                <button type="button" onClick={onToggleSecretVisible} className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary">
                  {storageSecretVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Bucket Name</label>
              <input
                type="text"
                value={storageSettings.s3_bucket_name || ''}
                onChange={(e) => onStorageSettingsChange(s => ({ ...s, s3_bucket_name: e.target.value }))}
                placeholder="my-department-files"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Region</label>
              <input
                type="text"
                value={storageSettings.s3_region || ''}
                onChange={(e) => onStorageSettingsChange(s => ({ ...s, s3_region: e.target.value }))}
                placeholder="us-east-1"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Endpoint URL (optional, for MinIO)</label>
              <input
                type="text"
                value={storageSettings.s3_endpoint_url || ''}
                onChange={(e) => onStorageSettingsChange(s => ({ ...s, s3_endpoint_url: e.target.value }))}
                placeholder="https://minio.example.com"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
          </div>
        </div>
      )}

      {/* Local storage config */}
      {storageSettings.platform === 'local' && (
        <div className="space-y-4 border-t border-theme-surface-border pt-4">
          <p className="text-sm font-medium text-theme-text-primary">Local Storage</p>
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Storage Path (optional)</label>
            <input
              type="text"
              value={storageSettings.local_storage_path || ''}
              onChange={(e) => onStorageSettingsChange(s => ({ ...s, local_storage_path: e.target.value }))}
              placeholder="/var/data/uploads (defaults to server upload directory)"
              className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
            />
            <p className="text-xs text-theme-text-muted mt-1">Files are stored on the server. Ensure adequate disk space and a backup strategy.</p>
          </div>
        </div>
      )}

      {/* Save */}
      <div className="flex justify-end pt-2">
        <button
          onClick={onSave}
          disabled={savingStorage}
          className="btn-info disabled:opacity-50 disabled:cursor-not-allowed font-medium gap-2 inline-flex items-center rounded-md text-sm"
        >
          {savingStorage && <Loader2 className="w-4 h-4 animate-spin" />}
          {savingStorage ? 'Saving...' : 'Save Storage Settings'}
        </button>
      </div>
    </div>
  );
};

export default StorageSettingsSection;
