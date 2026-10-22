/**
 * The department's certification expiry alert switches, shown to training
 * managers on the Expiring Certs tab.
 *
 * The sender (`CertAlertService`) only runs for a department that has switched
 * alerts on, so a department that has never opened this panel gets no expiry
 * emails at all. Saving writes all three switches the panel owns; the officer
 * position lists stored beside them are left alone by the server.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { trainingService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import type { CertAlertSettings } from '../../types/training';

const OFF: CertAlertSettings = {
  enabled: false,
  cc_chief_on_escalation: false,
  include_personal_email_on_final: false,
};

const CertAlertSettingsPanel: React.FC = () => {
  const [saved, setSaved] = useState<CertAlertSettings | null>(null);
  const [draft, setDraft] = useState<CertAlertSettings>(OFF);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const settings = await trainingService.getCertAlertSettings();
      setSaved(settings);
      setDraft(settings);
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the certification alert settings.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty =
    saved !== null &&
    (draft.enabled !== saved.enabled ||
      draft.cc_chief_on_escalation !== saved.cc_chief_on_escalation ||
      draft.include_personal_email_on_final !== saved.include_personal_email_on_final);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await trainingService.updateCertAlertSettings(draft);
      setSaved(next);
      setDraft(next);
      toast.success('Certification alerts saved');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not save the certification alert settings.'));
    } finally {
      setSaving(false);
    }
  };

  const set = (change: Partial<CertAlertSettings>) => setDraft((current) => ({ ...current, ...change }));

  return (
    <section aria-labelledby="cert-alerts-heading" className="card mb-6 p-4">
      <h3 id="cert-alerts-heading" className="text-theme-text-primary text-base font-semibold">
        Expiry alert emails
      </h3>

      {error && (
        <p className="alert-danger mt-3 text-sm" role="alert">
          {error}
        </p>
      )}

      {saved === null && !error && (
        <div className="flex justify-center py-4" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" aria-label="Loading" />
        </div>
      )}

      {saved !== null && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="form-checkbox mt-0.5"
              checked={draft.enabled}
              disabled={saving}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
            <span>
              <span className="text-theme-text-primary block text-sm font-medium">
                Email members when a certification is close to expiring
              </span>
              <span className="text-theme-text-secondary block text-xs">
                A member is emailed 90, 60, 30 and 7 days before one of their certifications expires, and again once it
                has, and gets a notice in the app each time. Training officers are copied from 30 days out. A member who
                has turned off training reminder emails is not emailed unless your department requires them. Off until
                you turn it on.
              </span>
            </span>
          </label>

          <label className="mobile-touch-row gap-3">
            <input
              type="checkbox"
              className="form-checkbox shrink-0"
              checked={draft.cc_chief_on_escalation}
              disabled={saving || !draft.enabled}
              onChange={(e) => set({ cc_chief_on_escalation: e.target.checked })}
            />
            <span className="text-theme-text-primary text-sm">Copy the chief officers on the expired notice</span>
          </label>

          <label className="mobile-touch-row gap-3">
            <input
              type="checkbox"
              className="form-checkbox shrink-0"
              checked={draft.include_personal_email_on_final}
              disabled={saving || !draft.enabled}
              onChange={(e) => set({ include_personal_email_on_final: e.target.checked })}
            />
            <span className="text-theme-text-primary text-sm">
              Also send the expired notice to the member&apos;s personal email address
            </span>
          </label>

          <div className="flex items-center justify-end gap-3">
            {dirty && !saving && <span className="text-theme-text-muted text-xs">Unsaved changes</span>}
            <button type="submit" className="btn-primary" disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
};

export default CertAlertSettingsPanel;
