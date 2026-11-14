/**
 * Storage for the skills-testing offline queue and read cache, with nothing
 * that needs to know who is signed in.
 *
 * Split from skillsTestOffline.ts so the service worker's background sync
 * (src/sw/backgroundSync.ts) can read and update the same queue. That file
 * imports the auth store to stamp and check owners, and the auth store pulls
 * in the whole app, none of which can load in a service worker. Here the
 * owner is always passed in; skillsTestOffline.ts passes the signed-in
 * member, and re-exports what pages import from it.
 */

import { openIndexedDb } from './offlineDb';
import type { OwnedQueueEntry } from './offlineQueueOwner';
import type { SkillTestCreate, SkillTestUpdate } from '../types/skillsTesting';

export const DB_NAME = 'logbook-offline-skills';
export const DB_VERSION = 1;
export const STORE_PENDING = 'pending';
export const STORE_TESTS = 'tests';
export const STORE_TEMPLATES = 'templates';
export const STORE_CANDIDATES = 'candidates';
export const ALL_STORES = [STORE_PENDING, STORE_TESTS, STORE_TEMPLATES, STORE_CANDIDATES] as const;

/** 5xx answers tolerated before an entry is marked failed (kept, not dropped). */
export const SKILLS_QUEUE_MAX_RETRIES = 5;

/**
 * How long an unsent evaluation is held for an examiner the device signed out
 * without asking (owner decision 2026-11-01, "keep until same examiner
 * returns"). Seven days covers a full 24/48 rotation with a Kelly day, so an
 * examiner timed out at the end of a tour finds their scoring on their next
 * one; past that the scorecard is more likely abandoned than awaited, and it
 * names a candidate on a shared device. Counted from when it was first held,
 * not from when it was scored.
 */
export const HELD_EVALUATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** A create sent from a device with no signal: the client minted the id. */
export interface OfflineSkillTestCreate extends SkillTestCreate {
  id: string;
  /** The template version the scorecard was built from; the server refuses a
   *  create against a sheet that has changed since. */
  expected_template_version?: number | undefined;
}

export interface SkillsPendingEntry extends OwnedQueueEntry {
  /** The test's id — one entry per test. */
  testId: string;
  /** "Template — Candidate", for anything that has to name the evaluation. */
  label: string;
  queuedAt: number;
  updatedAt: number;
  /** Bumped on every write, so a drain can tell whether the save it just sent
   *  is still the latest one. */
  rev: number;
  create?: OfflineSkillTestCreate | undefined;
  /** The merged, latest save. Never carries expected_version. */
  update?: SkillTestUpdate | undefined;
  /** The test version the queued save was made against. */
  baseVersion?: number | undefined;
  complete: boolean;
  retries: number;
  /** Set when the server refused a step; the payload is kept. */
  failed?: { status: number | null; message: string; at: number } | undefined;
  /** When an automatic sign-out first held this for its absent examiner.
   *  Cleared when they sign back in; retention counts from here. */
  heldAt?: number | undefined;
}

export interface CachedRow<T> extends OwnedQueueEntry {
  id: string;
  value: T;
  cachedAt: number;
}

export function openSkillsDb(): Promise<IDBDatabase> {
  return openIndexedDb(DB_NAME, DB_VERSION, (db) => {
    for (const store of ALL_STORES) {
      if (!db.objectStoreNames.contains(store)) {
        db.createObjectStore(store, { keyPath: store === STORE_PENDING ? 'testId' : 'id' });
      }
    }
  });
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function getRow<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openSkillsDb();
  return (await request(db.transaction(store, 'readonly').objectStore(store).get(key))) as T | undefined;
}

export async function allRows<T>(store: string): Promise<T[]> {
  const db = await openSkillsDb();
  return (await request(db.transaction(store, 'readonly').objectStore(store).getAll())) as T[];
}

export async function putRow(store: string, row: unknown): Promise<void> {
  const db = await openSkillsDb();
  await request(db.transaction(store, 'readwrite').objectStore(store).put(row));
}

export async function deleteRow(store: string, key: string): Promise<void> {
  const db = await openSkillsDb();
  await request(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

/**
 * Read-modify-write one pending entry inside a single transaction, as `owner`.
 *
 * `change` receives the stored entry (or undefined) and returns the entry to
 * store, `null` to delete it, or `undefined` to leave it untouched. An entry
 * belonging to someone else is never handed to `change` — it is refused.
 */
export async function mutatePendingAs(
  owner: string,
  testId: string,
  change: (existing: SkillsPendingEntry | undefined) => SkillsPendingEntry | null | undefined
): Promise<SkillsPendingEntry | null> {
  const db = await openSkillsDb();
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE_PENDING, 'readwrite').objectStore(STORE_PENDING);
    const read = store.get(testId);
    read.onerror = () => reject(read.error ?? new Error('IndexedDB request failed'));
    read.onsuccess = () => {
      const existing = read.result as SkillsPendingEntry | undefined;
      if (existing && existing.ownerId !== owner) {
        reject(new Error('This evaluation was saved on this device by someone else'));
        return;
      }
      const next = change(existing);
      if (next === undefined) {
        resolve(existing ?? null);
        return;
      }
      const write = next === null ? store.delete(testId) : store.put({ ...next, ownerId: owner });
      write.onsuccess = () => resolve(next);
      write.onerror = () => reject(write.error ?? new Error('IndexedDB request failed'));
    };
  });
}

export interface SkillsPurgeOutcome {
  /** Unsent evaluations deleted. */
  discarded: number;
  /** Unsent evaluations kept on the device for their examiner. */
  held: number;
}

const isExpired = (entry: SkillsPendingEntry, now: number): boolean =>
  entry.heldAt !== undefined && now - entry.heldAt > HELD_EVALUATION_RETENTION_MS;

/**
 * Empty the skills stores at a sign-out or a change of member, keeping each
 * examiner's unsent evaluations for them (FE-6/FE-7, owner decision
 * 2026-11-01).
 *
 * Kept: a pending entry stamped with an examiner, unless that examiner is
 * `discardFor` (the member who chose to sign out and confirmed the warning
 * that their own unsent work would be deleted) or it has been held past
 * HELD_EVALUATION_RETENTION_MS; and the copy of the live test it scores into,
 * so the examiner can reopen it without signal. Everything else goes: cached
 * sheets, recent candidates, test copies with nothing unsent, and an entry
 * with no examiner on it, which cannot be bound to anybody.
 *
 * Kept entries stay readable only by their examiner: every read and both
 * drains (the page's and the service worker's) filter on `ownerId`, which is
 * what this relies on — the rows are not encrypted.
 *
 * One transaction over every store, so a sign-out cannot leave a test copy
 * whose entry was deleted, or the reverse.
 */
export async function purgeSkillsStores(discardFor: string | null): Promise<SkillsPurgeOutcome> {
  const db = await openSkillsDb();
  const now = Date.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...ALL_STORES], 'readwrite');
    const outcome: SkillsPurgeOutcome = { discarded: 0, held: 0 };
    const keptOwners = new Map<string, string>();
    tx.oncomplete = () => resolve(outcome);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));

    const pending = tx.objectStore(STORE_PENDING);
    const readPending = pending.getAll();
    readPending.onsuccess = () => {
      for (const entry of readPending.result as SkillsPendingEntry[]) {
        const keep = !!entry.ownerId && entry.ownerId !== discardFor && !isExpired(entry, now);
        if (keep && entry.ownerId) {
          keptOwners.set(entry.testId, entry.ownerId);
          outcome.held += 1;
          if (entry.heldAt === undefined) pending.put({ ...entry, heldAt: now });
        } else {
          outcome.discarded += 1;
          pending.delete(entry.testId);
        }
      }
      const tests = tx.objectStore(STORE_TESTS);
      const readTests = tests.getAll();
      readTests.onsuccess = () => {
        for (const row of readTests.result as CachedRow<unknown>[]) {
          if (keptOwners.get(row.id) !== row.ownerId || !row.ownerId) tests.delete(row.id);
        }
      };
      tx.objectStore(STORE_TEMPLATES).clear();
      tx.objectStore(STORE_CANDIDATES).clear();
    };
  });
}

/**
 * At a sign-in: drop held evaluations past retention, then hand `member`'s
 * held ones back to them — no longer held, so no retention runs while they
 * are signed in and can see them.
 */
export async function releaseHeldSkillsEntries(member: string): Promise<void> {
  const db = await openSkillsDb();
  const now = Date.now();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_PENDING, STORE_TESTS], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    const pending = tx.objectStore(STORE_PENDING);
    const read = pending.getAll();
    read.onsuccess = () => {
      for (const entry of read.result as SkillsPendingEntry[]) {
        if (isExpired(entry, now)) {
          pending.delete(entry.testId);
          tx.objectStore(STORE_TESTS).delete(entry.testId);
        } else if (entry.heldAt !== undefined && entry.ownerId === member) {
          const { heldAt: _heldAt, ...released } = entry;
          void _heldAt;
          pending.put(released);
        }
      }
    };
  });
}
