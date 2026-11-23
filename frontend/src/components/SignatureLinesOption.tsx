/**
 * The "Add signature lines" tick-box shown beside a PDF download.
 *
 * Ticked, the server ends the PDF with Prepared by / Reviewed by / Approved by
 * lines, each with a date, for a report that goes up the chain to be signed on
 * paper. It starts unticked because most downloads are working copies nobody
 * signs (owner decision, 2026-11-21). It affects the PDF only; a CSV has no
 * page to sign.
 */

import React from 'react';

interface SignatureLinesOptionProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const SignatureLinesOption: React.FC<SignatureLinesOptionProps> = ({ checked, onChange, disabled = false }) => (
  <label className="text-theme-text-secondary touch:min-h-11 inline-flex shrink-0 items-center gap-2 text-sm">
    <input
      type="checkbox"
      className="form-checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span>Add signature lines to PDF</span>
  </label>
);
