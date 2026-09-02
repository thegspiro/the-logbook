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
 * leadership" names exactly who else can see it.
 */

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { SettingsToggle } from '../settings/SettingsToggle';
import type { ProfileVisibilityField } from '../../types/user';

export const VISIBLE_LABEL = 'Visible to members';
export const HIDDEN_LABEL = 'Only you and leadership';

interface VisibilityControlProps {
  field: ProfileVisibilityField;
  /** The field's human name, for the switch's accessible name ("Mailing address visibility"). */
  label: string;
  visible: boolean;
  mode: 'toggle' | 'badge';
  onChange?: ((next: boolean) => void) | undefined;
  disabled?: boolean | undefined;
}

export const VisibilityControl: React.FC<VisibilityControlProps> = ({
  field,
  label,
  visible,
  mode,
  onChange,
  disabled,
}) => {
  const Icon = visible ? Eye : EyeOff;
  const text = visible ? VISIBLE_LABEL : HIDDEN_LABEL;

  if (mode === 'badge') {
    return (
      <span
        className="badge bg-theme-surface-secondary text-theme-text-secondary gap-1"
        data-visibility-field={field}
        data-visibility-state={visible ? 'visible' : 'hidden'}
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
