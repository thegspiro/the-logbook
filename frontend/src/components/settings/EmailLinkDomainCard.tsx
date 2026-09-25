import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Copy, Globe } from 'lucide-react';
import { Collapsible } from '../ux/Collapsible';
import { Skeleton } from '../ux/Skeleton';
import { EmailLinkDomainSource } from '../../constants/enums';
import { organizationService } from '../../services/userServices';
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
    case EmailLinkDomainSource.UNRESOLVED_LOOPBACK:
      return (
        <>
          <code>FRONTEND_URL</code> has not been set to a public address, and <code>ALLOWED_ORIGINS</code> has none to
          fall back on.
        </>
      );
  }
};

/**
 * Shows the address every emailed link (password resets, ballots, approvals,
 * reminders) is built from. It is deployment configuration read at startup,
 * not an organization setting, so this card reports it and explains where to
 * change it rather than offering a field: links are deliberately pinned to
 * server configuration so that no request — and no stored setting an account
 * could alter — decides where a password-reset link sends someone.
 */
const EmailLinkDomainCard: React.FC = () => {
  const [domain, setDomain] = useState<EmailLinkDomain | null>(null);
  const [error, setError] = useState<string | null>(null);

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

              <Collapsible title="How to change this address" className="text-sm">
                <div className="text-theme-text-secondary space-y-3 text-sm">
                  <p>
                    Set the <code>FRONTEND_URL</code> environment variable on the backend to the full public address,
                    for example <code>https://logbook.yourdept.org</code>, then restart the backend. The change cannot
                    be made from this screen because it is read when the server starts.
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
