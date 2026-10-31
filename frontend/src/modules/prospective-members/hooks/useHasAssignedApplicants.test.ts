/**
 * useHasAssignedApplicants — the menu's reason to offer My Applicants.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getMyApplicants = vi.fn();
vi.mock('../services/api', () => ({
  applicantService: { getMyApplicants: (...a: unknown[]) => getMyApplicants(...a) as unknown },
}));

import { useAssignedApplicantsStore, useHasAssignedApplicants } from './useHasAssignedApplicants';

describe('useHasAssignedApplicants', () => {
  beforeEach(() => {
    getMyApplicants.mockReset();
    useAssignedApplicantsStore.setState({ userId: null, hasAny: false, loading: false });
  });

  it('is true once the backend lists an applicant for the member', async () => {
    getMyApplicants.mockResolvedValue([{ id: 'app-1' }]);
    const { result } = renderHook(() => useHasAssignedApplicants('board-1', true));

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is false for a member assigned to nobody', async () => {
    getMyApplicants.mockResolvedValue([]);
    const { result } = renderHook(() => useHasAssignedApplicants('board-1', true));

    await waitFor(() => expect(getMyApplicants).toHaveBeenCalledTimes(1));
    expect(result.current).toBe(false);
  });

  it('asks nothing while the module is off', () => {
    const { result } = renderHook(() => useHasAssignedApplicants('board-1', false));

    expect(result.current).toBe(false);
    expect(getMyApplicants).not.toHaveBeenCalled();
  });

  it('asks once per member, not on every render', async () => {
    getMyApplicants.mockResolvedValue([{ id: 'app-1' }]);
    const { result, rerender } = renderHook(() => useHasAssignedApplicants('board-1', true));
    await waitFor(() => expect(result.current).toBe(true));

    rerender();
    rerender();

    expect(getMyApplicants).toHaveBeenCalledTimes(1);
  });

  it('treats a failed request as no entry rather than an error', async () => {
    getMyApplicants.mockRejectedValue(new Error('Network Error'));
    const { result } = renderHook(() => useHasAssignedApplicants('board-1', true));

    await waitFor(() => expect(useAssignedApplicantsStore.getState().userId).toBe('board-1'));
    expect(result.current).toBe(false);
  });
});
