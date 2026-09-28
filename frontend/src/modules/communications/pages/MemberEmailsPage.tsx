/**
 * Member Emails & Texts
 *
 * Lists every kind of email the application sends to members and officers,
 * whether a member can turn it off, and which alerts may also be texted.
 *
 * Read-only by design: the classification is code (backend
 * services/email_policy and SmsAlert), so this page reports exactly what the
 * senders enforce instead of offering a switch a sender might not read
 * (CLAUDE.md pitfall #19).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Lock, Mail, MessageSquare, ToggleRight } from 'lucide-react';
import { Breadcrumbs, SkeletonPage } from '../../../components/ux';
import { emailTemplatesService } from '../../../services/api';
import type { MemberEmailKind, MemberEmailPolicy } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';

const EmailKindCard: React.FC<{ kind: MemberEmailKind }> = ({ kind }) => (
  <li className="card-secondary p-4">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-theme-text-primary text-base font-semibold">{kind.label}</h3>
      {kind.audience === 'officers' && (
        <span className="badge bg-theme-surface-secondary text-theme-text-secondary">Officers</span>
      )}
      {!kind.required && (
        <span className="badge bg-theme-surface-secondary text-theme-text-secondary">
          {kind.default_on ? 'On unless turned off' : 'Off unless turned on'}
        </span>
      )}
    </div>
    <ul className="text-theme-text-secondary mt-2 list-disc space-y-0.5 pl-5 text-sm">
      {kind.includes.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
    <p className="text-theme-text-muted mt-2 text-xs">{kind.rationale}</p>
  </li>
);

const MemberEmailsPage: React.FC = () => {
  const [policy, setPolicy] = useState<MemberEmailPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPolicy(await emailTemplatesService.getMemberEmailPolicy());
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load the list of member emails.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!policy && !error) {
    return <SkeletonPage />;
  }

  const required = policy?.emails.filter((k) => k.required) ?? [];
  const optional = policy?.emails.filter((k) => !k.required) ?? [];

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Communications' }, { label: 'Member Emails & Texts' }]} />
      <h1 className="text-theme-text-primary mb-2 flex items-center gap-2 text-2xl font-bold">
        <Mail className="h-6 w-6 shrink-0" aria-hidden="true" />
        Member Emails &amp; Texts
      </h1>
      <p className="text-theme-text-secondary mb-6 text-sm">
        Every email this system sends to members and officers, and whether a member can turn it off. Turning off an
        email never removes the notice from the member&rsquo;s bell. Email to applicants, event requesters and addresses
        you type in yourself is not listed here.
      </p>

      {error && (
        <div role="alert" className="alert-danger mb-4 flex items-center gap-2">
          <AlertCircle className="text-theme-alert-danger-icon h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-theme-alert-danger-text text-sm">{error}</p>
        </div>
      )}

      {policy && (
        <div className="space-y-8">
          <section aria-labelledby="required-emails">
            <h2
              id="required-emails"
              className="text-theme-text-primary mb-1 flex items-center gap-2 text-lg font-semibold"
            >
              <Lock className="h-5 w-5 shrink-0" aria-hidden="true" />
              Always sent
            </h2>
            <p className="text-theme-text-muted mb-3 text-sm">
              Members cannot turn these off. The department needs to be able to show the member was told.
            </p>
            <ul className="grid gap-3 md:grid-cols-2">
              {required.map((kind) => (
                <EmailKindCard key={kind.key} kind={kind} />
              ))}
            </ul>
          </section>

          <section aria-labelledby="optional-emails">
            <h2
              id="optional-emails"
              className="text-theme-text-primary mb-1 flex items-center gap-2 text-lg font-semibold"
            >
              <ToggleRight className="h-5 w-5 shrink-0" aria-hidden="true" />
              Members can turn off
            </h2>
            <p className="text-theme-text-muted mb-3 text-sm">
              A member who turns off Email Notifications in their settings stops all of these at once.
            </p>
            <ul className="grid gap-3 md:grid-cols-2">
              {optional.map((kind) => (
                <EmailKindCard key={kind.key} kind={kind} />
              ))}
            </ul>
          </section>

          <section aria-labelledby="text-messages">
            <h2
              id="text-messages"
              className="text-theme-text-primary mb-1 flex items-center gap-2 text-lg font-semibold"
            >
              <MessageSquare className="h-5 w-5 shrink-0" aria-hidden="true" />
              Text messages
            </h2>
            <p className="text-theme-text-muted mb-3 text-sm">
              Texts are only ever sent in addition to an email, and only for these alerts.
            </p>
            <ul className="mb-4 grid gap-3 md:grid-cols-2">
              {policy.texts.map((alert) => (
                <li key={alert.key} className="card-secondary p-4">
                  <h3 className="text-theme-text-primary text-base font-semibold">{alert.label}</h3>
                  <p className="text-theme-text-secondary mt-1 text-sm">{alert.description}</p>
                </li>
              ))}
            </ul>
            <h3 className="text-theme-text-primary mb-1 text-sm font-semibold">A member is texted only when</h3>
            <ul className="text-theme-text-secondary list-disc space-y-0.5 pl-5 text-sm">
              {policy.text_conditions.map((condition) => (
                <li key={condition}>{condition}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
};

export default MemberEmailsPage;
