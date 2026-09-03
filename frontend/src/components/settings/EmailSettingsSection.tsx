import React from 'react';
import { SettingsToggle as Toggle } from './SettingsToggle';
import { Loader2, Mail, Server, Cloud, Info, Eye, EyeOff } from 'lucide-react';
import type { EmailServiceSettings, MicrosoftAuthMethod } from '../../types/user';

interface EmailSettingsSectionProps {
  emailSettings: EmailServiceSettings;
  onEmailSettingsChange: React.Dispatch<React.SetStateAction<EmailServiceSettings>>;
  savingEmail: boolean;
  testingEmail: boolean;
  emailPasswordVisible: boolean;
  onTogglePasswordVisible: () => void;
  onSave: () => void;
  onTest: () => void;
  profileName: string | undefined;
}

/**
 * The hosted platforms are plain SMTP submission behind an App Password. The
 * account that signs in is the account the mail is sent from, so the From
 * address doubles as the login and the only platform-specific field is the
 * password. Host, port and encryption are fixed by the provider and resolved
 * on the backend.
 */
const APP_PASSWORD_PLATFORMS: Record<
  'gmail' | 'microsoft',
  {
    heading: string;
    passwordField: 'google_app_password' | 'microsoft_app_password';
    passwordLabel: string;
    placeholder: string;
    help: string;
    helpHref: string;
    helpLinkLabel: string;
  }
> = {
  gmail: {
    heading: 'Gmail / Google Workspace',
    passwordField: 'google_app_password',
    passwordLabel: 'Google App Password',
    placeholder: 'xxxx xxxx xxxx xxxx',
    help: 'Signs in to smtp.gmail.com as the From address. Turn on 2-Step Verification for that Google account, then create an App Password for "Mail".',
    helpHref: 'https://myaccount.google.com/apppasswords',
    helpLinkLabel: 'Create a Google App Password',
  },
  microsoft: {
    heading: 'Microsoft 365',
    passwordField: 'microsoft_app_password',
    passwordLabel: 'Microsoft 365 App Password',
    placeholder: 'App password for the sending mailbox',
    help: 'Signs in to smtp.office365.com as the From address. SMTP AUTH must be enabled for that mailbox in Exchange Online; if the account uses multi-factor sign-in, create an App Password for it.',
    helpHref: 'https://account.microsoft.com/security',
    helpLinkLabel: 'Microsoft account security settings',
  },
};

const EmailSettingsSection: React.FC<EmailSettingsSectionProps> = ({
  emailSettings,
  onEmailSettingsChange,
  savingEmail,
  testingEmail,
  emailPasswordVisible,
  onTogglePasswordVisible,
  onSave,
  onTest,
  profileName,
}) => {
  const appPasswordPlatform =
    emailSettings.platform === 'gmail' || emailSettings.platform === 'microsoft'
      ? APP_PASSWORD_PLATFORMS[emailSettings.platform]
      : null;
  const isMicrosoft = emailSettings.platform === 'microsoft';
  // A stored row written before OAuth existed carries no method and signs in
  // with a password, so absence has to read as App Password here exactly as
  // it does on the backend.
  const microsoftAuthMethod: MicrosoftAuthMethod = emailSettings.microsoft_auth_method || 'app_password';
  const showMicrosoftOAuth = isMicrosoft && microsoftAuthMethod === 'oauth';
  const busy = savingEmail || testingEmail;

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
              onClick={() =>
                onEmailSettingsChange((s) => ({
                  ...s,
                  platform: p.id,
                  // Basic auth is on its way out, so a Microsoft setup being
                  // made now starts on OAuth. A department that already has
                  // an App Password saved keeps the method it is working
                  // with — the redacted marker counts as saved.
                  ...(p.id === 'microsoft' && s.platform !== 'microsoft' && !s.microsoft_app_password
                    ? { microsoft_auth_method: 'oauth' as const }
                    : {}),
                }))
              }
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
          <label className="text-theme-text-muted mb-1 block text-xs">
            {appPasswordPlatform ? 'Account Email Address (sends from and signs in as)' : 'From Email Address'}
          </label>
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
      {appPasswordPlatform && (
        <div className="border-theme-surface-border space-y-4 border-t pt-4">
          <p className="text-theme-text-primary text-sm font-medium">{appPasswordPlatform.heading}</p>

          {isMicrosoft && (
            <div>
              <label className="text-theme-text-muted mb-2 block text-xs">Authentication</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    { id: 'oauth', label: 'App registration (OAuth)', hint: 'Recommended' },
                    { id: 'app_password', label: 'App Password', hint: 'Basic auth — retiring' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={microsoftAuthMethod === m.id}
                    onClick={() => onEmailSettingsChange((s) => ({ ...s, microsoft_auth_method: m.id }))}
                    className={`flex flex-col items-start gap-0.5 rounded-lg border-2 px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                      microsoftAuthMethod === m.id
                        ? 'border-theme-accent-blue bg-theme-accent-blue-muted text-theme-accent-blue'
                        : 'border-theme-surface-border text-theme-text-secondary hover:border-theme-surface-hover'
                    }`}
                  >
                    {m.label}
                    <span className="text-theme-text-muted text-xs font-normal">{m.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {showMicrosoftOAuth ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="ms-tenant-id" className="text-theme-text-muted mb-1 block text-xs">
                    Directory (tenant) ID
                  </label>
                  <input
                    id="ms-tenant-id"
                    type="text"
                    autoComplete="off"
                    value={emailSettings.microsoft_tenant_id || ''}
                    onChange={(e) => onEmailSettingsChange((s) => ({ ...s, microsoft_tenant_id: e.target.value }))}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="form-input"
                  />
                </div>
                <div>
                  <label htmlFor="ms-client-id" className="text-theme-text-muted mb-1 block text-xs">
                    Application (client) ID
                  </label>
                  <input
                    id="ms-client-id"
                    type="text"
                    autoComplete="off"
                    value={emailSettings.microsoft_client_id || ''}
                    onChange={(e) => onEmailSettingsChange((s) => ({ ...s, microsoft_client_id: e.target.value }))}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="form-input"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="ms-client-secret" className="text-theme-text-muted mb-1 block text-xs">
                  Client secret
                </label>
                <div className="relative sm:w-1/2">
                  <input
                    id="ms-client-secret"
                    type={emailPasswordVisible ? 'text' : 'password'}
                    autoComplete="off"
                    value={emailSettings.microsoft_client_secret || ''}
                    onChange={(e) => onEmailSettingsChange((s) => ({ ...s, microsoft_client_secret: e.target.value }))}
                    placeholder="Secret value from Entra ID"
                    className="form-input pr-10"
                  />
                  <button
                    type="button"
                    onClick={onTogglePasswordVisible}
                    aria-label={emailPasswordVisible ? 'Hide client secret' : 'Show client secret'}
                    className="text-theme-text-muted hover:text-theme-text-primary absolute top-1/2 right-2 -translate-y-1/2"
                  >
                    {emailPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="text-theme-text-muted flex items-start gap-2 text-xs">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Register an application in Entra ID, give it the <span className="font-medium">SMTP.SendAsApp</span>{' '}
                  application permission for Office 365 Exchange Online, and grant it{' '}
                  <span className="font-medium">SendAs</span> on this mailbox. Copy the secret{' '}
                  <span className="font-medium">value</span> — not its ID — into the field above.{' '}
                  <a
                    href="https://entra.microsoft.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-accent-blue underline"
                  >
                    Open Entra ID
                  </a>
                </span>
              </div>
            </>
          ) : (
            <>
              <div>
                <label htmlFor="email-app-password" className="text-theme-text-muted mb-1 block text-xs">
                  {appPasswordPlatform.passwordLabel}
                </label>
                <div className="relative sm:w-1/2">
                  <input
                    id="email-app-password"
                    type={emailPasswordVisible ? 'text' : 'password'}
                    autoComplete="off"
                    value={emailSettings[appPasswordPlatform.passwordField] || ''}
                    onChange={(e) =>
                      onEmailSettingsChange((s) => ({ ...s, [appPasswordPlatform.passwordField]: e.target.value }))
                    }
                    placeholder={appPasswordPlatform.placeholder}
                    className="form-input pr-10"
                  />
                  <button
                    type="button"
                    onClick={onTogglePasswordVisible}
                    aria-label={emailPasswordVisible ? 'Hide password' : 'Show password'}
                    className="text-theme-text-muted hover:text-theme-text-primary absolute top-1/2 right-2 -translate-y-1/2"
                  >
                    {emailPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="text-theme-text-muted flex items-start gap-2 text-xs">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {appPasswordPlatform.help}{' '}
                  <a
                    href={appPasswordPlatform.helpHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-accent-blue underline"
                  >
                    {appPasswordPlatform.helpLinkLabel}
                  </a>
                </span>
              </div>
              {isMicrosoft && (
                <div className="alert-warning text-theme-text-secondary text-xs">
                  An App Password is Basic authentication. Microsoft disables it by default for existing tenants at the
                  end of December 2026 and does not offer it to tenants created after that, so this mailbox will stop
                  sending unless it moves to an app registration. Switch to{' '}
                  <span className="font-medium">App registration (OAuth)</span> above when your Entra ID administrator
                  can set one up.
                </div>
              )}
            </>
          )}
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

      {/* Test + Save */}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onTest}
          disabled={busy || emailSettings.platform === 'other'}
          className="btn-secondary inline-flex items-center gap-2 rounded-md text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {testingEmail && <Loader2 className="h-4 w-4 animate-spin" />}
          {testingEmail ? 'Testing...' : 'Test Connection'}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
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
