/**
 * Named print setups for the inventory label page ("Rollo 2x1, 2 copies, QR").
 *
 * Kept in this browser's storage, not on the member's position: a setup
 * describes a print station — the printer beside it and the stock loaded in
 * it — and several members share one station. The position still remembers
 * the last size, style and lines each member used.
 */

import { sanitizeLabelLines } from './labelLines';

export interface LabelSetup {
  name: string;
  preset: string;
  customWidth: string;
  customHeight: string;
  symbology: 'code128' | 'qr';
  lines: string[];
  copies: number;
  /** The network printer to select, when the station has one. */
  printerId: string | null;
}

const STORAGE_KEY = 'inventory:labelSetups';
export const MAX_LABEL_SETUPS = 20;
export const MAX_SETUP_NAME = 40;

function parseSetup(raw: unknown): LabelSetup | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, MAX_SETUP_NAME) : '';
  if (!name || typeof r.preset !== 'string' || !r.preset) return null;
  const copies = typeof r.copies === 'number' && Number.isFinite(r.copies) ? Math.round(r.copies) : 1;
  return {
    name,
    preset: r.preset,
    customWidth: typeof r.customWidth === 'string' ? r.customWidth : '2',
    customHeight: typeof r.customHeight === 'string' ? r.customHeight : '1',
    symbology: r.symbology === 'qr' ? 'qr' : 'code128',
    lines: sanitizeLabelLines(r.lines) ?? [],
    copies: Math.max(1, Math.min(50, copies)),
    printerId: typeof r.printerId === 'string' && r.printerId ? r.printerId : null,
  };
}

export function loadLabelSetups(): LabelSetup[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .map(parseSetup)
      .filter((s): s is LabelSetup => s !== null)
      .slice(0, MAX_LABEL_SETUPS);
  } catch {
    return [];
  }
}

export function storeLabelSetups(setups: LabelSetup[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setups.slice(0, MAX_LABEL_SETUPS)));
  } catch {
    // Unavailable storage only costs keeping the setups past this visit.
  }
}

/** Add a setup, replacing one of the same name (case-insensitive) in place. */
export function upsertLabelSetup(setups: LabelSetup[], setup: LabelSetup): LabelSetup[] {
  const key = setup.name.toLowerCase();
  const at = setups.findIndex((s) => s.name.toLowerCase() === key);
  if (at >= 0) return setups.map((s, i) => (i === at ? setup : s));
  return [...setups, setup].slice(0, MAX_LABEL_SETUPS);
}
