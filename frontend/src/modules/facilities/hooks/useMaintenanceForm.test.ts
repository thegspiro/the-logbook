/**
 * Locks the create/update payload contract (CLAUDE.md pitfall #1) and the
 * server-side status filter, search and paging (FAC2-5).
 *
 * The hook builds one payload for both modes, so the mode is the only thing
 * deciding what a blank box means: omitted on create so `""` never reaches a
 * Pydantic validator, an explicit null on edit so the backend's `apply_updates`
 * writes the clear through instead of leaving the old value behind a success
 * toast.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaintenanceRecord } from '../types';

const getMaintenancePage = vi.fn();
const getMaintenanceTypes = vi.fn();
const createMaintenanceRecord = vi.fn();
const updateMaintenanceRecord = vi.fn();

vi.mock('../../../services/api', () => ({
  facilitiesService: {
    getMaintenancePage: (...a: unknown[]) => getMaintenancePage(...a) as unknown,
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

/** Blank every optional box, as a user clearing the fields would. The type is
 *  required, so it stays chosen. */
const cleared = {
  facility_id: 'fac-1',
  maintenance_type_id: 'type-1',
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
    getMaintenancePage.mockReset();
    getMaintenanceTypes.mockReset();
    createMaintenanceRecord.mockReset();
    updateMaintenanceRecord.mockReset();
    getMaintenancePage.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 50 });
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

  // The column is NOT NULL, so a blank type is refused before anything is
  // sent: nulling it would be rejected by the server, and omitting it on
  // create was refused there with a message the form never showed.
  it.each(['create', 'edit'] as const)('sends nothing on %s while the maintenance type is blank', async (mode) => {
    const { result } = renderHook(() => useMaintenanceForm({ facilityId: 'fac-1' }));

    await act(async () => {
      if (mode === 'create') result.current.openCreate('fac-1');
      else result.current.openEdit(existing);
    });
    await act(async () => {
      result.current.setFormData({ ...cleared, maintenance_type_id: '' });
    });
    await act(async () => {
      await result.current.handleSave();
    });

    expect(createMaintenanceRecord).not.toHaveBeenCalled();
    expect(updateMaintenanceRecord).not.toHaveBeenCalled();
  });

  it.each([
    { filter: 'overdue' as const, expected: { facility_id: 'fac-1', is_overdue: true, skip: 0, limit: 50 } },
    { filter: 'completed' as const, expected: { facility_id: 'fac-1', is_completed: true, skip: 0, limit: 50 } },
    { filter: 'pending' as const, expected: { facility_id: 'fac-1', is_completed: false, skip: 0, limit: 50 } },
    { filter: 'all' as const, expected: { facility_id: 'fac-1', skip: 0, limit: 50 } },
  ])('asks the server for the $filter records rather than filtering a loaded page', async ({ filter, expected }) => {
    const { result } = renderHook(() => useMaintenanceForm({ facilityId: 'fac-1' }));

    await act(async () => {
      result.current.setStatusFilter(filter);
    });

    expect(getMaintenancePage).toHaveBeenLastCalledWith(expected);
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

describe('useMaintenanceForm paging (FAC2-5)', () => {
  beforeEach(() => {
    getMaintenancePage.mockReset();
    getMaintenanceTypes.mockReset();
    getMaintenanceTypes.mockResolvedValue([]);
    getMaintenancePage.mockResolvedValue({ items: [existing], total: 120, skip: 0, limit: 50 });
  });

  it('reports the server total and asks for the page it is on', async () => {
    const { result } = renderHook(() => useMaintenanceForm());
    await waitFor(() => expect(result.current.total).toBe(120));

    await act(async () => {
      result.current.setPage(3);
    });

    expect(getMaintenancePage).toHaveBeenLastCalledWith({ skip: 100, limit: 50 });
  });

  it('sends the search to the server and goes back to the first page', async () => {
    const { result } = renderHook(() => useMaintenanceForm());
    await act(async () => {
      result.current.setPage(2);
    });

    await act(async () => {
      result.current.setSearchQuery('  acme ');
    });

    await waitFor(() => expect(getMaintenancePage).toHaveBeenLastCalledWith({ search: 'acme', skip: 0, limit: 50 }));
    expect(result.current.page).toBe(1);
  });

  it('a filter change goes back to the first page', async () => {
    const { result } = renderHook(() => useMaintenanceForm());
    await act(async () => {
      result.current.setPage(2);
    });

    await act(async () => {
      result.current.setStatusFilter('overdue');
    });

    expect(getMaintenancePage).toHaveBeenLastCalledWith({ is_overdue: true, skip: 0, limit: 50 });
    expect(getMaintenancePage).not.toHaveBeenCalledWith({ is_overdue: true, skip: 50, limit: 50 });
  });
});
