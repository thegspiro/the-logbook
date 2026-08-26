import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalRankResponse } from '../services/api';

const { mockGetRanks } = vi.hoisted(() => ({ mockGetRanks: vi.fn() }));
vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return { ...actual, ranksService: { getRanks: mockGetRanks } };
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
    mockGetRanks.mockReset();
    invalidateRanksCache();
    setOrganization('org-1');
  });

  it('does not use active-only ranks for a later all-ranks query', async () => {
    mockGetRanks.mockResolvedValueOnce([rank('active')]).mockResolvedValueOnce([rank('active'), rank('inactive')]);

    const active = renderHook(() => useRanks(true));
    await waitFor(() => expect(active.result.current.ranks).toHaveLength(1));
    active.unmount();

    const all = renderHook(() => useRanks(false));
    expect(all.result.current.ranks).toEqual([]);
    await waitFor(() => expect(all.result.current.ranks).toHaveLength(2));
    expect(mockGetRanks).toHaveBeenNthCalledWith(1, { is_active: true });
    expect(mockGetRanks).toHaveBeenNthCalledWith(2, undefined);
  });

  it('does not use all-ranks data for a later active-only query', async () => {
    mockGetRanks.mockResolvedValueOnce([rank('active'), rank('inactive')]).mockResolvedValueOnce([rank('active')]);

    const all = renderHook(() => useRanks(false));
    await waitFor(() => expect(all.result.current.ranks).toHaveLength(2));
    all.unmount();

    const active = renderHook(() => useRanks(true));
    expect(active.result.current.ranks).toEqual([]);
    await waitFor(() => expect(active.result.current.ranks).toEqual([rank('active')]));
  });

  it('clears visible ranks immediately when the filter changes on a mounted hook', async () => {
    let resolveAll!: (ranks: OperationalRankResponse[]) => void;
    mockGetRanks
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
    mockGetRanks.mockResolvedValueOnce([rank('old')]).mockResolvedValueOnce([rank('new')]);
    const hook = renderHook(() => useRanks(true));
    await waitFor(() => expect(hook.result.current.ranks).toEqual([rank('old')]));

    await act(async () => hook.result.current.refetch());
    expect(hook.result.current.ranks).toEqual([rank('new')]);
    expect(mockGetRanks).toHaveBeenCalledTimes(2);
  });

  it('does not expose ranks cached for another organization', async () => {
    mockGetRanks.mockResolvedValueOnce([rank('one', 'org-1')]).mockResolvedValueOnce([rank('two', 'org-2')]);
    const hook = renderHook(() => useRanks(true));
    await waitFor(() => expect(hook.result.current.ranks).toEqual([rank('one', 'org-1')]));

    act(() => setOrganization('org-2'));
    expect(hook.result.current.ranks).toEqual([]);
    await waitFor(() => expect(hook.result.current.ranks).toEqual([rank('two', 'org-2')]));
  });
});
