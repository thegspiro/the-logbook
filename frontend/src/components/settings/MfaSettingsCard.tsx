/**
 * MFA settings card — enroll in / disable two-factor authentication (TOTP).
 *
 * Enrollment: request a secret + otpauth URI, show a QR code, verify a code,
 * then display one-time recovery codes (shown exactly once). Disabling
 * requires a current authenticator code.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck, ShieldOff, Loader2, Copy } from 'lucide-react';
import { authService } from '../../services/authService';
import { getErrorMessage } from '../../utils/errorHandling';

type Step = 'idle' | 'enrolling' | 'recovery';

// Warn the member to generate fresh codes once they're running low.
const LOW_RECOVERY_THRESHOLD = 3;

const inputCls =
  'w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-violet-500';

export const MfaSettingsCard: React.FC<{ onChange?: () => void }> = ({ onChange }) => {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [recoveryRemaining, setRecoveryRemaining] = useState(0);
  const [step, setStep] = useState<Step>('idle');
  const [busy, setBusy] = useState(false);

  const [secret, setSecret] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disableCode, setDisableCode] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [regenCode, setRegenCode] = useState('');
  const [showRegen, setShowRegen] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const status = await authService.getMfaStatus();
      setEnabled(status.mfa_enabled);
      setRecoveryRemaining(status.recovery_codes_remaining);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load MFA status'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const startEnroll = async () => {
    setBusy(true);
    try {
      const data = await authService.setupMfa();
      setSecret(data.secret);
      setQrUrl(data.qr_code_url);
      setCode('');
      setStep('enrolling');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not start MFA setup'));
    } finally {
      setBusy(false);
    }
  };

  const confirmEnroll = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const res = await authService.verifyMfaSetup(code.trim());
      setRecoveryCodes(res.recovery_codes);
      setStep('recovery');
      toast.success('Two-factor authentication enabled');
      await loadStatus();
      onChange?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Invalid code — please try again'));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!disableCode.trim()) return;
    setBusy(true);
    try {
      await authService.disableMfa(disableCode.trim());
      toast.success('Two-factor authentication disabled');
      setShowDisable(false);
      setDisableCode('');
      await loadStatus();
      onChange?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not disable MFA — check your code'));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (!regenCode.trim()) return;
    setBusy(true);
    try {
      const res = await authService.regenerateRecoveryCodes(regenCode.trim());
      setRecoveryCodes(res.recovery_codes);
      setShowRegen(false);
      setRegenCode('');
      setStep('recovery');
      toast.success('New recovery codes generated');
      await loadStatus();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not regenerate codes — check your code'));
    } finally {
      setBusy(false);
    }
  };

  const copyRecovery = () => {
    void navigator.clipboard?.writeText(recoveryCodes.join('\n'));
    toast.success('Recovery codes copied');
  };

  if (loading) {
    return (
      <div className="text-theme-text-muted flex items-center gap-2 py-4" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  // One-time recovery code display after enabling.
  if (step === 'recovery') {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Save your recovery codes</p>
          <p className="text-theme-text-muted mt-1 text-xs">
            Each code works once if you lose your authenticator. They won't be shown again.
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
            onClick={copyRecovery}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm"
          >
            <Copy className="h-4 w-4" /> Copy codes
          </button>
          <button
            onClick={() => setStep('idle')}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // Enrollment QR + verify.
  if (step === 'enrolling') {
    return (
      <div className="space-y-4">
        <p className="text-theme-text-secondary text-sm">
          Scan this QR code with an authenticator app (Google Authenticator, Authy, 1Password…), then enter the 6-digit
          code to confirm.
        </p>
        <div className="mx-auto flex w-fit justify-center rounded-lg bg-white p-4">
          {qrUrl && <QRCodeSVG value={qrUrl} size={176} />}
        </div>
        <p className="text-theme-text-muted text-center text-xs break-all">
          Can't scan? Enter this key manually: <span className="font-mono">{secret}</span>
        </p>
        <div>
          <label htmlFor="mfa-setup-code" className="text-theme-text-secondary mb-1 block text-sm font-medium">
            Authenticator code
          </label>
          <input
            id="mfa-setup-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className={inputCls}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              void confirmEnroll();
            }}
            disabled={busy || !code.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Verify & enable
          </button>
          <button
            onClick={() => setStep('idle')}
            className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Idle: show status + enable/disable.
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {enabled ? (
          <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
        ) : (
          <ShieldOff className="text-theme-text-muted h-5 w-5" />
        )}
        <span className="text-theme-text-primary text-sm">
          Two-factor authentication is <strong>{enabled ? 'on' : 'off'}</strong>
          {enabled && ` · ${recoveryRemaining} recovery code${recoveryRemaining === 1 ? '' : 's'} left`}
        </span>
      </div>

      {enabled && recoveryRemaining <= LOW_RECOVERY_THRESHOLD && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3" role="status">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {recoveryRemaining === 0
              ? 'You have no recovery codes left. Generate a new set so you can still get in if you lose your authenticator.'
              : `You're running low on recovery codes (${recoveryRemaining} left). Generate a fresh set to be safe.`}
          </p>
        </div>
      )}

      {!enabled && (
        <button
          onClick={() => {
            void startEnroll();
          }}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Enable two-factor authentication
        </button>
      )}

      {enabled && !showDisable && !showRegen && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowRegen(true)}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm"
          >
            Regenerate recovery codes
          </button>
          <button
            onClick={() => setShowDisable(true)}
            className="rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-700 hover:bg-red-500/10 dark:text-red-400"
          >
            Disable
          </button>
        </div>
      )}

      {enabled && showRegen && (
        <div className="space-y-2">
          <label htmlFor="mfa-regen-code" className="text-theme-text-secondary block text-sm font-medium">
            Enter a current authenticator code to generate new recovery codes
          </label>
          <p className="text-theme-text-muted text-xs">
            This replaces your existing recovery codes — the old ones stop working.
          </p>
          <input
            id="mfa-regen-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={regenCode}
            onChange={(e) => setRegenCode(e.target.value)}
            placeholder="123456"
            className={inputCls}
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                void regenerate();
              }}
              disabled={busy || !regenCode.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Generate new codes
            </button>
            <button
              onClick={() => {
                setShowRegen(false);
                setRegenCode('');
              }}
              className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {enabled && showDisable && (
        <div className="space-y-2">
          <label htmlFor="mfa-disable-code" className="text-theme-text-secondary block text-sm font-medium">
            Enter a current authenticator code to disable
          </label>
          <input
            id="mfa-disable-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            placeholder="123456"
            className={inputCls}
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                void disable();
              }}
              disabled={busy || !disableCode.trim()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Confirm disable
            </button>
            <button
              onClick={() => {
                setShowDisable(false);
                setDisableCode('');
              }}
              className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
