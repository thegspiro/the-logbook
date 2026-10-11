/**
 * Organization settings: department email addresses.
 *
 * When on, converting a prospective member into a member gives them an address
 * on the department's own domain (jane.doe@firedept.org) as their primary
 * email, keeping the address they applied with as their personal one. The
 * generator in `membership_pipeline_service._generate_department_email` is the
 * reader; it does nothing when the switch is off or no domain is set, which is
 * why the screen refuses to save "on" without a domain rather than storing a
 * setting that silently has no effect.
 *
 * Explicit Save rather than autosave: half a domain typed on a debounce would
 * be what the next conversion used.
 */

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { organizationService } from '../../services/api';
import { DepartmentEmailFormat, type DepartmentEmailSettings } from '../../types/user';
import { getErrorMessage } from '../../utils/errorHandling';
import { SettingsPanelHead } from './SettingsPanelHead';
import { SettingsToggle } from './SettingsToggle';
import { domainError, normalizeDomain } from './departmentEmailDomain';

const DEFAULTS: DepartmentEmailSettings = {
  enabled: false,
  domain: '',
  format: DepartmentEmailFormat.FIRST_DOT_LAST,
};

const FORMAT_OPTIONS: { value: DepartmentEmailFormat; label: string; example: string }[] = [
  { value: DepartmentEmailFormat.FIRST_DOT_LAST, label: 'first.last', example: 'jane.doe' },
  { value: DepartmentEmailFormat.FIRST_INITIAL_LAST, label: 'first initial + last', example: 'jdoe' },
  { value: DepartmentEmailFormat.FIRST_LAST, label: 'firstlast', example: 'janedoe' },
  { value: DepartmentEmailFormat.LAST_DOT_FIRST, label: 'last.first', example: 'doe.jane' },
];

const DepartmentEmailSection: React.FC = () => {
  const [saved, setSaved] = useState<DepartmentEmailSettings>(DEFAULTS);
  const [draft, setDraft] = useState<DepartmentEmailSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const data = await organizationService.getSettings();
        if (cancelled) return;
        const loaded = { ...DEFAULTS, ...data.department_email };
        setSaved(loaded);
        setDraft(loaded);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const domain = normalizeDomain(draft.domain);
  const error = domainError(domain, draft.enabled);
  const dirty = draft.enabled !== saved.enabled || domain !== saved.domain || draft.format !== saved.format;
  const example = useMemo(
    () => FORMAT_OPTIONS.find((o) => o.value === draft.format)?.example ?? 'jane.doe',
    [draft.format]
  );

  const handleSave = async () => {
    if (error) return;
    setSaving(true);
    try {
      const next = await organizationService.updateDepartmentEmailSettings({ ...draft, domain });
      const merged = { ...DEFAULTS, ...next };
      setSaved(merged);
      setDraft(merged);
      toast.success('Department email settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save department email settings'));
    } finally {
      setSaving(false);
    }
  };

  const head = (
    <SettingsPanelHead
      title="Department Email"
      description="Give new members an address on the department's own domain when they are converted from applicants."
      meta={saved.enabled && saved.domain ? `@${saved.domain}` : undefined}
    />
  );

  if (failed) {
    return (
      <div>
        {head}
        <div className="alert-warning flex flex-wrap items-center gap-2 text-sm" role="alert">
          <span className="min-w-0 flex-1">
            These settings did not load. Retry to see what your department has chosen.
          </span>
          <button
            type="button"
            className="mobile-touch-target px-2 font-semibold underline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {head}
      <div className="space-y-4" aria-busy={loading}>
        <div className="border-theme-surface-border flex items-center justify-between gap-3 border-b py-3">
          <div>
            <p className="text-theme-text-primary text-sm font-medium">Create department email addresses</p>
            <p className="text-theme-text-muted text-xs">
              The new member&rsquo;s department address becomes their primary email; the one they applied with is kept
              as their personal email.
            </p>
          </div>
          <SettingsToggle
            label="Create department email addresses"
            checked={draft.enabled}
            disabled={loading || saving}
            onChange={(next) => setDraft((d) => ({ ...d, enabled: next }))}
          />
        </div>

        <div>
          <label className="form-label" htmlFor="department-email-domain">
            Domain
          </label>
          <input
            id="department-email-domain"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            className="form-input w-full max-w-sm"
            placeholder="firedept.org"
            value={draft.domain}
            disabled={loading || saving}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'department-email-domain-error' : undefined}
            onChange={(e) => setDraft((d) => ({ ...d, domain: e.target.value }))}
          />
          {error && (
            <p id="department-email-domain-error" className="mt-1 text-xs text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
        </div>

        <div>
          <label className="form-label" htmlFor="department-email-format">
            Address format
          </label>
          <select
            id="department-email-format"
            className="form-input w-full max-w-sm"
            value={draft.format}
            disabled={loading || saving}
            onChange={(e) => setDraft((d) => ({ ...d, format: e.target.value as DepartmentEmailFormat }))}
          >
            {FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} ({o.example})
              </option>
            ))}
          </select>
          <p className="text-theme-text-muted mt-1 text-xs">
            Jane Doe would get{' '}
            <span className="text-theme-text-primary font-mono">
              {example}@{domain || 'your-domain'}
            </span>
            . If that address is taken, a number is added (<span className="font-mono">{example}1</span>).
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            disabled={loading || saving || !dirty || error !== null}
            onClick={() => {
              void handleSave();
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DepartmentEmailSection;
