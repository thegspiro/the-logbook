import React from 'react';
import type { InventoryItem } from '../types';
import { styleAttributesLabel } from '../types';
import { displaySize } from '../utils/variantHelpers';

const SIZE_COLORS = 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30';
const COLOR_COLORS = 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30';
const STYLE_COLORS = 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30';

interface CapsuleProps {
  label: string;
  colorClass: string;
}

const Capsule: React.FC<CapsuleProps> = ({ label, colorClass }) => (
  <span
    className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] leading-none font-semibold ${colorClass}`}
  >
    {label}
  </span>
);

/** A variant attribute a caller can suppress. */
export type VariantAttribute = 'size' | 'color' | 'style';

export interface VariantCapsulesProps {
  item: InventoryItem;
  showLabels?: boolean;
  /**
   * Attributes to leave out.
   *
   * For a caller that already states the value elsewhere on the row — the
   * items list omits `size` when it renders a Size column, and omits whichever
   * attribute the list is grouped by, since the group header names it once
   * instead of every row repeating it.
   *
   * Defaults to showing everything, so the callers that do not group are
   * untouched.
   */
  omit?: readonly VariantAttribute[];
}

/**
 * Renders size, color, and style as compact colored capsules.
 * Displays nothing if the item has no variant attributes.
 */
export const VariantCapsules: React.FC<VariantCapsulesProps> = ({ item, showLabels = false, omit = [] }) => {
  const size = omit.includes('size') ? '' : displaySize(item);
  const color = omit.includes('color') ? '' : item.color;
  // The whole garment, not just the primary attribute: a men's long-sleeve
  // polo stores `style = "polo"` and would otherwise read as plain "Polo".
  // One shared formatter rather than a local one, which is how this capsule
  // came to render "Mens" and "V Neck" (CLAUDE.md pitfall #29).
  const style = omit.includes('style') ? '' : styleAttributesLabel(item.style_attributes, item.style);

  if (!size && !color && !style) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {size && <Capsule label={showLabels ? `Size: ${size}` : size} colorClass={SIZE_COLORS} />}
      {color && <Capsule label={showLabels ? `Color: ${color}` : color} colorClass={COLOR_COLORS} />}
      {style && <Capsule label={showLabels ? `Style: ${style}` : style} colorClass={STYLE_COLORS} />}
    </span>
  );
};

export default VariantCapsules;
