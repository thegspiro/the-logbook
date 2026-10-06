import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../contexts/ConfirmContext';

const skillsPendingCount = vi.fn<() => Promise<number>>();
const drainSkillsTests = vi.fn<() => Promise<void>>();

vi.mock('../utils/skillsTestOffline', () => ({
  skillsPendingCount: () => skillsPendingCount(),
}));
vi.mock('./useOfflineSyncEngine', () => ({
  drainSkillsTests: () => drainSkillsTests(),
}));

import { useSkillsLogoutGuard } from './useSkillsLogoutGuard';

const wrapper = ({ children }: { children: React.ReactNode }) => <ConfirmProvider>{children}</ConfirmProvider>;

const setOnline = (online: boolean) =>
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });

describe('useSkillsLogoutGuard', () => {
  beforeEach(() => {
    skillsPendingCount.mockReset();
    drainSkillsTests.mockReset();
    drainSkillsTests.mockResolvedValue(undefined);
    setOnline(true);
  });

  it('lets sign-out through when nothing is waiting', async () => {
    skillsPendingCount.mockResolvedValue(0);
    const { result } = renderHook(() => useSkillsLogoutGuard(), { wrapper });
    await expect(result.current()).resolves.toBe(true);
    expect(drainSkillsTests).not.toHaveBeenCalled();
  });

  it('sends waiting evaluations first when there is signal', async () => {
    skillsPendingCount.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    const { result } = renderHook(() => useSkillsLogoutGuard(), { wrapper });
    await expect(result.current()).resolves.toBe(true);
    expect(drainSkillsTests).toHaveBeenCalled();
  });

  it('blocks sign-out behind a warning when evaluations cannot be sent', async () => {
    setOnline(false);
    skillsPendingCount.mockResolvedValue(1);
    const user = userEvent.setup();
    const { result } = renderHook(() => useSkillsLogoutGuard(), { wrapper });

    let decision: Promise<boolean> = Promise.resolve(true);
    act(() => {
      decision = result.current();
    });
    expect(
      await screen.findByText(/1 skills evaluation scored on this device has not reached the server/)
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay signed in' }));
    await expect(decision).resolves.toBe(false);
    expect(drainSkillsTests).not.toHaveBeenCalled();
  });

  it('signs out only on an explicit choice to delete', async () => {
    setOnline(false);
    skillsPendingCount.mockResolvedValue(3);
    const user = userEvent.setup();
    const { result } = renderHook(() => useSkillsLogoutGuard(), { wrapper });

    let decision: Promise<boolean> = Promise.resolve(false);
    act(() => {
      decision = result.current();
    });
    await user.click(await screen.findByRole('button', { name: 'Sign out and delete' }));
    await expect(decision).resolves.toBe(true);
  });
});
