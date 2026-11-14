import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

const mockBatchCreate = vi.fn();
vi.mock('../services/api', () => ({
  shiftCompletionService: {
    batchCreateReports: (...a: unknown[]) => mockBatchCreate(...a) as unknown,
  },
}));

// Every entry is stamped with the signed-in member (FE3-34-5).
vi.mock('../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ isAuthenticated: true, user: { id: 'member-1' } }) },
}));

import { enqueueShiftReport, listPendingReports } from './shiftReportOfflineQueue';
import { SHIFT_REPORT_REFUSALS_BEFORE_NOTICE, drainShiftReports } from './shiftReportSync';
import type { BatchShiftReportCreate } from '@/types/training';
import { OFFLINE_DRAIN_LOCK } from '../sw/backgroundSyncProtocol';

const payload = (shift_date: string): BatchShiftReportCreate => ({
  shift_date,
  hours_on_shift: 12,
  calls_responded: 0,
  crew_member_ids: ['member-2'],
});

const httpError = (status: number, detail?: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    request: {},
    response: { status, data: detail ? { detail } : {} },
  });

describe('drainShiftReports', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    mockBatchCreate.mockReset();
  });

  it('sends a queued report and takes it off the device', async () => {
    mockBatchCreate.mockResolvedValue({ created: 1, skipped: 0, report_ids: ['r1'] });
    await enqueueShiftReport(payload('2026-10-30'));

    const result = await drainShiftReports();

    expect(result).toEqual({ synced: 1, refused: [] });
    expect(mockBatchCreate).toHaveBeenCalledWith(payload('2026-10-30'));
    expect(await listPendingReports()).toEqual([]);
  });

  it('leaves a report alone through an outage, without counting it as refused', async () => {
    mockBatchCreate.mockRejectedValue(httpError(503));
    await enqueueShiftReport(payload('2026-10-30'));

    for (let n = 0; n < SHIFT_REPORT_REFUSALS_BEFORE_NOTICE + 2; n += 1) {
      expect(await drainShiftReports()).toEqual({ synced: 0, refused: [] });
    }

    const [entry] = await listPendingReports();
    expect(entry?.retries).toBe(0);
  });

  it('names a report the server keeps refusing, with its reason, and keeps it', async () => {
    // Retried in silence forever, the officer never learned why the report
    // was not going anywhere. It is never discarded: it is the only copy.
    mockBatchCreate.mockRejectedValue(httpError(422, 'Shift date is in the future'));
    await enqueueShiftReport(payload('2026-12-01'));

    for (let n = 1; n < SHIFT_REPORT_REFUSALS_BEFORE_NOTICE; n += 1) {
      expect(await drainShiftReports()).toEqual({ synced: 0, refused: [] });
    }
    const result = await drainShiftReports();

    expect(result.refused).toEqual([
      { id: expect.any(String) as string, shiftDate: '2026-12-01', message: 'Shift date is in the future' },
    ]);
    const [entry] = await listPendingReports();
    expect(entry?.retries).toBe(SHIFT_REPORT_REFUSALS_BEFORE_NOTICE);
    expect(entry?.lastError).toBe('Shift date is in the future');
  });

  it('sends the rest when one report is refused', async () => {
    mockBatchCreate.mockImplementation((p: BatchShiftReportCreate) =>
      p.shift_date === '2026-12-01'
        ? Promise.reject(httpError(422, 'bad'))
        : Promise.resolve({ created: 1, skipped: 0, report_ids: [] })
    );
    await enqueueShiftReport(payload('2026-12-01'));
    await enqueueShiftReport(payload('2026-10-30'));

    const result = await drainShiftReports();

    expect(result.synced).toBe(1);
    expect((await listPendingReports()).map((e) => e.payload.shift_date)).toEqual(['2026-12-01']);
  });

  it('shares one drain between overlapping calls, so nothing is sent twice', async () => {
    let finish: () => void = () => {};
    mockBatchCreate.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ created: 1, skipped: 0, report_ids: [] });
      })
    );
    await enqueueShiftReport(payload('2026-10-30'));

    const first = drainShiftReports();
    const second = drainShiftReports();
    await new Promise((r) => setTimeout(r, 0));
    finish();

    expect(await first).toBe(await second);
    expect(mockBatchCreate).toHaveBeenCalledTimes(1);
  });

  it('drains under the lock the service worker takes for background sync', async () => {
    // Without it, a reconnect could have the page and the worker post the
    // same report at once.
    const request = vi.fn(<T>(_name: string, fn: () => Promise<T>) => fn());
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
    mockBatchCreate.mockResolvedValue({ created: 1, skipped: 0, report_ids: [] });
    await enqueueShiftReport(payload('2026-10-30'));

    try {
      await drainShiftReports();
    } finally {
      Reflect.deleteProperty(navigator, 'locks');
    }

    expect(request).toHaveBeenCalledWith(OFFLINE_DRAIN_LOCK, expect.any(Function));
    expect(mockBatchCreate).toHaveBeenCalledTimes(1);
  });
});
