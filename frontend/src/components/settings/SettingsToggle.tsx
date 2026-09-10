/**
 * The switch used across every settings screen.
 *
 * There were two copies of this before, and the copy in EmailSettingsSection
 * was declared *inside* its parent's body — a fresh component type on every
 * render, so React unmounted and remounted the switch on each keystroke
 * elsewhere in the form, discarding its focus and animation mid-transition.
 *
 * Elections rendered raw red checkboxes instead, which is what made the
 * settings screens carry five different ways to express one on/off choice.
 */

import React from 'react';

interface SettingsToggleProps {
  checked: boolean;
  /**
   * Receives the value being switched to. Handlers that ignore it and read
   * their own state remain valid — a zero-argument callback is assignable.
   */
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /**
   * The switch's accessible name.
   *
   * Required, not optional. It was optional and documented as "required
   * whenever no visible label is tied to the switch" — which is every call site,
   * because none of them ties one: the text beside a switch here is a sibling
   * `<p>`, not a `<label htmlFor>`. Nine of the fifteen call sites duly omitted
   * it, and axe reported `button-name (critical)` on all three settings screens
   * that had just been put on the accessibility pass. A screen reader announced
   * "switch, not pressed" and nothing else.
   *
   * A required prop is the only version of this rule that holds: a comment did
   * not, and a test would only cover the screens someone remembered to measure.
   */
  label: string;
  color?: 'red' | 'blue';
}

export const SettingsToggle: React.FC<SettingsToggleProps> = ({
  checked,
  onChange,
  disabled,
  label,
  color = 'blue',
}) => {
  const bg = checked ? (color === 'red' ? 'bg-theme-accent-red' : 'bg-theme-accent-blue') : 'bg-theme-surface-hover';
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`${bg} toggle-track-md focus:ring-theme-focus-ring disabled:cursor-not-allowed disabled:opacity-50`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span className={`${checked ? 'translate-x-5' : 'translate-x-0'} toggle-knob-md`} />
    </button>
  );
};

export default SettingsToggle;
