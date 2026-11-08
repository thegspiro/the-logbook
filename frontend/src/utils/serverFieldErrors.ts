/**
 * Puts a 422's validation errors on the fields they belong to (forms review
 * F-2 part 2).
 *
 * The API's validation handler (`main.py`) answers `{detail: [{field,
 * message}]}` with the schema's field name — `first_name`, `emergency_contacts.0.phone`
 * — and the frontend used to join those into one toast: "first_name: Value is
 * too long." A member reads an API key, no limit, and no highlighted field.
 * This maps each entry onto the form's own field key and rewrites the generic
 * messages in the field's own label, so the error lands under the input that
 * caused it.
 *
 * Both spellings of an entry are read, as in errorHandling.ts: `{field,
 * message}` from the API's handler and Pydantic's `{loc, msg}` from anything
 * that bypasses it.
 */

export interface ServerFieldSpec {
  /** The label the form shows, used to word the message. */
  label: string;
  /** The schema's `max_length`, so "too long" can say what the limit is. */
  maxLength?: number | undefined;
  /**
   * The API field path(s) this form field answers for. Defaults to the form
   * key itself in both snake_case and camelCase, which covers a snake_case
   * module (`first_name`) and a camelCase one (`firstName`) alike — check the
   * module's casing (CLAUDE.md pitfall #5) only when the names differ.
   */
  api?: string | readonly string[] | undefined;
}

export interface ServerFieldErrors<K extends string> {
  /** One friendly message per form field that the server refused. */
  fieldErrors: Partial<Record<K, string>>;
  /** Messages the form has no field for, without any API field name. */
  unmatched: string[];
}

interface Entry {
  field?: unknown;
  message?: unknown;
  loc?: unknown;
  msg?: unknown;
}

const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function entryPath(entry: Entry): string | null {
  if (typeof entry.field === 'string' && entry.field) return entry.field.replace(/^body\./, '');
  if (Array.isArray(entry.loc)) {
    const parts = (entry.loc as unknown[]).map(String);
    if (parts[0] === 'body') parts.shift();
    return parts.length ? parts.join('.') : null;
  }
  return null;
}

function entryMessage(entry: Entry): string {
  if (typeof entry.message === 'string' && entry.message) return entry.message;
  if (typeof entry.msg === 'string' && entry.msg) return entry.msg.replace(/^Value error, /, '');
  return 'Invalid value.';
}

/**
 * The server's generic wording, restated in the field's own label. A message
 * that is not one of these came from one of our own validators, which are
 * written for the person on the screen, and is shown as it is.
 */
export function friendlyFieldMessage(message: string, spec: ServerFieldSpec): string {
  const { label, maxLength } = spec;
  if (/too long/i.test(message) || /at most \d+ character/i.test(message)) {
    return maxLength ? `${label} is too long — keep it to ${maxLength} characters.` : `${label} is too long.`;
  }
  if (/too short/i.test(message) || /at least 1 character/i.test(message)) return `${label} can't be blank.`;
  if (/^(this )?field (is )?required/i.test(message)) return `${label} is required.`;
  if (/^invalid date format/i.test(message)) return `${label} needs a valid date.`;
  if (/^expected a number/i.test(message)) return `${label} needs a number.`;
  if (/out of the allowed range/i.test(message)) return `${label} is outside the allowed range.`;
  if (/^invalid id format/i.test(message) || /^invalid value\.?$/i.test(message)) {
    return `${label} isn't a value this form accepts.`;
  }
  return message;
}

/**
 * The field errors in a 422, keyed by the form's own field names, or `null`
 * when `error` is not a validation failure with a list of entries — the caller
 * then reports it however it reports any other failure.
 */
export function mapServerFieldErrors<K extends string>(
  error: unknown,
  fields: Record<K, ServerFieldSpec>
): ServerFieldErrors<K> | null {
  if (typeof error !== 'object' || error === null || !('response' in error)) return null;
  const response = (error as { response?: { status?: number; data?: { detail?: unknown } } }).response;
  const detail = response?.data?.detail;
  if (response?.status !== 422 || !Array.isArray(detail)) return null;

  const lookup = new Map<string, K>();
  for (const key of Object.keys(fields) as K[]) {
    const api = fields[key].api;
    const names = api === undefined ? [key, toSnake(key), toCamel(key)] : typeof api === 'string' ? [api] : api;
    for (const name of names) lookup.set(name, key);
  }

  const result: ServerFieldErrors<K> = { fieldErrors: {}, unmatched: [] };
  for (const raw of detail as Entry[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const path = entryPath(raw);
    const message = entryMessage(raw);
    const key = path ? lookup.get(path) : undefined;
    if (key === undefined) {
      result.unmatched.push(message);
    } else if (result.fieldErrors[key] === undefined) {
      result.fieldErrors[key] = friendlyFieldMessage(message, fields[key]);
    }
  }
  return result;
}
