/**
 * EC2-13: opening an incomplete check from history titled it "Completed
 * checklist" beside an In Progress badge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import { MyChecklistsPage } from './MyChecklistsPage';

const mockGetHistory = vi.fn();
const mockGetCheck = vi.fn();

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getMyChecklists: vi.fn().mockResolvedValue([]),
    getMyChecklistHistory: (...a: unknown[]) => mockGetHistory(...a) as unknown,
    getEquipmentCheckTemplate: vi.fn(),
    getEquipmentCheckTemplates: vi.fn().mockResolvedValue([]),
    getEquipmentCheck: (...a: unknown[]) => mockGetCheck(...a) as unknown,
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

const record = {
  id: 'chk-1',
  shiftId: 'shift-1',
  templateId: 'tmpl-1',
  checkTiming: 'start_of_shift',
  checkedBy: 'user-1',
  checkedAt: '2026-11-20T14:00:00Z',
  overallStatus: 'incomplete',
  totalItems: 4,
  completedItems: 2,
  failedItems: 0,
  items: [],
};

describe('MyChecklistsPage opening an incomplete check', () => {
  beforeEach(() => {
    mockGetHistory.mockReset();
    mockGetHistory.mockResolvedValue([record]);
    mockGetCheck.mockReset();
    mockGetCheck.mockResolvedValue(record);
  });

  it('does not call it completed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MyChecklistsPage />);

    await user.click(await screen.findByRole('button', { name: /Completed checklists/ }));
    await user.click(await screen.findByRole('button', { name: /Start of shift|Equipment check/i }));

    expect(await screen.findByRole('heading', { name: 'Checklist in progress' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Completed checklist' })).not.toBeInTheDocument();
  });
});
