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
import { isNetworkError, toAppError, getErrorMessage } from './errorHandling';
import { currentQueueOwner, isOwnedByCurrentMember, requireQueueOwner } from './offlineQueueOwner';
import type { SkillTemplate, SkillTest, SkillTestUpdate } from '../types/skillsTesting';
import { flushSkillsEntry, type SkillsTransport } from './skillsTestFlush';
import {
  ALL_STORES,
  SKILLS_QUEUE_MAX_RETRIES,
  STORE_CANDIDATES,
  STORE_PENDING,
  STORE_TEMPLATES,
  STORE_TESTS,
  allRows,
  deleteRow,
  getRow,
  mutatePendingAs,
  openSkillsDb,
  putRow,
  request,
  type CachedRow,
  type OfflineSkillTestCreate,
  type SkillsPendingEntry,
} from './skillsTestOfflineStore';

export { SKILLS_QUEUE_MAX_RETRIES };
export type { OfflineSkillTestCreate, SkillsPendingEntry } from './skillsTestOfflineStore';

/** Recent candidates kept for an examiner who starts a test with no signal. */
const MAX_RECENT_CANDIDATES = 50;

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

/**
 * Read-modify-write one of the signed-in member's pending entries; see
 * mutatePendingAs. Refuses when nobody is signed in.
 */
function mutatePending(
  testId: string,
  change: (existing: SkillsPendingEntry | undefined) => SkillsPendingEntry | null | undefined
): Promise<SkillsPendingEntry | null> {
  return mutatePendingAs(requireQueueOwner(), testId, change);
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
  const transport = axiosTransport(axios);
  const result: SkillsDrainResult = { synced: [], failed: [] };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return result;
  let entries: SkillsPendingEntry[];
  try {
    entries = (await listOwnSkillsPending()).filter((e) => !e.failed);
  } catch {
    return result;
  }
  for (const entry of entries) {
    const outcome = await flushSkillsEntry(entry, {
      transport,
      owner: requireQueueOwner,
      maySend: (e) => isOwnedByCurrentMember(e),
    });
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

/** The page's transport: the app's axios client, its error helpers. */
function axiosTransport(axios: AxiosInstance): SkillsTransport {
  return {
    post: async (path, body) =>
      (await (body === undefined ? axios.post<SkillTest>(path) : axios.post<SkillTest>(path, body))).data,
    put: async (path, body) => (await axios.put<SkillTest>(path, body)).data,
    get: async (path) => (await axios.get<SkillTest>(path)).data,
    isNetworkError,
    statusOf: (err) => toAppError(err).status ?? null,
    messageOf: (err, fallback) => getErrorMessage(err, fallback),
  };
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
  const db = await openSkillsDb();
  const count = await request(db.transaction(STORE_PENDING, 'readonly').objectStore(STORE_PENDING).count()).catch(
    () => 0
  );
  for (const store of ALL_STORES) {
    await request(db.transaction(store, 'readwrite').objectStore(store).clear()).catch(() => undefined);
  }
  return count;
}
