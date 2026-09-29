/**
 * Membership IDs — the number printed on a member's profile, and how it is
 * assigned.
 *
 * A department describes its own numbers as a pattern: literal text plus
 * {SEQ} (the running number), {PREFIX}, {YYYY} and {YY}. The count can restart
 * every calendar or fiscal year.
 *
 * Moved out of the global settings page with Contact Visibility, and owns its
 * own load and state for the same reason. See `ContactVisibilitySection` for why
 * that is safe here and was not for the scheduling mirrors.
 *
 * The free-text and number fields debounce; toggles, selects and presets do
 * not. That split is carried over deliberately: a toggle is one decisive act
 * and should be saved as one, while a text field would otherwise write a PATCH
 * per keystroke — and the pattern is free text, so "{", "{S", "{SE" would each
 * be refused on the way to what the officer meant.
 *
 * The "next number" shown here is the server's preview, never a local
 * rendering of the pattern: the server is the only formatter, so the number an
 * officer reads here is the number the next member receives (pitfall #29).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { organizationService } from '../../../../services/userServices';
import type { MembershipIdSettings } from '../../../../types/user';
import { FiscalYearLabel, MembershipYearBasis } from '../../../../constants/enums';
import { SettingsPanelHead } from '../../../../components/settings/SettingsPanelHead';
import { SettingsToggle as Toggle } from '../../../../components/settings/SettingsToggle';

const DEFAULTS: MembershipIdSettings = {
  enabled: false,
  auto_generate: false,
  prefix: '',
  next_number: 1,
  pattern: '{PREFIX}{SEQ}',
  padding: 4,
  start_number: 1,
  reset_yearly: false,
  year_basis: MembershipYearBasis.CALENDAR,
  fiscal_year_start_month: 1,
  fiscal_year_label: FiscalYearLabel.END,
};

/** Starting points for the pattern. Each sets only the fields it names. */
const PRESETS: { label: string; example: string; patch: Partial<MembershipIdSettings> }[] = [
  { label: 'Prefix and number', example: 'FD-0001', patch: { pattern: '{PREFIX}{SEQ}', padding: 4 } },
  { label: 'Year and number', example: '2026-001', patch: { pattern: '{YYYY}-{SEQ}', padding: 3 } },
  { label: 'Plain number', example: '142', patch: { pattern: '{SEQ}', padding: 1 } },
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// Only decides which controls to offer. Whether a pattern is valid, and what
// it produces, is the server's call.
const usesPrefix = (pattern: string): boolean => pattern.includes('{PREFIX}');
const usesYear = (pattern: string): boolean => /\{(YYYY|YY)\}/.test(pattern);

const positiveInt = (value: string, min: number, max = Number.MAX_SAFE_INTEGER): number =>
  Math.min(max, Math.max(min, parseInt(value, 10) || min));

interface Props {
  /** The page's autosave — see the note in `ContactVisibilitySection`. */
  save: (saver: () => Promise<unknown>) => void;
  /** The page's debounced autosave, for the free-text fields. */
  saveDebounced: (key: string, saver: () => Promise<unknown>) => void;
}

const MembershipIdSection: React.FC<Props> = ({ save, saveDebounced }) => {
  const [settings, setSettings] = useState<MembershipIdSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  // An unloaded page shows "off" with an empty prefix, which reads as a
  // department that has never turned membership IDs on. Saying so is the
  // difference between a setting an officer can trust and one they cannot.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [nextId, setNextId] = useState<string | null>(null);

  const ref = useRef<MembershipIdSettings>(DEFAULTS);
  // Previews can resolve out of order after a burst of saves; only the latest
  // request may set what is shown.
  const previewSeq = useRef(0);

  const refreshPreview = useCallback(async () => {
    const seq = ++previewSeq.current;
    try {
      const data = await organizationService.previewNextMembershipId();
      if (seq === previewSeq.current) setNextId(data.next_id ?? null);
    } catch {
      if (seq === previewSeq.current) setNextId(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const data = await organizationService.getSettings();
        if (cancelled) return;
        const loaded = { ...DEFAULTS, ...data.membership_id };
        setSettings(loaded);
        ref.current = loaded;
        void refreshPreview();
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, refreshPreview]);

  const update = (patch: Partial<MembershipIdSettings>, { immediate = false, key = 'membership-id' } = {}) => {
    const next = { ...ref.current, ...patch };
    // The server refuses a yearly restart without a year in the number, so
    // dropping the year from the pattern turns the restart off in the same
    // write rather than failing it.
    if (!usesYear(next.pattern)) next.reset_yearly = false;
    ref.current = next;
    setSettings(next);
    // Read at fire time rather than closed over: a debounced write that captured
    // `next` would persist the value as it was when the keystroke happened, not
    // as it is when the timer fires.
    const write = async () => {
      const saved = await organizationService.updateMembershipIdSettings(ref.current);
      void refreshPreview();
      return saved;
    };
    if (immediate) save(write);
    else saveDebounced(key, write);
  };

  if (failed) {
    return (
      <div>
        <SettingsPanelHead
          title="Membership ID Number"
          description="Each member can be assigned a unique ID displayed on their profile."
        />
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

  const yearInPattern = usesYear(settings.pattern);
  const fiscal = settings.year_basis === MembershipYearBasis.FISCAL;
  const startMonth = MONTHS[settings.fiscal_year_start_month - 1] ?? MONTHS[0] ?? '';

  return (
    <div>
      <SettingsPanelHead
        title="Membership ID Number"
        description="Each member can be assigned a unique ID displayed on their profile."
        meta={settings.enabled && nextId ? `Next: ${nextId}` : undefined}
      />
      <div className="space-y-3" aria-busy={loading}>
        <div className="border-theme-surface-border flex items-center justify-between border-b py-3">
          <div>
            <p className="text-theme-text-primary text-sm font-medium">Enable Membership ID Numbers</p>
            <p className="text-theme-text-muted text-xs">Display membership IDs on member profiles and lists</p>
          </div>
          <Toggle
            label="Enable Membership ID Numbers"
            checked={settings.enabled}
            disabled={loading}
            onChange={() => update({ enabled: !settings.enabled }, { immediate: true })}
          />
        </div>

        {settings.enabled && (
          <div className="space-y-5 pl-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-theme-text-primary text-sm">Auto-Generate IDs</p>
                <p className="text-theme-text-muted text-xs">Automatically assign sequential IDs to new members</p>
              </div>
              <Toggle
                label="Auto-Generate IDs"
                checked={settings.auto_generate}
                disabled={loading}
                onChange={() => update({ auto_generate: !settings.auto_generate }, { immediate: true })}
              />
            </div>

            <fieldset className="space-y-3">
              <legend className="text-theme-text-primary mb-1 text-sm font-medium">How numbers are built</legend>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="btn-secondary mobile-touch-target text-sm"
                    disabled={loading}
                    onClick={() => update(preset.patch, { immediate: true })}
                  >
                    {preset.label} <span className="text-theme-text-muted">({preset.example})</span>
                  </button>
                ))}
              </div>

              <div>
                <label className="form-label" htmlFor="membership-id-pattern">
                  Number pattern
                </label>
                <p id="membership-id-pattern-help" className="text-theme-text-muted mb-2 text-xs">
                  Write it the way your department does, using {'{SEQ}'} for the running number (required), {'{PREFIX}'}{' '}
                  for the prefix below, and {'{YYYY}'} or {'{YY}'} for the year. Letters, digits, spaces and - _ . / #
                  are kept as typed.
                </p>
                <input
                  id="membership-id-pattern"
                  type="text"
                  maxLength={40}
                  value={settings.pattern}
                  disabled={loading}
                  onChange={(e) => update({ pattern: e.target.value }, { key: 'membership-id-pattern' })}
                  aria-describedby="membership-id-pattern-help membership-id-preview"
                  className="form-input w-full max-w-sm font-mono"
                  spellCheck={false}
                  autoCapitalize="off"
                />
                <p id="membership-id-preview" className="text-theme-text-secondary mt-2 text-sm" aria-live="polite">
                  {!settings.auto_generate
                    ? 'Numbers are typed in by hand when a member is added.'
                    : nextId
                      ? `The next member will be numbered ${nextId}.`
                      : 'Checking the next number…'}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {usesPrefix(settings.pattern) && (
                  <div>
                    <label className="form-label" htmlFor="membership-id-prefix">
                      Prefix
                    </label>
                    <input
                      id="membership-id-prefix"
                      type="text"
                      maxLength={10}
                      value={settings.prefix}
                      disabled={loading}
                      onChange={(e) => update({ prefix: e.target.value }, { key: 'membership-id-prefix' })}
                      placeholder="e.g. FD-"
                      className="form-input w-40"
                    />
                  </div>
                )}
                <div>
                  <label className="form-label" htmlFor="membership-id-padding">
                    Minimum digits
                  </label>
                  <input
                    id="membership-id-padding"
                    type="number"
                    min={1}
                    max={10}
                    value={settings.padding}
                    disabled={loading}
                    onChange={(e) =>
                      update({ padding: positiveInt(e.target.value, 1, 10) }, { key: 'membership-id-padding' })
                    }
                    aria-describedby="membership-id-padding-help"
                    className="form-input w-24"
                  />
                  <p id="membership-id-padding-help" className="text-theme-text-muted mt-1 text-xs">
                    Zeros fill the number to this width. 1 means no padding.
                  </p>
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-theme-text-primary mb-1 text-sm font-medium">Counting</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="form-label" htmlFor="membership-id-start">
                    Starting number
                  </label>
                  <input
                    id="membership-id-start"
                    type="number"
                    min={1}
                    value={settings.start_number}
                    disabled={loading}
                    onChange={(e) =>
                      update({ start_number: positiveInt(e.target.value, 1) }, { key: 'membership-id-start' })
                    }
                    aria-describedby="membership-id-start-help"
                    className="form-input w-40"
                  />
                  <p id="membership-id-start-help" className="text-theme-text-muted mt-1 text-xs">
                    No number is issued below this one
                    {settings.reset_yearly ? ', and each new year starts here' : ''}.
                  </p>
                </div>
                {settings.auto_generate && (
                  <div>
                    <label className="form-label" htmlFor="membership-id-next">
                      Next ID Number
                    </label>
                    <input
                      id="membership-id-next"
                      type="number"
                      min={1}
                      value={settings.next_number}
                      disabled={loading}
                      onChange={(e) =>
                        update({ next_number: positiveInt(e.target.value, 1) }, { key: 'membership-id-next' })
                      }
                      aria-describedby="membership-id-next-help"
                      className="form-input w-40"
                    />
                    <p id="membership-id-next-help" className="text-theme-text-muted mt-1 text-xs">
                      Where the count stands now. Numbers any member holds or once held are always skipped.
                    </p>
                  </div>
                )}
              </div>

              {yearInPattern && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-theme-text-primary text-sm">Restart the count each year</p>
                      <p className="text-theme-text-muted text-xs">
                        The first member of each year gets the starting number again
                      </p>
                    </div>
                    <Toggle
                      label="Restart the count each year"
                      checked={settings.reset_yearly}
                      disabled={loading}
                      onChange={() => update({ reset_yearly: !settings.reset_yearly }, { immediate: true })}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="form-label" htmlFor="membership-id-year-basis">
                        The year follows
                      </label>
                      <select
                        id="membership-id-year-basis"
                        value={settings.year_basis}
                        disabled={loading}
                        onChange={(e) =>
                          update(
                            {
                              year_basis:
                                e.target.value === MembershipYearBasis.FISCAL
                                  ? MembershipYearBasis.FISCAL
                                  : MembershipYearBasis.CALENDAR,
                            },
                            { immediate: true }
                          )
                        }
                        className="form-input w-full"
                      >
                        <option value={MembershipYearBasis.CALENDAR}>The calendar year</option>
                        <option value={MembershipYearBasis.FISCAL}>Our fiscal year</option>
                      </select>
                    </div>

                    {fiscal && (
                      <div>
                        <label className="form-label" htmlFor="membership-id-fy-month">
                          Fiscal year starts in
                        </label>
                        <select
                          id="membership-id-fy-month"
                          value={settings.fiscal_year_start_month}
                          disabled={loading}
                          onChange={(e) =>
                            update({ fiscal_year_start_month: positiveInt(e.target.value, 1, 12) }, { immediate: true })
                          }
                          className="form-input w-full"
                        >
                          {MONTHS.map((name, i) => (
                            <option key={name} value={i + 1}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {fiscal && settings.fiscal_year_start_month !== 1 && (
                      <div className="sm:col-span-2">
                        <label className="form-label" htmlFor="membership-id-fy-label">
                          A fiscal year starting in {startMonth} is named by
                        </label>
                        <select
                          id="membership-id-fy-label"
                          value={settings.fiscal_year_label}
                          disabled={loading}
                          onChange={(e) =>
                            update(
                              {
                                fiscal_year_label:
                                  e.target.value === FiscalYearLabel.START
                                    ? FiscalYearLabel.START
                                    : FiscalYearLabel.END,
                              },
                              { immediate: true }
                            )
                          }
                          className="form-input w-full max-w-sm"
                        >
                          <option value={FiscalYearLabel.END}>The year it ends in</option>
                          <option value={FiscalYearLabel.START}>The year it starts in</option>
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </fieldset>
          </div>
        )}
      </div>
    </div>
  );
};

export default MembershipIdSection;
