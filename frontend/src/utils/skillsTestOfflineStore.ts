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
