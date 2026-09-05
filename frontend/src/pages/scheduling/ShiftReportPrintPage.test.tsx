import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockGetReport = vi.fn();
vi.mock('../../services/api', () => ({
  shiftCompletionService: {
    getReport: (...a: unknown[]) => mockGetReport(...a) as unknown,
  },
}));

vi.mock('react-router', () => ({
  useSearchParams: () => [new URLSearchParams('id=r1')],
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

const storeState = {
  settingsLoaded: false,
  callTypeLabels: {} as Record<string, string>,
  loadSettings: vi.fn(),
};
vi.mock('../../modules/scheduling/store/schedulingStore', () => ({
  useSchedulingStore: (selector?: (s: typeof storeState) => unknown) => (selector ? selector(storeState) : storeState),
}));

import ShiftReportPrintPage from './ShiftReportPrintPage';

const report = {
  id: 'r1',
  shift_date: '2026-08-30',
  hours_on_shift: 12,
  calls_responded: 2,
  call_types: ['mutual_aid'],
  data_sources: { call_types: 'org_calls' },
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  storeState.settingsLoaded = false;
  storeState.callTypeLabels = {};
  storeState.loadSettings.mockReset();
  storeState.loadSettings.mockResolvedValue(undefined);
  mockGetReport.mockReset();
  mockGetReport.mockResolvedValue(report);
  vi.mocked(window.print).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ShiftReportPrintPage print timing', () => {
  it('waits for the call-type labels before printing', async () => {
    // Printing first commits the raw slug to paper — the one output a later
    // re-render cannot repair.
    render(<ShiftReportPrintPage />);
    await waitFor(() => expect(mockGetReport).toHaveBeenCalledWith('r1'));

    await vi.advanceTimersByTimeAsync(700);
    expect(window.print).not.toHaveBeenCalled();
  });

  it('prints once the labels land', async () => {
    storeState.settingsLoaded = true;
    storeState.callTypeLabels = { mutual_aid: 'Mutual Aid' };
    render(<ShiftReportPrintPage />);
    await waitFor(() => expect(mockGetReport).toHaveBeenCalledWith('r1'));

    await vi.advanceTimersByTimeAsync(700);
    expect(window.print).toHaveBeenCalled();
    expect(screen.getByText(/Mutual Aid/)).toBeInTheDocument();
  });

  it('prints anyway when the settings never arrive', async () => {
    // loadSettings deliberately leaves the flag false when its request fails,
    // so waiting on it outright would mean a print view that never prints. A
    // slug on the page beats a dialog that never opens.
    render(<ShiftReportPrintPage />);
    await waitFor(() => expect(mockGetReport).toHaveBeenCalledWith('r1'));

    await vi.advanceTimersByTimeAsync(3100);
    expect(window.print).toHaveBeenCalled();
  });

  it('does not wait on a report holding an officer’s own wording', async () => {
    // Nothing to resolve, so nothing to wait for.
    mockGetReport.mockResolvedValue({ ...report, data_sources: { call_types: 'shift_calls' } });
    render(<ShiftReportPrintPage />);
    await waitFor(() => expect(mockGetReport).toHaveBeenCalledWith('r1'));

    await vi.advanceTimersByTimeAsync(700);
    expect(window.print).toHaveBeenCalled();
  });

  it('does not wait when the report has no call types to label', async () => {
    mockGetReport.mockResolvedValue({ ...report, call_types: [] });
    render(<ShiftReportPrintPage />);
    await waitFor(() => expect(mockGetReport).toHaveBeenCalledWith('r1'));

    await vi.advanceTimersByTimeAsync(700);
    expect(window.print).toHaveBeenCalled();
  });
});
