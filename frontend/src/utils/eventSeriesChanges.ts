/**
 * What a "This and all future events" save sends.
 *
 * The server writes every field it receives onto each later occurrence in the
 * series, and the edit form resends every field it shows. Sent whole, a save
 * was refused over values nobody touched whenever a later occurrence had
 * finalized attendance and differed from this one, and a field left blank on
 * this occurrence wiped it from every later one. So the series save carries
 * only what differs from the occurrence the form loaded.
 */
import type { Event, EventUpdate } from '../types/event';

/**
 * Sent together or not at all. The server moves each occurrence by this one's
 * shift and keeps an RSVP deadline the same lead ahead of each start, so a
 * moved start without its end or deadline would change the length and the
 * lead it did not mean to.
 */
const TIMING_FIELDS = ['start_datetime', 'end_datetime', 'rsvp_deadline'] as const;
const TIMING: ReadonlySet<string> = new Set(TIMING_FIELDS);

/** Null, undefined, an empty string and an empty list all mean "none" here. */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function isSame(key: string, sent: unknown, stored: unknown): boolean {
  if (isBlank(sent) || isBlank(stored)) return isBlank(sent) && isBlank(stored);
  // The form sends `…:00.000Z`, the API returns `…:00Z` or `+00:00`.
  if (TIMING.has(key)) return Date.parse(String(sent)) === Date.parse(String(stored));
  return JSON.stringify(sent) === JSON.stringify(stored);
}

/**
 * A copy of *payload* without the fields equal to *loaded*'s. Training
 * details are kept as sent: they are not an event column, and the server
 * judges them against each occurrence's own session.
 */
export function onlyChangedSeriesFields(payload: EventUpdate, loaded: Event): EventUpdate {
  const stored = new Map<string, unknown>(Object.entries(loaded));
  const timingChanged = TIMING_FIELDS.some((key) => key in payload && !isSame(key, payload[key], stored.get(key)));
  const changed: EventUpdate = { ...payload };
  for (const key of Object.keys(changed) as (keyof EventUpdate)[]) {
    if (key === 'training_details') continue;
    const keep = TIMING.has(key) ? timingChanged : !isSame(key, changed[key], stored.get(key));
    if (!keep) delete changed[key];
  }
  return changed;
}
