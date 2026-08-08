import React from 'react';
import { Loader2, Shield, Key, Lock, Info, Eye, EyeOff } from 'lucide-react';
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
        <h3 className="text-theme-text-primary text-lg font-semibold">Authentication</h3>
        <p className="text-theme-text-muted mt-1 text-sm">Configure how users sign in to the system.</p>
      </div>

      {/* Info banner */}
      <div className="border-theme-accent-blue/20 bg-theme-accent-blue-muted flex items-start gap-3 rounded-lg border p-4">
        <Info className="text-theme-accent-blue mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-theme-text-secondary text-sm">
          These settings were initially configured during onboarding. Changing the authentication provider will affect
          how all users sign in. Ensure the new provider is configured before switching.
        </p>
      </div>

      {/* Provider selection */}
      <div>
        <label className="text-theme-text-primary mb-2 block text-sm font-medium">Authentication Provider</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              { id: 'google', label: 'Google OAuth', icon: <Shield className="h-4 w-4" /> },
              { id: 'microsoft', label: 'Microsoft AD', icon: <Shield className="h-4 w-4" /> },
              { id: 'authentik', label: 'Authentik SSO', icon: <Key className="h-4 w-4" /> },
              { id: 'local', label: 'Local Passwords', icon: <Lock className="h-4 w-4" /> },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onAuthSettingsChange((s) => ({ ...s, provider: p.id }))}
              className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-colors ${
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
        <div className="border-theme-surface-border space-y-4 border-t pt-4">
          <p className="text-theme-text-primary text-sm font-medium">Google OAuth Configuration</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Client ID</label>
              <input
                type="text"
                value={authSettings.google_client_id || ''}
                onChange={(e) => onAuthSettingsChange((s) => ({ ...s, google_client_id: e.target.value }))}
                placeholder="123456789-abc.apps.googleusercontent.com"
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Client Secret</label>
              <div className="relative">
                <input
                  type={authSecretVisible ? 'text' : 'password'}
                  value={authSettings.google_client_secret || ''}
                  onChange={(e) => onAuthSettingsChange((s) => ({ ...s, google_client_secret: e.target.value }))}
                  className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 pr-10 text-sm focus:ring-2 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={onToggleSecretVisible}
                  className="text-theme-text-muted hover:text-theme-text-primary absolute top-1/2 right-2 -translate-y-1/2"
                >
                  {authSecretVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Microsoft Azure AD config */}
      {authSettings.provider === 'microsoft' && (
        <div className="border-theme-surface-border space-y-4 border-t pt-4">
          <p className="text-theme-text-primary text-sm font-medium">Microsoft Azure AD Configuration</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Tenant ID</label>
              <input
                type="text"
                value={authSettings.microsoft_tenant_id || ''}
                onChange={(e) => onAuthSettingsChange((s) => ({ ...s, microsoft_tenant_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Client ID (Application ID)</label>
              <input
                type="text"
                value={authSettings.microsoft_client_id || ''}
                onChange={(e) => onAuthSettingsChange((s) => ({ ...s, microsoft_client_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
          </div>
          <div>
            <label className="text-theme-text-muted mb-1 block text-xs">Client Secret</label>
            <div className="relative sm:w-1/2">
              <input
                type={authSecretVisible ? 'text' : 'password'}
                value={authSettings.microsoft_client_secret || ''}
                onChange={(e) => onAuthSettingsChange((s) => ({ ...s, microsoft_client_secret: e.target.value }))}
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 pr-10 text-sm focus:ring-2 focus:outline-hidden"
              />
              <button
                type="button"
                onClick={onToggleSecretVisible}
                className="text-theme-text-muted hover:text-theme-text-primary absolute top-1/2 right-2 -translate-y-1/2"
              >
                {authSecretVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Authentik SSO config */}
      {authSettings.provider === 'authentik' && (
        <div className="border-theme-surface-border space-y-4 border-t pt-4">
          <p className="text-theme-text-primary text-sm font-medium">Authentik SSO Configuration</p>
          <div>
            <label className="text-theme-text-muted mb-1 block text-xs">Authentik Server URL</label>
            <input
              type="text"
              value={authSettings.authentik_url || ''}
              onChange={(e) => onAuthSettingsChange((s) => ({ ...s, authentik_url: e.target.value }))}
              placeholder="https://auth.yourdomain.com"
              className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden sm:w-1/2"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Client ID</label>
              <input
                type="text"
                value={authSettings.authentik_client_id || ''}
                onChange={(e) => onAuthSettingsChange((s) => ({ ...s, authentik_client_id: e.target.value }))}
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Client Secret</label>
              <div className="relative">
                <input
                  type={authSecretVisible ? 'text' : 'password'}
                  value={authSettings.authentik_client_secret || ''}
                  onChange={(e) => onAuthSettingsChange((s) => ({ ...s, authentik_client_secret: e.target.value }))}
                  className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 pr-10 text-sm focus:ring-2 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={onToggleSecretVisible}
                  className="text-theme-text-muted hover:text-theme-text-primary absolute top-1/2 right-2 -translate-y-1/2"
                >
                  {authSecretVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Local passwords info */}
      {authSettings.provider === 'local' && (
        <div className="border-theme-surface-border border-t pt-4">
          <div className="border-theme-accent-green/20 bg-theme-accent-green-muted flex items-start gap-3 rounded-lg border p-4">
            <Lock className="text-theme-accent-green mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="text-theme-text-primary text-sm font-medium">Local Password Authentication</p>
              <p className="text-theme-text-secondary mt-1 text-sm">
                Passwords are securely hashed with Argon2id and stored internally. No external authentication services
                are required. Admins manage user accounts directly in the system.
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
          className="btn-info inline-flex items-center gap-2 rounded-md text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {savingAuth && <Loader2 className="h-4 w-4 animate-spin" />}
          {savingAuth ? 'Saving...' : 'Save Authentication Settings'}
        </button>
      </div>
    </div>
  );
};

export default AuthSettingsSection;
