/**
 * Display helpers for how a line is personalized.
 *
 * The method is read on the vendor purchase order and on order detail, where
 * someone acts on it — phoning an order in, or checking delivered goods. It is
 * always spelled out rather than implied by the presence of a thread swatch:
 * "no swatch" would otherwise have to mean both "engraved" and "nothing
 * stitched", and the sheet gets printed in black and white.
 */

import { PERSONALIZATION_METHODS, type PersonalizationMethod } from '../types';

/** "Embroidered" / "Engraved" for a stored method, falling back to the slug. */
export const methodLabel = (method: PersonalizationMethod | null | undefined): string => {
  if (!method) return '—';
  return PERSONALIZATION_METHODS.find((m) => m.value === method)?.label ?? method;
};
