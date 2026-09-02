import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import type { TestingCheckEntry } from '../services/api';

let currentPermissions = ['settings.manage'];
const mockAuthState: Record<string, unknown> = {
  user: {
    username: 'itmanager',
    full_name: 'Ivy Manager',
    positions: ['System Owner'],
    get permissions() {
      return currentPermissions;
    },
  },
  checkPermission: (permission: string) => currentPermissions.includes(permission),
  hasRole: () => false,
};
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState
  ),
}));
vi.mock('../../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ enabledModules: new Set<string>(), isModuleOn: () => true, isLoading: false }),
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

const savedEntries: TestingCheckEntry[] = [];
/** Set to make the run load fail, as a dead API or a 500 would. */
const loadFailure: { message: string | null } = { message: null };
const currentRun = {
  id: 'run-1',
  sequence: 1,
  label: 'Pre-launch',
  buildId: 'build-1',
  startedAt: '2026-08-27T09:00:00Z',
  startedById: 'u1',
  startedByName: 'Ivy Manager',
  isCurrent: true,
};
vi.mock('../services/api', () => ({
  testingChecklistService: {
    getRun: () =>
      loadFailure.message
        ? Promise.reject(new Error(loadFailure.message))
        : Promise.resolve({
            entries: savedEntries,
            run: currentRun,
            runs: [currentRun],
            includesAllTesters: true,
            testerCount: new Set(savedEntries.map((entry) => entry.userId)).size,
          }),
    saveEntry: () => Promise.resolve(savedEntries[0]),
    startRun: () => Promise.resolve(currentRun),
    clearRun: () => Promise.resolve(0),
  },
}));

// Import AFTER the mocks
import { TestingReportPrintPage } from './TestingReportPrintPage';

const mark = (overrides: Partial<TestingCheckEntry>): TestingCheckEntry => ({
  id: 'e1',
  routePath: '/events/admin',
  status: 'fail',
  note: 'roster column empty',
  params: null,
  checkedAt: '2026-08-27T12:00:00Z',
  userId: 'u1',
  userName: 'Ivy Manager',
  testedAs: ['System Owner'],
  buildId: 'build-1',
  expectedAccess: 'allowed',
  isMine: true,
  ...overrides,
});

/** The cells of the table row whose first cell reads `label`. */
const cellsOfRowNamed = (label: string): string[] => {
  for (const row of screen.getAllByRole('row')) {
    const cells = within(row).queryAllByRole('cell');
    if (cells[0]?.textContent === label) return cells.map((cell) => cell.textContent ?? '');
  }
  throw new Error(`no table row starting with ${label}`);
};

describe('TestingReportPrintPage', () => {
  beforeEach(() => {
    savedEntries.length = 0;
    loadFailure.message = null;
    currentPermissions = ['settings.manage'];
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
  });

  it('names the run and who printed it', async () => {
    renderWithRouter(<TestingReportPrintPage />);

    expect(await screen.findByText('Application testing report')).toBeInTheDocument();
    expect(screen.getByText('Pre-launch')).toBeInTheDocument();
    expect(screen.getByText(/By: Ivy Manager/)).toBeInTheDocument();
    expect(screen.getByText(/Build: build-1/)).toBeInTheDocument();
  });

  it('lists a failure with the note that explains it', async () => {
    savedEntries.push(mark({}));
    renderWithRouter(<TestingReportPrintPage />);

    expect(await screen.findByText('roster column empty')).toBeInTheDocument();
    expect(screen.getByText('Events administration hub')).toBeInTheDocument();
  });

  it('asks about a block on a page the account should open, without calling it a defect', async () => {
    savedEntries.push(mark({ status: 'blocked', note: null, expectedAccess: 'allowed' }));
    renderWithRouter(<TestingReportPrintPage />);

    expect(await screen.findByText('Blocked, though this account should be able to open it')).toBeInTheDocument();
    // Counted apart from the defects, which is what "(+1 to confirm)" says.
    expect(cellsOfRowNamed('Gate refusals verified')[3]).toBe('0 (+1 to confirm)');
  });

  it('reports a gate that did not behave, and names the seat', async () => {
    savedEntries.push(
      mark({
        status: 'pass',
        note: null,
        expectedAccess: 'denied',
        userId: 'u2',
        userName: 'Firefighter Jones',
        testedAs: ['firefighter'],
        isMine: false,
      })
    );
    renderWithRouter(<TestingReportPrintPage />);

    expect(await screen.findByText('Opened when it should have refused')).toBeInTheDocument();
    expect(screen.getByText(/Firefighter Jones \(firefighter\)/)).toBeInTheDocument();
  });

  it('says so plainly when there is nothing to report', async () => {
    renderWithRouter(<TestingReportPrintPage />);

    expect(await screen.findByText('No page was recorded as failing.')).toBeInTheDocument();
    expect(screen.getByText('Every gate behaved as the application predicted.')).toBeInTheDocument();
  });

  it('counts the headline totals over every tester it prints', async () => {
    // The report claims its counts cover the department; a failure listed
    // below must not sit above a "Failed 0".
    savedEntries.push(mark({ status: 'fail', userId: 'u2', userName: 'Firefighter Jones', isMine: false }));
    renderWithRouter(<TestingReportPrintPage />);

    await screen.findByText('Summary');
    expect(cellsOfRowNamed('Passed')).toEqual(['Passed', '0', 'Failed', '1']);
    expect(cellsOfRowNamed('Blocked')[1]).toBe('0');
  });

  it('counts a page another tester failed as failed', async () => {
    // Worst wins: a report that averaged two testers would bury the finding.
    savedEntries.push(
      mark({ id: 'a', status: 'pass', userId: 'u1', isMine: true }),
      mark({ id: 'b', status: 'fail', userId: 'u2', userName: 'Firefighter Jones', isMine: false })
    );
    renderWithRouter(<TestingReportPrintPage />);

    await screen.findByText('Coverage by area');

    // Area | Pages | Checked | Passed | Failed | Blocked
    expect(cellsOfRowNamed('Events')).toEqual(['Events', '11', '1', '0', '1', '0']);
  });

  it('counts pages nobody opened as not tested rather than as passing', async () => {
    savedEntries.push(mark({ status: 'pass', expectedAccess: 'allowed' }));
    renderWithRouter(<TestingReportPrintPage />);

    await screen.findByText('Summary');

    // Pages nobody opened must land in "Not tested", not quietly in a pass.
    const cells = cellsOfRowNamed('Blocked');
    expect(cells[2]).toBe('Not tested');
    expect(Number(cells[3])).toBeGreaterThan(200);
  });
});

describe('TestingReportPrintPage — when the run cannot be loaded', () => {
  beforeEach(() => {
    savedEntries.length = 0;
    loadFailure.message = 'Service unavailable';
    currentPermissions = ['settings.manage'];
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
  });

  it('says so instead of reporting a clean run', async () => {
    // An empty `results` renders as a report stating there were no failures
    // and that every gate behaved — the most confident possible reading of
    // "we never got the data".
    renderWithRouter(<TestingReportPrintPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByText('Application testing report')).not.toBeInTheDocument();
  });

  it('does not send it to the printer', async () => {
    vi.useFakeTimers();
    try {
      renderWithRouter(<TestingReportPrintPage />);
      await vi.waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      await vi.advanceTimersByTimeAsync(2000);

      expect(window.print).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
