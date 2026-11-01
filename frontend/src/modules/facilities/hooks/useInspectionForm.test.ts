/**
 * Locks the create/update payload contract (CLAUDE.md pitfall #1) — see
 * `useMaintenanceForm.test.ts` for the reasoning. Inspections carry the same
 * shape: one payload builder for both modes, where a blank box must be omitted
 * on create and sent as an explicit null on edit.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Inspection } from '../types';

const getInspectionsPage = vi.fn();
const createInspection = vi.fn();
const updateInspection = vi.fn();

vi.mock('../../../services/api', () => ({
  facilitiesService: {
    getInspectionsPage: (...a: unknown[]) => getInspectionsPage(...a) as unknown,
    createInspection: (...a: unknown[]) => createInspection(...a) as unknown,
    updateInspection: (...a: unknown[]) => updateInspection(...a) as unknown,
    deleteInspection: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

import { useInspectionForm } from './useInspectionForm';

const existing: Inspection = {
  id: 'insp-1',
  facilityId: 'fac-1',
  inspectionType: 'routine',
  title: 'Annual fire-alarm certification',
  description: 'Panel and pull stations',
  inspectionDate: '2026-02-10',
  nextInspectionDate: '2027-02-10',
  passed: true,
  inspectorName: 'R. Alvarez',
  inspectorOrganization: 'County Fire Marshal',
  findings: 'Two devices replaced',
  correctiveActions: 'Replace zone 3 horn',
  correctiveActionDeadline: '2026-03-10',
  notes: 'Certificate filed',
} as Inspection;

/** Blank every clearable box, keeping only what the form requires. */
const cleared = {
  facility_id: 'fac-1',
  inspection_type: 'routine',
  title: 'Annual fire-alarm certification',
  description: '',
  inspection_date: '2026-02-10',
  next_inspection_date: '',
  inspector_name: '',
  inspector_organization: '',
  passed: 'true',
  findings: '',
  corrective_actions: '',
  corrective_action_deadline: '',
  notes: '',
};

describe('useInspectionForm payload contract', () => {
  beforeEach(() => {
    getInspectionsPage.mockReset();
    createInspection.mockReset();
    updateInspection.mockReset();
    getInspectionsPage.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 50 });
    createInspection.mockResolvedValue(existing);
    updateInspection.mockResolvedValue(existing);
  });

  it('sends an explicit null for every field the user cleared on edit', async () => {
    const { result } = renderHook(() => useInspectionForm({ facilityId: 'fac-1' }));

    await act(async () => {
      result.current.openEdit(existing);
    });
    await act(async () => {
      result.current.setFormData(cleared);
    });
    await act(async () => {
      await result.current.handleSave();
    });

    expect(updateInspection).toHaveBeenCalledTimes(1);
    const payload = updateInspection.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      description: null,
      next_inspection_date: null,
      inspector_name: null,
      inspector_organization: null,
      findings: null,
      corrective_actions: null,
      corrective_action_deadline: null,
      notes: null,
    });
  });

  it('keeps the NOT NULL columns as values on edit', async () => {
    const { result } = renderHook(() => useInspectionForm({ facilityId: 'fac-1' }));

    await act(async () => {
      result.current.openEdit(existing);
    });
    await act(async () => {
      result.current.setFormData(cleared);
    });
    await act(async () => {
      await result.current.handleSave();
    });

    const payload = updateInspection.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      inspection_type: 'routine',
      title: 'Annual fire-alarm certification',
      inspection_date: '2026-02-10',
    });
  });

  it('omits blank optional fields on create, so "" never reaches a validator', async () => {
    const { result } = renderHook(() => useInspectionForm({ facilityId: 'fac-1' }));

    await act(async () => {
      result.current.openCreate('fac-1');
    });
    await act(async () => {
      result.current.setFormData(cleared);
    });
    await act(async () => {
      await result.current.handleSave();
    });

    expect(createInspection).toHaveBeenCalledTimes(1);
    const payload = createInspection.mock.calls[0]?.[0] as Record<string, unknown>;
    for (const key of [
      'description',
      'next_inspection_date',
      'inspector_name',
      'inspector_organization',
      'findings',
      'corrective_actions',
      'corrective_action_deadline',
      'notes',
    ]) {
      expect(payload[key], `${key} must be omitted on create, not nulled`).toBeUndefined();
    }
  });
});

describe('useInspectionForm paging (FAC2-5)', () => {
  beforeEach(() => {
    getInspectionsPage.mockReset();
    getInspectionsPage.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 50 });
  });

  it.each(['passed', 'failed', 'pending'] as const)('asks the server for %s inspections', async (filter) => {
    const { result } = renderHook(() => useInspectionForm());

    await act(async () => {
      result.current.setResultFilter(filter);
    });

    expect(getInspectionsPage).toHaveBeenLastCalledWith({ result: filter, skip: 0, limit: 50 });
  });

  it('sends the search to the server', async () => {
    const { result } = renderHook(() => useInspectionForm({ facilityId: 'fac-1' }));

    await act(async () => {
      result.current.setSearchQuery('marshal');
    });

    await waitFor(() =>
      expect(getInspectionsPage).toHaveBeenLastCalledWith({
        facility_id: 'fac-1',
        search: 'marshal',
        skip: 0,
        limit: 50,
      })
    );
  });

  // The dashboard's "Upcoming inspections" tile counts a window the server
  // computes on the department's calendar, so the window goes to the server
  // rather than being re-derived from the rows on the page.
  it('asks the server for the due window and lists what it returns', async () => {
    const due = { ...existing, id: 'insp-due', nextInspectionDate: '2026-11-15', passed: null };
    getInspectionsPage.mockResolvedValue({ items: [due], total: 1, skip: 0, limit: 50 });

    const { result } = renderHook(() => useInspectionForm({ dueWithinDays: 30 }));

    await waitFor(() => expect(result.current.inspections).toEqual([due]));
    expect(getInspectionsPage).toHaveBeenLastCalledWith({ due_within_days: 30, skip: 0, limit: 50 });
    expect(result.current.total).toBe(1);
  });

  it('sends no due window when none is asked for', async () => {
    renderHook(() => useInspectionForm());

    await waitFor(() => expect(getInspectionsPage).toHaveBeenCalled());
    expect(getInspectionsPage).toHaveBeenLastCalledWith({ skip: 0, limit: 50 });
  });
});
