import React from 'react';
import {
  Loader2,
  Shield,
  Key,
  Lock,
  Info,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { AuthSettings } from '../../types/user';

interface AuthSettingsSectionProps {
  authSettings: AuthSettings;
  onAuthSettingsChange: React.Dispatch<React.SetStateAction<AuthSettings>>;
  savingAuth: boolean;
  authSecretVisible: boolean;
  onToggleSecretVisible: () => void;
  onSave: () => void;
}

const AuthSettingsSection: React.FC<AuthSettingsSectionProps> = ({
  authSettings,
  onAuthSettingsChange,
  savingAuth,
  authSecretVisible,
  onToggleSecretVisible,
  onSave,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-theme-text-primary">Authentication</h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Configure how users sign in to the system.
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-lg border border-theme-accent-blue/20 bg-theme-accent-blue-muted p-4">
        <Info className="w-5 h-5 text-theme-accent-blue shrink-0 mt-0.5" />
        <p className="text-sm text-theme-text-secondary">
          These settings were initially configured during onboarding. Changing the authentication provider will affect how all users sign in. Ensure the new provider is configured before switching.
        </p>
      </div>

      {/* Provider selection */}
      <div>
        <label className="block text-sm font-medium text-theme-text-primary mb-2">Authentication Provider</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            { id: 'google', label: 'Google OAuth', icon: <Shield className="w-4 h-4" /> },
            { id: 'microsoft', label: 'Microsoft AD', icon: <Shield className="w-4 h-4" /> },
            { id: 'authentik', label: 'Authentik SSO', icon: <Key className="w-4 h-4" /> },
            { id: 'local', label: 'Local Passwords', icon: <Lock className="w-4 h-4" /> },
          ] as const).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onAuthSettingsChange(s => ({ ...s, provider: p.id }))}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                authSettings.provider === p.id
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

      {/* Google OAuth config */}
      {authSettings.provider === 'google' && (
        <div className="space-y-4 border-t border-theme-surface-border pt-4">
          <p className="text-sm font-medium text-theme-text-primary">Google OAuth Configuration</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Client ID</label>
              <input
                type="text"
                value={authSettings.google_client_id || ''}
                onChange={(e) => onAuthSettingsChange(s => ({ ...s, google_client_id: e.target.value }))}
                placeholder="123456789-abc.apps.googleusercontent.com"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Client Secret</label>
              <div className="relative">
                <input
                  type={authSecretVisible ? 'text' : 'password'}
                  value={authSettings.google_client_secret || ''}
                  onChange={(e) => onAuthSettingsChange(s => ({ ...s, google_client_secret: e.target.value }))}
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 pr-10 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
                <button type="button" onClick={onToggleSecretVisible} className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary">
                  {authSecretVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Microsoft Azure AD config */}
      {authSettings.provider === 'microsoft' && (
        <div className="space-y-4 border-t border-theme-surface-border pt-4">
          <p className="text-sm font-medium text-theme-text-primary">Microsoft Azure AD Configuration</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Tenant ID</label>
              <input
                type="text"
                value={authSettings.microsoft_tenant_id || ''}
                onChange={(e) => onAuthSettingsChange(s => ({ ...s, microsoft_tenant_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Client ID (Application ID)</label>
              <input
                type="text"
                value={authSettings.microsoft_client_id || ''}
                onChange={(e) => onAuthSettingsChange(s => ({ ...s, microsoft_client_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Client Secret</label>
            <div className="relative sm:w-1/2">
              <input
                type={authSecretVisible ? 'text' : 'password'}
                value={authSettings.microsoft_client_secret || ''}
                onChange={(e) => onAuthSettingsChange(s => ({ ...s, microsoft_client_secret: e.target.value }))}
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 pr-10 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
              <button type="button" onClick={onToggleSecretVisible} className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary">
                {authSecretVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Authentik SSO config */}
      {authSettings.provider === 'authentik' && (
        <div className="space-y-4 border-t border-theme-surface-border pt-4">
          <p className="text-sm font-medium text-theme-text-primary">Authentik SSO Configuration</p>
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Authentik Server URL</label>
            <input
              type="text"
              value={authSettings.authentik_url || ''}
              onChange={(e) => onAuthSettingsChange(s => ({ ...s, authentik_url: e.target.value }))}
              placeholder="https://auth.yourdomain.com"
              className="w-full sm:w-1/2 rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Client ID</label>
              <input
                type="text"
                value={authSettings.authentik_client_id || ''}
                onChange={(e) => onAuthSettingsChange(s => ({ ...s, authentik_client_id: e.target.value }))}
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Client Secret</label>
              <div className="relative">
                <input
                  type={authSecretVisible ? 'text' : 'password'}
                  value={authSettings.authentik_client_secret || ''}
                  onChange={(e) => onAuthSettingsChange(s => ({ ...s, authentik_client_secret: e.target.value }))}
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 pr-10 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
                <button type="button" onClick={onToggleSecretVisible} className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary">
                  {authSecretVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Local passwords info */}
      {authSettings.provider === 'local' && (
        <div className="border-t border-theme-surface-border pt-4">
          <div className="flex items-start gap-3 rounded-lg border border-theme-accent-green/20 bg-theme-accent-green-muted p-4">
            <Lock className="w-5 h-5 text-theme-accent-green shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-theme-text-primary">Local Password Authentication</p>
              <p className="text-sm text-theme-text-secondary mt-1">
                Passwords are securely hashed with Argon2id and stored internally. No external authentication services are required. Admins manage user accounts directly in the system.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Save */}
      <div className="flex justify-end pt-2">
        <button
          onClick={onSave}
          disabled={savingAuth}
          className="btn-info disabled:opacity-50 disabled:cursor-not-allowed font-medium gap-2 inline-flex items-center rounded-md text-sm"
        >
          {savingAuth && <Loader2 className="w-4 h-4 animate-spin" />}
          {savingAuth ? 'Saving...' : 'Save Authentication Settings'}
        </button>
      </div>
    </div>
  );
};

export default AuthSettingsSection;
