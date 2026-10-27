/**
 * Passkeys card — add, list and remove the passkeys a member uses as their
 * second factor (Face ID, a fingerprint or the device PIN on their phone or
 * computer), up to the server's limit.
 *
 * Adding is two taps on purpose: the first fetches a challenge (and may ask
 * the member to confirm it's them), the second opens the browser prompt.
 * Safari only shows that prompt from a direct tap, so no request may sit
 * between the tap and the prompt.
 *
 * A member whose only second factor is a passkey manages their recovery
 * codes here; one with the authenticator app manages them on that card.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, Fingerprint, Loader2, Trash2 } from 'lucide-react';
import { authService } from '../../services/authService';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTimezone } from '../../hooks/useTimezone';
import type { PasskeyList } from '../../types/auth';
import { formatDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import {
  createPasskey,
  isPasskeyPromptError,
  passkeyPromptError,
  passkeysSupported,
  type PasskeyCreationOptions,
} from '../../utils/passkeys';

const NAME_MAX = 100;

export const PasskeySettingsCard: React.FC<{ onChange?: () => void }> = ({ onChange }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<PasskeyList | null>(null);
  const [authenticatorOn, setAuthenticatorOn] = useState(false);
  const [recoveryRemaining, setRecoveryRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [creationOptions, setCreationOptions] = useState<PasskeyCreationOptions | null>(null);
  const [name, setName] = useState('My phone');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [passkeys, status] = await Promise.all([authService.listPasskeys(), authService.getMfaStatus()]);
      setList(passkeys);
      setAuthenticatorOn(status.mfa_enabled);
      setRecoveryRemaining(status.recovery_codes_remaining);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not load your passkeys'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startAdd = async () => {
    setBusy(true);
    try {
      setCreationOptions(await authService.getPasskeyRegistrationOptions());
      setName('My phone');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not start adding a passkey'));
    } finally {
      setBusy(false);
    }
  };

  const finishAdd = async () => {
    const label = name.trim();
    if (!creationOptions || !label || busy) return;
    setBusy(true);
    try {
      const credential = await createPasskey(creationOptions);
      const result = await authService.registerPasskey(label, credential);
      setCreationOptions(null);
      toast.success('Passkey added');
      await load();
      if (result.recovery_codes.length > 0) {
        // Shown once. The parent is told when they are dismissed, because
        // reloading the signed-in user remounts this card and would drop them.
        setRecoveryCodes(result.recovery_codes);
      } else {
        onChange?.();
      }
    } catch (err) {
      // The challenge is single-use either way, so a retry starts over.
      setCreationOptions(null);
      toast.error(
        isPasskeyPromptError(err) ? passkeyPromptError(err) : getErrorMessage(err, 'Could not add the passkey')
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, label: string) => {
    const ok = await confirm({
      title: 'Remove passkey',
      message: `"${label}" will stop working for sign-in on this account. You can add it again later.`,
      confirmLabel: 'Remove passkey',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await authService.deletePasskey(id);
      toast.success('Passkey removed');
      await load();
      onChange?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not remove the passkey'));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    const ok = await confirm({
      title: 'New recovery codes',
      message: 'Your current recovery codes will stop working, and a new set will be shown once.',
      confirmLabel: 'Generate new codes',
      cancelLabel: 'Keep current codes',
      variant: 'warning',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await authService.regeneratePasskeyRecoveryCodes();
      setRecoveryCodes(res.recovery_codes);
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not generate new recovery codes'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="text-theme-text-muted flex items-center gap-2 py-4" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (recoveryCodes.length > 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Save your recovery codes</p>
          <p className="text-theme-text-muted mt-1 text-xs">
            Each code signs you in once if you lose your phone. They won't be shown again.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-sm">
          {recoveryCodes.map((c) => (
            <span key={c} className="bg-theme-surface-hover text-theme-text-primary rounded px-2 py-1 text-center">
              {c}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(recoveryCodes.join('\n'));
              toast.success('Recovery codes copied');
            }}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm"
          >
            <Copy className="h-4 w-4" /> Copy codes
          </button>
          <button
            type="button"
            onClick={() => {
              setRecoveryCodes([]);
              onChange?.();
            }}
            className="btn-primary text-sm font-medium"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (!list) return null;

  if (!list.available) {
    return (
      <p className="text-theme-text-secondary text-sm">
        Passkeys need The Logbook to be reached over HTTPS at its web address. Ask your administrator, or use an
        authenticator app below.
      </p>
    );
  }

  const supported = passkeysSupported();
  const atLimit = list.passkeys.length >= list.max_passkeys;
  const passkeyOnly = list.passkeys.length > 0 && !authenticatorOn;

  return (
    <div className="space-y-4">
      {list.passkeys.length === 0 ? (
        <p className="text-theme-text-secondary text-sm">
          You have no passkeys. A passkey lets you confirm sign-in with Face ID, a fingerprint or your phone's PIN
          instead of typing a code.
        </p>
      ) : (
        <ul className="divide-theme-surface-border border-theme-surface-border divide-y rounded-lg border">
          {list.passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-theme-text-primary truncate text-sm font-medium">{p.name}</p>
                <p className="text-theme-text-muted text-xs">
                  {p.backed_up ? 'Syncs across your devices' : 'This device only'} · Added{' '}
                  {formatDate(p.created_at, tz)}
                  {p.last_used_at ? ` · Last used ${formatDate(p.last_used_at, tz)}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(p.id, p.name)}
                disabled={busy}
                aria-label={`Remove passkey ${p.name}`}
                className="btn-icon rounded-lg text-red-700 hover:bg-red-500/10 dark:text-red-400"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!list.allowed && (
        <p className="text-theme-text-secondary text-sm" role="status">
          Your organization has turned off adding new passkeys. Ones you already have keep working.
        </p>
      )}
      {list.allowed && !supported && (
        <p className="text-theme-text-secondary text-sm" role="status">
          This browser cannot create passkeys. Open The Logbook in a current browser on your phone or computer.
        </p>
      )}
      {list.allowed && supported && atLimit && (
        <p className="text-theme-text-secondary text-sm" role="status">
          You have the most passkeys allowed ({list.max_passkeys}). Remove one to add another.
        </p>
      )}

      {list.allowed && supported && !atLimit && !creationOptions && (
        <button
          type="button"
          onClick={() => void startAdd()}
          disabled={busy}
          className="btn-primary inline-flex items-center gap-1.5 text-sm font-medium"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />} Add a passkey
        </button>
      )}

      {creationOptions && (
        <div className="space-y-2">
          <label htmlFor="passkey-name" className="form-label">
            Name this passkey
          </label>
          <p className="text-theme-text-muted text-xs">So you can tell your devices apart later.</p>
          <input
            id="passkey-name"
            className="form-input"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void finishAdd()}
              disabled={busy || !name.trim()}
              className="btn-primary inline-flex items-center gap-1.5 text-sm font-medium"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create passkey
            </button>
            <button
              type="button"
              onClick={() => setCreationOptions(null)}
              disabled={busy}
              className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {passkeyOnly && (
        <div className="border-theme-surface-border space-y-2 border-t pt-4">
          <p className="text-theme-text-primary text-sm">
            {recoveryRemaining} recovery code{recoveryRemaining === 1 ? '' : 's'} left
          </p>
          <p className="text-theme-text-muted text-xs">
            Recovery codes get you in if you lose your phone. Keep them somewhere safe.
          </p>
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={busy}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm"
          >
            Generate new recovery codes
          </button>
        </div>
      )}
    </div>
  );
};
