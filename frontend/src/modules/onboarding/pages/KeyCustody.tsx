import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { KeyRound } from 'lucide-react';
import { OnboardingHeader, ProgressIndicator, ResetProgressButton, ErrorAlert } from '../components';
import { useOnboardingStore } from '../store';
import { useApiRequest } from '../hooks';
import { apiClient } from '../services/api-client';
import { nextStepPath } from '../config/steps';

/**
 * Encryption key step — the one thing setup cannot finish without
 * (docs/FILE_STORAGE_HARDENING.md decision 25).
 *
 * Stored files and sensitive fields are encrypted with the server's
 * ENCRYPTION_KEY and ENCRYPTION_SALT. Lose them and no backup brings the data
 * back; keep them beside the backups and the backups are readable by whoever
 * holds them. This page cannot check where the key is kept, so it asks the
 * administrator to confirm it and records who did. There is no skip: the
 * backend refuses to complete setup until this step is done.
 */
const KeyCustody: React.FC = () => {
  const navigate = useNavigate();
  const departmentName = useOnboardingStore((state) => state.departmentName);
  const logoPreview = useOnboardingStore((state) => state.logoData);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [alreadyConfirmed, setAlreadyConfirmed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const { execute, error, canRetry, clearError, isLoading } = useApiRequest();

  useEffect(() => {
    if (!departmentName) {
      void navigate('/onboarding/start');
    }
  }, [departmentName, navigate]);

  const loadFingerprint = React.useCallback(async () => {
    const { data } = await execute(
      async () => {
        const response = await apiClient.getKeyCustody();
        if (response.error || !response.data) {
          throw new Error(response.error || 'Could not read the encryption key status');
        }
        return response.data;
      },
      { step: 'Encryption Key', action: 'Load key fingerprint' }
    );
    if (data) {
      setFingerprint(data.key_fingerprint);
      setAlreadyConfirmed(data.confirmed);
      if (data.confirmed) setAcknowledged(true);
    }
  }, [execute]);

  useEffect(() => {
    void loadFingerprint();
  }, [loadFingerprint]);

  const handleContinue = async () => {
    if (!fingerprint || !acknowledged) return;
    clearError();
    const { error: apiError } = await execute(
      async () => {
        const response = await apiClient.confirmKeyCustody(fingerprint);
        if (response.error) {
          throw new Error(response.error);
        }
        return response;
      },
      { step: 'Encryption Key', action: 'Confirm key is stored separately' }
    );
    if (apiError) {
      // A 409 means the server's key changed since this page loaded. Retry
      // re-reads the fingerprint and the box must be ticked again, so a key
      // nobody looked at is never confirmed on the administrator's behalf.
      setAcknowledged(false);
      return;
    }
    void navigate(nextStepPath('key_custody'));
  };

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to safe-top flex min-h-screen flex-col bg-linear-to-br">
      <OnboardingHeader departmentName={departmentName} logoPreview={logoPreview} />

      <main id="main-content" tabIndex={-1} className="flex flex-1 items-start justify-center p-4 py-8">
        <div className="w-full max-w-2xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
              <KeyRound className="h-7 w-7 text-red-500" aria-hidden="true" />
            </div>
            <h2 className="text-theme-text-primary text-2xl font-bold">Keep the Encryption Key Safe</h2>
            <p className="text-theme-text-secondary mx-auto mt-2 max-w-xl text-sm">
              Every document, attachment and sensitive field this system stores is encrypted with a key that lives only
              in the server&apos;s configuration.
            </p>
          </div>

          <div className="card space-y-4 p-6 text-sm">
            <ul className="text-theme-text-secondary list-disc space-y-2 pl-5">
              <li>
                The key is the <code className="font-mono">ENCRYPTION_KEY</code> and{' '}
                <code className="font-mono">ENCRYPTION_SALT</code> values in the server&apos;s{' '}
                <code className="font-mono">.env</code> file.
              </li>
              <li>
                <strong className="text-theme-text-primary">If they are lost, nothing can recover your data</strong> —
                not a database backup, not a copy of the uploads folder, not support.
              </li>
              <li>
                <strong className="text-theme-text-primary">If they are stored with your backups</strong>, anyone who
                gets hold of a backup can read everything in it.
              </li>
              <li>
                Ask whoever runs the server to keep a copy of both values somewhere else — a password manager or a
                sealed record held by the chief — and never in the same place as the backups.
              </li>
            </ul>

            {fingerprint && (
              <p className="text-theme-text-secondary">
                Key fingerprint: <code className="text-theme-text-primary font-mono">{fingerprint}</code>
                <span className="text-theme-text-muted block text-xs">
                  Identifies the key without revealing it. It changes if the key is ever replaced.
                </span>
              </p>
            )}

            {alreadyConfirmed && (
              <p className="alert-success text-sm">This key has already been confirmed as stored separately.</p>
            )}

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5"
                checked={acknowledged}
                disabled={!fingerprint || isLoading}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span className="text-theme-text-primary">
                A copy of ENCRYPTION_KEY and ENCRYPTION_SALT is stored somewhere other than this server and its backups.
              </span>
            </label>
          </div>

          {error && (
            <div className="mt-4">
              <ErrorAlert
                message={error}
                canRetry={canRetry}
                onRetry={() => void loadFingerprint()}
                onDismiss={clearError}
              />
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => void handleContinue()}
              disabled={isLoading || !fingerprint || !acknowledged}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : 'Confirm and Continue'}
            </button>
          </div>

          <div className="mt-6 flex items-center justify-end">
            <ResetProgressButton />
          </div>

          <ProgressIndicator step="key_custody" className="border-theme-nav-border mt-6 border-t pt-6" />
        </div>
      </main>
    </div>
  );
};

export default KeyCustody;
