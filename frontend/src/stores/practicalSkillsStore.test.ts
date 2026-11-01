import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetConfig = vi.fn();
vi.mock('../services/api', () => ({
  trainingModuleConfigService: { getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown },
}));

// Import the store AFTER the mock is in place.
import { renderHook } from '@testing-library/react';
import { PracticalSkillsMethod } from '../constants/enums';
import {
  offersShiftSignoffs,
  offersSkillsTesting,
  usePracticalSkillsMethod,
  usePracticalSkillsStore,
} from './practicalSkillsStore';
import { useAuthStore } from './authStore';
import type { CurrentUser } from '../types/auth';

describe('practicalSkillsStore', () => {
  beforeEach(() => {
    mockGetConfig.mockReset();
    usePracticalSkillsStore.setState({ method: null, organizationId: null });
  });

  it('loads the department’s choice', async () => {
    mockGetConfig.mockResolvedValue({ practical_skills_method: 'shift_signoffs' });

    await usePracticalSkillsStore.getState().load('org-1');

    expect(usePracticalSkillsStore.getState()).toMatchObject({
      method: PracticalSkillsMethod.SHIFT_SIGNOFFS,
      organizationId: 'org-1',
    });
  });

  // Every navigation surface mounts together; one request answers them all.
  it('shares one request between callers that arrive together', async () => {
    mockGetConfig.mockResolvedValue({ practical_skills_method: 'skills_testing' });
    const { load } = usePracticalSkillsStore.getState();

    await Promise.all([load('org-1'), load('org-1'), load('org-1')]);
    await load('org-1');

    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it('reloads for a different department', async () => {
    mockGetConfig.mockResolvedValue({ practical_skills_method: 'skills_testing' });
    await usePracticalSkillsStore.getState().load('org-1');
    mockGetConfig.mockResolvedValue({ practical_skills_method: 'shift_signoffs' });

    await usePracticalSkillsStore.getState().load('org-2');

    expect(usePracticalSkillsStore.getState().method).toBe(PracticalSkillsMethod.SHIFT_SIGNOFFS);
  });

  it('reads an unrecognised value as Skills Testing, as the server does', async () => {
    mockGetConfig.mockResolvedValue({ practical_skills_method: 'both' });

    await usePracticalSkillsStore.getState().load('org-1');

    expect(usePracticalSkillsStore.getState().method).toBe(PracticalSkillsMethod.SKILLS_TESTING);
  });

  // An unknown answer shows both systems rather than hiding one the
  // department may be running.
  it('stays unknown when the lookup fails', async () => {
    mockGetConfig.mockRejectedValue(new Error('offline'));

    await usePracticalSkillsStore.getState().load('org-1');

    expect(usePracticalSkillsStore.getState().method).toBeNull();
    expect(offersSkillsTesting(null)).toBe(true);
    expect(offersShiftSignoffs(null)).toBe(true);
  });

  it('offers exactly one system once the choice is known', () => {
    expect(offersSkillsTesting(PracticalSkillsMethod.SKILLS_TESTING)).toBe(true);
    expect(offersShiftSignoffs(PracticalSkillsMethod.SKILLS_TESTING)).toBe(false);
    expect(offersSkillsTesting(PracticalSkillsMethod.SHIFT_SIGNOFFS)).toBe(false);
    expect(offersShiftSignoffs(PracticalSkillsMethod.SHIFT_SIGNOFFS)).toBe(true);
  });
});

// The command palette reads the method on every page, and the server refuses
// the setting while Training is off, so a department without Training drew a
// 403 on each one. The palette passes the module check in as `enabled`.
describe('usePracticalSkillsMethod', () => {
  beforeEach(() => {
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue({ practical_skills_method: 'skills_testing' });
    usePracticalSkillsStore.setState({ method: null, organizationId: null });
    useAuthStore.setState({ user: { organization_id: 'org-1' } as CurrentUser });
  });

  it('does not ask when its caller says the Training module is off', async () => {
    const { result } = renderHook(() => usePracticalSkillsMethod(false));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockGetConfig).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('asks by default, and once its caller says Training is on', async () => {
    const { rerender } = renderHook(({ on }: { on: boolean }) => usePracticalSkillsMethod(on), {
      initialProps: { on: false },
    });
    expect(mockGetConfig).not.toHaveBeenCalled();

    rerender({ on: true });

    await vi.waitFor(() => expect(mockGetConfig).toHaveBeenCalledTimes(1));
  });
});
