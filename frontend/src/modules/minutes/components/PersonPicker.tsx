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
import { FormField } from '../../../components/ux/FormField';
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
  /** A refusal to show under the picker and announce on it (and on the typed name). */
  error?: string | null | undefined;
}

export const PersonPicker: React.FC<PersonPickerProps> = ({
  id,
  label,
  value,
  onChange,
  attendees,
  exclude,
  disabled,
  error,
}) => {
  const roster = motionMakers(attendees).filter((n) => n !== exclude);
  const [typing, setTyping] = useState(() => value !== '' && !roster.includes(value));

  const selected = typing ? SOMEONE_ELSE : value;

  const emptyRoll = roster.length === 0 && !typing;

  return (
    <FormField
      id={id}
      label={label}
      error={error}
      hint={
        emptyRoll ? 'No one is recorded as present yet. Take the roll to choose from it, or type a name.' : undefined
      }
    >
      {(field) => (
        <>
          <select
            {...field}
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
              aria-invalid={field['aria-invalid']}
              aria-describedby={field['aria-describedby']}
              maxLength={MAX_NAME_LENGTH}
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Name, as it should appear in the minutes"
              className="form-input mt-2"
            />
          )}
        </>
      )}
    </FormField>
  );
};

export default PersonPicker;
