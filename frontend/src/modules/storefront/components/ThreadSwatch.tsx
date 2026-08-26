/**
 * Thread color, shown as a swatch plus its name.
 *
 * Used on the vendor purchase-order sheet and on order detail, where the color
 * is read by someone acting on it — a quartermaster phoning an order in, or
 * checking a delivered garment against what was ordered. The name is always
 * present and never carried by the swatch alone: color is not an accessible
 * label, and the sheet gets printed in black and white.
 */

import React from 'react';
import { EMBROIDERY_THREAD_COLORS, type EmbroideryThreadColor } from '../types';

interface ThreadSwatchProps {
  color: EmbroideryThreadColor;
}

export const ThreadSwatch: React.FC<ThreadSwatchProps> = ({ color }) => {
  const entry = EMBROIDERY_THREAD_COLORS.find((c) => c.value === color);
  if (!entry) {
    // A color retired from the palette still has to render on the orders that
    // were placed in it, so fall back to the stored slug rather than nothing.
    return <span className="whitespace-nowrap">{color}</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {/* Ringed: white and silver disappear into a light surface otherwise. */}
      <span
        aria-hidden="true"
        className="h-3 w-3 shrink-0 rounded-full ring-1 ring-slate-400/60"
        style={{ backgroundColor: entry.hex }}
      />
      {entry.label}
    </span>
  );
};
