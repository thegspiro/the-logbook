/**
 * The navigation asks once per signed-in member whether they own a budget
 * line, not on every render, and treats a failure as "no" — the link is a
 * hint, the page itself is the answer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mySummary = vi.fn();
vi.mock('../services/api', () => ({
  budgetService: { mySummary: (...args: unknown[]) => mySummary(...args) as unknown },
}));

import { useOwnsBudgets, useOwnsBudgetsStore } from './useOwnsBudgets';

beforeEach(() => {
  mySummary.mockReset();
  useOwnsBudgetsStore.setState({ userId: null, ownsAny: false, loading: false });
});

describe('useOwnsBudgets', () => {
  it('asks once and remembers the answer for that member', async () => {
    mySummary.mockResolvedValue({ ownsAny: true });
    const { result, rerender } = renderHook(() => useOwnsBudgets('u-1', true));

    await waitFor(() => expect(result.current).toBe(true));
    rerender();
    renderHook(() => useOwnsBudgets('u-1', true));
    expect(mySummary).toHaveBeenCalledTimes(1);
  });

  it('asks again for a different member', async () => {
    mySummary.mockResolvedValueOnce({ ownsAny: true }).mockResolvedValueOnce({ ownsAny: false });
    const first = renderHook(() => useOwnsBudgets('u-1', true));
    await waitFor(() => expect(first.result.current).toBe(true));
    first.unmount();

    const second = renderHook(() => useOwnsBudgets('u-2', true));
    await waitFor(() => expect(mySummary).toHaveBeenCalledTimes(2));
    expect(second.result.current).toBe(false);
  });

  it('asks nothing while the Finance module is off or nobody is signed in', () => {
    renderHook(() => useOwnsBudgets('u-1', false));
    renderHook(() => useOwnsBudgets(undefined, true));
    expect(mySummary).not.toHaveBeenCalled();
  });

  it('offers nothing when the question fails', async () => {
    mySummary.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useOwnsBudgets('u-1', true));

    await waitFor(() => expect(useOwnsBudgetsStore.getState().userId).toBe('u-1'));
    expect(result.current).toBe(false);
  });
});
