/**
 * Reading a catalog row's size the way the backend reads it.
 *
 * Two rules live here, and both mirror `app/services/inventory_service.py`,
 * which is authoritative. They exist on the client so the fulfil picker can
 * decide whether a stocked row is the size a member asked for without a round
 * trip; when they disagree with the backend the backend is right.
 */
import type { InventoryItem } from '../types';

/** Alias table mirroring `InventoryService._SIZE_ALIASES`. */
const SIZE_ALIASES: Record<string, string> = {
  '2xs': 'xxs',
  xxs: 'xxs',
  xs: 'xs',
  'extra small': 'xs',
  s: 's',
  sm: 's',
  small: 's',
  m: 'm',
  med: 'm',
  medium: 'm',
  l: 'l',
  lg: 'l',
  large: 'l',
  xl: 'xl',
  '1xl': 'xl',
  'extra large': 'xl',
  xxl: 'xxl',
  '2xl': 'xxl',
  xxxl: 'xxxl',
  '3xl': 'xxxl',
  xxxxl: 'xxxxl',
  '4xl': 'xxxxl',
};

/**
 * The size string a stocked row should be bucketed by.
 *
 * Mirrors `_item_stock_size_value`: the structured `standard_size` wins, but
 * `custom` is a sentinel meaning "the real value is in the free-text `size`",
 * so it is skipped rather than compared. Reading `standard_size` blindly makes
 * a legitimately custom-sized item (`standard_size: 'custom', size: '34W'`)
 * compare as the literal word "custom" — it then never matches, and renders in
 * the picker as "Custom" instead of the size it actually is.
 */
export function stockSizeValue(item: Pick<InventoryItem, 'standard_size' | 'size'>): string | undefined {
  const standard = item.standard_size?.trim();
  if (standard && standard.toLowerCase() !== 'custom') return standard;
  return item.size?.trim() || undefined;
}

/**
 * Canonical key for comparing two sizes.
 *
 * Mirrors `_normalize_size_key`: drop any parenthetical qualifier, collapse
 * whitespace, lowercase, then fold common alpha spellings together so a member
 * who recorded "Large" matches stock filed as "l".
 */
export function normalizeSizeKey(value: string | null | undefined): string {
  if (!value) return '';
  const base = value.split('(')[0] ?? '';
  const key = base.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  return SIZE_ALIASES[key] ?? key;
}

/**
 * The product a variant row belongs to.
 *
 * Mirrors `_product_base_name`: the variant generator names its output
 * `base — Size — Colour — Style`, so the segment before the first separator is
 * the product. Only applied to a row that carries a variant axis, so an item
 * legitimately named "Halligan — 30 inch" keeps its whole name.
 */
export function productBaseName(
  item: Pick<InventoryItem, 'name' | 'size' | 'standard_size' | 'color' | 'style'>
): string {
  const name = (item.name ?? '').trim();
  const carriesVariantAxis = Boolean(item.size || item.standard_size || item.color || item.style);
  if (carriesVariantAxis && name.includes(' — ')) {
    return (name.split(' — ')[0] ?? '').trim() || name;
  }
  return name;
}
