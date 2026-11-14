import React from 'react';
import { PRINTER_DPI_CHOICES } from './printerDpi';

interface PrinterDpiSelectProps {
  id: string;
  /** The chosen resolution, or null for Auto. */
  value: number | null;
  /** What Auto resolves to for the current label size. */
  autoDpi: number;
  onChange: (dpi: number | null) => void;
}

export const PrinterDpiSelect: React.FC<PrinterDpiSelectProps> = ({ id, value, autoDpi, onChange }) => (
  <div>
    <label htmlFor={id} className="text-theme-text-muted mb-1 block text-xs font-medium tracking-wider uppercase">
      Printer resolution
    </label>
    <select
      id={id}
      className="form-input w-auto"
      value={value === null ? 'auto' : String(value)}
      onChange={(e) => onChange(e.target.value === 'auto' ? null : Number(e.target.value))}
    >
      <option value="auto">Auto ({autoDpi} dpi for this label size)</option>
      {PRINTER_DPI_CHOICES.map((dpi) => (
        <option key={dpi} value={dpi}>
          {dpi} dpi
        </option>
      ))}
    </select>
    <p className="text-theme-text-muted mt-1 text-xs">
      Match your printer so barcode bars print at exact widths: Rollo and most Zebra desktop printers are 203, Dymo
      LabelWriters 300. It&apos;s on the printer&apos;s spec sheet. Remembered for this label size on this computer, and
      only used when printing from the browser.
    </p>
  </div>
);
