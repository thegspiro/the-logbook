import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dedupeInFlight, isInFlight, clearInFlight } from './inFlight';

/** A promise plus the handles to settle it, so tests control the timing. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('dedupeInFlight', () => {
  beforeEach(() => {
    clearInFlight();
  });

  it('starts the request once for concurrent callers', async () => {
    const d = deferred<string>();
    const start = vi.fn().mockReturnValue(d.promise);

    const a = dedupeInFlight('modules', start);
    const b = dedupeInFlight('modules', start);
    const c = dedupeInFlight('modules', start);
    d.resolve('ok');

    expect(await Promise.all([a, b, c])).toEqual(['ok', 'ok', 'ok']);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('keeps different keys apart', async () => {
    const start = vi.fn().mockResolvedValue('ok');

    await Promise.all([dedupeInFlight('modules', start), dedupeInFlight('branding', start)]);

    expect(start).toHaveBeenCalledTimes(2);
  });

  // Sharing must last only as long as the request. A second caller after the
  // first has finished should get fresh data, not a permanently pinned value.
  it('does not cache once the request settles', async () => {
    const start = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');

    expect(await dedupeInFlight('modules', start)).toBe('first');
    expect(await dedupeInFlight('modules', start)).toBe('second');
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('shares a rejection with every caller', async () => {
    const d = deferred<string>();
    const start = vi.fn().mockReturnValue(d.promise);

    const a = dedupeInFlight('modules', start);
    const b = dedupeInFlight('modules', start);
    d.reject(new Error('offline'));

    await expect(a).rejects.toThrow('offline');
    await expect(b).rejects.toThrow('offline');
    expect(start).toHaveBeenCalledTimes(1);
  });

  // A failed request must not wedge the key — otherwise one network blip would
  // pin the failure for the rest of the session.
  it('lets the next caller retry after a failure', async () => {
    const start = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('recovered');

    await expect(dedupeInFlight('modules', start)).rejects.toThrow('offline');

    expect(isInFlight('modules')).toBe(false);
    expect(await dedupeInFlight('modules', start)).toBe('recovered');
  });

  it('reports what is in flight and clears it on settle', async () => {
    const d = deferred<string>();

    const pending = dedupeInFlight('modules', () => d.promise);
    expect(isInFlight('modules')).toBe(true);

    d.resolve('ok');
    await pending;

    expect(isInFlight('modules')).toBe(false);
  });

  it('does not share a pending request across a clear', async () => {
    const oldSession = deferred<string>();
    const newSession = deferred<string>();
    const start = vi.fn().mockReturnValueOnce(oldSession.promise).mockReturnValueOnce(newSession.promise);

    const oldRequest = dedupeInFlight('modules', start);
    clearInFlight();
    const newRequest = dedupeInFlight('modules', start);

    oldSession.resolve('old session');
    expect(await oldRequest).toBe('old session');
    // Settling the cleared request must not delete its new-session replacement.
    expect(isInFlight('modules')).toBe(true);

    newSession.resolve('new session');
    expect(await newRequest).toBe('new session');
    expect(start).toHaveBeenCalledTimes(2);
    expect(isInFlight('modules')).toBe(false);
  });
});
