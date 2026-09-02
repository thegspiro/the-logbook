import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileVisibility } from '../types/user';

const { getMyProfileVisibility, setMyProfileVisibility } = vi.hoisted(() => ({
  getMyProfileVisibility: vi.fn(),
  setMyProfileVisibility: vi.fn(),
}));
vi.mock('../services/api', () => ({
  userService: {
    getMyProfileVisibility: (...args: unknown[]) => getMyProfileVisibility(...args) as unknown,
    setMyProfileVisibility: (...args: unknown[]) => setMyProfileVisibility(...args) as unknown,
  },
}));

import { DEFAULT_PROFILE_VISIBILITY } from '../types/user';
import { useProfileVisibility } from './useProfileVisibility';

const shareAll: ProfileVisibility = {
  email: true,
  personal_email: true,
  phone: true,
  mobile: true,
  address: true,
};

describe('useProfileVisibility', () => {
  beforeEach(() => {
    getMyProfileVisibility.mockReset();
    setMyProfileVisibility.mockReset();
    getMyProfileVisibility.mockResolvedValue({ ...DEFAULT_PROFILE_VISIBILITY, address: true });
    setMyProfileVisibility.mockImplementation((v: ProfileVisibility) => Promise.resolve(v));
  });

  it('seeds from the initial value without fetching', () => {
    const initial = { ...shareAll, mobile: false };
    const { result } = renderHook(() => useProfileVisibility({ enabled: true, initial }));

    expect(result.current.visibility).toEqual(initial);
    expect(result.current.loading).toBe(false);
    expect(getMyProfileVisibility).not.toHaveBeenCalled();
  });

  it('fetches when enabled and nothing is on hand', async () => {
    const { result } = renderHook(() => useProfileVisibility({ enabled: true, initial: null }));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visibility.address).toBe(true);
    expect(getMyProfileVisibility).toHaveBeenCalledWith();
  });

  it("does nothing on a colleague's profile", () => {
    const { result } = renderHook(() => useProfileVisibility({ enabled: false, initial: null }));

    expect(result.current.loading).toBe(false);
    expect(result.current.visibility).toEqual(DEFAULT_PROFILE_VISIBILITY);
    expect(getMyProfileVisibility).not.toHaveBeenCalled();
  });

  it('saves the whole object on a single flip and keeps the response', async () => {
    setMyProfileVisibility.mockResolvedValue({ ...DEFAULT_PROFILE_VISIBILITY, address: true, phone: false });
    const { result } = renderHook(() => useProfileVisibility({ enabled: true, initial: DEFAULT_PROFILE_VISIBILITY }));

    await act(async () => {
      await result.current.setField('address', true);
    });

    expect(setMyProfileVisibility).toHaveBeenCalledWith({ ...DEFAULT_PROFILE_VISIBILITY, address: true });
    // The response is the truth, even where it differs from the optimistic value.
    expect(result.current.visibility.phone).toBe(false);
    expect(result.current.saveState).toBe('saved');
    expect(result.current.savingField).toBeNull();
  });

  it('reverts the switch and reports the failure when the save is rejected', async () => {
    setMyProfileVisibility.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useProfileVisibility({ enabled: true, initial: DEFAULT_PROFILE_VISIBILITY }));

    await act(async () => {
      await result.current.setField('address', true);
    });

    expect(result.current.visibility.address).toBe(false);
    expect(result.current.saveState).toBe('error');
  });

  it('builds each save on the latest object, not a stale closure', async () => {
    const { result } = renderHook(() => useProfileVisibility({ enabled: true, initial: DEFAULT_PROFILE_VISIBILITY }));

    await act(async () => {
      await result.current.setField('address', true);
    });
    await act(async () => {
      await result.current.setField('mobile', false);
    });

    expect(setMyProfileVisibility).toHaveBeenLastCalledWith({
      ...DEFAULT_PROFILE_VISIBILITY,
      address: true,
      mobile: false,
    });
  });

  it('serialises saves so a second flip cannot be undone by the first response', async () => {
    let resolveFirst: (v: ProfileVisibility) => void = () => {};
    setMyProfileVisibility
      .mockImplementationOnce(
        () =>
          new Promise<ProfileVisibility>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce((v: ProfileVisibility) => Promise.resolve(v));
    const { result } = renderHook(() => useProfileVisibility({ enabled: true, initial: DEFAULT_PROFILE_VISIBILITY }));

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.setField('address', true);
      second = result.current.setField('mobile', false);
      // Let the queue hand the first save to the network; the second stays behind it.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Only the first request has gone out; the second waits its turn.
    expect(setMyProfileVisibility).toHaveBeenCalledTimes(1);
    expect(result.current.visibility).toEqual({ ...DEFAULT_PROFILE_VISIBILITY, address: true, mobile: false });

    await act(async () => {
      // The server echoes the first snapshot, which does not know about mobile.
      resolveFirst({ ...DEFAULT_PROFILE_VISIBILITY, address: true });
      await first;
      await second;
    });

    expect(setMyProfileVisibility).toHaveBeenCalledTimes(2);
    expect(setMyProfileVisibility).toHaveBeenLastCalledWith({
      ...DEFAULT_PROFILE_VISIBILITY,
      address: true,
      mobile: false,
    });
    expect(result.current.visibility.mobile).toBe(false);
    expect(result.current.visibility.address).toBe(true);
  });

  it('refuses to write while the stored choice is unknown, and reloads on request', async () => {
    getMyProfileVisibility.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useProfileVisibility({ enabled: true, initial: null }));

    await waitFor(() => expect(result.current.loadError).toBe(true));
    expect(result.current.ready).toBe(false);

    await act(async () => {
      await result.current.setField('address', true);
    });
    // A whole-object save built on the defaults would overwrite a hidden field.
    expect(setMyProfileVisibility).not.toHaveBeenCalled();
    expect(result.current.visibility.address).toBe(false);

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.loadError).toBe(false);
    expect(result.current.visibility.address).toBe(true);
  });
});
