import React from 'react';
import type { InventoryItem } from '../types';

const SIZE_COLORS = 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30';
const COLOR_COLORS = 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30';
const STYLE_COLORS = 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30';

interface CapsuleProps {
  label: string;
  colorClass: string;
}

const Capsule: React.FC<CapsuleProps> = ({ label, colorClass }) => (
  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border leading-none ${colorClass}`}>
    {label}
  </span>
);

export interface VariantCapsulesProps {
  item: InventoryItem;
  showLabels?: boolean;
}

/**
 * Renders size, color, and style as compact colored capsules.
 * Displays nothing if the item has no variant attributes.
 */
export const VariantCapsules: React.FC<VariantCapsulesProps> = ({ item, showLabels = false }) => {
  const size = item.standard_size || item.size;
  const color = item.color;
  const style = item.style;

  if (!size && !color && !style) return null;

  const formatStyle = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {size && (
        <Capsule
          label={showLabels ? `Size: ${size.toUpperCase()}` : size.toUpperCase()}
          colorClass={SIZE_COLORS}
        />
      )}
      {color && (
        <Capsule
          label={showLabels ? `Color: ${color}` : color}
          colorClass={COLOR_COLORS}
        />
      )}
      {style && (
        <Capsule
          label={showLabels ? `Style: ${formatStyle(style)}` : formatStyle(style)}
          colorClass={STYLE_COLORS}
        />
      )}
    </span>
  );
};

export default VariantCapsules;
