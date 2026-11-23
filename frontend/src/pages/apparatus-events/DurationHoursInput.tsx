/**
 * A length entered in hours (3, 2.5) and stored in minutes, as the apparatus
 * event API takes it. Keeps its own text while the field is being typed in, so
 * "2." or a cleared box is not snapped back to a whole number mid-keystroke.
 */

import React, { useEffect, useState } from 'react';
import { hoursText, minutesFromHours } from './templateForm';

interface DurationHoursInputProps {
  id: string;
  /** Minutes, as a string; empty when the field is blank or not a number. */
  minutes: string;
  onChange: (minutes: string) => void;
  className?: string;
}

const DurationHoursInput: React.FC<DurationHoursInputProps> = ({ id, minutes, onChange, className }) => {
  const [text, setText] = useState(() => hoursText(minutes));

  // A new value from outside (a template loaded, a night copied) replaces
  // what is shown; the field's own keystrokes already match it.
  useEffect(() => {
    setText((current) => (minutesFromHours(current) === minutes ? current : hoursText(minutes)));
  }, [minutes]);

  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      min={0.25}
      max={24}
      step={0.25}
      className={className ?? 'form-input'}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(minutesFromHours(e.target.value));
      }}
    />
  );
};

export default DurationHoursInput;
