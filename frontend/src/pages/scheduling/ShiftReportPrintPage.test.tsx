import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

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

/**
 * Render, and settle before any test advances the clock.
 *
 * Every test here advances timers to reach the print timeout, and that timer is
 * scheduled by an effect gated on report state — so it does not exist until the
 * fetch's promise has resolved, React has committed, and the passive effect has
 * run. What these tests waited on instead was `getReport` having been *called*,
 * which is already true synchronously inside `render`: the wait resolved
 * immediately and guaranteed none of those three steps. Normally they happened
 * during `advanceTimersByTimeAsync`'s first yield anyway. Under a loaded
 * machine — a pre-commit `vitest related` run with workers competing — they did
 * not, `advanceTimersByTimeAsync` advanced a clock carrying no print timer, and
 * the suite went red somewhere unrelated to whatever was being committed.
 *
 * A longer advance does not fix that. `tickAsync` snapshots its target after
 * its first yield, so an effect that lands later is late no matter how far the
 * clock is asked to travel.
 *
 * `act` is what makes this provable rather than probable: its contract is that
 * pending React work *including passive effects* has flushed before it
 * resolves. Advancing by 0 yields a real macrotask for the promise chain and
 * React's scheduler while consuming no fake-clock budget — which matters,
 * because the negative test below only has 3000ms before its assertion stops
 * meaning anything. Same idiom as EventQRCodePage.test.tsx.
 */
async function renderSettled() {
  const utils = render(<ShiftReportPrintPage />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(mockGetReport).toHaveBeenCalledWith('r1');
  return utils;
}

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
    await renderSettled();

    await vi.advanceTimersByTimeAsync(700);
    expect(window.print).not.toHaveBeenCalled();
  });

  it('prints once the labels land', async () => {
    storeState.settingsLoaded = true;
    storeState.callTypeLabels = { mutual_aid: 'Mutual Aid' };
    await renderSettled();

    await vi.advanceTimersByTimeAsync(700);
    expect(window.print).toHaveBeenCalled();
    expect(screen.getByText(/Mutual Aid/)).toBeInTheDocument();
  });

  it('prints anyway when the settings never arrive', async () => {
    // loadSettings deliberately leaves the flag false when its request fails,
    // so waiting on it outright would mean a print view that never prints. A
    // slug on the page beats a dialog that never opens.
    await renderSettled();

    await vi.advanceTimersByTimeAsync(3100);
    expect(window.print).toHaveBeenCalled();
  });

  it('does not wait on a report holding an officer’s own wording', async () => {
    // Nothing to resolve, so nothing to wait for.
    mockGetReport.mockResolvedValue({ ...report, data_sources: { call_types: 'shift_calls' } });
    await renderSettled();

    await vi.advanceTimersByTimeAsync(700);
    expect(window.print).toHaveBeenCalled();
  });

  it('prints once, even when the labels land after the fallback fired', async () => {
    // In browsers where the print dialog blocks the thread, a second
    // scheduled print is waiting behind the first one the member just closed.
    const { rerender } = await renderSettled();

    await vi.advanceTimersByTimeAsync(3100);
    expect(window.print).toHaveBeenCalledTimes(1);

    storeState.settingsLoaded = true;
    storeState.callTypeLabels = { mutual_aid: 'Mutual Aid' };
    rerender(<ShiftReportPrintPage />);
    await vi.advanceTimersByTimeAsync(2000);

    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('does not wait when the report has no call types to label', async () => {
    mockGetReport.mockResolvedValue({ ...report, call_types: [] });
    await renderSettled();

    await vi.advanceTimersByTimeAsync(700);
    expect(window.print).toHaveBeenCalled();
  });
});
