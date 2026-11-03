/**
 * The printer resolution a browser-printed Code 128 is sized for.
 *
 * The browser cannot ask the printer, so by default it is inferred from the
 * label size (printerDpiFor). That guess is wrong for, say, a 300 dpi Zebra,
 * whose bars then fall back to uneven widths, so a member can name the
 * resolution instead. It is remembered per label size on this computer: the
 * resolution belongs to the printer plugged in here, and one station may feed
 * a Rollo for 2" x 1" rolls and a Dymo for address labels.
 */
import { useCallback, useEffect, useState } from 'react';
import { printerDpiFor } from './barcodeGeometry';

export const PRINTER_DPI_CHOICES = [203, 300, 600] as const;

const STORAGE_KEY = 'labels:printerDpi';

function readAll(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if ((PRINTER_DPI_CHOICES as readonly unknown[]).includes(value)) out[key] = value as number;
    }
    return out;
  } catch {
    return {};
  }
}

/** The resolution chosen for this label size on this computer, or null for Auto. */
export function loadPrinterDpiOverride(presetId: string): number | null {
  return readAll()[presetId] ?? null;
}

export function savePrinterDpiOverride(presetId: string, dpi: number | null): void {
  try {
    const all = readAll();
    if (dpi === null) delete all[presetId];
    else all[presetId] = dpi;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Unavailable storage only means the choice is not remembered.
  }
}

export function usePrinterDpi(presetId: string) {
  const [override, setOverrideState] = useState<number | null>(() => loadPrinterDpiOverride(presetId));

  useEffect(() => {
    setOverrideState(loadPrinterDpiOverride(presetId));
  }, [presetId]);

  const setOverride = useCallback(
    (dpi: number | null) => {
      savePrinterDpiOverride(presetId, dpi);
      setOverrideState(dpi);
    },
    [presetId]
  );

  return { override, autoDpi: printerDpiFor(presetId), dpi: override ?? printerDpiFor(presetId), setOverride };
}
