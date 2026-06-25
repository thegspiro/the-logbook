/**
 * Admin control for the org-wide MFA requirement. When enabled, members who
 * haven't set up MFA are forced into enrollment before using the app
 * (enforced server-side in get_current_user).
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, ShieldCheck } from 'lucide-react';
import { authService } from '../../services/authService';
import { getErrorMessage } from '../../utils/errorHandling';

export const MfaPolicyCard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [required, setRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const policy = await authService.getMfaPolicy();
        if (!cancelled) setRequired(policy.mfa_required);
      } catch (err) {
        if (!cancelled) toast.error(getErrorMessage(err, 'Failed to load MFA policy'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
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

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-theme-text-primary flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Require two-factor authentication
          </h3>
          <p className="text-sm text-theme-text-muted mt-1">
            When on, members must set up an authenticator app before they can
            use the app. Each member enrolls from their own Security settings.
          </p>
        </div>
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={required}
            disabled={saving}
            onClick={() => { void toggle(!required); }}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              required ? 'bg-violet-600' : 'bg-theme-surface-border'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                required ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        )}
      </div>
    </div>
  );
};
