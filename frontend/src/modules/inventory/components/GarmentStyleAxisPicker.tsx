/**
 * The garment style chips, as one labelled row per axis.
 *
 * Shared by the variant generator and the single-item form on purpose. The
 * whole point of the axis model is that there is one taxonomy; two pickers
 * would be two places for it to drift, and a chip that sits under "Neckline"
 * in one and "Closure" in the other would teach two different rules about what
 * multiplies.
 *
 * The rows are what make the rule visible: a flat strip of ten chips read as
 * ten alternatives, which is why picking Long Sleeve + Men's + Polo looked like
 * it should produce three items.
 */

import React from 'react';
import { GARMENT_STYLE_AXES } from '../types';

interface GarmentStyleAxisPickerProps {
  /** Selected style values, flat across all axes. */
  selected: string[];
  onToggle: (value: string) => void;
  /** Distinguishes the generated ids when two pickers share a page. */
  idPrefix: string;
}

const chipBase =
  'inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer select-none border transition-colors';
const chipOn = 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/40';
const chipOff =
  'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border hover:border-theme-text-muted';

export const GarmentStyleAxisPicker: React.FC<GarmentStyleAxisPickerProps> = ({ selected, onToggle, idPrefix }) => (
  <div className="space-y-3">
    {GARMENT_STYLE_AXES.map((axis) => (
      <div key={axis.key}>
        <span className="text-theme-text-muted text-xs font-medium" id={`${idPrefix}-${axis.key}-label`}>
          {axis.label}
        </span>
        <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-labelledby={`${idPrefix}-${axis.key}-label`}>
          {axis.options.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={selected.includes(o.value)}
              className={`${chipBase} ${selected.includes(o.value) ? chipOn : chipOff}`}
              onClick={() => onToggle(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    ))}
  </div>
);

export default GarmentStyleAxisPicker;
