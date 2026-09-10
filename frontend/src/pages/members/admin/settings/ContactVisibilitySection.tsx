/**
 * Contact Visibility — what one member sees of another on the member list.
 *
 * Moved out of the global settings page, where it sat under a **Members**
 * heading two clicks from anything else about members. It owns its own load,
 * state and autosave rather than reading a parent's: the global page fetched
 * every section's settings in one call and shared one autosave across all of
 * them, which is fine while they live on one screen and is exactly what stops a
 * section being liftable while they do not.
 *
 * Safe to move and stay editable — unlike the scheduling settings mirrors, which
 * had to be read-only. Each section here writes its own endpoint
 * (`PATCH /organization/settings/contact-info`), so two screens showing it
 * cannot silently revert each other the way one whole-object PUT would.
 */

import React, { useEffect, useRef, useState } from 'react';
import { organizationService } from '../../../../services/userServices';
import type { ContactInfoSettings } from '../../../../types/user';
import { SettingsPanelHead } from '../../../../components/settings/SettingsPanelHead';
import { SettingsToggle as Toggle } from '../../../../components/settings/SettingsToggle';

const DEFAULTS: ContactInfoSettings = {
  enabled: false,
  show_email: false,
  show_phone: false,
  show_mobile: false,
};

interface Props {
  /**
   * The page's autosave, not one of our own.
   *
   * `SettingsLayout` renders the save pill in its header, so the state it
   * reflects has to be the page's. A section holding a second `useSettingsAutosave`
   * would save correctly and report into a pill nobody renders.
   */
  save: (saver: () => Promise<unknown>) => void;
}

const ContactVisibilitySection: React.FC<Props> = ({ save }) => {
  const [settings, setSettings] = useState<ContactInfoSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  // Said rather than swallowed. The toggles below are all `false` before the
  // load lands, which is indistinguishable from a department that has turned
  // contact information off — and an officer reading that would conclude the
  // setting is already what they wanted.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // The saver reads this at fire time, so the loaded values have to land in
  // both or the first edit writes a payload built on the defaults above.
  const ref = useRef<ContactInfoSettings>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const data = await organizationService.getSettings();
        if (cancelled) return;
        const loaded = data.contact_info_visibility ?? DEFAULTS;
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

  const update = (patch: Partial<ContactInfoSettings>) => {
    const next = { ...ref.current, ...patch };
    ref.current = next;
    setSettings(next);
    void save(() => organizationService.updateContactInfoSettings(next));
  };

  if (failed) {
    return (
      <div>
        <SettingsPanelHead
          title="Contact Information Visibility"
          description="Control what appears on the member list page."
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
        title="Contact Information Visibility"
        description="Control what appears on the member list page."
      />
      <div className="space-y-3" aria-busy={loading}>
        <div className="border-theme-surface-border flex items-center justify-between border-b py-3">
          <div>
            <p className="text-theme-text-primary text-sm font-medium">Show Contact Information</p>
            <p className="text-theme-text-muted text-xs">Enable display of contact info for all members</p>
          </div>
          <Toggle
            label="Show Contact Information"
            checked={settings.enabled}
            disabled={loading}
            onChange={() => update({ enabled: !settings.enabled })}
          />
        </div>

        {settings.enabled && (
          <div className="space-y-3 pl-4">
            <div className="flex items-center justify-between py-2">
              <p className="text-theme-text-primary text-sm">Show Email Addresses</p>
              <Toggle
                label="Show Email Addresses"
                checked={settings.show_email}
                disabled={loading}
                onChange={() => update({ show_email: !settings.show_email })}
              />
            </div>
            <div className="flex items-center justify-between py-2">
              <p className="text-theme-text-primary text-sm">Show Phone Numbers</p>
              <Toggle
                label="Show Phone Numbers"
                checked={settings.show_phone}
                disabled={loading}
                onChange={() => update({ show_phone: !settings.show_phone })}
              />
            </div>
            <div className="flex items-center justify-between py-2">
              <p className="text-theme-text-primary text-sm">Show Mobile Numbers</p>
              <Toggle
                label="Show Mobile Numbers"
                checked={settings.show_mobile}
                disabled={loading}
                onChange={() => update({ show_mobile: !settings.show_mobile })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ContactVisibilitySection;
