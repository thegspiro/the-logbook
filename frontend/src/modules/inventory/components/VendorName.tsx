/**
 * A supplier's name as it should appear on an item or reorder row.
 *
 * A name that is only typed text is muted: nobody has attached that row to a
 * vendor record, so there is no contact behind it, no purchase history, and
 * nothing the vendor screen can tell you. Printing it in the same weight as a
 * linked name hides precisely the rows worth cleaning up.
 */
import React from 'react';
import { vendorDisplay, type VendorNamed } from '../utils/vendorHelpers';

export interface VendorNameProps {
  record: VendorNamed;
  /** Shown when the record names no supplier at all. */
  fallback?: string;
}

export const VendorName: React.FC<VendorNameProps> = ({ record, fallback = '—' }) => {
  const { name, linked } = vendorDisplay(record);

  if (!name) return <span className="text-theme-text-muted">{fallback}</span>;
  if (linked) return <span className="text-theme-text-primary">{name}</span>;

  return (
    <span className="text-theme-text-muted italic" title="Not on the vendor list">
      {name}
      {/* The muting is the signal on screen; this is the same signal for a
          screen reader, which cannot see the styling. */}
      <span className="sr-only"> (not on the vendor list)</span>
    </span>
  );
};

export default VendorName;
