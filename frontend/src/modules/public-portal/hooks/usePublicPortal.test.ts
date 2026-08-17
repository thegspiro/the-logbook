import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mockGetConfig = vi.fn();
const mockUpdateConfig = vi.fn();
const mockListAPIKeys = vi.fn();
const mockCreateAPIKey = vi.fn();
const mockRevokeAPIKey = vi.fn();
const mockGetAccessLogs = vi.fn();
const mockGetUsageStats = vi.fn();
const mockGetWhitelist = vi.fn();
const mockUpdateWhitelistEntry = vi.fn();
const mockBulkUpdateWhitelist = vi.fn();

vi.mock('../services/publicPortalApi', () => ({
  getConfig: (...a: unknown[]) => mockGetConfig(...a) as unknown,
  updateConfig: (...a: unknown[]) => mockUpdateConfig(...a) as unknown,
  listAPIKeys: (...a: unknown[]) => mockListAPIKeys(...a) as unknown,
  createAPIKey: (...a: unknown[]) => mockCreateAPIKey(...a) as unknown,
  revokeAPIKey: (...a: unknown[]) => mockRevokeAPIKey(...a) as unknown,
  getAccessLogs: (...a: unknown[]) => mockGetAccessLogs(...a) as unknown,
  getUsageStats: (...a: unknown[]) => mockGetUsageStats(...a) as unknown,
  getWhitelist: (...a: unknown[]) => mockGetWhitelist(...a) as unknown,
  updateWhitelistEntry: (...a: unknown[]) => mockUpdateWhitelistEntry(...a) as unknown,
  bulkUpdateWhitelist: (...a: unknown[]) => mockBulkUpdateWhitelist(...a) as unknown,
}));

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  toast: {
    error: (m: string) => mockToastError(m) as unknown,
    success: (m: string) => mockToastSuccess(m) as unknown,
  },
}));

// Import the hooks AFTER the mocks are in place.
import { usePortalConfig, useAPIKeys, useAccessLogs, useUsageStats, useDataWhitelist } from './usePublicPortal';

describe('usePublicPortal hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue({ enabled: false });
    mockListAPIKeys.mockResolvedValue([]);
    mockGetAccessLogs.mockResolvedValue([]);
    mockGetUsageStats.mockResolvedValue({ totalRequests: 0 });
    mockGetWhitelist.mockResolvedValue([]);
  });

  describe('usePortalConfig', () => {
    it('loads the configuration on mount', async () => {
      mockGetConfig.mockResolvedValue({ enabled: true });

      const { result } = renderHook(() => usePortalConfig());

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.config).toEqual({ enabled: true });
      expect(result.current.error).toBeNull();
    });

    it('surfaces a load failure in state and as a toast', async () => {
      mockGetConfig.mockRejectedValue(new Error('gateway timeout'));

      const { result } = renderHook(() => usePortalConfig());

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('gateway timeout');
      expect(mockToastError).toHaveBeenCalledWith('gateway timeout');
    });

    it('replaces the config with what the server returns, not what was sent', async () => {
      mockUpdateConfig.mockResolvedValue({ enabled: true, rateLimit: 60 });
      const { result } = renderHook(() => usePortalConfig());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateConfig({ enabled: true });
      });

      expect(result.current.config).toEqual({ enabled: true, rateLimit: 60 });
      expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    });

    // This portal is unauthenticated and internet-facing, so a failed toggle
    // must not leave the UI claiming a state the server never accepted.
    it('keeps the previous config and rethrows when an update fails', async () => {
      mockGetConfig.mockResolvedValue({ enabled: false });
      mockUpdateConfig.mockRejectedValue(new Error('403'));
      const { result } = renderHook(() => usePortalConfig());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.updateConfig({ enabled: true });
        })
      ).rejects.toThrow();

      expect(result.current.config).toEqual({ enabled: false });
      expect(mockToastError).toHaveBeenCalled();
    });

    it('toggles enablement through the same update path', async () => {
      mockUpdateConfig.mockResolvedValue({ enabled: true });
      const { result } = renderHook(() => usePortalConfig());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.toggleEnabled(true);
      });

      expect(mockUpdateConfig).toHaveBeenCalledWith({ enabled: true });
    });
  });

  describe('useAPIKeys', () => {
    it('lists only active keys by default', async () => {
      const { result } = renderHook(() => useAPIKeys());

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockListAPIKeys).toHaveBeenCalledWith(false);
    });

    it('includes revoked keys when asked', async () => {
      renderHook(() => useAPIKeys(true));

      await waitFor(() => expect(mockListAPIKeys).toHaveBeenCalledWith(true));
    });

    // The create response carries the only copy of the plaintext key, so it has
    // to reach the caller — the refreshed list will never contain it again.
    it('returns the created key and refreshes the list', async () => {
      mockCreateAPIKey.mockResolvedValue({ id: 'k-1', plaintextKey: 'pk_live_secret' });
      const { result } = renderHook(() => useAPIKeys());
      await waitFor(() => expect(result.current.loading).toBe(false));
      mockListAPIKeys.mockClear();

      let created: { plaintextKey?: string } = {};
      await act(async () => {
        created = await result.current.createKey({ name: 'reporting' });
      });

      expect(created.plaintextKey).toBe('pk_live_secret');
      expect(mockListAPIKeys).toHaveBeenCalledTimes(1);
    });

    it('refreshes the list after revoking a key', async () => {
      mockRevokeAPIKey.mockResolvedValue({ message: 'ok', key_prefix: 'pk_live' });
      const { result } = renderHook(() => useAPIKeys());
      await waitFor(() => expect(result.current.loading).toBe(false));
      mockListAPIKeys.mockClear();

      await act(async () => {
        await result.current.revokeKey('k-1');
      });

      expect(mockRevokeAPIKey).toHaveBeenCalledWith('k-1');
      expect(mockListAPIKeys).toHaveBeenCalledTimes(1);
    });

    // A revoke that silently failed would leave a live key the admin believes
    // is dead, so the failure has to reach the caller.
    it('rethrows a failed revoke instead of reporting success', async () => {
      mockRevokeAPIKey.mockRejectedValue(new Error('500'));
      const { result } = renderHook(() => useAPIKeys());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.revokeKey('k-1');
        })
      ).rejects.toThrow();

      expect(mockToastSuccess).not.toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalled();
    });
  });

  describe('useAccessLogs', () => {
    it('fetches with the filters it was given', async () => {
      const { result } = renderHook(() => useAccessLogs({ status_code: 403 }));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockGetAccessLogs).toHaveBeenCalledWith({ status_code: 403 });
    });

    it('defaults to no filters', async () => {
      const { result } = renderHook(() => useAccessLogs());

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockGetAccessLogs).toHaveBeenCalledWith({});
    });

    // The guard this pins: callers pass an object literal, which is a NEW
    // reference on every render. Keyed on the reference, the effect would
    // refetch, re-render, and refetch again — an unbounded request loop against
    // an endpoint that reads access logs. The hook keys on the serialised
    // values instead, so re-rendering with an equal filter is inert.
    it('does not refetch when re-rendered with an equal but new filter object', async () => {
      const { result, rerender } = renderHook(({ f }) => useAccessLogs(f), {
        initialProps: { f: { status_code: 403 } },
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockGetAccessLogs).toHaveBeenCalledTimes(1);

      for (let i = 0; i < 5; i++) {
        rerender({ f: { status_code: 403 } });
      }

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockGetAccessLogs).toHaveBeenCalledTimes(1);
    });

    it('refetches when a filter value actually changes', async () => {
      const { result, rerender } = renderHook(({ f }) => useAccessLogs(f), {
        initialProps: { f: { status_code: 403 } },
      });
      await waitFor(() => expect(result.current.loading).toBe(false));

      rerender({ f: { status_code: 500 } });

      await waitFor(() => expect(mockGetAccessLogs).toHaveBeenCalledTimes(2));
      expect(mockGetAccessLogs).toHaveBeenLastCalledWith({ status_code: 500 });
    });

    it('surfaces a load failure', async () => {
      mockGetAccessLogs.mockRejectedValue(new Error('gateway timeout'));

      const { result } = renderHook(() => useAccessLogs());

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('gateway timeout');
      expect(result.current.logs).toEqual([]);
    });
  });

  describe('useUsageStats', () => {
    it('loads stats on mount', async () => {
      mockGetUsageStats.mockResolvedValue({ totalRequests: 42 });

      const { result } = renderHook(() => useUsageStats());

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.stats).toEqual({ totalRequests: 42 });
    });

    it('surfaces a load failure and leaves stats null', async () => {
      mockGetUsageStats.mockRejectedValue(new Error('gateway timeout'));

      const { result } = renderHook(() => useUsageStats());

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.stats).toBeNull();
      expect(result.current.error).toBe('gateway timeout');
    });
  });

  // The whitelist decides which fields an unauthenticated caller can read, so a
  // toggle that reports success without persisting would silently publish — or
  // silently keep publishing — member data.
  describe('useDataWhitelist', () => {
    it('loads every category when none is given', async () => {
      const { result } = renderHook(() => useDataWhitelist());

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockGetWhitelist).toHaveBeenCalledWith(undefined);
    });

    it('scopes the fetch to one category', async () => {
      renderHook(() => useDataWhitelist('members'));

      await waitFor(() => expect(mockGetWhitelist).toHaveBeenCalledWith('members'));
    });

    it('refetches when the category changes', async () => {
      const { result, rerender } = renderHook(({ c }) => useDataWhitelist(c), {
        initialProps: { c: 'members' },
      });
      await waitFor(() => expect(result.current.loading).toBe(false));

      rerender({ c: 'apparatus' });

      await waitFor(() => expect(mockGetWhitelist).toHaveBeenLastCalledWith('apparatus'));
    });

    it('re-reads the whitelist from the server after a toggle', async () => {
      mockUpdateWhitelistEntry.mockResolvedValue({ id: 'w-1', isEnabled: true });
      const { result } = renderHook(() => useDataWhitelist());
      await waitFor(() => expect(result.current.loading).toBe(false));
      mockGetWhitelist.mockClear();

      await act(async () => {
        await result.current.toggleField('w-1', true);
      });

      expect(mockUpdateWhitelistEntry).toHaveBeenCalledWith('w-1', true);
      expect(mockGetWhitelist).toHaveBeenCalledTimes(1);
    });

    it('rethrows a failed toggle rather than reporting success', async () => {
      mockUpdateWhitelistEntry.mockRejectedValue(new Error('403'));
      const { result } = renderHook(() => useDataWhitelist());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.toggleField('w-1', true);
        })
      ).rejects.toThrow();

      expect(mockToastSuccess).not.toHaveBeenCalled();
    });

    it('reports the server’s own summary after a bulk update', async () => {
      mockBulkUpdateWhitelist.mockResolvedValue({ message: '3 fields updated' });
      const { result } = renderHook(() => useDataWhitelist());
      await waitFor(() => expect(result.current.loading).toBe(false));
      mockGetWhitelist.mockClear();

      await act(async () => {
        await result.current.bulkUpdate([{ category: 'members', field: 'email', enabled: false }]);
      });

      expect(mockToastSuccess).toHaveBeenCalledWith('3 fields updated');
      expect(mockGetWhitelist).toHaveBeenCalledTimes(1);
    });

    it('rethrows a failed bulk update', async () => {
      mockBulkUpdateWhitelist.mockRejectedValue(new Error('500'));
      const { result } = renderHook(() => useDataWhitelist());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.bulkUpdate([]);
        })
      ).rejects.toThrow();

      expect(mockToastError).toHaveBeenCalled();
    });
  });
});
