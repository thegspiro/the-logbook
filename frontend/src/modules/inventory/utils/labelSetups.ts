/**
 * Named print setups for the inventory label page ("Rollo 2x1, QR").
 *
 * Saved on the organization through /inventory/label-setups, so every member
 * who prints labels sees the same list at any station. The member's position
 * still remembers the last size, style and lines they used.
 */

import { sanitizeLabelLines } from './labelLines';

/** One saved setup, as the API returns it. */
export interface LabelSetup {
  id: string;
  name: string;
  preset: string;
  custom_width: number | null;
  custom_height: number | null;
  symbology: 'code128' | 'qr';
  extra_lines: string[];
  copies: number;
  printer_id: string | null;
}

/** What the page sends to save one; the server assigns the id. */
export interface LabelSetupSave {
  name: string;
  preset: string;
  custom_width?: number;
  custom_height?: number;
  symbology: 'code128' | 'qr';
  extra_lines: string[];
  copies: number;
  printer_id?: string;
}

// Mirrors MAX_LABEL_SETUPS and the name bound in the backend schema; the
// server enforces both, these only let the page say so before it asks.
export const MAX_LABEL_SETUPS = 20;
export const MAX_SETUP_NAME = 40;

/** Drop line keys this page does not offer, so an older setup cannot send one. */
export function usableSetupLines(setup: LabelSetup): string[] {
  return sanitizeLabelLines(setup.extra_lines) ?? [];
}
