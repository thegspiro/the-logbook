import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockGetRoles = vi.fn();
const mockGetPermissions = vi.fn();
const mockGetUsers = vi.fn();

vi.mock('../../../services/api', () => ({
  roleService: {
    getRoles: (...args: unknown[]) => mockGetRoles(...args) as unknown,
    getPermissions: (...args: unknown[]) => mockGetPermissions(...args) as unknown,
  },
  userService: { getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown },
}));

import { useApproverOptions } from './useApproverOptions';

describe('useApproverOptions — members', () => {
  beforeEach(() => {
    mockGetRoles.mockReset();
    mockGetRoles.mockResolvedValue([]);
    mockGetPermissions.mockReset();
    mockGetPermissions.mockResolvedValue([]);
    mockGetUsers.mockReset();
    mockGetUsers.mockResolvedValue([
      { id: 'u1', username: 'sortiz', first_name: 'Sam', last_name: 'Ortiz', status: 'active' },
      { id: 'u2', username: 'dreyes', first_name: 'Dana', last_name: 'Reyes', status: 'probationary' },
      { id: 'u3', username: 'lpark', first_name: 'Lee', last_name: 'Park', status: 'retired' },
    ]);
  });

  it('keeps every member, so a stored approver still reads by name, and marks the former ones', async () => {
    const { result } = renderHook(() => useApproverOptions());

    await waitFor(() => expect(result.current.users).not.toBeNull());
    expect(result.current.users).toEqual([
      { value: 'u2', label: 'Dana Reyes', former: false },
      { value: 'u3', label: 'Lee Park', former: true },
      { value: 'u1', label: 'Sam Ortiz', former: false },
    ]);
  });
});
