/**
 * Regression test: `fetchApplications` had no request sequencing. When a
 * status-filtered fetch was still in flight and a newer one started (the
 * user switching the status filter again, or the applications page's
 * effect re-firing before the first request resolved), an out-of-order
 * response could resolve after the newer one and overwrite `applications`
 * with the stale filter's results. The store now drops any response that
 * resolves after a newer `fetchApplications` call has started.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListApplications = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    listApplications: (...args: unknown[]) => mockListApplications(...args) as unknown,
  },
  fundraisingService: {},
}));

import { useGrantsStore } from './grantsStore';

function getState() {
  return useGrantsStore.getState();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('grantsStore.fetchApplications — stale response sequencing', () => {
  beforeEach(() => {
    mockListApplications.mockReset();
    useGrantsStore.setState({ applications: [], isLoading: false, error: null });
  });

  it('drops a slow first response that resolves after a newer request already resolved', async () => {
    const slow = deferred<unknown[]>();
    const fast = deferred<unknown[]>();
    mockListApplications.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const firstCall = getState().fetchApplications({ status: 'researching' });
    const secondCall = getState().fetchApplications({ status: 'active' });

    // The newer ("active") request resolves first...
    fast.resolve([{ id: 'active-1' }] as never);
    await secondCall;
    expect(getState().applications).toEqual([{ id: 'active-1' }]);

    // ...then the stale ("researching") request resolves late and must not
    // overwrite the newer, already-applied result.
    slow.resolve([{ id: 'researching-1' }] as never);
    await firstCall;
    expect(getState().applications).toEqual([{ id: 'active-1' }]);
  });
});
