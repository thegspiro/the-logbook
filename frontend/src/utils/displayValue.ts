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
