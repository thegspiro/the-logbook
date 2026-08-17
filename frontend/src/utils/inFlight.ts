/**
 * In-flight request de-duplication.
 *
 * The response cache in `apiCache.ts` only helps a caller that arrives *after*
 * an identical request has finished. Several components mounting together all
 * miss a cold cache and all reach the network — the navigation surfaces each
 * ask for the organization's enabled modules on every page load, which measured
 * as three identical round trips per mount.
 *
 * This shares the promise instead of the response, so simultaneous callers make
 * one request. It deliberately stores nothing once the request settles, so it
 * adds no caching to endpoints the HIPAA rules exclude from caching — a
 * response is only ever handed to callers who asked for it at the same moment.
 *
 * Wrap at the *service* layer, not inside the axios instance: by the time a
 * service promise settles, the response interceptor has already run its
 * 401 → refresh → retry sequence, so followers receive the retried result. A
 * dedupe placed inside the axios adapter would instead hand followers the
 * pre-refresh failure, and a retried request would re-enter the interceptor and
 * wait on its own pending entry.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Share one in-flight promise between concurrent callers for the same key.
 *
 * @param key Identifies the request. Include any parameters that change the
 *   response, or two different requests will be served the same result.
 * @param start Begins the request. Called only when nothing is in flight.
 */
export function dedupeInFlight<T>(key: string, start: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  // The entry is removed on settle rather than on success, so a failed request
  // does not wedge the key: the next caller starts a fresh one. Followers of a
  // failed request share its rejection, which is correct — it is their request
  // too.
  const started = start().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, started);
  return started;
}

/** Whether a request is currently in flight for this key. Testing aid. */
export function isInFlight(key: string): boolean {
  return inFlight.has(key);
}

/** Drop all pending entries. Tests only — never call this from app code. */
export function clearInFlight(): void {
  inFlight.clear();
}
