/**
 * Report cell formatting.
 *
 * Downloads are built on the server (`POST /reports/export`), which re-runs
 * the report and audits the export; what remains here is the shared helper
 * the renderers use to show a cell.
 */

/** Safely convert any unknown value to a display string. */
export const toStr = (v: unknown, fallback = ''): string => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return fallback;
  }
};
