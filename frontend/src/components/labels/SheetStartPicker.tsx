/**
 * "Start at label N" for an Avery 5160 sheet, so a partly used sheet goes back
 * in the printer instead of the bin. The label pages render the skipped
 * positions as blank cells in their preview and send the same position to the
 * PDF, so browser print and PDF land on the same label.
 */

import React from 'react';

// Avery 5160, the one sheet layout the renderers lay out: 3 columns by 10 rows.
export const SHEET_LABELS_PER_PAGE = 30;

interface SheetStartPickerProps {
  value: number;
  onChange: (position: number) => void;
}

export const SheetStartPicker: React.FC<SheetStartPickerProps> = ({ value, onChange }) => (
  <div className="card-secondary mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
    <div className="flex-1">
      <label htmlFor="sheet-start-position" className="form-label">
        Start at label
      </label>
      <div className="flex items-center gap-2">
        <input
          id="sheet-start-position"
          type="number"
          min={1}
          max={SHEET_LABELS_PER_PAGE}
          value={value}
          onChange={(e) => onChange(Math.max(1, Math.min(SHEET_LABELS_PER_PAGE, parseInt(e.target.value) || 1)))}
          aria-describedby="sheet-start-position-help"
          className="form-input w-24"
        />
        <span className="text-theme-text-secondary text-sm">of {SHEET_LABELS_PER_PAGE}</span>
      </div>
      <p id="sheet-start-position-help" className="text-theme-text-muted mt-1 text-xs">
        {value > 1
          ? `Labels 1–${value - 1} are left blank, so a partly used sheet can go back in the printer.`
          : 'Reusing a sheet with some labels already peeled off? Start at the first label still on it, counting across each row.'}
      </p>
    </div>
    <div
      className="grid shrink-0 grid-cols-3 gap-0.5 self-center rounded border border-slate-300 bg-white p-1"
      aria-hidden="true"
    >
      {Array.from({ length: SHEET_LABELS_PER_PAGE }, (_, index) => (
        <span
          key={index}
          className={`h-1.5 w-4 rounded-[1px] ${
            index < value - 1 ? 'bg-slate-300' : index === value - 1 ? 'bg-emerald-700' : 'border border-slate-300'
          }`}
        />
      ))}
    </div>
  </div>
);

export default SheetStartPicker;
