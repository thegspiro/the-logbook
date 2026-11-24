import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../../test/utils';
import type { PositionHoursReport } from '../../types';
import { PositionHoursRenderer } from './PositionHoursRenderer';

const report: PositionHoursReport = {
  report_type: 'position_hours',
  generated_at: '2026-11-24T12:00:00Z',
  period_start: '2025-01-01',
  period_end: '2025-12-31',
  summary: {
    total_hours: 42,
    total_shifts: 5,
    total_calls: 9,
    members: 2,
    by_position: [
      { position: 'Driver/Operator', hours: 22, shifts: 2, calls: 4, members: 1 },
      { position: 'Officer', hours: 12, shifts: 1, calls: 3, members: 1 },
      { position: 'No position recorded', hours: 4, shifts: 1, calls: 0, members: 1 },
      { position: 'Other departments', hours: 4, shifts: 1, calls: 2, members: 1 },
    ],
  },
  entries: [
    { member_name: 'Blake Adams', position: 'Officer', hours: 12, shifts: 1, calls: 3 },
    { member_name: 'Blake Adams', position: 'Other departments', hours: 4, shifts: 1, calls: 2 },
    { member_name: 'Avery Stone', position: 'Driver/Operator', hours: 22, shifts: 2, calls: 4 },
    { member_name: 'Avery Stone', position: 'No position recorded', hours: 4, shifts: 1, calls: 0 },
  ],
};

const bodyRows = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    );

describe('PositionHoursRenderer', () => {
  it("shows the server's totals and one row per member and seat", () => {
    renderWithRouter(<PositionHoursRenderer data={report} />);

    // 42 hours is the server's total; no row reads 42.
    expect(screen.getByText('Total Hours')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(bodyRows()).toEqual([
      ['Blake Adams', 'Officer', '12', '1', '3'],
      ['Blake Adams', 'Other departments', '4', '1', '2'],
      ['Avery Stone', 'Driver/Operator', '22', '2', '4'],
      ['Avery Stone', 'No position recorded', '4', '1', '0'],
    ]);
  });

  it("narrows to one position and states that position's own total", async () => {
    const user = userEvent.setup();
    renderWithRouter(<PositionHoursRenderer data={report} />);

    await user.selectOptions(screen.getByLabelText('Position'), 'Driver/Operator');

    expect(bodyRows()).toEqual([['Avery Stone', 'Driver/Operator', '22', '2', '4']]);
    expect(screen.getByText('Driver/Operator: 22 hrs · 2 shifts · 4 calls · 1 member')).toBeInTheDocument();
  });

  it('says so when the period has no credited shifts', () => {
    renderWithRouter(
      <PositionHoursRenderer
        data={{
          ...report,
          summary: { total_hours: 0, total_shifts: 0, total_calls: 0, members: 0, by_position: [] },
          entries: [],
        }}
      />
    );

    expect(screen.queryByLabelText('Position')).not.toBeInTheDocument();
    expect(screen.getByText('No credited shifts in this period.')).toBeInTheDocument();
  });
});
