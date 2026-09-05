import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CallVolumeReport } from '../../types';
import { CallVolumeRenderer, getCallVolumeExportData } from './CallVolumeRenderer';

const report = (over: Partial<CallVolumeReport> = {}): CallVolumeReport =>
  ({
    report_type: 'call_volume',
    generated_at: '2026-09-01T00:00:00Z',
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    summary: {
      total_calls: 5,
      avg_calls_per_day: 0.2,
      busiest_day: '2026-08-04',
      busiest_day_count: 3,
      by_type_totals: { mutual_aid: 3, unclassified: 2 },
    },
    entries: [{ date: '2026-08-04', total_calls: 3, by_type: { mutual_aid: 3 } }],
    call_type_labels: { mutual_aid: 'Mutual Aid', unclassified: 'Not categorised' },
    ...over,
  }) satisfies CallVolumeReport;

describe('CallVolumeRenderer call type labels', () => {
  it('names each type the way the department does', () => {
    render(<CallVolumeRenderer data={report()} />);
    // A slug is a storage key. Stripping its underscores is not a name —
    // "Alarm / Good Intent" came out as "alarm".
    expect(screen.getAllByText(/Mutual Aid/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/mutual_aid/)).not.toBeInTheDocument();
  });

  it('names the untyped remainder as the close-out wizard names it', () => {
    render(<CallVolumeRenderer data={report()} />);
    expect(screen.getByText(/Not categorised/)).toBeInTheDocument();
  });

  it('falls back to the stored value when no label is served', () => {
    // An older backend, or a type deleted outright. Showing the stored value
    // beats showing nothing.
    render(<CallVolumeRenderer data={report({ call_type_labels: undefined })} />);
    expect(screen.getAllByText(/mutual aid/).length).toBeGreaterThan(0);
  });
});

describe('getCallVolumeExportData', () => {
  it('puts the label in the column header, not the slug', () => {
    // The export lands in a spreadsheet somebody else opens, with no legend
    // beside it to decode `type_mutual_aid`.
    const { columns } = getCallVolumeExportData(report());
    expect(columns.map((c) => c.header)).toContain('Mutual Aid');
  });

  it('keys the row off the slug so the column still fills', () => {
    const { rows, columns } = getCallVolumeExportData(report());
    const labelled = columns.find((c) => c.header === 'Mutual Aid');
    expect(labelled?.key).toBe('type_mutual_aid');
    expect(rows[0]?.['type_mutual_aid']).toBe(3);
  });

  it('falls back to the prettified slug with no labels served', () => {
    const { columns } = getCallVolumeExportData(report({ call_type_labels: undefined }));
    expect(columns.map((c) => c.header)).toContain('mutual aid');
  });
});
