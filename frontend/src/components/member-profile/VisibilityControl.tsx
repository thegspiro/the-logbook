/**
 * One row's "who can see this" marker on a member profile.
 *
 * Two modes, one vocabulary. `toggle` is the member on their own profile (or
 * on My Account → Privacy): the switch flips the field for everyone else.
 * `badge` is a members-manager looking at someone else's record: they can see
 * the value regardless, and the marker tells them what the roster shows so
 * "why can't Smith see my phone?" has an answer without a settings dive.
 *
 * The wording is deliberately the consequence, not the mechanism: "Visible to
 * members" means every member of the department, and "Only you and
 * leadership" names exactly who else can see it. When the department's own
 * contact-visibility setting has switched a work field off for everyone, the
 * marker says so rather than promising a visibility the roster does not give;
 * the member's switch still records their own choice for when it is back on.
 */

import React from 'react';
import { Eye, EyeOff, Building2 } from 'lucide-react';
import { SettingsToggle } from '../settings/SettingsToggle';
import type { ProfileVisibilityField } from '../../types/user';

export const VISIBLE_LABEL = 'Visible to members';
export const HIDDEN_LABEL = 'Only you and leadership';
export const ORG_HIDDEN_LABEL = 'Off for everyone (department setting)';

interface VisibilityControlProps {
  field: ProfileVisibilityField;
  /** The field's human name, for the switch's accessible name ("Mailing address visibility"). */
  label: string;
  visible: boolean;
  mode: 'toggle' | 'badge';
  /** The organisation's contact-visibility setting hides this field for everyone. */
  orgHidden?: boolean | undefined;
  onChange?: ((next: boolean) => void) | undefined;
  disabled?: boolean | undefined;
}

export const VisibilityControl: React.FC<VisibilityControlProps> = ({
  field,
  label,
  visible,
  mode,
  orgHidden = false,
  onChange,
  disabled,
}) => {
  const effectiveVisible = visible && !orgHidden;
  const Icon = orgHidden ? Building2 : effectiveVisible ? Eye : EyeOff;
  const text = orgHidden ? ORG_HIDDEN_LABEL : effectiveVisible ? VISIBLE_LABEL : HIDDEN_LABEL;

  if (mode === 'badge') {
    return (
      <span
        className="badge bg-theme-surface-secondary text-theme-text-secondary gap-1"
        data-visibility-field={field}
        data-visibility-state={effectiveVisible ? 'visible' : 'hidden'}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {text}
      </span>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-2.5" data-visibility-field={field}>
      <span className="text-theme-text-secondary inline-flex items-center gap-1 text-xs whitespace-nowrap">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {text}
      </span>
      <SettingsToggle
        checked={visible}
        onChange={(next) => onChange?.(next)}
        disabled={disabled ?? false}
        label={`${label} visibility`}
      />
    </span>
  );
};

export default VisibilityControl;
