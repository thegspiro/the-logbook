import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { Apparatus, ApparatusStatus } from '../types';

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

// A failed equipment check puts "Deficiency" on the rig, but the failure itself
// is only on Check reports, and logging the repair does not clear the badge.
// The page said none of that, so a chief saw the badge and a dead end.
describe('ApparatusDetailHeader deficiency and status reason', () => {
  beforeEach(() => {
    grantedPermissions = new Set();
  });

  const deficient = {
    ...apparatus,
    hasDeficiency: true,
    deficiencySince: '2026-08-14T12:00:00Z',
  } as Apparatus;

  it('explains what the Deficiency badge means and how it clears', () => {
    renderWithRouter(
      <ApparatusDetailHeader currentApparatus={deficient} status={undefined} id={apparatus.id} isArchived={false} />
    );
    expect(screen.getByText(/An equipment check on this apparatus found a problem/)).toBeInTheDocument();
    expect(
      screen.getByText(/clears when the next check passes; logging a repair does not clear it/)
    ).toBeInTheDocument();
  });

  it('links someone who can view checks to the failure, from the day it was found', () => {
    grantedPermissions.add('inventory.check_view');
    renderWithRouter(
      <ApparatusDetailHeader currentApparatus={deficient} status={undefined} id={apparatus.id} isArchived={false} />
    );
    const link = screen.getByRole('link', { name: /See what was found/ });
    expect(link.getAttribute('href')).toMatch(
      /^\/inventory\/admin\/checklists\/reports\?tab=failures&from=2026-08-1[34]$/
    );
  });

  it('offers no link to someone the reports page would refuse', () => {
    grantedPermissions.add('apparatus.view');
    renderWithRouter(
      <ApparatusDetailHeader currentApparatus={deficient} status={undefined} id={apparatus.id} isArchived={false} />
    );
    expect(screen.queryByRole('link', { name: /See what was found/ })).not.toBeInTheDocument();
  });

  it('says nothing about deficiencies on a rig that has none', () => {
    renderWithRouter(
      <ApparatusDetailHeader currentApparatus={apparatus} status={undefined} id={apparatus.id} isArchived={false} />
    );
    expect(screen.queryByText(/found a problem/)).not.toBeInTheDocument();
  });

  const outOfService: ApparatusStatus = {
    id: 'st-oos',
    organizationId: null,
    name: 'Out of Service',
    code: 'out_of_service',
    description: null,
    isSystem: true,
    defaultStatus: 'out_of_service',
    isAvailable: false,
    isOperational: false,
    requiresReason: true,
    isArchivedStatus: false,
    color: null,
    icon: null,
    sortOrder: 2,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('shows why the rig has its status', () => {
    renderWithRouter(
      <ApparatusDetailHeader
        currentApparatus={{ ...apparatus, statusReason: 'Pump seal leaking' }}
        status={outOfService}
        id={apparatus.id}
        isArchived={false}
      />
    );
    expect(screen.getByText('Out of Service:')).toBeInTheDocument();
    expect(screen.getByText(/Pump seal leaking/)).toBeInTheDocument();
  });
});
