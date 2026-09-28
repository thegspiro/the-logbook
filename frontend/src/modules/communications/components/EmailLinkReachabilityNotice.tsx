/**
 * A warning at the top of Email Templates when emailed links would not open.
 *
 * Every link and the logo in an email are built from the deployment's link
 * address. When that address only works on the server itself, or only inside
 * the station's network, the templates here look right in the preview (the
 * admin is on that network) and are broken for the members who receive them.
 * The address itself is changed on the Email settings screen; this only says
 * so where people are looking at the emails.
 *
 * Silent when the address is public, and when it cannot be read — a user who
 * lacks the settings permission gets nothing rather than an error about a
 * setting they cannot change.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router';
import { organizationService } from '../../../services/api';
import type { EmailLinkDomain } from '../../../types/user';

const EMAIL_SETTINGS_PATH = '/settings?tab=email';

export const EmailLinkReachabilityNotice: React.FC = () => {
  const [domain, setDomain] = useState<EmailLinkDomain | null>(null);

  useEffect(() => {
    let cancelled = false;
    organizationService
      .getEmailLinkDomain()
      .then((result) => {
        if (!cancelled) setDomain(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!domain || !(domain.is_loopback || domain.is_private_network)) return null;

  const where = domain.is_loopback ? 'the server itself' : "your station's network";
  return (
    <div role="alert" className="alert-warning mb-4 flex items-start gap-2 text-sm">
      <AlertTriangle className="text-theme-alert-warning-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="text-theme-alert-warning-text">
        Emails link to <code>{domain.effective_url}</code>, which only works on {where}. Links and the logo in these
        emails will not open for members reading them elsewhere, even though they look right here.{' '}
        <Link to={EMAIL_SETTINGS_PATH} className="underline">
          Change the email link address
        </Link>
        .
      </p>
    </div>
  );
};
