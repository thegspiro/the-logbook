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
import {
  CHECK_QUEUE_MAX_RETRIES,
  listPendingChecks,
  openCheckDb,
  txStore,
  type QueuedCheck,
} from '../utils/equipmentCheckOfflineStore';
import { STORE_PENDING, STORE_TESTS, allRows, putRow, type SkillsPendingEntry } from '../utils/skillsTestOfflineStore';

// fake-indexeddb's structured clone does not keep a jsdom Blob: it comes back
// as an empty object (see offlineQueue.test.ts). A real browser keeps it, and
// pwa.spec.ts proves that end to end. Here the photos read back from the queue
// are given their Blobs again, by file name, so the upload can be asserted.
const photoBlobs = new Map<string, Blob>();
vi.mock('../utils/equipmentCheckOfflineStore', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/equipmentCheckOfflineStore')>();
  return {
    ...real,
    listPendingChecks: async () =>
      (await real.listPendingChecks()).map((entry) => ({
        ...entry,
        photos: entry.photos.map((photo) => ({ ...photo, blob: photoBlobs.get(photo.fileName) ?? photo.blob })),
      })),
  };
});

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

async function putCheck(check: Partial<QueuedCheck> & { id: string }): Promise<void> {
  const full: QueuedCheck = {
    shiftId: 'shift-1',
    payload: { template_id: 'tpl', check_timing: 'start_of_shift', client_submission_id: check.id, items: [] },
    photos: [],
    queuedAt: 1_000,
    retries: 0,
    ownerId: ME,
    ...check,
  };
  for (const photo of full.photos) photoBlobs.set(photo.fileName, photo.blob);
  const db = await openCheckDb();
  await new Promise<void>((resolve, reject) => {
    const req = txStore(db, 'readwrite').put(full);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('put failed'));
  });
}

const photo = (itemId: string, fileName: string) => ({
  itemId,
  fileName,
  blob: new Blob([fileName], { type: 'image/jpeg' }),
});

async function putSkills(entry: Partial<SkillsPendingEntry> & { testId: string }): Promise<void> {
  const full: SkillsPendingEntry = {
    label: 'Ladder raise — Sam Rivera',
    queuedAt: 1_000,
    updatedAt: 1_000,
    rev: 1,
    complete: false,
    retries: 0,
    ownerId: ME,
    ...entry,
  };
  await putRow(STORE_PENDING, full);
}

const skillTest = (over: Record<string, unknown> = {}) => ({ id: 't1', status: 'in_progress', version: 2, ...over });

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
    photoBlobs.clear();
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
        equipmentChecksSynced: [],
        equipmentChecksDiscarded: [],
        skillsSynced: [],
        skillsFailed: [],
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

  describe('equipment checks', () => {
    it('submits the check, uploads each item’s photos as files, and takes it off the device', async () => {
      await putCheck({ id: 'c1', photos: [photo('tpl-1', 'a.jpg'), photo('tpl-1', 'b.jpg'), photo('tpl-2', 'c.jpg')] });
      const { env, calls, notices } = makeEnv({
        'GET /auth/me': meOk,
        'POST /equipment-checks/shifts/shift-1/checks': () =>
          json(201, {
            id: 'check-1',
            items: [
              { id: 'ci-1', templateItemId: 'tpl-1' },
              { id: 'ci-2', templateItemId: 'tpl-2' },
            ],
          }),
        'POST /equipment-checks/checks/check-1/items/ci-1/photos': () => json(201, { count: 2 }),
        'POST /equipment-checks/checks/check-1/items/ci-2/photos': () => json(201, { count: 1 }),
      });

      await runBackgroundSync(env);

      expect(await listPendingChecks()).toEqual([]);
      const submit = calls.find((c) => c.path === '/equipment-checks/shifts/shift-1/checks');
      expect(JSON.parse(submit?.init.body as string)).toMatchObject({ client_submission_id: 'c1' });
      const upload = calls.find((c) => c.path.endsWith('/items/ci-1/photos'));
      const form = upload?.init.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.getAll('files').map((f) => (f as File).name)).toEqual(['a.jpg', 'b.jpg']);
      // The browser writes a multipart Content-Type with its boundary itself.
      expect((upload?.init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
      expect((upload?.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-123');
      expect(notices[0]?.equipmentChecksSynced).toEqual(['c1']);
    });

    it('sends only the photos still missing from a check the server already accepted', async () => {
      await putCheck({
        id: 'c1',
        submittedCheckId: 'check-1',
        submittedItemIds: { 'tpl-2': 'ci-2' },
        photos: [photo('tpl-2', 'c.jpg')],
      });
      const { env, calls } = makeEnv({
        'GET /auth/me': meOk,
        'POST /equipment-checks/checks/check-1/items/ci-2/photos': () => json(201, { count: 1 }),
      });

      await runBackgroundSync(env);

      expect(calls.map((c) => c.path)).toEqual(['/auth/me', '/equipment-checks/checks/check-1/items/ci-2/photos']);
      expect(await listPendingChecks()).toEqual([]);
    });

    it('keeps the accepted check’s checkpoint when a photo upload fails, and retries later', async () => {
      await putCheck({ id: 'c1', photos: [photo('tpl-1', 'a.jpg')] });
      const { env } = makeEnv({
        'GET /auth/me': meOk,
        'POST /equipment-checks/shifts/shift-1/checks': () =>
          json(201, { id: 'check-1', items: [{ id: 'ci-1', templateItemId: 'tpl-1' }] }),
        'POST /equipment-checks/checks/check-1/items/ci-1/photos': () => json(503),
      });

      await expect(runBackgroundSync(env)).rejects.toBeInstanceOf(BackgroundSyncRetryLater);

      const [left] = await listPendingChecks();
      expect(left?.submittedCheckId).toBe('check-1');
      expect(left?.retries).toBe(0);
    });

    it('discards a check at the page’s cap of permanent refusals', async () => {
      await putCheck({ id: 'c1', retries: CHECK_QUEUE_MAX_RETRIES - 1 });
      const { env, notices } = makeEnv({
        'GET /auth/me': meOk,
        'POST /equipment-checks/shifts/shift-1/checks': () => json(422, { detail: 'Template deleted' }),
      });

      await runBackgroundSync(env);

      expect(await listPendingChecks()).toEqual([]);
      expect(notices[0]?.equipmentChecksDiscarded).toEqual(['c1']);
    });

    it('leaves another member’s check alone', async () => {
      await putCheck({ id: 'c1', ownerId: 'member-2' });
      const { env, calls } = makeEnv({ 'GET /auth/me': meOk });

      await runBackgroundSync(env);

      expect(calls.map((c) => c.path)).toEqual(['/auth/me']);
      expect(await listPendingChecks()).toHaveLength(1);
    });
  });

  describe('skills evaluations', () => {
    it('creates, saves and completes a test begun offline, in that order', async () => {
      await putSkills({
        testId: 't1',
        create: { id: 't1', template_id: 'tpl', candidate_id: 'cand' },
        update: { notes: 'Steady' },
        complete: true,
      });
      const { env, calls, notices } = makeEnv({
        'GET /auth/me': meOk,
        'POST /training/skills-testing/tests': () => json(201, skillTest({ version: 1, status: 'draft' })),
        'PUT /training/skills-testing/tests/t1': () => json(200, skillTest({ version: 2 })),
        'POST /training/skills-testing/tests/t1/complete': () =>
          json(200, skillTest({ version: 3, status: 'completed' })),
      });

      await runBackgroundSync(env);

      expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        'GET /auth/me',
        'POST /training/skills-testing/tests',
        'PUT /training/skills-testing/tests/t1',
        'POST /training/skills-testing/tests/t1/complete',
      ]);
      const save = calls.find((c) => c.method === 'PUT');
      expect(JSON.parse(save?.init.body as string)).toEqual({ notes: 'Steady', expected_version: 1 });
      expect(await allRows(STORE_PENDING)).toEqual([]);
      expect(notices[0]?.skillsSynced).toEqual([
        { testId: 't1', test: skillTest({ version: 3, status: 'completed' }), completed: true },
      ]);
    });

    it('records the version its save produced, for an open screen’s next save', async () => {
      await putSkills({ testId: 't1', update: { notes: 'x' }, baseVersion: 2 });
      const { env } = makeEnv({
        'GET /auth/me': meOk,
        'PUT /training/skills-testing/tests/t1': () => json(200, skillTest({ version: 3 })),
      });

      await runBackgroundSync(env);

      const [cached] = await allRows<{ id: string; drainedVersion?: number }>(STORE_TESTS);
      expect(cached).toMatchObject({ id: 't1', drainedVersion: 3 });
    });

    it('keeps a refused evaluation, marked failed, and names it', async () => {
      await putSkills({ testId: 't1', update: { notes: 'x' }, baseVersion: 2 });
      const { env, notices } = makeEnv({
        'GET /auth/me': meOk,
        'PUT /training/skills-testing/tests/t1': () => json(409, { detail: 'This test was voided' }),
      });

      await runBackgroundSync(env);

      const [kept] = await allRows<SkillsPendingEntry>(STORE_PENDING);
      expect(kept?.failed).toMatchObject({ status: 409, message: 'This test was voided' });
      expect(kept?.update).toEqual({ notes: 'x' });
      expect(notices[0]?.skillsFailed).toEqual([
        { testId: 't1', label: 'Ladder raise — Sam Rivera', message: 'This test was voided' },
      ]);
    });

    it('skips an evaluation already marked failed and another member’s', async () => {
      await putSkills({ testId: 't1', update: { notes: 'x' }, failed: { status: 409, message: 'no', at: 1 } });
      await putSkills({ testId: 't2', update: { notes: 'y' }, ownerId: 'member-2' });
      const { env, calls } = makeEnv({ 'GET /auth/me': meOk });

      await runBackgroundSync(env);

      expect(calls.map((c) => c.path)).toEqual(['/auth/me']);
    });

    it('asks the browser to try again after an outage, keeping the save', async () => {
      await putSkills({ testId: 't1', update: { notes: 'x' }, baseVersion: 2 });
      const { env } = makeEnv({
        'GET /auth/me': meOk,
        'PUT /training/skills-testing/tests/t1': () => json(503),
      });

      await expect(runBackgroundSync(env)).rejects.toBeInstanceOf(BackgroundSyncRetryLater);

      const [kept] = await allRows<SkillsPendingEntry>(STORE_PENDING);
      expect(kept?.update).toEqual({ notes: 'x' });
      expect(kept?.failed).toBeUndefined();
    });

    it('stops at a lost connection without counting it against the evaluation', async () => {
      await putSkills({ testId: 't1', update: { notes: 'x' }, baseVersion: 2 });
      const { env } = makeEnv({
        'GET /auth/me': meOk,
        'PUT /training/skills-testing/tests/t1': () => {
          throw new TypeError('Failed to fetch');
        },
      });

      await expect(runBackgroundSync(env)).rejects.toBeInstanceOf(BackgroundSyncRetryLater);

      const [kept] = await allRows<SkillsPendingEntry>(STORE_PENDING);
      expect(kept?.retries).toBe(0);
    });
  });
});
