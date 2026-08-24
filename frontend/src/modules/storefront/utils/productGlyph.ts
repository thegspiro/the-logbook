/**
 * Fallback glyph for a product with no photo.
 *
 * Apparel gets a shirt, everything else a parcel. The tile it sits in is
 * `aria-hidden`, so a wrong guess costs nothing a screen reader will hear —
 * which is why a heuristic on the name is acceptable here and would not be
 * anywhere the choice carried meaning.
 */

import { Package, Shirt } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const APPAREL = /shirt|tee|hood|sweat|polo|jacket|apparel|uniform|coat|pant|vest/i;

export const productGlyph = (offer: { name: string; category?: string | null }): LucideIcon =>
  APPAREL.test(`${offer.name} ${offer.category ?? ''}`) ? Shirt : Package;
