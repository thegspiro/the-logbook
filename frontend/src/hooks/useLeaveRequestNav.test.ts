/**
 * The navigation offers Leave Requests when the department takes requests or
 * something waits on the member, with the count beside it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getSummary = vi.fn();
vi.mock('../services/leaveRequestService', () => ({
  leaveRequestService: { getSummary: (...a: unknown[]) => getSummary(...a) as unknown },
}));

import { leaveRequestNavLabel, useLeaveRequestNav, useLeaveRequestNavStore } from './useLeaveRequestNav';

describe('useLeaveRequestNav', () => {
  beforeEach(() => {
    getSummary.mockReset();
    useLeaveRequestNavStore.setState({ userId: null, requestsEnabled: false, waiting: 0, loading: false });
  });

  it('counts what waits to decide and to answer', async () => {
    getSummary.mockResolvedValue({ requests_enabled: true, to_decide: 2, waiting_on_me: 1 });
    const { result } = renderHook(() => useLeaveRequestNav('u1'));
    await waitFor(() => expect(result.current).toEqual({ show: true, waiting: 3 }));
  });

  it('is offered to an approver even where members cannot ask', async () => {
    getSummary.mockResolvedValue({ requests_enabled: false, to_decide: 1, waiting_on_me: 0 });
    const { result } = renderHook(() => useLeaveRequestNav('u1'));
    await waitFor(() => expect(result.current.show).toBe(true));
  });

  it('is not offered when requests are off and nothing waits, or the read fails', async () => {
    getSummary.mockResolvedValue({ requests_enabled: false, to_decide: 0, waiting_on_me: 0 });
    const { result, unmount } = renderHook(() => useLeaveRequestNav('u1'));
    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(1));
    expect(result.current.show).toBe(false);
    // One signed-in member at a time, as in the app.
    unmount();

    useLeaveRequestNavStore.setState({ userId: null });
    getSummary.mockRejectedValue(new Error('offline'));
    const failed = renderHook(() => useLeaveRequestNav('u2'));
    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
    expect(failed.result.current.show).toBe(false);
  });

  it('labels the entry with the count only when something waits', () => {
    expect(leaveRequestNavLabel(0)).toBe('Leave Requests');
    expect(leaveRequestNavLabel(4)).toBe('Leave Requests (4)');
  });
});
