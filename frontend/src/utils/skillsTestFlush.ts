/**
 * Sends one queued skills evaluation, its steps in order: create, save,
 * complete. The rules are explained in skillsTestOffline.ts.
 *
 * Shared by the page drain (`drainSkillsQueue`) and the service worker's
 * background sync (src/sw/backgroundSync.ts), so an evaluation is sent the
 * same way whichever of them reaches it. The transport and the owner are
 * passed in: the page sends through axios as the signed-in member, the worker
 * through fetch as the member the server says the session belongs to.
 */

import type { SkillTest, SkillTestUpdate } from '../types/skillsTesting';
import {
  SKILLS_QUEUE_MAX_RETRIES,
  STORE_TESTS,
  deleteRow,
  mutatePendingAs,
  type SkillsPendingEntry,
} from './skillsTestOfflineStore';

const BASE = '/training/skills-testing';

/** Requests under `/api/v1`, answered with the test or rejected. */
export interface SkillsTransport {
  post: (path: string, body?: unknown) => Promise<SkillTest>;
  put: (path: string, body: unknown) => Promise<SkillTest>;
  get: (path: string) => Promise<SkillTest>;
  /** The request never reached the server, or its answer never came back. */
  isNetworkError: (error: unknown) => boolean;
  /** The HTTP status the server answered with, when it answered. */
  statusOf: (error: unknown) => number | null;
  messageOf: (error: unknown, fallback: string) => string;
}

export interface SkillsFlushContext {
  transport: SkillsTransport;
  /** The member the entry is written back as; asked at every write. */
  owner: () => string;
  /** Whether the entry may still be sent under the live session. */
  maySend: (entry: SkillsPendingEntry) => boolean;
}

export type SkillsFlushOutcome =
  | { kind: 'synced'; test: SkillTest | null; completed: boolean }
  | { kind: 'failed'; message: string }
  | { kind: 'offline' }
  | { kind: 'retry' };

function mutate(
  ctx: SkillsFlushContext,
  testId: string,
  change: (existing: SkillsPendingEntry | undefined) => SkillsPendingEntry | null | undefined
): Promise<SkillsPendingEntry | null> {
  return mutatePendingAs(ctx.owner(), testId, change);
}

async function markFailedOrRetry(
  ctx: SkillsFlushContext,
  entry: SkillsPendingEntry,
  err: unknown
): Promise<SkillsFlushOutcome> {
  const status = ctx.transport.statusOf(err);
  const message = ctx.transport.messageOf(err, 'The server refused this evaluation');
  const permanent = status !== null && status >= 400 && status < 500;
  let failedNow = permanent;
  await mutate(ctx, entry.testId, (existing) => {
    if (!existing) return undefined;
    const retries = existing.retries + 1;
    failedNow = permanent || retries >= SKILLS_QUEUE_MAX_RETRIES;
    return {
      ...existing,
      retries,
      failed: failedNow ? { status, message, at: Date.now() } : undefined,
    };
  });
  return failedNow ? { kind: 'failed', message } : { kind: 'retry' };
}

export async function flushSkillsEntry(
  start: SkillsPendingEntry,
  ctx: SkillsFlushContext
): Promise<SkillsFlushOutcome> {
  const { transport } = ctx;
  let entry: SkillsPendingEntry | null = start;
  let latest: SkillTest | null = null;

  // The member can change between listing and sending, and the request goes
  // out with whoever's cookies are live (FE3-34-5).
  if (!ctx.maySend(entry)) return { kind: 'retry' };

  // 1. Create — a test started with no signal does not exist server-side yet.
  if (entry.create) {
    const create = entry.create;
    try {
      latest = await transport.post(`${BASE}/tests`, create);
    } catch (err) {
      if (transport.isNetworkError(err)) return { kind: 'offline' };
      return markFailedOrRetry(ctx, entry, err);
    }
    const createdVersion = latest.version;
    entry = await mutate(ctx, entry.testId, (existing) =>
      existing ? { ...existing, create: undefined, baseVersion: createdVersion } : undefined
    );
    if (!entry) return { kind: 'synced', test: latest, completed: false };
  }

  // 2. The merged save, against the version it was made from.
  if (entry.update) {
    const sentRev = entry.rev;
    const body: SkillTestUpdate = { ...entry.update };
    if (entry.baseVersion !== undefined) body.expected_version = entry.baseVersion;
    try {
      latest = await transport.put(`${BASE}/tests/${entry.testId}`, body);
    } catch (err) {
      if (transport.isNetworkError(err)) return { kind: 'offline' };
      return markFailedOrRetry(ctx, entry, err);
    }
    const savedVersion = latest.version;
    entry = await mutate(ctx, entry.testId, (existing) => {
      if (!existing) return undefined;
      // A save written while this one was in flight stays queued, now made
      // against the version this one produced.
      if (existing.rev !== sentRev) return { ...existing, baseVersion: savedVersion };
      return { ...existing, update: undefined, baseVersion: savedVersion, retries: 0 };
    });
    if (!entry) return { kind: 'synced', test: latest, completed: false };
    if (entry.update) return { kind: 'retry' };
  }

  // 3. Complete, only once nothing is left to save.
  if (entry.complete) {
    try {
      latest = await transport.post(`${BASE}/tests/${entry.testId}/complete`);
    } catch (err) {
      if (transport.isNetworkError(err)) return { kind: 'offline' };
      // A completion whose response was lost on an earlier try has already
      // landed; asking is cheaper than reporting a failure that is not one.
      try {
        const current = await transport.get(`${BASE}/tests/${entry.testId}`);
        if (current.status === 'completed') latest = current;
      } catch {
        // Fall through to the refusal below.
      }
      if (latest?.status !== 'completed') return markFailedOrRetry(ctx, entry, err);
    }
    await mutate(ctx, entry.testId, () => null);
    await deleteRow(STORE_TESTS, entry.testId).catch(() => undefined);
    return { kind: 'synced', test: latest, completed: true };
  }

  // Nothing left: the entry has done its job.
  await mutate(ctx, entry.testId, (existing) => (existing && !existing.update && !existing.create ? null : undefined));
  return { kind: 'synced', test: latest, completed: false };
}
