/**
 * Membership IDs — the number printed on a member's profile, and how it is
 * assigned.
 *
 * Moved out of the global settings page with Contact Visibility, and owns its
 * own load and state for the same reason. See `ContactVisibilitySection` for why
 * that is safe here and was not for the scheduling mirrors.
 *
 * The prefix and next-number fields debounce; the toggles do not. That split is
 * carried over deliberately: a toggle is one decisive act and should be saved as
 * one, while a text field would otherwise write a PATCH per keystroke — and the
 * prefix is free text, so "F", "FD", "FD-" would all be persisted on the way to
 * what the officer meant.
 */

import React, { useEffect, useRef, useState } from 'react';
import { organizationService } from '../../../../services/userServices';
import type { MembershipIdSettings } from '../../../../types/user';
import { SettingsPanelHead } from '../../../../components/settings/SettingsPanelHead';
import { SettingsToggle as Toggle } from '../../../../components/settings/SettingsToggle';

const DEFAULTS: MembershipIdSettings = {
  enabled: false,
  auto_generate: false,
  prefix: '',
  next_number: 1,
};

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

  const ref = useRef<MembershipIdSettings>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const data = await organizationService.getSettings();
        if (cancelled) return;
        const loaded = data.membership_id ?? DEFAULTS;
        setSettings(loaded);
        ref.current = loaded;
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

  const update = (patch: Partial<MembershipIdSettings>, { immediate = false } = {}) => {
    const next = { ...ref.current, ...patch };
    ref.current = next;
    setSettings(next);
    // Read at fire time rather than closed over: a debounced write that captured
    // `next` would persist the value as it was when the keystroke happened, not
    // as it is when the timer fires.
    const write = () => organizationService.updateMembershipIdSettings(ref.current);
    if (immediate) save(write);
    else saveDebounced('membership-id', write);
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
            These settings did not load, so nothing below reflects what your department has chosen.
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
      <SettingsPanelHead
        title="Membership ID Number"
        description="Each member can be assigned a unique ID displayed on their profile."
        meta={settings.enabled ? `Next: ${settings.prefix}${settings.next_number}` : undefined}
      />
      <div className="space-y-3" aria-busy={loading}>
        <div className="border-theme-surface-border flex items-center justify-between border-b py-3">
          <div>
            <p className="text-theme-text-primary text-sm font-medium">Enable Membership ID Numbers</p>
            <p className="text-theme-text-muted text-xs">Display membership IDs on member profiles and lists</p>
          </div>
          <Toggle
            checked={settings.enabled}
            disabled={loading}
            onChange={() => update({ enabled: !settings.enabled }, { immediate: true })}
          />
        </div>

        {settings.enabled && (
          <div className="space-y-4 pl-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-theme-text-primary text-sm">Auto-Generate IDs</p>
                <p className="text-theme-text-muted text-xs">Automatically assign sequential IDs to new members</p>
              </div>
              <Toggle
                checked={settings.auto_generate}
                disabled={loading}
                onChange={() => update({ auto_generate: !settings.auto_generate }, { immediate: true })}
              />
            </div>

            <div>
              <label className="text-theme-text-primary mb-1 block text-sm font-medium" htmlFor="membership-id-prefix">
                ID Prefix
              </label>
              <p className="text-theme-text-muted mb-2 text-xs">
                Optional prefix (e.g. &quot;FD-&quot; produces FD-001)
              </p>
              <input
                id="membership-id-prefix"
                type="text"
                maxLength={10}
                value={settings.prefix}
                disabled={loading}
                onChange={(e) => update({ prefix: e.target.value })}
                placeholder="e.g. FD-"
                className="form-input w-40"
              />
            </div>

            {settings.auto_generate && (
              <div>
                <label className="text-theme-text-primary mb-1 block text-sm font-medium" htmlFor="membership-id-next">
                  Next ID Number
                </label>
                <p className="text-theme-text-muted mb-2 text-xs">Next number assigned when a new member is added</p>
                <input
                  id="membership-id-next"
                  type="number"
                  min={1}
                  value={settings.next_number}
                  disabled={loading}
                  onChange={(e) => update({ next_number: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="form-input w-40"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MembershipIdSection;
