import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenericCount = vi.fn();
const mockEquipmentCount = vi.fn();
const mockReportCount = vi.fn();

vi.mock('../utils/genericOfflineQueue', () => ({
  genericPendingCount: () => mockGenericCount() as Promise<number>,
}));
vi.mock('../utils/offlineQueue', () => ({
  pendingCount: () => mockEquipmentCount() as Promise<number>,
}));
vi.mock('../utils/shiftReportOfflineQueue', () => ({
  pendingReportCount: () => mockReportCount() as Promise<number>,
}));

// Import the store AFTER the queue mocks are in place.
import { usePendingSyncStore } from './pendingSyncStore';

describe('pendingSyncStore', () => {
  beforeEach(() => {
    usePendingSyncStore.setState({ count: 0, status: 'idle', lastError: null });
    vi.clearAllMocks();
    mockGenericCount.mockResolvedValue(0);
    mockEquipmentCount.mockResolvedValue(0);
    mockReportCount.mockResolvedValue(0);
  });

  describe('refresh', () => {
    it('sums the three queues into the badge count', async () => {
      mockGenericCount.mockResolvedValue(2);
      mockEquipmentCount.mockResolvedValue(3);
      mockReportCount.mockResolvedValue(5);

      await usePendingSyncStore.getState().refresh();

      expect(usePendingSyncStore.getState().count).toBe(10);
    });

    it('reports zero when every queue is empty', async () => {
      await usePendingSyncStore.getState().refresh();
      expect(usePendingSyncStore.getState().count).toBe(0);
    });

    it('queries all three queues, not just the first', async () => {
      await usePendingSyncStore.getState().refresh();

      expect(mockGenericCount).toHaveBeenCalledWith();
      expect(mockEquipmentCount).toHaveBeenCalledWith();
      expect(mockReportCount).toHaveBeenCalledWith();
    });

    // The count drives a navigation pill, not a decision. One queue failing to
    // open — a private-mode browser, a blocked upgrade — must not blank the
    // badge or throw into a render; it should just contribute nothing.
    it('still counts the healthy queues when one cannot be read', async () => {
      mockEquipmentCount.mockRejectedValue(new Error('IndexedDB unavailable'));
      mockGenericCount.mockResolvedValue(4);
      mockReportCount.mockResolvedValue(1);

      await usePendingSyncStore.getState().refresh();

      expect(usePendingSyncStore.getState().count).toBe(5);
    });

    it('settles at zero when every queue fails', async () => {
      mockGenericCount.mockRejectedValue(new Error('nope'));
      mockEquipmentCount.mockRejectedValue(new Error('nope'));
      mockReportCount.mockRejectedValue(new Error('nope'));

      await expect(usePendingSyncStore.getState().refresh()).resolves.toBeUndefined();
      expect(usePendingSyncStore.getState().count).toBe(0);
    });

    it('replaces the previous count rather than accumulating across refreshes', async () => {
      mockGenericCount.mockResolvedValue(7);
      await usePendingSyncStore.getState().refresh();
      expect(usePendingSyncStore.getState().count).toBe(7);

      mockGenericCount.mockResolvedValue(1);
      await usePendingSyncStore.getState().refresh();
      expect(usePendingSyncStore.getState().count).toBe(1);
    });
  });

  describe('setStatus', () => {
    it('records a sync failure with its reason', () => {
      usePendingSyncStore.getState().setStatus('error', 'upload rejected');

      expect(usePendingSyncStore.getState().status).toBe('error');
      expect(usePendingSyncStore.getState().lastError).toBe('upload rejected');
    });

    // Moving back to syncing or idle without clearing lastError would leave a
    // stale failure on screen after a later attempt succeeded.
    it('clears the previous error when no reason is given', () => {
      usePendingSyncStore.getState().setStatus('error', 'upload rejected');
      usePendingSyncStore.getState().setStatus('syncing');

      expect(usePendingSyncStore.getState().status).toBe('syncing');
      expect(usePendingSyncStore.getState().lastError).toBeNull();
    });

    it('leaves the pending count untouched', async () => {
      mockGenericCount.mockResolvedValue(3);
      await usePendingSyncStore.getState().refresh();

      usePendingSyncStore.getState().setStatus('syncing');

      expect(usePendingSyncStore.getState().count).toBe(3);
    });
  });
});
