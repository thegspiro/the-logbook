/**
 * Mounted once at the app root. Registers the prompt that `requestStepUp()`
 * (utils/stepUp.ts) opens when the server asks for re-verification, so any
 * screen's sensitive action gets one without knowing about it.
 *
 * Authenticator code for a member with MFA, password for one without — the
 * same proof the server will accept (POST /auth/step-up).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '../components/Modal';
import { authService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';
import { registerStepUpRequester } from '../utils/stepUp';

export const StepUpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mfaEnabled = useAuthStore((s) => Boolean(s.user?.mfa_enabled));
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const settle = useRef<((verified: boolean) => void) | null>(null);

  const finish = useCallback((verified: boolean) => {
    settle.current?.(verified);
    settle.current = null;
    setOpen(false);
    setValue('');
    setError(null);
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

  const submit = async () => {
    const proof = value.trim();
    if (!proof || busy) return;
    setBusy(true);
    setError(null);
    try {
      await authService.stepUp(mfaEnabled ? { code: proof } : { password: value });
      finish(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Verification failed. Try again.'));
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
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || value.trim().length === 0}
              className="btn-primary inline-flex items-center justify-center gap-2 font-medium"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Confirm
            </button>
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
          <div>
            <label htmlFor="stepup-proof" className="form-label">
              {mfaEnabled ? 'Authenticator code' : 'Password'}
            </label>
            <input
              id="stepup-proof"
              className="form-input"
              type={mfaEnabled ? 'text' : 'password'}
              inputMode={mfaEnabled ? 'numeric' : undefined}
              autoComplete={mfaEnabled ? 'one-time-code' : 'current-password'}
              maxLength={mfaEnabled ? 6 : 1024}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'stepup-error' : undefined}
            />
            {error && (
              <p id="stepup-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </div>
        </form>
      </Modal>
    </>
  );
};

export default StepUpProvider;
