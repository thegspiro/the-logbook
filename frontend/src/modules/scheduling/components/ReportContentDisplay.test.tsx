import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ShiftCompletionReport } from '../../../types/training';

// The hook under the component reads the once-per-session settings load. This
// stands in for it so the test states the label map it depends on rather than
// inheriting whatever another suite left in a real store (pitfall #28).
const storeState = {
  callTypeLabels: {} as Record<string, string>,
  loadSettings: vi.fn(),
};

vi.mock('../store/schedulingStore', () => ({
  useSchedulingStore: (selector?: (s: typeof storeState) => unknown) => (selector ? selector(storeState) : storeState),
}));

import { ReportContentDisplay } from './ReportContentDisplay';

const report = (callTypes: string[], source?: string): ShiftCompletionReport =>
  ({
    id: 'r1',
    hours_on_shift: 12,
    calls_responded: callTypes.length,
    call_types: callTypes,
    ...(source ? { data_sources: { call_types: source } } : {}),
  }) as ShiftCompletionReport;

beforeEach(() => {
  storeState.callTypeLabels = {};
  storeState.loadSettings.mockReset();
  storeState.loadSettings.mockResolvedValue(undefined);
});

describe('ReportContentDisplay call types', () => {
  it('shows the department label rather than the stored slug', () => {
    // On count-only tracking these are filled in from the shift's own tally,
    // so they are slugs no officer ever typed.
    storeState.callTypeLabels = { mutual_aid: 'Mutual Aid' };
    render(<ReportContentDisplay report={report(['mutual_aid'], 'org_calls')} />);

    expect(screen.getByText('Mutual Aid')).toBeInTheDocument();
    expect(screen.queryByText('mutual_aid')).not.toBeInTheDocument();
  });

  it('passes through a value it has no label for', () => {
    render(<ReportContentDisplay report={report(['Structure Fire'], 'org_calls')} />);
    expect(screen.getByText('Structure Fire')).toBeInTheDocument();
  });

  it('leaves an officer’s own wording alone', () => {
    // Detailed tracking stores what the officer typed. If they wrote "fire"
    // and the configured `fire` slug is later renamed, relabelling here would
    // silently rewrite their historical report.
    storeState.callTypeLabels = { fire: 'Structure Fire' };
    render(<ReportContentDisplay report={report(['fire'], 'shift_calls')} />);

    expect(screen.getByText('fire')).toBeInTheDocument();
    expect(screen.queryByText('Structure Fire')).not.toBeInTheDocument();
  });

  it('leaves a report with no recorded provenance alone', () => {
    // Written before the backend recorded which shape this column holds.
    // Verbatim is what it rendered as before labels existed, and the safe
    // direction — the alternative rewrites an officer's words.
    storeState.callTypeLabels = { fire: 'Structure Fire' };
    render(<ReportContentDisplay report={report(['fire'])} />);

    expect(screen.getByText('fire')).toBeInTheDocument();
  });

  it('loads the settings itself rather than assuming a parent did', () => {
    // The member-facing report page mounts none of the scheduling screens
    // that would have.
    render(<ReportContentDisplay report={report(['mutual_aid'], 'org_calls')} />);
    expect(storeState.loadSettings).toHaveBeenCalled();
  });
});
