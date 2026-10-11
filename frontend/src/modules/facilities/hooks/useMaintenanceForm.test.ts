/**
 * Locks the create/update payload contract (CLAUDE.md pitfall #1) and the
 * server-side status filter.
 *
 * The hook builds one payload for both modes, so the mode is the only thing
 * deciding what a blank box means: omitted on create so `""` never reaches a
 * Pydantic validator, an explicit null on edit so the backend's `apply_updates`
 * writes the clear through instead of leaving the old value behind a success
 * toast.
 */
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaintenanceRecord } from '../types';

const getMaintenanceRecords = vi.fn();
const getMaintenanceTypes = vi.fn();
const createMaintenanceRecord = vi.fn();
const updateMaintenanceRecord = vi.fn();

vi.mock('../../../services/api', () => ({
  facilitiesService: {
    getMaintenanceRecords: (...a: unknown[]) => getMaintenanceRecords(...a) as unknown,
    getMaintenanceTypes: (...a: unknown[]) => getMaintenanceTypes(...a) as unknown,
    createMaintenanceRecord: (...a: unknown[]) => createMaintenanceRecord(...a) as unknown,
    updateMaintenanceRecord: (...a: unknown[]) => updateMaintenanceRecord(...a) as unknown,
    deleteMaintenanceRecord: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

import { useMaintenanceForm } from './useMaintenanceForm';

const existing: MaintenanceRecord = {
  id: 'rec-1',
  facilityId: 'fac-1',
  maintenanceTypeId: 'type-1',
  description: 'Quarterly generator service',
  scheduledDate: '2026-03-01',
  dueDate: '2026-03-15',
  performedBy: 'R. Alvarez',
  cost: 420.5,
  vendor: 'Acme Generators',
  workOrderNumber: 'WO-5512',
  notes: 'Bring the spare filter',
} as MaintenanceRecord;

/** Blank every optional box, as a user clearing the fields would. */
const cleared = {
  facility_id: 'fac-1',
  maintenance_type_id: '',
  description: 'Quarterly generator service',
  scheduled_date: '',
  due_date: '',
  performed_by: '',
  cost: '',
  vendor: '',
  work_order_number: '',
  notes: '',
};

describe('useMaintenanceForm payload contract', () => {
  beforeEach(() => {
    getMaintenanceRecords.mockReset();
    getMaintenanceTypes.mockReset();
    createMaintenanceRecord.mockReset();
    updateMaintenanceRecord.mockReset();
    getMaintenanceRecords.mockResolvedValue([]);
    getMaintenanceTypes.mockResolvedValue([]);
    createMaintenanceRecord.mockResolvedValue(existing);
    updateMaintenanceRecord.mockResolvedValue(existing);
  });

  it('sends an explicit null for every field the user cleared on edit', async () => {
    const { result } = renderHook(() => useMaintenanceForm({ facilityId: 'fac-1' }));

    await act(async () => {
      result.current.openEdit(existing);
    });
    await act(async () => {
      result.current.setFormData(cleared);
    });
    await act(async () => {
      await result.current.handleSave();
    });

    expect(updateMaintenanceRecord).toHaveBeenCalledTimes(1);
    const payload = updateMaintenanceRecord.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      scheduled_date: null,
      due_date: null,
      performed_by: null,
      cost: null,
      vendor: null,
      work_order_number: null,
      notes: null,
    });
  });

  it('omits a blank maintenance_type_id rather than nulling a NOT NULL column', async () => {
    const { result } = renderHook(() => useMaintenanceForm({ facilityId: 'fac-1' }));

    await act(async () => {
      result.current.openEdit(existing);
    });
    await act(async () => {
      result.current.setFormData(cleared);
    });
    await act(async () => {
      await result.current.handleSave();
    });

    const payload = updateMaintenanceRecord.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.maintenance_type_id).toBeUndefined();
    expect(payload.maintenance_type_id).not.toBeNull();
  });

  it.each([
    { filter: 'overdue' as const, expected: { facility_id: 'fac-1', is_overdue: true } },
    { filter: 'completed' as const, expected: { facility_id: 'fac-1', is_completed: true } },
    { filter: 'pending' as const, expected: { facility_id: 'fac-1', is_completed: false } },
    { filter: 'all' as const, expected: { facility_id: 'fac-1' } },
  ])('asks the server for the $filter records rather than filtering a loaded page', async ({ filter, expected }) => {
    const { result } = renderHook(() => useMaintenanceForm({ facilityId: 'fac-1' }));

    await act(async () => {
      result.current.setStatusFilter(filter);
    });

    expect(getMaintenanceRecords).toHaveBeenLastCalledWith(expected);
  });

  it('omits blank optional fields on create, so "" never reaches a validator', async () => {
    const { result } = renderHook(() => useMaintenanceForm({ facilityId: 'fac-1' }));

    await act(async () => {
      result.current.openCreate('fac-1');
    });
    await act(async () => {
      result.current.setFormData({ ...cleared, description: 'New service' });
    });
    await act(async () => {
      await result.current.handleSave();
    });

    expect(createMaintenanceRecord).toHaveBeenCalledTimes(1);
    const payload = createMaintenanceRecord.mock.calls[0]?.[0] as Record<string, unknown>;
    for (const key of ['scheduled_date', 'due_date', 'performed_by', 'cost', 'vendor', 'work_order_number', 'notes']) {
      expect(payload[key], `${key} must be omitted on create, not nulled`).toBeUndefined();
    }
  });
});
