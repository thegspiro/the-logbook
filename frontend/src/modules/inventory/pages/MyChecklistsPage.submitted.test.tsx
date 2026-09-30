import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import { MyChecklistsPage } from './MyChecklistsPage';
import type { ActiveChecklistRecord } from '../services/equipmentCheckApi';

const mockGetMyChecklists = vi.fn();

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getMyChecklists: (...a: unknown[]) => mockGetMyChecklists(...a) as unknown,
    getMyChecklistHistory: vi.fn().mockResolvedValue([]),
    getEquipmentCheckTemplate: vi.fn(),
    getEquipmentCheckTemplates: vi.fn().mockResolvedValue([]),
    getEquipmentCheck: vi.fn(),
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/Chicago',
}));

function makeChecklist(overrides: Partial<ActiveChecklistRecord> = {}): ActiveChecklistRecord {
  return {
    shiftId: 'shift-1',
    shiftDate: '2026-09-29',
    apparatusName: 'E1',
    templateId: 'tmpl-1',
    templateName: 'Engine Daily Check',
    checkTiming: 'start_of_shift',
    status: 'not_started',
    totalItems: 4,
    completedItems: 0,
    ...overrides,
  };
}

describe('MyChecklistsPage — a shift check already filed', () => {
  beforeEach(() => {
    mockGetMyChecklists.mockReset();
  });

  // W46-2: a filed check still offered "Open checklist", which walked the
  // member through every item and then refused at Submit with a 409.
  it.each(['pass', 'fail', 'out_of_service'])('offers no way to file a second %s check', async (status) => {
    mockGetMyChecklists.mockResolvedValue([makeChecklist({ status, completedItems: 4 })]);
    renderWithRouter(<MyChecklistsPage />);

    expect(await screen.findByText('Submitted for this shift')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open checklist|continue checklist/i })).not.toBeInTheDocument();
  });

  it('still opens a check nobody has filed, and resumes one in progress', async () => {
    mockGetMyChecklists.mockResolvedValue([
      makeChecklist(),
      makeChecklist({ shiftId: 'shift-2', status: 'in_progress', completedItems: 2, checkId: 'chk-2' }),
    ]);
    renderWithRouter(<MyChecklistsPage />);

    expect(await screen.findByRole('button', { name: 'Open checklist' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue checklist' })).toBeInTheDocument();
    expect(screen.queryByText('Submitted for this shift')).not.toBeInTheDocument();
  });
});
