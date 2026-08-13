import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import type { Apparatus } from '../types';

let grantedPermissions = new Set<string>();

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: (permission: string) => boolean }) => unknown) =>
    selector({ checkPermission: (permission) => grantedPermissions.has(permission) }),
}));

import { ApparatusDetailHeader } from './ApparatusDetailHeader';

const apparatus = {
  id: 'apparatus-1',
  unitNumber: 'E-1',
  name: 'Engine 1',
  year: 2025,
  make: 'Pierce',
  model: 'Enforcer',
  hasDeficiency: false,
} as Apparatus;

describe('ApparatusDetailHeader permissions', () => {
  beforeEach(() => {
    grantedPermissions = new Set();
  });

  it('does not show mutation actions to a view-only member', () => {
    grantedPermissions.add('apparatus.view');

    renderWithRouter(
      <ApparatusDetailHeader currentApparatus={apparatus} status={undefined} id={apparatus.id} isArchived={false} />
    );

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('honors edit and manage as separate permissions', () => {
    grantedPermissions.add('apparatus.edit');
    const { unmount } = renderWithRouter(
      <ApparatusDetailHeader currentApparatus={apparatus} status={undefined} id={apparatus.id} isArchived={false} />
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();

    unmount();
    grantedPermissions = new Set(['apparatus.manage']);
    renderWithRouter(
      <ApparatusDetailHeader currentApparatus={apparatus} status={undefined} id={apparatus.id} isArchived={false} />
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });
});
