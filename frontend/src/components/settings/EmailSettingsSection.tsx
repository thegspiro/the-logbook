import React from 'react';
import {
  Loader2,
  Mail,
  Server,
  Info,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { EmailServiceSettings } from '../../types/user';

interface EmailSettingsSectionProps {
  emailSettings: EmailServiceSettings;
  onEmailSettingsChange: React.Dispatch<React.SetStateAction<EmailServiceSettings>>;
  savingEmail: boolean;
  emailPasswordVisible: boolean;
  onTogglePasswordVisible: () => void;
  onSave: () => void;
  profileName: string | undefined;
}

const EmailSettingsSection: React.FC<EmailSettingsSectionProps> = ({
  emailSettings,
  onEmailSettingsChange,
  savingEmail,
  emailPasswordVisible,
  onTogglePasswordVisible,
  onSave,
  profileName,
}) => {
  const Toggle: React.FC<{
    checked: boolean;
    onChange: () => void;
  }> = ({ checked, onChange }) => {
    const bg = checked ? 'bg-theme-accent-blue' : 'bg-theme-surface-hover';
    return (
      <button
        type="button"
        onClick={onChange}
        className={`${bg} relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring`}
        role="switch"
        aria-checked={checked}
      >
        <span
          className={`${
            checked ? 'translate-x-5' : 'translate-x-0'
          } toggle-knob-md`}
        />
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-theme-text-primary">Email Configuration</h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Configure your email platform for sending notifications and alerts to your team.
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-lg border border-theme-accent-blue/20 bg-theme-accent-blue-muted p-4">
        <Info className="w-5 h-5 text-theme-accent-blue shrink-0 mt-0.5" />
        <p className="text-sm text-theme-text-secondary">
          These settings were initially configured during onboarding. Changes here will affect how the system sends email notifications, reminders, and alerts.
        </p>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between py-3 border-b border-theme-surface-border">
        <div>
          <p className="text-sm font-medium text-theme-text-primary">Enable Email Notifications</p>
          <p className="text-xs text-theme-text-muted">Send email notifications, reminders, and alerts</p>
        </div>
        <Toggle checked={emailSettings.enabled} onChange={() => onEmailSettingsChange(s => ({ ...s, enabled: !s.enabled }))} />
      </div>

      {/* Platform selection */}
      <div>
        <label className="block text-sm font-medium text-theme-text-primary mb-2">Email Platform</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            { id: 'gmail', label: 'Gmail', icon: <Mail className="w-4 h-4" /> },
            { id: 'microsoft', label: 'Microsoft 365', icon: <Mail className="w-4 h-4" /> },
            { id: 'selfhosted', label: 'Self-Hosted SMTP', icon: <Server className="w-4 h-4" /> },
            { id: 'other', label: 'Other / None', icon: <Mail className="w-4 h-4" /> },
          ] as const).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onEmailSettingsChange(s => ({ ...s, platform: p.id }))}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                emailSettings.platform === p.id
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

      {/* Common fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-theme-text-muted mb-1">From Email Address</label>
          <input
            type="email"
            value={emailSettings.from_email || ''}
            onChange={(e) => onEmailSettingsChange(s => ({ ...s, from_email: e.target.value }))}
            placeholder="notifications@yourdomain.com"
            className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
          />
        </div>
        <div>
          <label className="block text-xs text-theme-text-muted mb-1">From Name</label>
          <input
            type="text"
            value={emailSettings.from_name || ''}
            onChange={(e) => onEmailSettingsChange(s => ({ ...s, from_name: e.target.value }))}
            placeholder={profileName || 'Department Name'}
            className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
          />
        </div>
      </div>

      {/* Platform-specific fields */}
      {emailSettings.platform === 'gmail' && (
        <div className="space-y-4 border-t border-theme-surface-border pt-4">
          <p className="text-sm font-medium text-theme-text-primary">Gmail / Google Workspace</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Google Client ID</label>
              <input
                type="text"
                value={emailSettings.google_client_id || ''}
                onChange={(e) => onEmailSettingsChange(s => ({ ...s, google_client_id: e.target.value }))}
                placeholder="123456789-abc.apps.googleusercontent.com"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Google Client Secret</label>
              <div className="relative">
                <input
                  type={emailPasswordVisible ? 'text' : 'password'}
                  value={emailSettings.google_client_secret || ''}
                  onChange={(e) => onEmailSettingsChange(s => ({ ...s, google_client_secret: e.target.value }))}
                  placeholder="GOCSPX-xxxxxxxxxxxxx"
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 pr-10 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
                <button type="button" onClick={onTogglePasswordVisible} className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary">
                  {emailPasswordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">App Password (alternative to OAuth)</label>
            <input
              type="password"
              value={emailSettings.google_app_password || ''}
              onChange={(e) => onEmailSettingsChange(s => ({ ...s, google_app_password: e.target.value }))}
              placeholder="xxxx xxxx xxxx xxxx"
              className="w-full sm:w-1/2 rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
            />
          </div>
        </div>
      )}

      {emailSettings.platform === 'microsoft' && (
        <div className="space-y-4 border-t border-theme-surface-border pt-4">
          <p className="text-sm font-medium text-theme-text-primary">Microsoft 365 / Azure AD</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Tenant ID</label>
              <input
                type="text"
                value={emailSettings.microsoft_tenant_id || ''}
                onChange={(e) => onEmailSettingsChange(s => ({ ...s, microsoft_tenant_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Client ID (Application ID)</label>
              <input
                type="text"
                value={emailSettings.microsoft_client_id || ''}
                onChange={(e) => onEmailSettingsChange(s => ({ ...s, microsoft_client_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Client Secret</label>
            <div className="relative sm:w-1/2">
              <input
                type={emailPasswordVisible ? 'text' : 'password'}
                value={emailSettings.microsoft_client_secret || ''}
                onChange={(e) => onEmailSettingsChange(s => ({ ...s, microsoft_client_secret: e.target.value }))}
                placeholder="Client secret value"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 pr-10 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
              <button type="button" onClick={onTogglePasswordVisible} className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary">
                {emailPasswordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {emailSettings.platform === 'selfhosted' && (
        <div className="space-y-4 border-t border-theme-surface-border pt-4">
          <p className="text-sm font-medium text-theme-text-primary">Self-Hosted SMTP</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">SMTP Host</label>
              <input
                type="text"
                value={emailSettings.smtp_host || ''}
                onChange={(e) => onEmailSettingsChange(s => ({ ...s, smtp_host: e.target.value }))}
                placeholder="mail.yourdomain.com"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Port</label>
              <input
                type="number"
                value={emailSettings.smtp_port}
                onChange={(e) => onEmailSettingsChange(s => ({ ...s, smtp_port: parseInt(e.target.value) || 587 }))}
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Encryption</label>
              <select
                value={emailSettings.smtp_encryption}
                onChange={(e) => onEmailSettingsChange(s => ({ ...s, smtp_encryption: e.target.value }))}
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              >
                <option value="tls">TLS (STARTTLS)</option>
                <option value="ssl">SSL</option>
                <option value="none">None</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Username</label>
              <input
                type="text"
                value={emailSettings.smtp_user || ''}
                onChange={(e) => onEmailSettingsChange(s => ({ ...s, smtp_user: e.target.value }))}
                placeholder="notifications@yourdomain.com"
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted mb-1">Password</label>
              <div className="relative">
                <input
                  type={emailPasswordVisible ? 'text' : 'password'}
                  value={emailSettings.smtp_password || ''}
                  onChange={(e) => onEmailSettingsChange(s => ({ ...s, smtp_password: e.target.value }))}
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 pr-10 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
                <button type="button" onClick={onTogglePasswordVisible} className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary">
                  {emailPasswordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save */}
      <div className="flex justify-end pt-2">
        <button
          onClick={onSave}
          disabled={savingEmail}
          className="btn-info disabled:opacity-50 disabled:cursor-not-allowed font-medium gap-2 inline-flex items-center rounded-md text-sm"
        >
          {savingEmail && <Loader2 className="w-4 h-4 animate-spin" />}
          {savingEmail ? 'Saving...' : 'Save Email Settings'}
        </button>
      </div>
    </div>
  );
};

export default EmailSettingsSection;
