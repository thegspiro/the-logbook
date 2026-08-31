import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import { CheckLogPage } from './CheckLogPage';
import type { CheckLogEntry, CheckLogResponse } from '../../../modules/inventory/types/equipmentCheck';

const mockGetCheckLog = vi.fn();

// Equipment-check calls moved to modules/inventory when checklists
// became an Inventory feature; the scheduling service re-exports it.
vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getCheckLog: (...a: unknown[]) => mockGetCheckLog(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('../../../hooks/useRegisterPullToRefresh', () => ({
  useRegisterPullToRefresh: () => undefined,
}));

function makeEntry(overrides: Partial<CheckLogEntry> = {}): CheckLogEntry {
  return {
    shiftId: 's-1',
    shiftDate: '2026-08-15',
    apparatusId: 'a-1',
    unitLabel: 'E-1',
    templateId: 't-1',
    templateName: 'Engine Daily Check',
    checkTiming: 'start_of_shift',
    status: 'passed',
    checkId: 'chk-1',
    checkedAt: '2026-08-15T11:12:00Z',
    checkedByName: 'Kelly Moreno',
    totalItems: 9,
    completedItems: 9,
    failedItems: 0,
    findingCount: 0,
    findings: [],
    ...overrides,
  };
}

function makeResponse(overrides: Partial<CheckLogResponse> = {}): CheckLogResponse {
  return {
    windowDates: 14,
    dates: ['2026-08-15', '2026-08-16'],
    scope: 'fleet',
    rows: [
      {
        apparatusId: 'a-1',
        unitLabel: 'E-1',
        apparatusType: 'engine',
        cells: [
          {
            date: '2026-08-15',
            status: 'passed',
            checks: [
              {
                checkId: 'chk-1',
                templateName: 'Engine Daily Check',
                checkTiming: 'start_of_shift',
                status: 'passed',
                findingCount: 0,
              },
            ],
          },
          { date: '2026-08-16', status: null, checks: [] },
        ],
        expected: 1,
        completed: 1,
        completionRate: 100,
      },
    ],
    entries: [makeEntry()],
    summary: {
      expected: 1,
      completed: 1,
      completionRate: 100,
      missed: 0,
      withFindings: 0,
      outOfServiceDays: 0,
    },
    ...overrides,
  };
}

describe('CheckLogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCheckLog.mockResolvedValue(makeResponse());
  });

  it('opens on the grid for a fleet-scoped caller', async () => {
    renderWithRouter(<CheckLogPage />);
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'E-1' })).toHaveAttribute('href', '/inventory/checklists/apparatus/a-1');
  });

  it('withholds the grid from a member scoped to their own checks', async () => {
    // A matrix built from one member's checks would be read as fleet coverage.
    mockGetCheckLog.mockResolvedValue(makeResponse({ scope: 'own', rows: [] }));
    renderWithRouter(<CheckLogPage />);
    await screen.findByText('Engine Daily Check');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Grid/ })).not.toBeInTheDocument();
  });

  it('describes a member-scoped log as their own checks', async () => {
    mockGetCheckLog.mockResolvedValue(makeResponse({ scope: 'own', rows: [] }));
    renderWithRouter(<CheckLogPage />);
    expect(await screen.findByText('Checks you performed')).toBeInTheDocument();
  });

  it('shows a missed check as a row of its own', async () => {
    // The entire reason for the expected-vs-actual query: a check that never
    // happened has no record, so without this it would simply be absent.
    mockGetCheckLog.mockResolvedValue(
      makeResponse({
        entries: [
          makeEntry({
            status: 'missed',
            // The server sends no checkId for a check that never happened.
            checkId: undefined,
            checkedAt: undefined,
            checkedByName: undefined,
            totalItems: undefined,
            completedItems: undefined,
          }),
        ],
        summary: {
          expected: 1,
          completed: 0,
          completionRate: 0,
          missed: 1,
          withFindings: 0,
          outOfServiceDays: 0,
        },
      })
    );
    renderWithRouter(<CheckLogPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Log/ }));
    expect(screen.getByText('Missed')).toBeInTheDocument();
    expect(screen.getByText(/nobody submitted this check/)).toBeInTheDocument();
  });

  it('lists what a failing check found', async () => {
    mockGetCheckLog.mockResolvedValue(
      makeResponse({
        entries: [
          makeEntry({
            status: 'failed',
            failedItems: 1,
            findingCount: 1,
            findings: ['SCBA bottle #4'],
          }),
        ],
      })
    );
    renderWithRouter(<CheckLogPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Log/ }));
    expect(screen.getByText('SCBA bottle #4')).toBeInTheDocument();
  });

  it('says how many findings were truncated', async () => {
    mockGetCheckLog.mockResolvedValue(
      makeResponse({
        entries: [makeEntry({ status: 'failed', findingCount: 8, findings: ['A', 'B'] })],
      })
    );
    renderWithRouter(<CheckLogPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Log/ }));
    expect(screen.getByText(/\+6 more/)).toBeInTheDocument();
  });

  it('requests a different window when one is chosen', async () => {
    renderWithRouter(<CheckLogPage />);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Last 30' }));
    await waitFor(() => {
      expect(mockGetCheckLog).toHaveBeenLastCalledWith({ dates: 30 });
    });
  });

  it('pins the request to one apparatus when scoped', async () => {
    renderWithRouter(<CheckLogPage apparatusId="a-1" showHeader={false} />);
    await waitFor(() => {
      expect(mockGetCheckLog).toHaveBeenCalledWith({ dates: 14, apparatus_id: 'a-1' });
    });
    expect(screen.queryByRole('heading', { name: 'Check log' })).not.toBeInTheDocument();
  });

  it('filters the log by rig, member or item', async () => {
    mockGetCheckLog.mockResolvedValue(
      makeResponse({
        entries: [
          makeEntry({ checkedByName: 'Kelly Moreno' }),
          makeEntry({ shiftId: 's-2', unitLabel: 'M-2', checkedByName: 'Dana Whitfield' }),
        ],
      })
    );
    renderWithRouter(<CheckLogPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Log/ }));
    expect(screen.getByText('Dana Whitfield')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Filter the log'), 'Kelly');
    await waitFor(() => {
      expect(screen.queryByText('Dana Whitfield')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Kelly Moreno')).toBeInTheDocument();
  });

  it('shows an empty state when nothing was expected in the window', async () => {
    mockGetCheckLog.mockResolvedValue(
      makeResponse({
        dates: [],
        rows: [],
        entries: [],
        summary: {
          expected: 0,
          completed: 0,
          completionRate: null,
          missed: 0,
          withFindings: 0,
          outOfServiceDays: 0,
        },
      })
    );
    renderWithRouter(<CheckLogPage />);
    expect(await screen.findByText('Nothing in this window')).toBeInTheDocument();
  });

  it('renders a rate of null as an em dash', async () => {
    mockGetCheckLog.mockResolvedValue(
      makeResponse({
        summary: {
          expected: 0,
          completed: 0,
          completionRate: null,
          missed: 0,
          withFindings: 0,
          outOfServiceDays: 0,
        },
      })
    );
    renderWithRouter(<CheckLogPage />);
    expect(await screen.findByText('—')).toBeInTheDocument();
  });
});
