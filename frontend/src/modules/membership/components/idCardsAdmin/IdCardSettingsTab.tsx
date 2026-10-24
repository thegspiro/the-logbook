/**
 * ID-card settings: how long the tap log is kept.
 *
 * The bounds mirror `MIN/MAX_TAP_RETENTION_MONTHS` in the backend's
 * `nfc_card_admin_service.py`, which refuses anything outside them.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../../utils/errorHandling';
import { nfcCardService } from '../../services/nfcCardService';

export const MIN_RETENTION_MONTHS = 3;
export const MAX_RETENTION_MONTHS = 84;

export const IdCardSettingsTab: React.FC = () => {
  const [saved, setSaved] = useState<number | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    nfcCardService
      .getSettings()
      .then((settings) => {
        if (cancelled) return;
        setSaved(settings.tapRetentionMonths);
        setValue(String(settings.tapRetentionMonths));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Unable to load ID card settings'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const months = Number(value);
  const valid = Number.isInteger(months) && months >= MIN_RETENTION_MONTHS && months <= MAX_RETENTION_MONTHS;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const result = await nfcCardService.updateSettings(months);
      setSaved(result.tapRetentionMonths);
      toast.success('Settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to save ID card settings'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card max-w-xl space-y-4 p-4 sm:p-6">
      {error && (
        <div className="alert-danger flex items-start gap-2">
          <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-theme-alert-danger-text text-sm">{error}</p>
        </div>
      )}
      <div>
        <label htmlFor="tap-retention" className="form-label">
          Keep the tap log for (months)
        </label>
        <input
          id="tap-retention"
          type="number"
          inputMode="numeric"
          className="form-input w-32"
          min={MIN_RETENTION_MONTHS}
          max={MAX_RETENTION_MONTHS}
          step={1}
          value={value}
          aria-describedby="tap-retention-hint"
          aria-invalid={value !== '' && !valid}
          onChange={(e) => setValue(e.target.value)}
        />
        <p id="tap-retention-hint" className="text-theme-text-secondary mt-1 text-sm">
          Between {MIN_RETENTION_MONTHS} and {MAX_RETENTION_MONTHS} months. Taps older than this are deleted overnight.
          Check-ins themselves stay on the shift, event or admin-hours record.
        </p>
      </div>
      <button
        type="button"
        className="btn-primary inline-flex items-center gap-2"
        disabled={!valid || saving || months === saved}
        onClick={() => void handleSave()}
      >
        <Save className="h-4 w-4" aria-hidden="true" />
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
};
