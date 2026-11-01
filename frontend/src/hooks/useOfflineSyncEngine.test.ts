import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockDrainShiftReports = vi.fn();
const mockDrainSkillsQueue = vi.fn();
const mockEquipmentPending = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockToast = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: Object.assign((...a: unknown[]) => mockToast(...a) as unknown, {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
  }),
}));
vi.mock('../services/apiClient', () => ({ default: {} }));
vi.mock('../utils/genericOfflineQueue', () => ({
  flushOne: vi.fn(),
  getGenericItem: vi.fn(),
  isGenericSendable: () => true,
  listOwnGenericPending: () => Promise.resolve([]),
}));
vi.mock('../modules/inventory/utils/nfcOfflineSync', () => ({ describeNfcSync: vi.fn() }));
vi.mock('../utils/shiftReportSync', () => ({
  SHIFT_REPORTS_SYNCED_EVENT: 'logbook:shift-reports-synced',
  drainShiftReports: () => mockDrainShiftReports() as unknown,
}));
vi.mock('../utils/skillsTestOffline', () => ({
  SKILLS_OFFLINE_QUEUED_EVENT: 'skills-queued',
  drainSkillsQueue: () => mockDrainSkillsQueue() as unknown,
}));
vi.mock('../utils/offlineQueue', () => ({
  pendingCount: () => mockEquipmentPending() as unknown,
}));
vi.mock('../stores/pendingSyncStore', () => ({
  usePendingSyncStore: Object.assign(
    (select: (s: { refresh: () => Promise<void> }) => unknown) => select({ refresh: () => Promise.resolve() }),
    { getState: () => ({ refresh: () => Promise.resolve(), setStatus: vi.fn() }) }
  ),
}));
vi.mock('../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: { getState: () => ({ handleSynced: vi.fn() }) },
}));

import { triggerAllOfflineDrains, triggerOfflineDrain, useOfflineSyncEngine } from './useOfflineSyncEngine';
import { BACKGROUND_SYNC_MESSAGE, OFFLINE_DRAIN_LOCK } from '../sw/backgroundSyncProtocol';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('useOfflineSyncEngine', () => {
  beforeEach(() => {
    mockDrainShiftReports.mockReset();
    mockDrainShiftReports.mockResolvedValue({ synced: 0, refused: [] });
    mockDrainSkillsQueue.mockReset();
    mockDrainSkillsQueue.mockResolvedValue({ synced: [], failed: [] });
    mockEquipmentPending.mockReset();
    mockEquipmentPending.mockResolvedValue(0);
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockToast.mockReset();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('sends queued shift reports when the app loads online', async () => {
    // They used to wait for the officer to reopen Shift Reports.
    renderHook(() => useOfflineSyncEngine());
    await flush();

    expect(mockDrainShiftReports).toHaveBeenCalledTimes(1);
  });

  it('sends queued shift reports when the device reconnects', async () => {
    renderHook(() => useOfflineSyncEngine());
    await flush();
    mockDrainShiftReports.mockClear();

    window.dispatchEvent(new Event('online'));
    await flush();

    expect(mockDrainShiftReports).toHaveBeenCalledTimes(1);
  });

  it('retries every queue the pending pill counts, not only the generic one', async () => {
    await triggerAllOfflineDrains();

    expect(mockDrainShiftReports).toHaveBeenCalledTimes(1);
    expect(mockDrainSkillsQueue).toHaveBeenCalledTimes(1);
  });

  it('names a report the server keeps refusing, and says it is still saved', async () => {
    mockDrainShiftReports.mockResolvedValue({
      synced: 0,
      refused: [{ id: 'sr-1', shiftDate: '2026-12-01', message: 'Shift date is in the future' }],
    });

    await triggerAllOfflineDrains();

    expect(mockToastError).toHaveBeenCalledWith(
      'Shift report for 2026-12-01 was not accepted: Shift date is in the future It is still saved on this device.',
      { duration: 10_000 }
    );
  });

  it('says where equipment checks that only their own screen can send are waiting', async () => {
    mockEquipmentPending.mockResolvedValue(2);

    await triggerAllOfflineDrains();

    expect(mockToast).toHaveBeenCalledWith(
      '2 equipment checks are saved on this device. Open the equipment check to send them.'
    );
  });

  it('says nothing about equipment checks when none are waiting', async () => {
    await triggerAllOfflineDrains();

    expect(mockToast).not.toHaveBeenCalled();
  });

  it('drains the generic queue under the lock the service worker takes', async () => {
    const request = vi.fn(<T>(_name: string, fn: () => Promise<T>) => fn());
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });

    try {
      await triggerOfflineDrain();
    } finally {
      Reflect.deleteProperty(navigator, 'locks');
    }

    expect(request).toHaveBeenCalledWith(OFFLINE_DRAIN_LOCK, expect.any(Function));
  });

  describe('when the service worker reports a background sync', () => {
    function installWorkerMessages(): EventTarget {
      const container = new EventTarget();
      Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
      return container;
    }

    function post(container: EventTarget, data: unknown): void {
      container.dispatchEvent(new MessageEvent('message', { data }));
    }

    it('says what it sent, names refused reports, and tells Shift Reports to refresh', async () => {
      const container = installWorkerMessages();
      const synced = vi.fn();
      window.addEventListener('logbook:shift-reports-synced', synced);
      try {
        renderHook(() => useOfflineSyncEngine());
        await flush();
        mockToastSuccess.mockClear();

        post(container, {
          type: BACKGROUND_SYNC_MESSAGE,
          genericSynced: 2,
          genericDiscarded: 0,
          shiftReportsSynced: 1,
          shiftReportsRefused: [{ shiftDate: '2026-12-01', message: 'Shift date is in the future' }],
        });
        await flush();

        expect(mockToastSuccess).toHaveBeenCalledWith('Sent 3 items saved on this device while you were offline');
        expect(mockToastError).toHaveBeenCalledWith(
          'Shift report for 2026-12-01 was not accepted: Shift date is in the future It is still saved on this device.',
          { duration: 10_000 }
        );
        expect(synced).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener('logbook:shift-reports-synced', synced);
        Reflect.deleteProperty(navigator, 'serviceWorker');
      }
    });

    it('ignores messages that are not its own', async () => {
      const container = installWorkerMessages();
      try {
        renderHook(() => useOfflineSyncEngine());
        await flush();
        mockToastSuccess.mockClear();

        post(container, { type: 'something-else', genericSynced: 5 });
        await flush();

        expect(mockToastSuccess).not.toHaveBeenCalled();
      } finally {
        Reflect.deleteProperty(navigator, 'serviceWorker');
      }
    });
  });
});
