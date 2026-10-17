/**
 * The member's directory account (Google Workspace or Microsoft 365), and a
 * Retry for whatever is unfinished.
 *
 * The Logbook creates the account when an applicant is converted to a member,
 * after the conversion commits — so a Google failure never undoes the
 * conversion, and lands here instead. Officers with members.manage only; the
 * endpoints enforce it independently.
 *
 * The page renders it only for a member The Logbook made an account record
 * for (see hooks/useMemberGoogleAccount), and only while the Google Workspace
 * integration is connected.
 */

import React, { useState } from 'react';
import { AlertTriangle, Mail, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { googleAccountService } from '../services/googleAccountService';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { GOOGLE_ACCOUNT_STATUS_COLORS, GoogleAccountStatus } from '../../../constants/enums';
import type { GoogleAccount } from '../types/googleAccount';
import { directoryVendor, retryAction } from '../constants/googleAccount';

const STATUS_LABELS: Record<GoogleAccountStatus, string> = {
  pending: 'Being created',
  created: 'Created',
  linked_existing: 'Existing account',
  failed: 'Not created',
};

const ACTION_LABELS: Record<NonNullable<ReturnType<typeof retryAction>>, (account: GoogleAccount) => string> = {
  suspension: (account) => (account.suspension_wanted ? 'Retry suspending' : 'Retry unsuspending'),
  create: () => 'Retry creating account',
  finish: () => 'Finish setup',
};

interface GoogleAccountPanelProps {
  userId: string;
  account: GoogleAccount;
  onChange: (account: GoogleAccount | null) => void;
  onReload: () => Promise<void>;
}

export const GoogleAccountPanel: React.FC<GoogleAccountPanelProps> = ({ userId, account, onChange, onReload }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [retrying, setRetrying] = useState(false);
  const vendor = directoryVendor(account.provider);

  const handleRetry = async () => {
    // Only a created account whose password never arrived is reset: nobody
    // can have signed in with a password nobody received.
    if (
      retryAction(account) === 'finish' &&
      account.status === GoogleAccountStatus.CREATED &&
      !account.credentials_sent
    ) {
      const ok = await confirm({
        title: `Send a new ${vendor} password?`,
        message:
          `This sets a new temporary password on the ${vendor} account and emails it to the member’s personal ` +
          `address. ${vendor} asks them to change it at first sign-in.`,
        confirmLabel: 'Send new password',
        cancelLabel: 'Not now',
        variant: 'warning',
      });
      if (!ok) return;
    }
    setRetrying(true);
    try {
      const data = await googleAccountService.retry(userId);
      onChange(data.account);
      toast.success(`${vendor} account updated`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, `The ${vendor} account could not be updated`));
      void onReload();
    } finally {
      setRetrying(false);
    }
  };

  const action = retryAction(account);

  return (
    <div className="card p-6">
      <h2 className="text-theme-text-primary mb-4 flex items-center gap-2 text-lg font-semibold">
        <Mail className="h-5 w-5" aria-hidden="true" />
        {account.provider_name}
      </h2>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-theme-text-primary font-mono break-all">{account.primary_email}</span>
          <span className={`badge ${GOOGLE_ACCOUNT_STATUS_COLORS[account.status] ?? ''}`}>
            {STATUS_LABELS[account.status] ?? account.status}
          </span>
          {account.suspension_wanted && account.suspension_settled && (
            <span className="badge bg-theme-surface-secondary text-theme-text-secondary">Suspended</span>
          )}
        </div>
        {account.status === GoogleAccountStatus.CREATED && (
          <p className="text-theme-text-secondary">
            {account.credentials_sent
              ? 'The temporary password was emailed to the member’s personal address.'
              : 'The member has not been sent a password for this account.'}
          </p>
        )}
        {account.suspension_wanted && account.suspension_settled && (
          <p className="text-theme-text-secondary" data-testid="google-suspension">
            {account.suspended_by_logbook
              ? `Suspended when the member left${
                  account.suspended_at ? ` (${formatDateTime(account.suspended_at, tz)})` : ''
                }. It is lifted automatically if they return.`
              : `It was already suspended in ${vendor} when the member left, so The Logbook will not lift it if they return.`}
          </p>
        )}
        {!account.suspension_settled && (
          <p className="text-theme-text-secondary" data-testid="google-suspension">
            {account.suspension_wanted
              ? 'The member has left, but the account is not suspended yet.'
              : 'The member has returned, but the account is still suspended.'}
          </p>
        )}
        {account.suspension_error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{account.suspension_error}</p>
          </div>
        )}
        {account.license_pending && (
          <p className="text-theme-text-secondary">
            Not licensed yet, so the account has no mailbox. Retry assigns the license.
          </p>
        )}
        {account.managed_on_premises && (
          <p className="text-theme-text-secondary" data-testid="directory-on-premises">
            This account is synced from on-premises Active Directory. The Logbook cannot suspend it; disable it in
            Active Directory when the member leaves.
          </p>
        )}
        {account.pending_groups.length > 0 && (
          <p className="text-theme-text-secondary">Not yet added to: {account.pending_groups.join(', ')}</p>
        )}
        {account.last_error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{account.last_error}</p>
          </div>
        )}
        {account.last_attempt_at && (
          <p className="text-theme-text-muted text-xs">Last attempt {formatDateTime(account.last_attempt_at, tz)}</p>
        )}
        {action && (
          <button
            type="button"
            onClick={() => void handleRetry()}
            disabled={retrying}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {retrying ? 'Working…' : ACTION_LABELS[action](account)}
          </button>
        )}
      </div>
    </div>
  );
};
