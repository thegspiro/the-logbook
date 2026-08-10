import React from 'react';
import { Loader2, Mail, Server, Cloud, Info, Eye, EyeOff } from 'lucide-react';
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
        className={`${bg} focus:ring-theme-focus-ring toggle-track-md`}
        role="switch"
        aria-checked={checked}
      >
        <span className={`${checked ? 'translate-x-5' : 'translate-x-0'} toggle-knob-md`} />
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-theme-text-primary text-lg font-semibold">Email Configuration</h3>
        <p className="text-theme-text-muted mt-1 text-sm">
          Configure your email platform for sending notifications and alerts to your team.
        </p>
      </div>

      {/* Info banner */}
      <div className="border-theme-accent-blue/20 bg-theme-accent-blue-muted flex items-start gap-3 rounded-lg border p-4">
        <Info className="text-theme-accent-blue mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-theme-text-secondary text-sm">
          These settings were initially configured during onboarding. Changes here will affect how the system sends
          email notifications, reminders, and alerts.
        </p>
      </div>

      {/* Enable toggle */}
      <div className="border-theme-surface-border flex items-center justify-between border-b py-3">
        <div>
          <p className="text-theme-text-primary text-sm font-medium">Enable Email Notifications</p>
          <p className="text-theme-text-muted text-xs">Send email notifications, reminders, and alerts</p>
        </div>
        <Toggle
          checked={emailSettings.enabled}
          onChange={() => onEmailSettingsChange((s) => ({ ...s, enabled: !s.enabled }))}
        />
      </div>

      {/* Platform selection */}
      <div>
        <label className="text-theme-text-primary mb-2 block text-sm font-medium">Email Platform</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(
            [
              { id: 'gmail', label: 'Gmail', icon: <Mail className="h-4 w-4" /> },
              { id: 'microsoft', label: 'Microsoft 365', icon: <Mail className="h-4 w-4" /> },
              { id: 'selfhosted', label: 'Self-Hosted SMTP', icon: <Server className="h-4 w-4" /> },
              { id: 'cloudflare', label: 'Cloudflare', icon: <Cloud className="h-4 w-4" /> },
              { id: 'other', label: 'Other / None', icon: <Mail className="h-4 w-4" /> },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onEmailSettingsChange((s) => ({ ...s, platform: p.id }))}
              className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-colors ${
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="text-theme-text-muted mb-1 block text-xs">From Email Address</label>
          <input
            type="email"
            value={emailSettings.from_email || ''}
            onChange={(e) => onEmailSettingsChange((s) => ({ ...s, from_email: e.target.value }))}
            placeholder="notifications@yourdomain.com"
            className="form-input"
          />
        </div>
        <div>
          <label className="text-theme-text-muted mb-1 block text-xs">From Name</label>
          <input
            type="text"
            value={emailSettings.from_name || ''}
            onChange={(e) => onEmailSettingsChange((s) => ({ ...s, from_name: e.target.value }))}
            placeholder={profileName || 'Department Name'}
            className="form-input"
          />
        </div>
      </div>

      {/* Platform-specific fields */}
      {emailSettings.platform === 'gmail' && (
        <div className="border-theme-surface-border space-y-4 border-t pt-4">
          <p className="text-theme-text-primary text-sm font-medium">Gmail / Google Workspace</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Google Client ID</label>
              <input
                type="text"
                value={emailSettings.google_client_id || ''}
                onChange={(e) => onEmailSettingsChange((s) => ({ ...s, google_client_id: e.target.value }))}
                placeholder="123456789-abc.apps.googleusercontent.com"
                className="form-input"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Google Client Secret</label>
              <div className="relative">
                <input
                  type={emailPasswordVisible ? 'text' : 'password'}
                  value={emailSettings.google_client_secret || ''}
                  onChange={(e) => onEmailSettingsChange((s) => ({ ...s, google_client_secret: e.target.value }))}
                  placeholder="GOCSPX-xxxxxxxxxxxxx"
                  className="form-input pr-10"
                />
                <button
                  type="button"
                  onClick={onTogglePasswordVisible}
                  className="text-theme-text-muted hover:text-theme-text-primary absolute top-1/2 right-2 -translate-y-1/2"
                >
                  {emailPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <div>
            <label className="text-theme-text-muted mb-1 block text-xs">App Password (alternative to OAuth)</label>
            <input
              type="password"
              value={emailSettings.google_app_password || ''}
              onChange={(e) => onEmailSettingsChange((s) => ({ ...s, google_app_password: e.target.value }))}
              placeholder="xxxx xxxx xxxx xxxx"
              className="form-input sm:w-1/2"
            />
          </div>
        </div>
      )}

      {emailSettings.platform === 'microsoft' && (
        <div className="border-theme-surface-border space-y-4 border-t pt-4">
          <p className="text-theme-text-primary text-sm font-medium">Microsoft 365 / Azure AD</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Tenant ID</label>
              <input
                type="text"
                value={emailSettings.microsoft_tenant_id || ''}
                onChange={(e) => onEmailSettingsChange((s) => ({ ...s, microsoft_tenant_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="form-input"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Client ID (Application ID)</label>
              <input
                type="text"
                value={emailSettings.microsoft_client_id || ''}
                onChange={(e) => onEmailSettingsChange((s) => ({ ...s, microsoft_client_id: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="form-input"
              />
            </div>
          </div>
          <div>
            <label className="text-theme-text-muted mb-1 block text-xs">Client Secret</label>
            <div className="relative sm:w-1/2">
              <input
                type={emailPasswordVisible ? 'text' : 'password'}
                value={emailSettings.microsoft_client_secret || ''}
                onChange={(e) => onEmailSettingsChange((s) => ({ ...s, microsoft_client_secret: e.target.value }))}
                placeholder="Client secret value"
                className="form-input pr-10"
              />
              <button
                type="button"
                onClick={onTogglePasswordVisible}
                className="text-theme-text-muted hover:text-theme-text-primary absolute top-1/2 right-2 -translate-y-1/2"
              >
                {emailPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {emailSettings.platform === 'selfhosted' && (
        <div className="border-theme-surface-border space-y-4 border-t pt-4">
          <p className="text-theme-text-primary text-sm font-medium">Self-Hosted SMTP</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">SMTP Host</label>
              <input
                type="text"
                value={emailSettings.smtp_host || ''}
                onChange={(e) => onEmailSettingsChange((s) => ({ ...s, smtp_host: e.target.value }))}
                placeholder="mail.yourdomain.com"
                className="form-input"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Port</label>
              <input
                type="number"
                value={emailSettings.smtp_port}
                onChange={(e) => onEmailSettingsChange((s) => ({ ...s, smtp_port: parseInt(e.target.value) || 587 }))}
                className="form-input"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Encryption</label>
              <select
                value={emailSettings.smtp_encryption}
                onChange={(e) => onEmailSettingsChange((s) => ({ ...s, smtp_encryption: e.target.value }))}
                className="form-input"
              >
                <option value="tls">TLS (STARTTLS)</option>
                <option value="ssl">SSL</option>
                <option value="none">None</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Username</label>
              <input
                type="text"
                value={emailSettings.smtp_user || ''}
                onChange={(e) => onEmailSettingsChange((s) => ({ ...s, smtp_user: e.target.value }))}
                placeholder="notifications@yourdomain.com"
                className="form-input"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Password</label>
              <div className="relative">
                <input
                  type={emailPasswordVisible ? 'text' : 'password'}
                  value={emailSettings.smtp_password || ''}
                  onChange={(e) => onEmailSettingsChange((s) => ({ ...s, smtp_password: e.target.value }))}
                  className="form-input pr-10"
                />
                <button
                  type="button"
                  onClick={onTogglePasswordVisible}
                  className="text-theme-text-muted hover:text-theme-text-primary absolute top-1/2 right-2 -translate-y-1/2"
                >
                  {emailPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {emailSettings.platform === 'cloudflare' && (
        <div className="border-theme-surface-border space-y-4 border-t pt-4">
          <p className="text-theme-text-primary text-sm font-medium">Cloudflare Email Service</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">Account ID</label>
              <input
                type="text"
                value={emailSettings.cloudflare_account_id || ''}
                onChange={(e) => onEmailSettingsChange((s) => ({ ...s, cloudflare_account_id: e.target.value }))}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="form-input"
              />
            </div>
            <div>
              <label className="text-theme-text-muted mb-1 block text-xs">API Token</label>
              <div className="relative">
                <input
                  type={emailPasswordVisible ? 'text' : 'password'}
                  value={emailSettings.cloudflare_api_token || ''}
                  onChange={(e) => onEmailSettingsChange((s) => ({ ...s, cloudflare_api_token: e.target.value }))}
                  placeholder="API token with email sending permission"
                  className="form-input pr-10"
                />
                <button
                  type="button"
                  onClick={onTogglePasswordVisible}
                  className="text-theme-text-muted hover:text-theme-text-primary absolute top-1/2 right-2 -translate-y-1/2"
                >
                  {emailPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <div className="text-theme-text-muted flex items-start gap-2 text-xs">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Domain DNS must be managed by Cloudflare. Emails are sent via REST API — no SMTP server required.
            </span>
          </div>
        </div>
      )}

      {/* Save */}
      <div className="flex justify-end pt-2">
        <button
          onClick={onSave}
          disabled={savingEmail}
          className="btn-info inline-flex items-center gap-2 rounded-md text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {savingEmail && <Loader2 className="h-4 w-4 animate-spin" />}
          {savingEmail ? 'Saving...' : 'Save Email Settings'}
        </button>
      </div>
    </div>
  );
};

export default EmailSettingsSection;
