import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { ActiveChecklistRecord } from '../services/equipmentCheckApi';

const mockGetMyChecklists = vi.fn();
const mockGetTemplate = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: vi.fn(),
  }),
}));

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getMyChecklists: (...a: unknown[]) => mockGetMyChecklists(...a) as unknown,
    getMyChecklistHistory: vi.fn().mockResolvedValue([]),
    getEquipmentCheckTemplate: (...a: unknown[]) => mockGetTemplate(...a) as unknown,
    getEquipmentCheckTemplates: vi.fn().mockResolvedValue([]),
    getEquipmentCheck: vi.fn(),
  },
}));

// The form owns every outcome message — "submitted", "saved offline", "queued
// for sync". The stub stands in for whichever of those it showed and reports
// completion, which is all the page is told.
vi.mock('./EquipmentCheckForm', () => ({
  default: ({ onComplete }: { onComplete?: () => void }) => (
    <button type="button" onClick={() => onComplete?.()}>
      Finish stub check
    </button>
  ),
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

import { MyChecklistsPage } from './MyChecklistsPage';

function makeChecklist(overrides: Partial<ActiveChecklistRecord> = {}): ActiveChecklistRecord {
  return {
    shiftId: 'shift-1',
    shiftDate: '2026-10-03',
    apparatusName: 'E1',
    templateId: 'tmpl-1',
    templateName: 'Engine Morning Check',
    checkTiming: 'start_of_shift',
    status: 'not_started',
    totalItems: 4,
    completedItems: 0,
    ...overrides,
  };
}

describe('MyChecklistsPage — finishing a check', () => {
  beforeEach(() => {
    mockGetMyChecklists.mockReset();
    mockGetTemplate.mockReset();
    mockToastSuccess.mockReset();
    mockGetMyChecklists.mockResolvedValue([makeChecklist()]);
    mockGetTemplate.mockResolvedValue({ id: 'tmpl-1', name: 'Engine Morning Check', compartments: [] });
  });

  // The page used to add its own "Equipment check submitted" on top of the
  // form's message: two toasts for one tap online, and offline a claim that
  // the check was submitted beside the form's correct "saved offline".
  it('adds no message of its own when the form reports completion', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MyChecklistsPage />);

    await user.click(await screen.findByRole('button', { name: 'Open checklist' }));
    await user.click(await screen.findByRole('button', { name: 'Finish stub check' }));

    expect(await screen.findByText('Engine Morning Check')).toBeInTheDocument();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('returns to the refreshed list after the form completes', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MyChecklistsPage />);

    await user.click(await screen.findByRole('button', { name: 'Open checklist' }));
    mockGetMyChecklists.mockResolvedValue([makeChecklist({ status: 'fail', completedItems: 4 })]);
    await user.click(await screen.findByRole('button', { name: 'Finish stub check' }));

    expect(await screen.findByText('Submitted for this shift')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish stub check' })).not.toBeInTheDocument();
  });
});
