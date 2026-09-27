import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Copy, Globe, Loader2 } from 'lucide-react';
import { Collapsible } from '../ux/Collapsible';
import { Skeleton } from '../ux/Skeleton';
import { EmailLinkDomainSource } from '../../constants/enums';
import { useConfirm } from '../../contexts/ConfirmContext';
import { organizationService } from '../../services/userServices';
import { useAuthStore } from '../../stores/authStore';
import type { EmailLinkDomain } from '../../types/user';
import { copyToClipboard } from '../../utils/clipboard';
import { getErrorMessage } from '../../utils/errorHandling';

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

const sourceDescription = (domain: EmailLinkDomain): React.ReactNode => {
  switch (domain.source) {
    case EmailLinkDomainSource.FRONTEND_URL:
      return (
        <>
          Set by the <code>FRONTEND_URL</code> setting.
        </>
      );
    case EmailLinkDomainSource.ALLOWED_ORIGINS:
      return (
        <>
          Picked automatically from <code>ALLOWED_ORIGINS</code>, because <code>FRONTEND_URL</code> is{' '}
          <code>{domain.configured_url || '(blank)'}</code>, which only the server itself can open. Set{' '}
          <code>FRONTEND_URL</code> to choose the address explicitly.
        </>
      );
    case EmailLinkDomainSource.OVERRIDE:
      return (
        <>
          Set on this screen by an IT administrator. Without it, links would use{' '}
          <code>{domain.deployment_url || '(not set)'}</code> from the server&apos;s configuration.
        </>
      );
    case EmailLinkDomainSource.UNRESOLVED_LOOPBACK:
      return (
        <>
          <code>FRONTEND_URL</code> has not been set to a public address, and <code>ALLOWED_ORIGINS</code> has none to
          fall back on.
        </>
      );
  }
};

/** The permission that lets an IT administrator change the address here. */
export const MANAGE_LINK_DOMAIN_PERMISSION = 'system.manage_link_domain';

interface LinkDomainEditorProps {
  domain: EmailLinkDomain;
  viewingOrigin: string | null;
  onChange: (next: EmailLinkDomain) => void;
}

/**
 * The override form. The backend accepts only a host this server already
 * serves and says why when it refuses, so the reason is shown as it came
 * rather than re-derived here.
 */
const LinkDomainEditor: React.FC<LinkDomainEditorProps> = ({ domain, viewingOrigin, onChange }) => {
  const { confirm } = useConfirm();
  const [url, setUrl] = useState(domain.override_url || domain.effective_url);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const next = url.trim();
    if (!next) {
      setError('Enter the address members use to reach this site.');
      return;
    }
    const ok = await confirm({
      title: 'Change the email link address?',
      message: (
        <>
          Every email sent from now on — including password resets and ballots — will link to <code>{next}</code>.
          Emails already sent keep the old address.
        </>
      ),
      confirmLabel: 'Change address',
      cancelLabel: 'Keep current address',
      variant: 'warning',
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await organizationService.setEmailLinkDomain(next);
      onChange(updated);
      setUrl(updated.override_url || updated.effective_url);
      toast.success('Email link address changed');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not change the email link address.'));
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = async () => {
    const ok = await confirm({
      title: 'Go back to the server setting?',
      message: (
        <>
          Emails will link to <code>{domain.deployment_url || '(not set)'}</code>, the address in the server&apos;s
          configuration.
        </>
      ),
      confirmLabel: 'Use server setting',
      cancelLabel: 'Keep this address',
      variant: 'warning',
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await organizationService.clearEmailLinkDomain();
      onChange(updated);
      setUrl(updated.effective_url);
      toast.success('Email links use the server setting again');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not change the email link address.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-theme-surface-border space-y-2 border-t pt-3">
      <label htmlFor="email-link-domain-input" className="form-label">
        Change address
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="email-link-domain-input"
          type="url"
          inputMode="url"
          autoComplete="off"
          className="form-input sm:flex-1"
          placeholder="https://logbook.yourdept.org"
          value={url}
          maxLength={255}
          disabled={saving}
          aria-describedby="email-link-domain-hint"
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
        />
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void handleSave()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Save
        </button>
      </div>
      {viewingOrigin && viewingOrigin !== url.trim() && (
        <button
          type="button"
          className="text-theme-accent-blue text-xs underline"
          disabled={saving}
          onClick={() => {
            setUrl(viewingOrigin);
            setError(null);
          }}
        >
          Use the address I&apos;m on now ({viewingOrigin})
        </button>
      )}
      <p id="email-link-domain-hint" className="text-theme-text-muted text-xs">
        {domain.allowed_hosts.length > 0 ? (
          <>
            Must be an address this server accepts: <code>{domain.allowed_hosts.join(', ')}</code>.
          </>
        ) : (
          <>
            This server has no public address configured yet, so one has to be added to <code>ALLOWED_ORIGINS</code>{' '}
            first.
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="text-theme-alert-danger-text text-sm">
          {error}
        </p>
      )}
      {domain.override_url && (
        <button type="button" className="btn-secondary btn-sm" disabled={saving} onClick={() => void handleRevert()}>
          Go back to the server setting
        </button>
      )}
    </div>
  );
};

/**
 * Shows the address every emailed link (password resets, ballots, approvals,
 * reminders) is built from, and lets an IT administrator holding
 * system.manage_link_domain change it. Everyone else with access to email
 * settings sees it read-only: the value redirects password-reset links for the
 * whole deployment, so it is gated above settings.manage.
 */
const EmailLinkDomainCard: React.FC = () => {
  const [domain, setDomain] = useState<EmailLinkDomain | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = useAuthStore((s) => s.checkPermission)(MANAGE_LINK_DOMAIN_PERMISSION);

  useEffect(() => {
    let cancelled = false;
    organizationService
      .getEmailLinkDomain()
      .then((result) => {
        if (!cancelled) setDomain(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load the email link address.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = async (url: string) => {
    try {
      await copyToClipboard(url);
      toast.success('Address copied');
    } catch {
      toast.error('Could not copy the address');
    }
  };

  const linkOrigin = domain ? originOf(domain.effective_url) : null;
  const viewingOrigin = typeof window !== 'undefined' ? window.location.origin : null;
  const mismatch = Boolean(
    domain && !domain.is_loopback && linkOrigin && viewingOrigin && linkOrigin !== viewingOrigin
  );

  return (
    <section aria-labelledby="email-link-domain-heading" className="border-theme-surface-border rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <Globe className="text-theme-text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h4 id="email-link-domain-heading" className="text-theme-text-primary text-sm font-semibold">
              Email link address
            </h4>
            <p className="text-theme-text-muted text-xs">
              Every link in an outgoing email — password resets, ballots, approvals, reminders — starts with this
              address. It applies to the whole installation.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-theme-text-secondary text-sm">
              {error}
            </p>
          )}

          {!domain && !error && <Skeleton className="h-9 w-full" />}

          {domain && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <code
                  data-testid="email-link-domain-url"
                  className="bg-theme-surface-secondary text-theme-text-primary rounded-sm px-2 py-1 text-sm break-all"
                >
                  {domain.effective_url || '(not set)'}
                </code>
                {domain.effective_url && (
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="Copy email link address"
                    onClick={() => void handleCopy(domain.effective_url)}
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <p className="text-theme-text-secondary text-xs">{sourceDescription(domain)}</p>

              {domain.is_loopback && (
                <div role="alert" className="alert-danger flex items-start gap-2 text-sm">
                  <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p className="text-theme-alert-danger-text">
                    This address only works on the server itself. Links in emails will not open for anyone who receives
                    them{domain.email_enabled ? '' : ' once email sending is turned on'}. Set it to the address members
                    use to reach this site.
                  </p>
                </div>
              )}

              {!domain.is_loopback && !domain.is_https && (
                <div className="alert-warning flex items-start gap-2 text-sm">
                  <AlertTriangle className="text-theme-alert-warning-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p className="text-theme-alert-warning-text">
                    This address uses <code>http://</code>, so emailed links — including password resets — are sent
                    unencrypted. Use an <code>https://</code> address if the site has one.
                  </p>
                </div>
              )}

              {mismatch && (
                <div className="alert-warning flex items-start gap-2 text-sm">
                  <AlertTriangle className="text-theme-alert-warning-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p className="text-theme-alert-warning-text">
                    You are viewing this site at <code>{viewingOrigin}</code>, but emails link to{' '}
                    <code>{linkOrigin}</code>. If members reach the site at the address you are using now, update the
                    email link address to match.
                  </p>
                </div>
              )}

              {canEdit && <LinkDomainEditor domain={domain} viewingOrigin={viewingOrigin} onChange={setDomain} />}

              <Collapsible title="Changing it on the server instead" className="text-sm">
                <div className="text-theme-text-secondary space-y-3 text-sm">
                  <p>
                    {canEdit
                      ? 'An address saved above takes priority. To set the default the server uses when nothing is saved here,'
                      : 'An IT administrator can change this address here. To set it on the server instead,'}{' '}
                    set the <code>FRONTEND_URL</code> environment variable on the backend to the full public address,
                    for example <code>https://logbook.yourdept.org</code>, then restart the backend.
                  </p>
                  <ul className="list-disc space-y-2 pl-5">
                    <li>
                      <strong>Docker Compose / Linux:</strong> edit <code>FRONTEND_URL=</code> in the <code>.env</code>{' '}
                      file next to <code>docker-compose.yml</code>, then run <code>docker compose up -d</code>.
                    </li>
                    <li>
                      <strong>Unraid:</strong> edit the container, set <em>Public Site Address</em>, and click Apply.
                    </li>
                    <li>
                      <strong>AWS or other hosting:</strong> set <code>FRONTEND_URL</code> in the backend service&apos;s
                      environment (task definition, parameter store or equivalent) and redeploy.
                    </li>
                  </ul>
                  <p>
                    Also make sure the same address is listed in <code>ALLOWED_ORIGINS</code>, or members will not be
                    able to sign in from it.
                  </p>
                </div>
              </Collapsible>
            </>
          )}
        </div>
      </div>
    </section>
  );
};

export default EmailLinkDomainCard;
