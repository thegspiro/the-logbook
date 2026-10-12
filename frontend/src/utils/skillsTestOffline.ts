/**
 * Offline skills testing: a queue for scorecard writes, and a local copy of
 * what an examiner needs to keep scoring without signal.
 *
 * Scoped in docs/SKILLS_TESTING_OFFLINE_PLAN.md. Why this is not the generic
 * queue (`genericOfflineQueue.ts`):
 *
 * - **Coalescing.** Autosave writes every 30s. One entry per test, merged on
 *   every write, so an hour offline is one PUT on reconnect, not 120 stale ones.
 * - **Ordered completion.** `POST /complete` scores whatever the server holds,
 *   so it must land after the final save; and a test started with no signal
 *   must be created before either. Each entry carries its steps — create, save,
 *   complete — and the drain runs them in that order, stopping at the first
 *   that cannot go yet.
 * - **Nothing is discarded.** A step the server refuses (the test was
 *   completed or voided elsewhere, the attempt cap was reached) marks the entry
 *   failed and keeps its payload. A generic item is dropped after five
 *   refusals; a scored evaluation never is — only the examiner can discard it.
 *
 * Ownership follows FE3-34-5: every entry and cached copy is stamped with the
 * member who wrote it, the drain sends only the signed-in member's own, and a
 * cached copy is served only to its owner. Sign-in and logout purge the whole
 * store through `purgeLocalMemberData`; logout first asks (see AppLayout).
 */

import type { AxiosInstance } from 'axios';
import { openIndexedDb } from './offlineDb';
import { isNetworkError, toAppError, getErrorMessage } from './errorHandling';
import {
  currentQueueOwner,
  isOwnedByCurrentMember,
  requireQueueOwner,
  type OwnedQueueEntry,
} from './offlineQueueOwner';
import type { SkillTemplate, SkillTest, SkillTestCreate, SkillTestUpdate } from '../types/skillsTesting';

const DB_NAME = 'logbook-offline-skills';
const DB_VERSION = 1;
const STORE_PENDING = 'pending';
const STORE_TESTS = 'tests';
const STORE_TEMPLATES = 'templates';
const STORE_CANDIDATES = 'candidates';
const ALL_STORES = [STORE_PENDING, STORE_TESTS, STORE_TEMPLATES, STORE_CANDIDATES] as const;

/** 5xx answers tolerated before an entry is marked failed (kept, not dropped). */
export const SKILLS_QUEUE_MAX_RETRIES = 5;
/** Recent candidates kept for an examiner who starts a test with no signal. */
const MAX_RECENT_CANDIDATES = 50;

const BASE = '/training/skills-testing';

/** Dispatched on window when work is queued, so the sync engine can try it. */
export const SKILLS_OFFLINE_QUEUED_EVENT = 'skills-offline-queued';

/**
 * A v4 UUID for a new test. The client mints it (owner decision, cold start)
 * so a test begun with no signal has an identity before the server sees it;
 * the server accepts it once, idempotently, for the same examiner.
 */
export function mintTestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The test as the examiner screen needs it, built on the device from a cached
 * published template. Only what scoring reads is filled; the server builds the
 * real record — its own template snapshot, policy and timestamps — when the
 * queued create lands, and refuses it if the sheet has changed meanwhile.
 */
export function buildOfflineSkillTest(
  template: SkillTemplate,
  create: OfflineSkillTestCreate,
  people: { examinerId: string; examinerName: string; candidateName: string }
): SkillTest {
  const now = new Date().toISOString();
  return {
    id: create.id,
    organization_id: template.organization_id,
    template_id: template.id,
    template_name: template.name,
    candidate_id: create.candidate_id,
    candidate_name: people.candidateName,
    examiner_id: people.examinerId,
    examiner_name: people.examinerName,
    status: 'draft',
    result: 'incomplete',
    is_practice: create.is_practice ?? false,
    version: 1,
    section_results: [],
    notes: create.notes,
    created_at: now,
    updated_at: now,
    template_sections: template.sections,
    template_time_limit_seconds: template.time_limit_seconds,
    template_require_all_critical: template.require_all_critical,
    template_score_pass_fail_criteria: template.score_pass_fail_criteria,
  };
}

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

interface CachedRow<T> extends OwnedQueueEntry {
  id: string;
  value: T;
  cachedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return openIndexedDb(DB_NAME, DB_VERSION, (db) => {
    for (const store of ALL_STORES) {
      if (!db.objectStoreNames.contains(store)) {
        db.createObjectStore(store, { keyPath: store === STORE_PENDING ? 'testId' : 'id' });
      }
    }
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

async function getRow<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return (await request(db.transaction(store, 'readonly').objectStore(store).get(key))) as T | undefined;
}

async function allRows<T>(store: string): Promise<T[]> {
  const db = await openDB();
  return (await request(db.transaction(store, 'readonly').objectStore(store).getAll())) as T[];
}

async function putRow(store: string, row: unknown): Promise<void> {
  const db = await openDB();
  await request(db.transaction(store, 'readwrite').objectStore(store).put(row));
}

async function deleteRow(store: string, key: string): Promise<void> {
  const db = await openDB();
  await request(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

/**
 * Read-modify-write one pending entry inside a single transaction.
 *
 * `change` receives the stored entry (or undefined) and returns the entry to
 * store, `null` to delete it, or `undefined` to leave it untouched. An entry
 * belonging to someone else is never handed to `change` — it is refused.
 */
async function mutatePending(
  testId: string,
  change: (existing: SkillsPendingEntry | undefined) => SkillsPendingEntry | null | undefined
): Promise<SkillsPendingEntry | null> {
  const owner = requireQueueOwner();
  const db = await openDB();
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

function fresh(testId: string, label: string): SkillsPendingEntry {
  const now = Date.now();
  return { testId, label, queuedAt: now, updatedAt: now, rev: 0, complete: false, retries: 0 };
}

/** Fields a later save replaces outright; `resumed` is a one-shot flag and
 *  must survive coalescing until it has been sent once. */
export function mergeUpdates(older: SkillTestUpdate | undefined, newer: SkillTestUpdate): SkillTestUpdate {
  const { expected_version: _ignored, ...rest } = newer;
  void _ignored;
  const merged: SkillTestUpdate = { ...(older ?? {}), ...rest };
  if (older?.resumed || newer.resumed) merged.resumed = true;
  return merged;
}

// ---------------------------------------------------------------- queue

/** Queue a save for a test, merged into whatever is already waiting. */
export async function enqueueSkillsUpdate(
  test: { id: string; label: string; version?: number | undefined },
  update: SkillTestUpdate
): Promise<SkillsPendingEntry | null> {
  return mutatePending(test.id, (existing) => {
    const entry = existing ?? fresh(test.id, test.label);
    return {
      ...entry,
      label: test.label || entry.label,
      update: mergeUpdates(entry.update, update),
      // The version the first unsent save was made against. Later saves pile
      // onto the same entry, so they share it.
      baseVersion: entry.baseVersion ?? update.expected_version ?? test.version,
      rev: entry.rev + 1,
      updatedAt: Date.now(),
      failed: undefined,
      retries: 0,
    };
  });
}

/** Queue the creation of a test started with no signal. */
export async function enqueueSkillsCreate(create: OfflineSkillTestCreate, label: string): Promise<void> {
  await mutatePending(create.id, (existing) => ({
    ...(existing ?? fresh(create.id, label)),
    create,
    baseVersion: 1,
    rev: (existing?.rev ?? 0) + 1,
    updatedAt: Date.now(),
  }));
}

/** Queue completion — it runs only after the entry's last save has landed. */
export async function enqueueSkillsComplete(test: { id: string; label: string }): Promise<void> {
  await mutatePending(test.id, (existing) => ({
    ...(existing ?? fresh(test.id, test.label)),
    complete: true,
    rev: (existing?.rev ?? 0) + 1,
    updatedAt: Date.now(),
    failed: undefined,
    retries: 0,
  }));
}

/** The signed-in member's entry for a test, if any. */
export async function getOwnSkillsPending(testId: string): Promise<SkillsPendingEntry | null> {
  try {
    const entry = await getRow<SkillsPendingEntry>(STORE_PENDING, testId);
    return entry && isOwnedByCurrentMember(entry) ? entry : null;
  } catch {
    return null;
  }
}

/** The signed-in member's entries, oldest first — failed ones included. */
export async function listOwnSkillsPending(): Promise<SkillsPendingEntry[]> {
  return (await allRows<SkillsPendingEntry>(STORE_PENDING))
    .filter((e) => isOwnedByCurrentMember(e))
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

/** Scored evaluations of the signed-in member's that have not reached the server. */
export async function skillsPendingCount(): Promise<number> {
  return (await listOwnSkillsPending()).length;
}

/** Throw away one of the member's own entries — the examiner's call only. */
export async function discardSkillsPending(testId: string): Promise<void> {
  await mutatePending(testId, (existing) => (existing ? null : undefined));
  await deleteRow(STORE_TESTS, testId).catch(() => undefined);
}

/** Lay a queued save over a server or cached copy of the test. */
export function applyPending(test: SkillTest, entry: SkillsPendingEntry | null): SkillTest {
  if (!entry?.update) return test;
  const { resumed: _resumed, expected_version: _version, ...fields } = entry.update;
  void _resumed;
  void _version;
  return {
    ...test,
    ...(fields as Partial<SkillTest>),
    version: entry.baseVersion ?? test.version,
  };
}

// ---------------------------------------------------------------- drain

export interface SkillsDrainResult {
  synced: { testId: string; test: SkillTest | null; completed: boolean }[];
  failed: { testId: string; label: string; message: string }[];
}

let inFlight: Promise<SkillsDrainResult> | null = null;

/**
 * Send the signed-in member's entries, each one's steps in order.
 *
 * Concurrent calls share one drain. A connection drop stops the entry where it
 * is; a refusal marks it failed and moves on to the next entry.
 */
export function drainSkillsQueue(axios: AxiosInstance): Promise<SkillsDrainResult> {
  if (inFlight) return inFlight;
  inFlight = runDrain(axios).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runDrain(axios: AxiosInstance): Promise<SkillsDrainResult> {
  const result: SkillsDrainResult = { synced: [], failed: [] };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return result;
  let entries: SkillsPendingEntry[];
  try {
    entries = (await listOwnSkillsPending()).filter((e) => !e.failed);
  } catch {
    return result;
  }
  for (const entry of entries) {
    const outcome = await flushEntry(entry, axios);
    if (outcome.kind === 'synced') {
      result.synced.push({ testId: entry.testId, test: outcome.test, completed: outcome.completed });
    } else if (outcome.kind === 'failed') {
      result.failed.push({ testId: entry.testId, label: entry.label, message: outcome.message });
    } else if (outcome.kind === 'offline') {
      break;
    }
  }
  return result;
}

type FlushOutcome =
  | { kind: 'synced'; test: SkillTest | null; completed: boolean }
  | { kind: 'failed'; message: string }
  | { kind: 'offline' }
  | { kind: 'retry' };

async function markFailedOrRetry(entry: SkillsPendingEntry, err: unknown): Promise<FlushOutcome> {
  const appError = toAppError(err);
  const status = appError.status ?? null;
  const message = getErrorMessage(err, 'The server refused this evaluation');
  const permanent = status !== null && status >= 400 && status < 500;
  let failedNow = permanent;
  await mutatePending(entry.testId, (existing) => {
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

async function flushEntry(start: SkillsPendingEntry, axios: AxiosInstance): Promise<FlushOutcome> {
  let entry: SkillsPendingEntry | null = start;
  let latest: SkillTest | null = null;

  // The member can change between listing and sending, and the request goes
  // out with whoever's cookies are live (FE3-34-5).
  if (!isOwnedByCurrentMember(entry)) return { kind: 'retry' };

  // 1. Create — a test started with no signal does not exist server-side yet.
  if (entry.create) {
    const create = entry.create;
    try {
      latest = (await axios.post<SkillTest>(`${BASE}/tests`, create)).data;
    } catch (err) {
      if (isNetworkError(err)) return { kind: 'offline' };
      return markFailedOrRetry(entry, err);
    }
    const createdVersion = latest.version;
    entry = await mutatePending(entry.testId, (existing) =>
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
      latest = (await axios.put<SkillTest>(`${BASE}/tests/${entry.testId}`, body)).data;
    } catch (err) {
      if (isNetworkError(err)) return { kind: 'offline' };
      return markFailedOrRetry(entry, err);
    }
    const savedVersion = latest.version;
    entry = await mutatePending(entry.testId, (existing) => {
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
      latest = (await axios.post<SkillTest>(`${BASE}/tests/${entry.testId}/complete`)).data;
    } catch (err) {
      if (isNetworkError(err)) return { kind: 'offline' };
      // A completion whose response was lost on an earlier try has already
      // landed; asking is cheaper than reporting a failure that is not one.
      try {
        const current = (await axios.get<SkillTest>(`${BASE}/tests/${entry.testId}`)).data;
        if (current.status === 'completed') latest = current;
      } catch {
        // Fall through to the refusal below.
      }
      if (latest?.status !== 'completed') return markFailedOrRetry(entry, err);
    }
    await mutatePending(entry.testId, () => null);
    await deleteRow(STORE_TESTS, entry.testId).catch(() => undefined);
    return { kind: 'synced', test: latest, completed: true };
  }

  // Nothing left: the entry has done its job.
  await mutatePending(entry.testId, (existing) =>
    existing && !existing.update && !existing.create ? null : undefined
  );
  return { kind: 'synced', test: latest, completed: false };
}

// ---------------------------------------------------------------- read cache

async function putOwned<T>(store: string, id: string, value: T): Promise<void> {
  const owner = currentQueueOwner();
  if (!owner) return;
  await putRow(store, { id, ownerId: owner, value, cachedAt: Date.now() } satisfies CachedRow<T>);
}

async function getOwned<T>(store: string, id: string): Promise<T | null> {
  try {
    const row = await getRow<CachedRow<T>>(store, id);
    return row && isOwnedByCurrentMember(row) ? row.value : null;
  } catch {
    return null;
  }
}

async function listOwned<T>(store: string): Promise<CachedRow<T>[]> {
  try {
    return (await allRows<CachedRow<T>>(store)).filter((row) => isOwnedByCurrentMember(row));
  } catch {
    return [];
  }
}

/**
 * Keep a copy of a live test the member is examining, so a signal drop does
 * not leave them with nothing to score into. Only live tests: a finished one
 * is not field-critical and is not worth holding on a shared device.
 */
export async function cacheSkillTest(test: SkillTest): Promise<void> {
  try {
    if (test.status === 'draft' || test.status === 'in_progress') {
      await putOwned(STORE_TESTS, test.id, test);
    } else {
      await deleteRow(STORE_TESTS, test.id);
    }
  } catch {
    // Best effort: the online path does not depend on it.
  }
}

export async function getCachedSkillTest(testId: string): Promise<SkillTest | null> {
  return getOwned<SkillTest>(STORE_TESTS, testId);
}

/** Published templates, for starting a test with no signal. */
export async function cacheSkillTemplates(templates: SkillTemplate[]): Promise<void> {
  try {
    for (const template of templates) await putOwned(STORE_TEMPLATES, template.id, template);
  } catch {
    // Best effort.
  }
}

export async function listCachedSkillTemplates(): Promise<SkillTemplate[]> {
  return (await listOwned<SkillTemplate>(STORE_TEMPLATES)).map((row) => row.value);
}

export async function getCachedSkillTemplate(templateId: string): Promise<SkillTemplate | null> {
  return getOwned<SkillTemplate>(STORE_TEMPLATES, templateId);
}

/** Remember someone the member examined, so they can be picked offline. */
export async function rememberCandidate(candidate: { id: string; name: string }): Promise<void> {
  try {
    await putOwned(STORE_CANDIDATES, candidate.id, candidate);
    const rows = await listOwned<{ id: string; name: string }>(STORE_CANDIDATES);
    const stale = rows.sort((a, b) => b.cachedAt - a.cachedAt).slice(MAX_RECENT_CANDIDATES);
    for (const row of stale) await deleteRow(STORE_CANDIDATES, row.id);
  } catch {
    // Best effort.
  }
}

export async function listRecentCandidates(): Promise<{ id: string; name: string }[]> {
  return (await listOwned<{ id: string; name: string }>(STORE_CANDIDATES))
    .sort((a, b) => b.cachedAt - a.cachedAt)
    .map((row) => row.value);
}

// ---------------------------------------------------------------- purge

/**
 * Empty every store (FE-6/FE-7). Returns how many unsent evaluations were in
 * the queue, whoever they belonged to.
 */
export async function clearAllSkillsOffline(): Promise<number> {
  const db = await openDB();
  const count = await request(db.transaction(STORE_PENDING, 'readonly').objectStore(STORE_PENDING).count()).catch(
    () => 0
  );
  for (const store of ALL_STORES) {
    await request(db.transaction(store, 'readwrite').objectStore(store).clear()).catch(() => undefined);
  }
  return count;
}
