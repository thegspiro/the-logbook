/**
 * NFPA Department Switch
 *
 * Lets an administrator turn NFPA apparatus compliance on or off for the
 * whole department. Until somebody chooses, the server answers from the
 * organization type (on for fire and combined departments, off for EMS-only),
 * and this card says which default is in force.
 *
 * Turning it off hides the NFPA tab and refuses the NFPA endpoints; nothing
 * stored is deleted, so turning it back on restores the records.
 */

import React, { useState } from 'react';
import { Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import { organizationService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { ApparatusNfpaSettings } from '../types';

interface NfpaDepartmentSwitchProps {
  settings: ApparatusNfpaSettings;
  onChanged: () => Promise<void>;
}

export const NfpaDepartmentSwitch: React.FC<NfpaDepartmentSwitchProps> = ({ settings, onChanged }) => {
  const [saving, setSaving] = useState(false);

  const handleToggle = async () => {
    setSaving(true);
    try {
      await organizationService.updateSettings({
        apparatus: { nfpa_compliance_enabled: !settings.enabled },
      });
      await onChanged();
      toast.success(settings.enabled ? 'NFPA compliance tracking turned off' : 'NFPA compliance tracking turned on');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to change NFPA compliance tracking'));
    } finally {
      setSaving(false);
    }
  };

  const source =
    settings.explicitChoice === null
      ? `Using the default for your organization type (${settings.defaultForOrganizationType ? 'on' : 'off'}).`
      : 'Set by an administrator.';

  return (
    <div className="card mb-6 flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <Shield className="text-theme-text-secondary mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p id="nfpa-department-switch-label" className="text-theme-text-primary font-medium">
            NFPA Compliance
          </p>
          <p className="text-theme-text-muted text-sm">
            Track NFPA 1911 tests and compliance items on each apparatus. {source}
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={settings.enabled}
        aria-labelledby="nfpa-department-switch-label"
        disabled={saving}
        onClick={() => void handleToggle()}
        className={`toggle-track-sm ${settings.enabled ? 'bg-red-800' : 'bg-theme-surface-border'}`}
      >
        <span className={`toggle-knob-sm ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
};

export default NfpaDepartmentSwitch;
