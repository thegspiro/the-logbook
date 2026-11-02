import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { BackgroundSyncRetryLater, runBackgroundSync, type BackgroundSyncEnv } from './backgroundSync';
import { BACKGROUND_SYNC_MESSAGE, type BackgroundSyncSummary } from './backgroundSyncProtocol';
import {
  GENERIC_QUEUE_MAX_RETRIES,
  genericStore,
  getGenericItem,
  listGenericPending,
  openGenericDb,
  type GenericQueuedItem,
} from '../utils/genericOfflineStore';
import { listPendingReports, openDB, STORE_REPORTS, type QueuedShiftReport } from '../utils/shiftReportOfflineStore';

const ME = 'member-1';

async function putGeneric(item: Partial<GenericQueuedItem> & { id: string }): Promise<void> {
  const full: GenericQueuedItem = {
    kind: 'training-submission',
    url: '/training/submissions',
    body: { course_name: 'Ladder drill' },
    label: 'Training: Ladder drill',
    queuedAt: 1_000,
    retries: 0,
    ownerId: ME,
    ...item,
  };
  const db = await openGenericDb();
  await new Promise<void>((resolve, reject) => {
    const req = genericStore(db, 'readwrite').put(full);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('put failed'));
  });
}

async function putReport(report: Partial<QueuedShiftReport> & { id: string }): Promise<void> {
  const full: QueuedShiftReport = {
    payload: { shift_date: '2026-10-30', hours_on_shift: 12, calls_responded: 0, crew_member_ids: [] },
    queuedAt: 1_000,
    retries: 0,
    ownerId: ME,
    ...report,
  };
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_REPORTS, 'readwrite');
    tx.objectStore(STORE_REPORTS).put(full);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('put failed'));
  });
}

type Route = (init: RequestInit) => Response | Promise<Response>;

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function makeEnv(routes: Record<string, Route | Route[]>): {
  env: BackgroundSyncEnv;
  calls: Array<{ method: string; path: string; init: RequestInit }>;
  notices: BackgroundSyncSummary[];
  lock: ReturnType<typeof vi.fn>;
} {
  const calls: Array<{ method: string; path: string; init: RequestInit }> = [];
  const notices: BackgroundSyncSummary[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
  const lock = vi.fn(<T>(fn: () => Promise<T>) => fn());
  const env: BackgroundSyncEnv = {
    fetch: async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init.method ?? 'GET').toUpperCase();
      const path = url.replace(/^\/api\/v1/, '');
      calls.push({ method, path, init });
      const route = queues.get(`${method} ${path}`);
      if (!route) throw new Error(`unexpected request ${method} ${path}`);
      const handler = Array.isArray(route) ? (route.length > 1 ? route.shift() : route[0]) : route;
      if (!handler) throw new Error(`no response left for ${method} ${path}`);
      return handler(init);
    },
    csrfToken: () => Promise.resolve('csrf-123'),
    withLock: lock as BackgroundSyncEnv['withLock'],
    notify: (summary) => {
      notices.push(summary);
      return Promise.resolve();
    },
  };
  return { env, calls, notices, lock };
}

const meOk = () => json(200, { id: ME });

describe('runBackgroundSync', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('sends the signed-in member’s items and takes them off the device', async () => {
    await putGeneric({ id: 'g1' });
    await putReport({ id: 'r1' });
    const { env, calls, notices } = makeEnv({
      'GET /auth/me': meOk,
      'POST /training/submissions': () => json(201, { id: 's1' }),
      'POST /training/shift-reports/batch': () => json(201, { created: 1, skipped: 0, report_ids: [] }),
    });

    await runBackgroundSync(env);

    expect(await listGenericPending()).toEqual([]);
    expect(await listPendingReports()).toEqual([]);
    const post = calls.find((c) => c.path === '/training/submissions');
    expect(post?.init.body).toBe(JSON.stringify({ course_name: 'Ladder drill' }));
    expect(post?.init.credentials).toBe('include');
    expect((post?.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-123');
    expect(notices).toEqual([
      {
        type: BACKGROUND_SYNC_MESSAGE,
        genericSynced: 1,
        genericDiscarded: 0,
        shiftReportsSynced: 1,
        shiftReportsRefused: [],
      },
    ]);
  });

  it('holds the drain lock the page drains take, for the whole sync', async () => {
    const { env, lock } = makeEnv({ 'GET /auth/me': meOk });

    await runBackgroundSync(env);

    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('leaves another member’s items, held items, and unowned items alone', async () => {
    // The server, not the page's auth store, says who this session is.
    await putGeneric({ id: 'theirs', ownerId: 'member-2' });
    await putGeneric({ id: 'unowned', ownerId: undefined });
    await putGeneric({ id: 'held', held: true, updatedAt: Date.now() });
    await putReport({ id: 'their-report', ownerId: 'member-2' });
    const { env, calls } = makeEnv({ 'GET /auth/me': meOk });

    await runBackgroundSync(env);

    expect(calls.map((c) => c.path)).toEqual(['/auth/me']);
    expect((await listGenericPending()).map((i) => i.id).sort()).toEqual(['held', 'theirs', 'unowned']);
    expect(await listPendingReports()).toHaveLength(1);
  });

  it('refreshes an expired access token once and carries on', async () => {
    await putGeneric({ id: 'g1' });
    const { env, calls } = makeEnv({
      'GET /auth/me': [() => json(401), meOk],
      'POST /auth/refresh': () => json(200, {}),
      'POST /training/submissions': () => json(201),
    });

    await runBackgroundSync(env);

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /auth/me',
      'POST /auth/refresh',
      'GET /auth/me',
      'POST /training/submissions',
    ]);
    expect(await getGenericItem('g1')).toBeNull();
  });

  it('treats a refresh another context won as success, not as signed out', async () => {
    // AUTH-21: two refreshes at once — the page and the worker — and the loser
    // gets 409 LB-AUTH-012. The shared cookie jar already holds the winner's
    // tokens, so retrying is right; treating it as a failure would stop here.
    await putGeneric({ id: 'g1' });
    const { env } = makeEnv({
      'GET /auth/me': [() => json(401), meOk],
      'POST /auth/refresh': () => json(409, { code: 'LB-AUTH-012' }),
      'POST /training/submissions': () => json(201),
    });

    await runBackgroundSync(env);

    expect(await getGenericItem('g1')).toBeNull();
  });

  it('sends nothing, and asks for no retry, when the session cannot be renewed', async () => {
    await putGeneric({ id: 'g1' });
    const { env, calls, notices } = makeEnv({
      'GET /auth/me': () => json(401),
      'POST /auth/refresh': () => json(401),
    });

    await expect(runBackgroundSync(env)).resolves.toBeUndefined();

    expect(calls.map((c) => c.path)).toEqual(['/auth/me', '/auth/refresh']);
    expect(await getGenericItem('g1')).not.toBeNull();
    expect(notices).toEqual([]);
  });

  it('keeps an item through an outage and asks the browser to try again later', async () => {
    await putGeneric({ id: 'g1' });
    const { env, notices } = makeEnv({
      'GET /auth/me': meOk,
      'POST /training/submissions': () => json(503),
    });

    await expect(runBackgroundSync(env)).rejects.toBeInstanceOf(BackgroundSyncRetryLater);

    expect((await getGenericItem('g1'))?.retries).toBe(0);
    expect(notices).toHaveLength(1);
  });

  it('stops at a lost connection, leaving everything for the next attempt', async () => {
    await putGeneric({ id: 'g1', queuedAt: 1 });
    await putGeneric({ id: 'g2', queuedAt: 2 });
    const { env, calls } = makeEnv({
      'GET /auth/me': meOk,
      'POST /training/submissions': () => {
        throw new TypeError('Failed to fetch');
      },
    });

    await expect(runBackgroundSync(env)).rejects.toBeInstanceOf(BackgroundSyncRetryLater);

    expect(calls.filter((c) => c.path === '/training/submissions')).toHaveLength(1);
    expect(await listGenericPending()).toHaveLength(2);
  });

  it('counts a refusal as a strike and discards at the same cap as the page', async () => {
    await putGeneric({ id: 'g1', retries: GENERIC_QUEUE_MAX_RETRIES - 2 });
    const { env, notices } = makeEnv({
      'GET /auth/me': meOk,
      'POST /training/submissions': () => json(422, { detail: 'bad' }),
    });

    await runBackgroundSync(env);
    expect((await getGenericItem('g1'))?.retries).toBe(GENERIC_QUEUE_MAX_RETRIES - 1);

    await runBackgroundSync(env);
    expect(await getGenericItem('g1')).toBeNull();
    expect(notices[1]?.genericDiscarded).toBe(1);
  });

  it('never discards a refused shift report, and names it from the third refusal', async () => {
    await putReport({
      id: 'r1',
      retries: 1,
      payload: { shift_date: '2026-12-01', hours_on_shift: 12, calls_responded: 0, crew_member_ids: [] },
    });
    const { env, notices } = makeEnv({
      'GET /auth/me': meOk,
      'POST /training/shift-reports/batch': () => json(422, { detail: 'Shift date is in the future' }),
    });

    await runBackgroundSync(env);
    await runBackgroundSync(env);

    expect(notices[0]?.shiftReportsRefused).toEqual([]);
    expect(notices[1]?.shiftReportsRefused).toEqual([
      { shiftDate: '2026-12-01', message: 'Shift date is in the future' },
    ]);
    const [report] = await listPendingReports();
    expect(report?.retries).toBe(3);
    expect(report?.lastError).toBe('Shift date is in the future');
  });

  it('reads a validation error list the way the page does', async () => {
    await putReport({ id: 'r1', retries: 2 });
    const { env, notices } = makeEnv({
      'GET /auth/me': meOk,
      'POST /training/shift-reports/batch': () =>
        json(422, { detail: [{ loc: ['body', 'hours_on_shift'], msg: 'Input should be greater than 0' }] }),
    });

    await runBackgroundSync(env);

    expect(notices[0]?.shiftReportsRefused[0]?.message).toBe('Input should be greater than 0');
  });

  it('reports nothing when there was nothing to send', async () => {
    const { env, notices } = makeEnv({ 'GET /auth/me': meOk });

    await runBackgroundSync(env);

    expect(notices).toEqual([]);
  });
});
