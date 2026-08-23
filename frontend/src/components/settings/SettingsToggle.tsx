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
  /** Accessible name. Required whenever no visible label is tied to the switch. */
  label?: string;
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
