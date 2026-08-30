/**
 * Regression test: GrantApplicationsPage refetches applications every time
 * `statusFilter` changes (GF-31), which means two fetches can be in flight
 * at once if the filter changes again before the first resolves. Before
 * this fix, `fetchApplications` unconditionally overwrote `applications`
 * with whichever response arrived last — so a slower response for a
 * superseded filter could clobber a newer, already-applied one (GF-32).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GrantApplication } from '../types';

const mockListApplications = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    listApplications: (...args: unknown[]) => mockListApplications(...args) as unknown,
  },
  fundraisingService: {},
}));

import { useGrantsStore } from './grantsStore';

const application = (id: string, applicationStatus: string) =>
  ({ id, applicationStatus }) as unknown as GrantApplication;

describe('grantsStore.fetchApplications — out-of-order responses', () => {
  beforeEach(() => {
    mockListApplications.mockReset();
    useGrantsStore.setState({ applications: [], isLoading: false, error: null });
  });

  it('does not let a slower, superseded request overwrite a newer one', async () => {
    const stale = [application('1', 'reporting')];
    const fresh = [application('2', 'active')];

    let resolveStale: (value: GrantApplication[]) => void = () => {
      throw new Error('resolveStale called before assignment');
    };
    const stalePromise = new Promise<GrantApplication[]>((resolve) => {
      resolveStale = resolve;
    });

    mockListApplications.mockImplementationOnce(() => stalePromise);
    mockListApplications.mockResolvedValueOnce(fresh);

    const staleCall = useGrantsStore.getState().fetchApplications({ status: 'reporting' });
    const freshCall = useGrantsStore.getState().fetchApplications({ status: 'active' });

    // The second (newer) request resolves first.
    await freshCall;
    expect(useGrantsStore.getState().applications).toEqual(fresh);

    // The first (superseded) request resolves after — its result must be
    // ignored rather than overwriting the newer state.
    resolveStale(stale);
    await staleCall;
    expect(useGrantsStore.getState().applications).toEqual(fresh);
  });

  it('clears the list on a failed fetch rather than leaving the previous filter on screen', async () => {
    useGrantsStore.setState({ applications: [application('1', 'reporting')] });
    mockListApplications.mockRejectedValueOnce(new Error('network error'));

    await useGrantsStore.getState().fetchApplications({ status: 'active' });

    // The stale 'reporting' rows must not linger under the new 'active'
    // filter alongside the error banner.
    expect(useGrantsStore.getState().applications).toEqual([]);
    expect(useGrantsStore.getState().error).toBe('network error');
  });
});
