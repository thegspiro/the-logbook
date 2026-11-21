/**
 * AP2-10: the Maintenance, Fuel Logs and Equipment tabs offer only what the
 * backend lets the signed-in member do. Each button used to show for anyone
 * who could open the apparatus, so a view-only member filled a form and was
 * refused at the end, and an editor was offered deletes only a manager may do.
 *
 * Backend gates: maintenance and fuel records take apparatus.maintenance,
 * .edit or .manage; equipment takes .edit or .manage; every delete takes
 * .manage alone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import type { ApparatusEquipment, ApparatusMaintenance } from '../types';

let grantedPermissions = new Set<string>();

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: (permission: string) => boolean }) => unknown) =>
    selector({ checkPermission: (permission) => grantedPermissions.has(permission) }),
}));

vi.mock('../services/api', () => ({
  apparatusEquipmentService: { deleteEquipment: vi.fn() },
  apparatusMaintenanceService: { deleteMaintenanceRecord: vi.fn() },
}));

import { EquipmentTab } from './EquipmentTab';
import { FuelLogsTab } from './FuelLogsTab';
import { MaintenanceTab } from './MaintenanceTab';

const record: ApparatusMaintenance = {
  id: 'm-1',
  organizationId: 'org-1',
  apparatusId: 'a-1',
  maintenanceTypeId: 'mt-1',
  scheduledDate: null,
  dueDate: '2026-12-01',
  completedDate: null,
  completedBy: null,
  performedBy: null,
  isCompleted: false,
  isOverdue: false,
  description: null,
  workPerformed: null,
  findings: null,
  mileageAtService: null,
  hoursAtService: null,
  cost: null,
  vendor: null,
  invoiceNumber: null,
  nextDueDate: null,
  nextDueMileage: null,
  nextDueHours: null,
  notes: null,
  createdBy: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};

const item: ApparatusEquipment = {
  id: 'e-1',
  organizationId: 'org-1',
  apparatusId: 'a-1',
  inventoryItemId: null,
  name: 'Halligan',
  description: null,
  quantity: 1,
  locationOnApparatus: null,
  isMounted: false,
  isRequired: false,
  serialNumber: null,
  assetTag: null,
  isPresent: true,
  notes: null,
  assignedBy: null,
  assignedAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};

const renderMaintenance = () =>
  renderWithRouter(
    <MaintenanceTab
      maintenanceRecords={[record]}
      loadingTab={false}
      timezone="America/New_York"
      apparatusId="a-1"
      onRefresh={vi.fn()}
    />
  );

const renderFuel = () =>
  renderWithRouter(
    <FuelLogsTab fuelLogs={[]} loadingTab={false} timezone="America/New_York" apparatusId="a-1" onRefresh={vi.fn()} />
  );

const renderEquipment = () =>
  renderWithRouter(<EquipmentTab equipment={[item]} loadingTab={false} apparatusId="a-1" onRefresh={vi.fn()} />);

describe('apparatus tabs offer only what the backend allows', () => {
  beforeEach(() => {
    grantedPermissions = new Set();
  });

  it('offers a view-only member no add, edit or delete', () => {
    grantedPermissions = new Set(['apparatus.view']);
    renderMaintenance();
    renderFuel();
    renderEquipment();

    for (const name of [
      'Add Record',
      'Edit record',
      'Delete record',
      'Add Fuel Log',
      'Add Equipment',
      'Edit equipment',
      'Remove equipment',
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('lets a maintenance member record work and fuel, but not delete or edit equipment', () => {
    grantedPermissions = new Set(['apparatus.view', 'apparatus.maintenance']);
    renderMaintenance();
    renderFuel();
    renderEquipment();

    expect(screen.getByRole('button', { name: 'Add Record' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit record' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Fuel Log' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete record' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Equipment' })).not.toBeInTheDocument();
  });

  it('lets an editor add and edit equipment but not remove it', () => {
    grantedPermissions = new Set(['apparatus.view', 'apparatus.edit']);
    renderEquipment();

    expect(screen.getByRole('button', { name: 'Add Equipment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit equipment' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove equipment' })).not.toBeInTheDocument();
  });

  it('offers a manager every control, deletes included', () => {
    grantedPermissions = new Set(['apparatus.view', 'apparatus.manage']);
    renderMaintenance();
    renderEquipment();

    expect(screen.getByRole('button', { name: 'Delete record' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove equipment' })).toBeInTheDocument();
  });
});
