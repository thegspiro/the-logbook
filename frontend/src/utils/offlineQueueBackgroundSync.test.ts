import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

const mockRequestBackgroundSync = vi.fn(() => Promise.resolve());
vi.mock('./backgroundSyncRegistration', () => ({
  requestBackgroundSync: () => mockRequestBackgroundSync(),
}));

// Every entry is stamped with the signed-in member (FE3-34-5).
vi.mock('../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ isAuthenticated: true, user: { id: 'member-1' } }) },
}));

import { enqueueGeneric, putGenericItem } from './genericOfflineQueue';
import { enqueueShiftReport } from './shiftReportOfflineQueue';

// Queuing is what asks the browser for a background sync, so an item queued
// with no signal can be sent once signal returns even after the app is closed.
describe('queuing an item asks for a background sync', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    mockRequestBackgroundSync.mockReset();
    mockRequestBackgroundSync.mockResolvedValue(undefined);
  });

  it('for a training submission or RSVP', async () => {
    await enqueueGeneric('event-rsvp', '/events/e1/rsvp', { status: 'going' }, 'RSVP: going');

    expect(mockRequestBackgroundSync).toHaveBeenCalledTimes(1);
  });

  it('for an NFC session the screen rewrites as taps arrive', async () => {
    await putGenericItem({
      id: 'session-1',
      kind: 'nfc-put-away',
      url: '/inventory/nfc/put-away/replay',
      body: { taps: [] },
      label: 'Put away',
      queuedAt: 1_000,
      retries: 0,
      held: false,
    });

    expect(mockRequestBackgroundSync).toHaveBeenCalledTimes(1);
  });

  it('for a shift report', async () => {
    await enqueueShiftReport({ shift_date: '2026-10-30', hours_on_shift: 12, calls_responded: 0, crew_member_ids: [] });

    expect(mockRequestBackgroundSync).toHaveBeenCalledTimes(1);
  });
});
