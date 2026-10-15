/**
 * Choose who moved or seconded: a drop-down of the members on the roll, with a
 * typed name as the way out for anyone else.
 *
 * Only people recorded as present count (present, late, left early), because a
 * motion is made by someone in the room. A department may let a guest make a
 * motion as an honorary act, so "Someone else" is always offered and takes a
 * name typed by hand. The value is the name, which is what a motion stores.
 */

import React, { useState } from 'react';
import { motionMakers } from '../utils/motionMakers';
import type { AttendeeEntry } from '../types/minutes';

const SOMEONE_ELSE = '__someone_else__';
const MAX_NAME_LENGTH = 200;

interface PersonPickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (name: string) => void;
  attendees: AttendeeEntry[];
  /** A name to leave out, so the seconder cannot be the mover. */
  exclude?: string | undefined;
  disabled?: boolean | undefined;
}

export const PersonPicker: React.FC<PersonPickerProps> = ({
  id,
  label,
  value,
  onChange,
  attendees,
  exclude,
  disabled,
}) => {
  const roster = motionMakers(attendees).filter((n) => n !== exclude);
  const [typing, setTyping] = useState(() => value !== '' && !roster.includes(value));

  const selected = typing ? SOMEONE_ELSE : value;

  return (
    <div>
      <label htmlFor={id} className="form-label">
        {label}
      </label>
      <select
        id={id}
        value={selected}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === SOMEONE_ELSE) {
            setTyping(true);
            onChange('');
          } else {
            setTyping(false);
            onChange(e.target.value);
          }
        }}
        className="form-input"
      >
        <option value="">Choose from the roll…</option>
        {roster.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        <option value={SOMEONE_ELSE}>Someone else (type a name)</option>
      </select>
      {typing && (
        <input
          type="text"
          aria-label={`${label}, typed name`}
          maxLength={MAX_NAME_LENGTH}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Name, as it should appear in the minutes"
          className="form-input mt-2"
        />
      )}
      {roster.length === 0 && !typing && (
        <p className="text-theme-text-muted mt-1 text-xs">
          No one is recorded as present yet. Take the roll to choose from it, or type a name.
        </p>
      )}
    </div>
  );
};

export default PersonPicker;
