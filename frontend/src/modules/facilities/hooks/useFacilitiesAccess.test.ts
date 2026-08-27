import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../../../stores/authStore';
import { useFacilitiesAccess } from './useFacilitiesAccess';

describe('useFacilitiesAccess permission contract', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { permissions: [] } as never });
  });

  it.each([
    {
      label: 'view only',
      permissions: ['facilities.view'],
      expected: { canManage: false, canCreate: false, canEdit: false, canDelete: false, canMaintenance: false },
    },
    {
      label: 'create only',
      permissions: ['facilities.view', 'facilities.create'],
      expected: { canManage: false, canCreate: true, canEdit: false, canDelete: false, canMaintenance: false },
    },
    {
      label: 'edit',
      permissions: ['facilities.view', 'facilities.edit'],
      expected: { canManage: false, canCreate: true, canEdit: true, canDelete: false, canMaintenance: true },
    },
    {
      label: 'maintenance',
      permissions: ['facilities.view', 'facilities.maintenance'],
      expected: { canManage: false, canCreate: false, canEdit: false, canDelete: false, canMaintenance: true },
    },
    {
      label: 'delete only',
      permissions: ['facilities.view', 'facilities.delete'],
      expected: { canManage: false, canCreate: false, canEdit: false, canDelete: true, canMaintenance: false },
    },
    {
      label: 'manage',
      permissions: ['facilities.manage'],
      expected: { canManage: true, canCreate: true, canEdit: true, canDelete: true, canMaintenance: true },
    },
  ])('maps $label permissions to the matching capabilities', ({ permissions, expected }) => {
    useAuthStore.setState({ user: { permissions } as never });

    const { result } = renderHook(() => useFacilitiesAccess());

    expect(result.current).toMatchObject(expected);
  });
});
