import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockGetMyUnreadCount = vi.fn();

vi.mock('../services/api', () => ({
  notificationsService: { getMyUnreadCount: (...args: unknown[]) => mockGetMyUnreadCount(...args) as unknown },
}));
vi.mock('./useEnabledModules', () => ({
  useEnabledModules: () => ({ isModuleOn: () => true, isLoading: false }),
}));

import { useNotificationPoller } from './useNotificationCount';
import { BACKGROUND_REQUEST_CONFIG } from '../utils/backgroundRequest';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMyUnreadCount.mockReset();
  mockGetMyUnreadCount.mockResolvedValue({ unread_count: 3 });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useNotificationPoller', () => {
  it('polls as a background request, so an open tab does not keep the session alive', async () => {
    renderHook(() => useNotificationPoller());
    await vi.advanceTimersByTimeAsync(60_000 + 100);

    expect(mockGetMyUnreadCount).toHaveBeenCalled();
    for (const call of mockGetMyUnreadCount.mock.calls) {
      expect(call[0]).toBe(BACKGROUND_REQUEST_CONFIG);
    }
  });
});
