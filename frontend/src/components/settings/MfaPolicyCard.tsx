/**
 * Admin controls for the org-wide MFA requirement and for passkeys. When MFA
 * is required, members who haven't set up a second factor are forced into
 * enrollment before using the app (enforced server-side in get_current_user).
 *
 * Turning passkeys off stops members adding new ones; passkeys already
 * registered keep working, so no member silently loses their second factor.
 * The switch is hidden against a server too old to report it.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Fingerprint, Loader2, ShieldCheck } from 'lucide-react';
import { authService } from '../../services/authService';
import { getErrorMessage } from '../../utils/errorHandling';

export const MfaPolicyCard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [required, setRequired] = useState(false);
  const [passkeysEnabled, setPasskeysEnabled] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const policy = await authService.getMfaPolicy();
        if (!cancelled) {
          setRequired(policy.mfa_required);
          setPasskeysEnabled(policy.passkeys_enabled);
        }
      } catch (err) {
        if (!cancelled) toast.error(getErrorMessage(err, 'Failed to load MFA policy'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      const res = await authService.setMfaPolicy(next);
      setRequired(res.mfa_required);
      toast.success(next ? 'MFA is now required for all members' : 'MFA requirement removed');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update MFA policy'));
    } finally {
      setSaving(false);
    }
  };

  const togglePasskeys = async (next: boolean) => {
    setSaving(true);
    try {
      const res = await authService.setMfaPolicy(required, next);
      setRequired(res.mfa_required);
      setPasskeysEnabled(res.passkeys_enabled);
      toast.success(next ? 'Members can add passkeys' : 'Members can no longer add new passkeys');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update the passkey setting'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3
            id="mfa-policy-required-label"
            className="text-theme-text-primary flex items-center gap-2 text-base font-semibold"
          >
            <ShieldCheck className="h-4 w-4" /> Require two-factor authentication
          </h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            When on, members must set up a passkey or an authenticator app before they can use the app. Each member
            enrolls from their own Security settings.
          </p>
        </div>
        {loading ? (
          <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={required}
            aria-labelledby="mfa-policy-required-label"
            disabled={saving}
            onClick={() => {
              void toggle(!required);
            }}
            className={`toggle-track-sm ${required ? 'bg-theme-accent-blue' : 'bg-theme-surface-hover'}`}
          >
            <span className={`toggle-knob-sm ${required ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        )}
      </div>
      {!loading && passkeysEnabled !== undefined && (
        <div className="border-theme-surface-border mt-4 flex items-center justify-between gap-4 border-t pt-4">
          <div>
            <h3
              id="mfa-policy-passkeys-label"
              className="text-theme-text-primary flex items-center gap-2 text-base font-semibold"
            >
              <Fingerprint className="h-4 w-4" /> Allow passkeys
            </h3>
            <p className="text-theme-text-muted mt-1 text-sm">
              Members can use a passkey on their phone or computer instead of an authenticator code. Turning this off
              stops new passkeys being added; existing ones keep working until the member or an administrator removes
              them.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={passkeysEnabled}
            aria-labelledby="mfa-policy-passkeys-label"
            disabled={saving}
            onClick={() => {
              void togglePasskeys(!passkeysEnabled);
            }}
            className={`toggle-track-sm ${passkeysEnabled ? 'bg-theme-accent-blue' : 'bg-theme-surface-hover'}`}
          >
            <span className={`toggle-knob-sm ${passkeysEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      )}
    </div>
  );
};
