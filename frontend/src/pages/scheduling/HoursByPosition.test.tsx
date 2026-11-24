import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { MemberHoursTotals, MemberPositionTotals } from '../../modules/scheduling/services/api';

// The labels a department's own seats carry come from its shift settings;
// the built-in ones are what this screen's rows are about.
vi.mock('../../modules/scheduling/utils/positionLabels', () => ({
  positionLabel: (p: string) => ({ driver: 'Driver/Operator', officer: 'Officer' })[p] ?? p,
}));

import { HoursByPosition } from './HoursByPosition';

const totals = (overrides: Partial<MemberHoursTotals> = {}): MemberHoursTotals => ({
  shifts: 3,
  hours: 26,
  calls: 4,
  pending_shifts: 0,
  pending_hours: 0,
  external_shifts: 0,
  external_hours: 0,
  external_calls: 0,
  ...overrides,
});

const year: MemberPositionTotals[] = [
  { position: 'driver', shifts: 1, hours: 12, calls: 3 },
  { position: 'officer', shifts: 1, hours: 10, calls: 1 },
  { position: null, shifts: 1, hours: 4, calls: 0 },
];
const allTime: MemberPositionTotals[] = [{ position: 'driver', shifts: 40, hours: 480, calls: 96 }];

const render = (props: Partial<React.ComponentProps<typeof HoursByPosition>> = {}) =>
  renderWithRouter(
    <HoursByPosition
      idPrefix="my-hours"
      year={2025}
      positions={year}
      allTimePositions={allTime}
      totals={totals({ external_shifts: 2, external_hours: 8, external_calls: 5 })}
      allTime={totals({ external_shifts: 9, external_hours: 36, external_calls: 20 })}
      showCalls
      {...props}
    />
  );

describe('HoursByPosition', () => {
  it("lists the year's hours by seat, then other departments", () => {
    render();

    const section = screen.getByRole('region', { name: 'Hours by position' });
    const items = within(section).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Driver/Operator12 hrs · 1 shift · 3 calls',
      'Officer10 hrs · 1 shift · 1 call',
      'No position recorded4 hrs · 1 shift · 0 calls',
      'Other departments8 hrs · 2 shifts · 5 calls',
    ]);
    expect(within(section).getByRole('button', { name: '2025' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches to all time, outside row included', async () => {
    const user = userEvent.setup();
    render();

    await user.click(screen.getByRole('button', { name: 'All time' }));

    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Driver/Operator480 hrs · 40 shifts · 96 calls',
      'Other departments36 hrs · 9 shifts · 20 calls',
    ]);
    expect(screen.getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('leaves calls out when the department does not track them', () => {
    render({ showCalls: false });

    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Driver/Operator12 hrs · 1 shift');
    expect(screen.getAllByRole('listitem')[0]).not.toHaveTextContent('calls');
  });

  it('says so when there are no credited shifts', () => {
    render({ positions: [], totals: totals() });

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText('No credited shifts in 2025.')).toBeInTheDocument();
  });
});
