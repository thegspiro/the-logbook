/**
 * Display helpers for values whose shape is not known at compile time.
 *
 * Report payloads, audit-event data and attendance-waiver rows all arrive from
 * the API as `Record<string, unknown>`, so the renderers that display them have
 * nothing better than `unknown` to work with. A bare `String(value)` on those
 * would silently render `[object Object]` the moment the backend nests an
 * object in a cell — objects and arrays are JSON-encoded here instead so the
 * data stays legible.
 */
/** Words that should stay fully uppercased when formatting enum labels */
const ACRONYMS = new Set(['ada', 'hvac', 'id', 'ppe', 'nfpa', 'osha', 'ems', 'scba']);

/**
 * Convert a snake_case enum value to a human-readable label.
 *
 * `"building_code"` → `"Building Code"`, `"deputy_chief"` → `"Deputy Chief"`.
 *
 * CSS `text-transform: capitalize` is not a substitute: it capitalises the
 * first letter of each *word*, and a snake_case value is one word, so
 * `deputy_chief` renders as "Deputy_chief" — underscore and all.
 */
export function enumLabel(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .split('_')
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'symbol') return value.description ?? 'Symbol()';
  if (typeof value === 'function') return value.name || 'function';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    // Circular structures throw; there is nothing useful left to show.
    return '';
  }
}
