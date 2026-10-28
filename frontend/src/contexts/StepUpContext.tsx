/**
 * Mounted once at the app root. Registers the prompt that `requestStepUp()`
 * (utils/stepUp.ts) opens when the server asks for re-verification, so any
 * screen's sensitive action gets one without knowing about it.
 *
 * The proof is the one the server will accept (POST /auth/step-up): the
 * member's passkey or authenticator code when they have a second factor,
 * otherwise their password. A member with only a passkey is not offered the
 * password, because the server refuses it for them.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint, Loader2 } from 'lucide-react';
import { Modal } from '../components/Modal';
import { authService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';
import {
  getPasskeyAssertion,
  passkeyPromptError,
  passkeysSupported,
  type PasskeyRequestOptions,
} from '../utils/passkeys';
import { registerStepUpRequester } from '../utils/stepUp';

export const StepUpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mfaEnabled = useAuthStore((s) => Boolean(s.user?.mfa_enabled));
  const hasPasskey = useAuthStore((s) => (s.user?.passkey_count ?? 0) > 0);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Fetched when the dialog opens, so the tap on "Use your passkey" goes
  // straight to the browser prompt (Safari only shows it from a direct tap).
  const [passkeyOptions, setPasskeyOptions] = useState<PasskeyRequestOptions | null>(null);
  const settle = useRef<((verified: boolean) => void) | null>(null);

  const offerPasskey = hasPasskey && passkeysSupported();
  // The typed field: an authenticator code, or the password for a member with
  // no second factor. None for a passkey-only member.
  const typedProof: 'code' | 'password' | null = mfaEnabled ? 'code' : hasPasskey ? null : 'password';

  const loadPasskeyOptions = useCallback(async () => {
    try {
      setPasskeyOptions(await authService.getStepUpPasskeyOptions());
    } catch (err: unknown) {
      setPasskeyOptions(null);
      setError(getErrorMessage(err, 'Could not start the passkey check.'));
    }
  }, []);

  const finish = useCallback((verified: boolean) => {
    settle.current?.(verified);
    settle.current = null;
    setOpen(false);
    setValue('');
    setError(null);
    setPasskeyOptions(null);
  }, []);

  useEffect(() => {
    registerStepUpRequester(
      () =>
        new Promise<boolean>((resolve) => {
          settle.current?.(false);
          settle.current = resolve;
          setValue('');
          setError(null);
          setOpen(true);
        })
    );
    return () => {
      registerStepUpRequester(null);
      settle.current?.(false);
      settle.current = null;
    };
  }, []);

  useEffect(() => {
    if (open && offerPasskey) void loadPasskeyOptions();
  }, [open, offerPasskey, loadPasskeyOptions]);

  const submit = async () => {
    const proof = value.trim();
    if (!proof || busy || typedProof === null) return;
    setBusy(true);
    setError(null);
    try {
      await authService.stepUp(typedProof === 'code' ? { code: proof } : { password: value });
      finish(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Verification failed. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const confirmWithPasskey = async () => {
    if (!passkeyOptions || busy) return;
    setBusy(true);
    setError(null);
    try {
      let credential;
      try {
        credential = await getPasskeyAssertion(passkeyOptions);
      } catch (err: unknown) {
        setError(passkeyPromptError(err));
        void loadPasskeyOptions();
        return;
      }
      try {
        await authService.stepUp({ passkey_credential: credential });
        finish(true);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Verification failed. Try again.'));
        void loadPasskeyOptions();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {children}
      <Modal
        isOpen={open}
        onClose={() => finish(false)}
        title="Confirm it's you"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => finish(false)}
              disabled={busy}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            {typedProof !== null && (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || value.trim().length === 0}
                className="btn-primary inline-flex items-center justify-center gap-2 font-medium"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Confirm
              </button>
            )}
          </div>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-theme-text-secondary text-sm">
            This action needs a recent confirmation. Once confirmed, other sensitive actions stay open for a few
            minutes.
          </p>
          {offerPasskey && (
            <button
              type="button"
              onClick={() => void confirmWithPasskey()}
              disabled={busy || !passkeyOptions}
              className="btn-primary inline-flex w-full items-center justify-center gap-2 font-medium"
            >
              <Fingerprint className="h-4 w-4" aria-hidden="true" />
              Use your passkey
            </button>
          )}
          {hasPasskey && !offerPasskey && typedProof === null && (
            <p className="text-theme-text-secondary text-sm">
              This browser cannot use passkeys. Open The Logbook in a current browser on a device with your passkey.
            </p>
          )}
          {typedProof !== null && (
            <div>
              <label htmlFor="stepup-proof" className="form-label">
                {typedProof === 'code' ? 'Authenticator code' : 'Password'}
              </label>
              <input
                id="stepup-proof"
                className="form-input"
                type={typedProof === 'code' ? 'text' : 'password'}
                inputMode={typedProof === 'code' ? 'numeric' : undefined}
                autoComplete={typedProof === 'code' ? 'one-time-code' : 'current-password'}
                maxLength={typedProof === 'code' ? 6 : 1024}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'stepup-error' : undefined}
              />
            </div>
          )}
          {error && (
            <p id="stepup-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </form>
      </Modal>
    </>
  );
};

export default StepUpProvider;
