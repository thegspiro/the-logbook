import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { ActiveChecklistRecord } from '../services/equipmentCheckApi';
import type { ShiftEquipmentCheckRecord } from '../../../modules/inventory/types/equipmentCheck';

const mockGetMyChecklists = vi.fn();
const mockGetHistory = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getMyChecklists: (...a: unknown[]) => mockGetMyChecklists(...a) as unknown,
    getMyChecklistHistory: (...a: unknown[]) => mockGetHistory(...a) as unknown,
    getEquipmentCheckTemplate: vi.fn(),
    getEquipmentCheckTemplates: vi.fn().mockResolvedValue([]),
    getEquipmentCheck: vi.fn(),
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: (p: string) => mockCheckPermission(p) as unknown }),
}));

import { MyChecklistsPage } from './MyChecklistsPage';

function makeChecklist(overrides: Partial<ActiveChecklistRecord> = {}): ActiveChecklistRecord {
  return {
    shiftId: 'shift-1',
    shiftDate: '2026-10-16',
    apparatusName: 'E1',
    templateId: 'tmpl-1',
    templateName: 'Engine Daily Check',
    checkTiming: 'start_of_shift',
    status: 'not_started',
    totalItems: 24,
    completedItems: 0,
    ...overrides,
  };
}

function makeRecord(overrides: Partial<ShiftEquipmentCheckRecord> = {}): ShiftEquipmentCheckRecord {
  return {
    id: 'rec-1',
    organizationId: 'org-1',
    templateId: 'tmpl-1',
    checkedByName: 'Kelly Moreno',
    checkedAt: '2026-10-15T11:10:00Z',
    checkTiming: 'start_of_shift',
    overallStatus: 'pass',
    totalItems: 24,
    completedItems: 24,
    failedItems: 0,
    items: [],
    ...overrides,
  };
}

const headings = (region: HTMLElement) =>
  within(region)
    .getAllByRole('heading', { level: 3 })
    .map((h) => h.textContent);

describe('MyChecklistsPage — phone layout', () => {
  beforeEach(() => {
    // Only Date is faked: "Today" depends on the clock, and faking timers
    // would stall the promise-driven loads and userEvent.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T14:00:00Z'));
    mockGetMyChecklists.mockReset();
    mockGetHistory.mockReset();
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(false);
    mockGetHistory.mockResolvedValue([]);
    mockGetMyChecklists.mockResolvedValue([
      makeChecklist({ shiftId: 's-3', shiftDate: '2026-10-19', apparatusName: 'T1', templateId: 'tmpl-3' }),
      makeChecklist({
        shiftId: 's-1',
        checkTiming: 'end_of_shift',
        templateId: 'tmpl-2',
        templateName: 'Engine Evening',
      }),
      makeChecklist({ shiftId: 's-1' }),
      makeChecklist({ shiftId: 's-2', shiftDate: '2026-10-17' }),
    ]);
    window.history.replaceState({}, '', '/inventory/checklists/my');
  });

  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  it('heads each day once, soonest first, with the start-of-shift check before the end', async () => {
    renderWithRouter(<MyChecklistsPage />);
    await screen.findAllByText('Engine Daily Check');

    const due = screen.getByRole('region', { name: 'Due now and coming up' });
    expect(headings(due)).toEqual(['Today', 'Tomorrow', 'Mon, Oct 19']);
    const today = within(due).getByRole('region', { name: 'Today' });
    expect(
      within(today)
        .getAllByRole('listitem')
        .map((row) => row.textContent)
    ).toEqual([expect.stringContaining('Engine Daily Check'), expect.stringContaining('Engine Evening')]);
  });

  it('marks a past day that still holds an unfiled check as overdue', async () => {
    mockGetMyChecklists.mockResolvedValue([
      makeChecklist({ shiftId: 's-0', shiftDate: '2026-10-14' }),
      makeChecklist({ shiftId: 's-x', shiftDate: '2026-10-15', status: 'pass', completedItems: 24 }),
    ]);
    renderWithRouter(<MyChecklistsPage />);
    await screen.findByText('Submitted for this shift');

    expect(screen.getByRole('region', { name: 'Wed, Oct 14' })).toHaveTextContent('overdue');
    // Everything on that day was filed, so nothing is overdue.
    expect(screen.getByRole('region', { name: 'Yesterday' })).not.toHaveTextContent('overdue');
  });

  it('brings the day of a shift opened from the drawer to the top', async () => {
    window.history.replaceState({}, '', '/inventory/checklists/my?shift=s-3');
    renderWithRouter(<MyChecklistsPage />);
    await screen.findAllByText('Engine Daily Check');

    const due = screen.getByRole('region', { name: 'Due now and coming up' });
    expect(headings(due)[0]).toBe('Mon, Oct 19');
  });

  // Every row carries its own Start/End badge, so a filter over a handful of
  // checks only cost a row of screen.
  it('offers no start/end filter', async () => {
    renderWithRouter(<MyChecklistsPage />);
    await screen.findAllByText('Engine Daily Check');
    expect(screen.queryByRole('button', { name: 'Start of shift' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
  });

  it('shows how far a started check has got', async () => {
    mockGetMyChecklists.mockResolvedValue([makeChecklist({ status: 'in_progress', completedItems: 9, checkId: 'c' })]);
    renderWithRouter(<MyChecklistsPage />);

    expect(await screen.findByRole('progressbar', { name: '9 of 24 items checked' })).toBeInTheDocument();
    expect(screen.getByText('9 of 24')).toBeInTheDocument();
  });

  describe('the header menu', () => {
    it('holds apparatus inventory, and template management only for whoever may manage them', async () => {
      renderWithRouter(<MyChecklistsPage />);
      await screen.findAllByText('Engine Daily Check');

      const links = within(screen.getByTestId('checklist-header-menu')).getAllByRole('link', { hidden: true });
      expect(links.map((l) => l.getAttribute('href'))).toEqual(['/inventory/checklists/apparatus-inventory']);
    });

    it('adds template management for a checklist manager', async () => {
      mockCheckPermission.mockImplementation((p: string) => p === 'inventory.check_manage');
      renderWithRouter(<MyChecklistsPage />);
      await screen.findAllByText('Engine Daily Check');

      const links = within(screen.getByTestId('checklist-header-menu')).getAllByRole('link', { hidden: true });
      expect(links.map((l) => l.getAttribute('href'))).toEqual([
        '/inventory/checklists/apparatus-inventory',
        '/inventory/admin/checklists',
      ]);
    });
  });

  describe('completed checklists', () => {
    it('groups by the day it was checked and names what it can', async () => {
      mockGetHistory.mockResolvedValue([
        makeRecord(),
        makeRecord({
          id: 'rec-2',
          templateId: 'retired',
          checkTiming: 'end_of_shift',
          checkedAt: '2026-10-13T22:00:00Z',
          overallStatus: 'fail',
          completedItems: 22,
          failedItems: 2,
        }),
      ]);
      renderWithRouter(<MyChecklistsPage />);
      await screen.findAllByText('Engine Daily Check');
      await userEvent.click(screen.getByRole('button', { name: /Completed checklists/ }));

      const history = await screen.findByRole('region', { name: 'Yesterday' });
      // The name comes from a current checklist on the same template.
      expect(within(history).getByText('Engine Daily Check')).toBeInTheDocument();
      expect(within(history).getByText('Kelly Moreno')).toBeInTheDocument();

      // A template no longer among them falls back to its timing.
      const older = screen.getByRole('region', { name: 'Tue, Oct 13' });
      expect(within(older).getByText('End of shift check')).toBeInTheDocument();
      expect(within(older).getByText('2 failed')).toBeInTheDocument();
      expect(within(older).getByText('22 of 24 items')).toBeInTheDocument();
    });
  });
});
