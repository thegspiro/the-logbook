import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DashboardHoursCard from './DashboardHoursCard';
import type { HoursSegment } from './DashboardHoursCard';

const segments = (training: number, standby: number, administrative: number): HoursSegment[] => [
  { label: 'Training', value: training, colorClass: 'bg-theme-accent-green' },
  { label: 'Standby', value: standby, colorClass: 'bg-theme-accent-yellow' },
  { label: 'Administrative', value: administrative, colorClass: 'bg-theme-accent-purple' },
];

/** The legend row for a segment, which reads as its label followed by its hours. */
const legendRow = (label: string) =>
  screen.getAllByRole('listitem').find((item) => item.textContent?.startsWith(label));

describe('DashboardHoursCard', () => {
  it('reports each figure on the quarter hour', () => {
    render(<DashboardHoursCard monthLabel="August" segments={segments(0, 66.7, 2.9)} loading={false} />);

    expect(legendRow('Training')).toHaveTextContent(/^Training0$/);
    expect(legendRow('Standby')).toHaveTextContent(/^Standby66\.75$/);
    expect(legendRow('Administrative')).toHaveTextContent(/^Administrative3$/);
  });

  it('states a total that equals the segments printed beneath it', () => {
    // The reported defect: 66.7 + 2.9 rendered as "69.60000000000001". Adding
    // the raw values and rounding once would print 69.5 over parts summing to
    // 69.75, which reads as an arithmetic error on the member's own card.
    render(<DashboardHoursCard monthLabel="August" segments={segments(0, 66.7, 2.9)} loading={false} />);

    expect(screen.getByText('69.75')).toBeInTheDocument();
    expect(screen.queryByText(/69\.60*1/)).not.toBeInTheDocument();
  });

  it('leaves a total already on the quarter alone', () => {
    render(<DashboardHoursCard monthLabel="August" segments={segments(1.5, 12, 0.25)} loading={false} />);

    expect(screen.getByText('13.75')).toBeInTheDocument();
  });
});
