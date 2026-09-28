/**
 * Member Emails & Texts
 *
 * Lists every kind of email the application sends to members and officers,
 * whether a member can turn it off, and which alerts may also be texted.
 *
 * The classification is code (backend services/email_policy and SmsAlert),
 * so this page reports exactly what the senders enforce. The one thing a
 * department changes here is which optional emails it makes required for its
 * own members; every sender reads that list, so the switch is never
 * decorative (CLAUDE.md pitfall #19). Members then see those emails as
 * always sent rather than as a choice.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Lock, Mail, MessageSquare, ToggleRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs, SkeletonPage } from '../../../components/ux';
import { SettingsToggle } from '../../../components/settings/SettingsToggle';
import { emailTemplatesService } from '../../../services/api';
import type { MemberEmailKind, MemberEmailPolicy } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';

interface EmailKindCardProps {
  kind: MemberEmailKind;
  /** Present only for an optional kind the caller may make required. */
  onRequiredChange?: ((required: boolean) => void) | undefined;
  saving?: boolean;
}

const EmailKindCard: React.FC<EmailKindCardProps> = ({ kind, onRequiredChange, saving }) => (
  <li className="card-secondary p-4">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-theme-text-primary text-base font-semibold">{kind.label}</h3>
      {kind.audience === 'officers' && (
        <span className="badge bg-theme-surface-secondary text-theme-text-secondary">Officers</span>
      )}
      {!kind.required &&
        (kind.department_required ? (
          <span className="badge bg-theme-surface-secondary text-theme-text-secondary">
            Required by your department
          </span>
        ) : (
          <span className="badge bg-theme-surface-secondary text-theme-text-secondary">
            {kind.default_on ? 'On unless turned off' : 'Off unless turned on'}
          </span>
        ))}
    </div>
    <ul className="text-theme-text-secondary mt-2 list-disc space-y-0.5 pl-5 text-sm">
      {kind.includes.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
    <p className="text-theme-text-muted mt-2 text-xs">{kind.rationale}</p>
    {onRequiredChange && (
      <div className="border-theme-surface-border mt-3 flex items-center justify-between gap-3 border-t pt-3">
        <p className="text-theme-text-secondary text-sm">Required for our department</p>
        <SettingsToggle
          checked={kind.department_required}
          onChange={onRequiredChange}
          disabled={saving === true}
          label={`Require ${kind.label} for every member`}
        />
      </div>
    )}
  </li>
);

const MemberEmailsPage: React.FC = () => {
  const [policy, setPolicy] = useState<MemberEmailPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const setDepartmentRequired = async (key: string, required: boolean) => {
    if (!policy) return;
    const current = policy.emails.filter((k) => k.department_required).map((k) => k.key);
    const next = required ? [...current, key] : current.filter((k) => k !== key);
    setSaving(true);
    try {
      setPolicy(await emailTemplatesService.updateMemberEmailPolicy(next));
      toast.success(required ? 'Now required for every member' : 'Members can turn it off again');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to save that change.'));
    } finally {
      setSaving(false);
    }
  };

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
              {policy.can_edit
                ? ' Make one required and members will see it as always sent instead of as a choice.'
                : ''}
            </p>
            <ul className="grid gap-3 md:grid-cols-2">
              {optional.map((kind) => (
                <EmailKindCard
                  key={kind.key}
                  kind={kind}
                  saving={saving}
                  onRequiredChange={
                    policy.can_edit ? (required) => void setDepartmentRequired(kind.key, required) : undefined
                  }
                />
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
