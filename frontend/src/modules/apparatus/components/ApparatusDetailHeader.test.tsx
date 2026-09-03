import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { Apparatus } from '../types';

let grantedPermissions = new Set<string>();

const mockArchiveApparatus = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../services/api', () => ({
  apparatusService: {
    archiveApparatus: (...args: unknown[]) => mockArchiveApparatus(...args) as unknown,
  },
}));

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

describe('ApparatusDetailHeader archive action', () => {
  beforeEach(() => {
    grantedPermissions = new Set(['apparatus.manage']);
    mockArchiveApparatus.mockReset();
    mockArchiveApparatus.mockResolvedValue({});
    mockNavigate.mockReset();
  });

  it('opens the archive form rather than navigating to the API path', async () => {
    // Archive used to navigate to /apparatus/:id/archive — the POST endpoint,
    // which matches no route, so it fell through to the dashboard and left the
    // apparatus in service. There is nothing to navigate to: archiving needs a
    // disposal record.
    const user = userEvent.setup();
    renderWithRouter(
      <ApparatusDetailHeader currentApparatus={apparatus} status={undefined} id={apparatus.id} isArchived={false} />
    );

    await user.click(screen.getByRole('button', { name: 'Archive' }));

    expect(await screen.findByRole('button', { name: 'Archive apparatus' })).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('posts the disposal record and reports back', async () => {
    const user = userEvent.setup();
    const onArchived = vi.fn();
    renderWithRouter(
      <ApparatusDetailHeader
        currentApparatus={apparatus}
        status={undefined}
        id={apparatus.id}
        isArchived={false}
        onArchived={onArchived}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByRole('button', { name: 'Archive apparatus' });
    await user.type(screen.getByLabelText('Reason'), 'Replaced by Engine 2');
    await user.click(screen.getByRole('button', { name: 'Archive apparatus' }));

    await waitFor(() =>
      expect(mockArchiveApparatus).toHaveBeenCalledWith('apparatus-1', {
        disposalMethod: 'sold',
        disposalReason: 'Replaced by Engine 2',
      })
    );
    expect(onArchived).toHaveBeenCalled();
  });

  it('leaves sale fields out for a truck that was scrapped', async () => {
    // Filing a buyer against a scrapped truck writes a record nobody can
    // explain later, so the sale block is hidden and its values are dropped.
    const user = userEvent.setup();
    renderWithRouter(
      <ApparatusDetailHeader currentApparatus={apparatus} status={undefined} id={apparatus.id} isArchived={false} />
    );

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByRole('button', { name: 'Archive apparatus' });
    await user.type(screen.getByLabelText('Buyer'), 'County Auction');
    await user.selectOptions(screen.getByLabelText('Disposal Method *'), 'scrapped');

    expect(screen.queryByLabelText('Buyer')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Archive apparatus' }));

    await waitFor(() =>
      expect(mockArchiveApparatus).toHaveBeenCalledWith('apparatus-1', { disposalMethod: 'scrapped' })
    );
  });
});
