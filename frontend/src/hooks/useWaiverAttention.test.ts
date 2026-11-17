import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const { training, meeting } = vi.hoisted(() => ({
  training: { getAttention: vi.fn() },
  meeting: { getAttention: vi.fn() },
}));
vi.mock('../services/attendanceWaiverService', () => ({
  attendanceWaiverService: training,
  meetingWaiverService: meeting,
}));

import { useWaiverAttention, useWaiverAttentionStore, WaiverAttentionKey } from './useWaiverAttention';

const BOTH = { training: true, meetings: true };

describe('useWaiverAttention', () => {
  beforeEach(() => {
    training.getAttention.mockReset();
    meeting.getAttention.mockReset();
    useWaiverAttentionStore.setState({ userId: null, answers: {}, loading: {} });
    training.getAttention.mockResolvedValue({ decides: false, pending: 0 });
    meeting.getAttention.mockResolvedValue({ decides: true, pending: 2 });
  });

  it('asks each enabled workflow once and returns the server’s answers', async () => {
    const { result, rerender } = renderHook(() => useWaiverAttention('u-1', BOTH));
    await waitFor(() => expect(result.current.meetings).toEqual({ decides: true, pending: 2 }));
    expect(result.current.training).toEqual({ decides: false, pending: 0 });
    rerender();
    expect(training.getAttention).toHaveBeenCalledTimes(1);
    expect(meeting.getAttention).toHaveBeenCalledTimes(1);
  });

  it('does not ask about a workflow whose module is off', async () => {
    const { result } = renderHook(() => useWaiverAttention('u-1', { training: true, meetings: false }));
    await waitFor(() => expect(result.current.training).not.toBeNull());
    expect(meeting.getAttention).not.toHaveBeenCalled();
    expect(result.current.meetings).toBeNull();
  });

  it('offers no link when the server cannot be asked', async () => {
    meeting.getAttention.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useWaiverAttention('u-1', BOTH));
    await waitFor(() => expect(result.current.meetings).toEqual({ decides: false, pending: 0 }));
  });

  it('asks again for a different member', async () => {
    const { result, rerender } = renderHook(({ id }) => useWaiverAttention(id, BOTH), {
      initialProps: { id: 'u-1' },
    });
    await waitFor(() => expect(result.current.meetings).not.toBeNull());
    meeting.getAttention.mockResolvedValue({ decides: false, pending: 0 });
    rerender({ id: 'u-2' });
    await waitFor(() => expect(result.current.meetings).toEqual({ decides: false, pending: 0 }));
    expect(meeting.getAttention).toHaveBeenCalledTimes(2);
  });

  it('follows a refresh after a decision', async () => {
    const { result } = renderHook(() => useWaiverAttention('u-1', BOTH));
    await waitFor(() => expect(result.current.meetings?.pending).toBe(2));
    meeting.getAttention.mockResolvedValue({ decides: true, pending: 1 });
    await act(async () => {
      await useWaiverAttentionStore.getState().refresh(WaiverAttentionKey.BUSINESS_MEETING);
    });
    expect(result.current.meetings).toEqual({ decides: true, pending: 1 });
  });
});
