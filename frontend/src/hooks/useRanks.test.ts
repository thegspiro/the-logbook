import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalRankResponse } from '../services/api';

const { mockGetRankLadder, mockInvalidateByPrefix } = vi.hoisted(() => ({
  mockGetRankLadder: vi.fn(),
  mockInvalidateByPrefix: vi.fn(),
}));
vi.mock('../utils/apiCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/apiCache')>();
  return { ...actual, invalidateByPrefix: (p: string) => mockInvalidateByPrefix(p) as unknown };
});
vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  // The hook reads strictly, so a non-array body throws rather than becoming
  // an empty ladder nobody can tell from a real one.
  return { ...actual, ranksService: { getRankLadder: mockGetRankLadder } };
});

import { useAuthStore } from '../stores/authStore';
import { invalidateRanksCache } from './ranksCache';
import { useRanks } from './useRanks';

const rank = (code: string, organizationId = 'org-1'): OperationalRankResponse => ({
  id: `${organizationId}-${code}`,
  organization_id: organizationId,
  rank_code: code,
  display_name: code,
  description: null,
  sort_order: 1,
  is_active: true,
  eligible_positions: null,
  default_permission_count: 0,
  created_at: '',
  updated_at: '',
});

const setOrganization = (organizationId: string) => {
  useAuthStore.setState({ user: { organization_id: organizationId } as never });
};

describe('useRanks cache keys', () => {
  beforeEach(() => {
    mockGetRankLadder.mockReset();
    invalidateRanksCache();
    setOrganization('org-1');
  });

  it('does not use active-only ranks for a later all-ranks query', async () => {
    mockGetRankLadder.mockResolvedValueOnce([rank('active')]).mockResolvedValueOnce([rank('active'), rank('inactive')]);

    const active = renderHook(() => useRanks(true));
    await waitFor(() => expect(active.result.current.ranks).toHaveLength(1));
    active.unmount();

    const all = renderHook(() => useRanks(false));
    expect(all.result.current.ranks).toEqual([]);
    await waitFor(() => expect(all.result.current.ranks).toHaveLength(2));
    expect(mockGetRankLadder).toHaveBeenNthCalledWith(1, { is_active: true });
    expect(mockGetRankLadder).toHaveBeenNthCalledWith(2, undefined);
  });

  it('does not use all-ranks data for a later active-only query', async () => {
    mockGetRankLadder.mockResolvedValueOnce([rank('active'), rank('inactive')]).mockResolvedValueOnce([rank('active')]);

    const all = renderHook(() => useRanks(false));
    await waitFor(() => expect(all.result.current.ranks).toHaveLength(2));
    all.unmount();

    const active = renderHook(() => useRanks(true));
    expect(active.result.current.ranks).toEqual([]);
    await waitFor(() => expect(active.result.current.ranks).toEqual([rank('active')]));
  });

  it('clears visible ranks immediately when the filter changes on a mounted hook', async () => {
    let resolveAll!: (ranks: OperationalRankResponse[]) => void;
    mockGetRankLadder
      .mockResolvedValueOnce([rank('active')])
      .mockImplementationOnce(() => new Promise((resolve) => (resolveAll = resolve)));

    const hook = renderHook(({ activeOnly }) => useRanks(activeOnly), { initialProps: { activeOnly: true } });
    await waitFor(() => expect(hook.result.current.ranks).toEqual([rank('active')]));

    hook.rerender({ activeOnly: false });
    expect(hook.result.current.ranks).toEqual([]);
    await act(async () => resolveAll([rank('active'), rank('inactive')]));
    expect(hook.result.current.ranks).toHaveLength(2);
  });

  it('refetch invalidates and replaces only the current cache entry', async () => {
    mockGetRankLadder.mockResolvedValueOnce([rank('old')]).mockResolvedValueOnce([rank('new')]);
    const hook = renderHook(() => useRanks(true));
    await waitFor(() => expect(hook.result.current.ranks).toEqual([rank('old')]));

    await act(async () => hook.result.current.refetch());
    expect(hook.result.current.ranks).toEqual([rank('new')]);
    expect(mockGetRankLadder).toHaveBeenCalledTimes(2);
  });

  it('does not expose ranks cached for another organization', async () => {
    mockGetRankLadder.mockResolvedValueOnce([rank('one', 'org-1')]).mockResolvedValueOnce([rank('two', 'org-2')]);
    const hook = renderHook(() => useRanks(true));
    await waitFor(() => expect(hook.result.current.ranks).toEqual([rank('one', 'org-1')]));

    act(() => setOrganization('org-2'));
    expect(hook.result.current.ranks).toEqual([]);
    await waitFor(() => expect(hook.result.current.ranks).toEqual([rank('two', 'org-2')]));
  });
});

describe('useRanks and a response that is not a ladder', () => {
  beforeEach(() => {
    mockGetRankLadder.mockReset();
    invalidateRanksCache();
    setOrganization('org-strict');
  });

  it('reads strictly, so a captive-portal body is a failure and not an empty ladder', async () => {
    // `getRanks` funnels the body through `asArray`, which turns an HTTP 200
    // HTML page into `[]` — and a guard above that never fires. Reading through
    // `getRankLadder` is what lets the failure be known at all.
    mockGetRankLadder.mockRejectedValue(new TypeError('The rank list response was not an array'));
    const { result } = renderHook(() => useRanks());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.failed).toBe(true);
    expect(result.current.ranks).toEqual([]);
  });

  it('still renders nothing rather than throwing, for the surfaces that only display ranks', async () => {
    // The reason the lenient reader exists — a dropdown showing nothing beats a
    // page dying through the ErrorBoundary — is met by the hook's catch. Those
    // consumers simply ignore `failed`.
    mockGetRankLadder.mockRejectedValue(new TypeError('nope'));
    const { result } = renderHook(() => useRanks());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rankOptions).toEqual([]);
  });

  it('does not cache a failed read as a legitimately empty ladder', async () => {
    // The poisoned value used to reach every later consumer through the shared
    // cache, so a second hook would not even re-request.
    mockGetRankLadder.mockRejectedValueOnce(new TypeError('nope'));
    const first = renderHook(() => useRanks());
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    mockGetRankLadder.mockResolvedValue([rank('captain', 'org-strict')]);
    const second = renderHook(() => useRanks());
    await waitFor(() => expect(second.result.current.ranks).toHaveLength(1));

    expect(second.result.current.failed).toBe(false);
  });

  it('does not carry a failure onto a key whose ranks are already cached', async () => {
    // `failed` is keyed like `rankState` and `loadingState`. Left as a bare
    // boolean it survived the switch — and the *cache-hit* path is what makes
    // that visible, because it sets ranks and loading and returns without ever
    // fetching, so nothing clears the flag. A consumer then hides a perfectly
    // good ladder behind the load-error alert.
    //
    // Warmed first, deliberately: a switch to an uncached key fetches, and a
    // successful fetch clears the flag on its own, so that path would pass with
    // or without the fix.
    mockGetRankLadder.mockResolvedValueOnce([rank('captain', 'org-warm')]);
    act(() => setOrganization('org-warm'));
    const warm = renderHook(() => useRanks());
    await waitFor(() => expect(warm.result.current.ranks).toHaveLength(1));
    // Unmounted before the next switch, or it competes for the queued mock and
    // takes the rejection meant for the hook under test.
    warm.unmount();

    act(() => setOrganization('org-strict'));
    mockGetRankLadder.mockRejectedValueOnce(new TypeError('nope'));
    const { result } = renderHook(() => useRanks());
    await waitFor(() => expect(result.current.failed).toBe(true));

    // org-warm is in the ranks cache, so this switch takes the early-return.
    mockGetRankLadder.mockClear();
    act(() => setOrganization('org-warm'));

    await waitFor(() => expect(result.current.ranks).toHaveLength(1));
    expect(mockGetRankLadder).not.toHaveBeenCalled();
    expect(result.current.failed).toBe(false);
  });

  it('clears the failure once a read succeeds', async () => {
    mockGetRankLadder.mockRejectedValueOnce(new TypeError('nope'));
    const { result } = renderHook(() => useRanks());
    await waitFor(() => expect(result.current.failed).toBe(true));

    mockGetRankLadder.mockResolvedValue([rank('captain', 'org-strict')]);
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.failed).toBe(false);
  });
});

describe('useRanks retry and the shared response cache', () => {
  beforeEach(() => {
    mockGetRankLadder.mockReset();
    mockInvalidateByPrefix.mockReset();
    invalidateRanksCache();
    setOrganization('org-retry');
  });

  it('clears the shared axios cache, not only the ranks cache', async () => {
    // `/operational-ranks` is not in `UNCACHEABLE_PREFIXES`, so the response
    // interceptor stored the body. When the failure being retried is an HTTP
    // 200 with a malformed body, that body is exactly what a retry inside the
    // 30-second fresh window is served — so "Try again" would be a dead button
    // in the one case the strict read exists to catch.
    mockGetRankLadder.mockResolvedValue([]);
    const { result } = renderHook(() => useRanks());
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockInvalidateByPrefix.mockClear();

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockInvalidateByPrefix).toHaveBeenCalledWith('/operational-ranks');
  });
});
