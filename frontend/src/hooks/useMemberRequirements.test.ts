import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getMyTraining = vi.fn();
const getMemberRequirements = vi.fn();
vi.mock('../services/api', () => ({
  trainingModuleConfigService: {
    getMyTraining: (...args: unknown[]) => getMyTraining(...args) as unknown,
    getMemberRequirements: (...args: unknown[]) => getMemberRequirements(...args) as unknown,
  },
}));

import { useMemberRequirements } from './useMemberRequirements';

const detail = { id: 'req-cpr', name: 'CPR/BLS' };

describe('useMemberRequirements', () => {
  beforeEach(() => {
    getMyTraining.mockReset();
    getMyTraining.mockResolvedValue({ requirements_detail: [detail] });
    getMemberRequirements.mockReset();
    getMemberRequirements.mockResolvedValue({ requirements_detail: [{ ...detail, id: 'other' }] });
  });

  it("reads one's own requirements through My Training, where the visibility settings apply", async () => {
    const { result } = renderHook(() => useMemberRequirements('me', true, true));
    await waitFor(() => expect(result.current).toEqual([detail]));
    expect(getMemberRequirements).not.toHaveBeenCalled();
  });

  it("reads another member's through the officer endpoint", async () => {
    const { result } = renderHook(() => useMemberRequirements('member-2', true, false));
    await waitFor(() => expect(result.current).toEqual([{ ...detail, id: 'other' }]));
    expect(getMemberRequirements).toHaveBeenCalledWith('member-2');
    expect(getMyTraining).not.toHaveBeenCalled();
  });

  it('asks for nothing when the viewer may not read the training', () => {
    const { result } = renderHook(() => useMemberRequirements('member-2', false, false));
    expect(result.current).toEqual([]);
    expect(getMyTraining).not.toHaveBeenCalled();
    expect(getMemberRequirements).not.toHaveBeenCalled();
  });

  it('reads a failed load as no requirements', async () => {
    getMemberRequirements.mockReset();
    getMemberRequirements.mockRejectedValue(new Error('403'));
    const { result } = renderHook(() => useMemberRequirements('member-2', true, false));
    await waitFor(() => expect(getMemberRequirements).toHaveBeenCalledWith('member-2'));
    expect(result.current).toEqual([]);
  });
});
