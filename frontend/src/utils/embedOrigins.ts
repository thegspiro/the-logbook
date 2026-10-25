/**
 * The rule for a website allowed to embed a department's forms: an exact
 * https origin — scheme, host and optional port, nothing else.
 *
 * A projection of `normalize_embed_origin` in backend/app/utils/embed_origins.py,
 * which is the authority and re-checks every entry: this copy exists so the
 * settings screen can point at the bad line before saving instead of after.
 */

const ORIGIN =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::([0-9]{1,5}))?$/;

/** Mirrors MAX_EMBED_ORIGINS on the backend. */
export const MAX_EMBED_ORIGINS = 10;

/** The origin *value* names, or null when it is not one. */
export function normalizeEmbedOrigin(value: string): string | null {
  const origin = value.trim().toLowerCase().replace(/\/+$/, '');
  const match = ORIGIN.exec(origin);
  if (!match) return null;
  const port = match[1];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;
  return origin;
}

export interface ParsedEmbedOrigins {
  origins: string[];
  /** Lines that are not an exact https origin, as typed. */
  invalid: string[];
}

/** Read one origin per line, skipping blanks and repeats. */
export function parseEmbedOrigins(text: string): ParsedEmbedOrigins {
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const origin = normalizeEmbedOrigin(line);
    if (origin === null) invalid.push(line.trim());
    else if (!origins.includes(origin)) origins.push(origin);
  }
  return { origins, invalid };
}
