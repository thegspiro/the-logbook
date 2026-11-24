import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrrImpact } from '../../services/communicationsServices';

vi.mock('./CrrZipMap', () => ({
  default: ({ zips }: { zips: { zip_code: string }[] }) => (
    <div data-testid="crr-map">{zips.map((z) => z.zip_code).join(',')}</div>
  ),
}));

import { renderWithRouter } from '../../test/utils';
import CrrImpactSection from './CrrImpactSection';

const crr = (overrides: Partial<CrrImpact> = {}): CrrImpact => ({
  activities: 3,
  previous_activities: 2,
  by_type: [
    {
      activity_type_id: 't-smoke',
      name: 'Smoke alarm install',
      activities: 2,
      previous_activities: 1,
      counts: [
        { measure_id: 'm-alarms', label: 'Alarms installed', quantity: 5, previous_quantity: 4 },
        { measure_id: 'm-homes', label: 'Homes', quantity: 2, previous_quantity: 2 },
      ],
    },
  ],
  by_tag: [
    {
      tag_id: 'tag-fire',
      kind: 'risk',
      label: 'Fire',
      activities: 3,
      counts: [
        { measure_id: 'm-alarms', activity_type_name: 'Smoke alarm install', label: 'Alarms installed', quantity: 5 },
      ],
    },
    {
      tag_id: 'tag-older',
      kind: 'population',
      label: 'Older adults',
      activities: 1,
      counts: [],
    },
  ],
  by_zip: [
    {
      zip_code: '22046',
      city: 'Falls Church',
      state: 'VA',
      latitude: 38.8856,
      longitude: -77.1802,
      activities: 2,
      counts: [
        { measure_id: 'm-alarms', activity_type_name: 'Smoke alarm install', label: 'Alarms installed', quantity: 3 },
      ],
    },
  ],
  unplaced_activities: 1,
  ...overrides,
});

const renderSection = (data: CrrImpact, against: string | null = 'the same point last year') =>
  renderWithRouter(<CrrImpactSection crr={data} periodLabel="this year" against={against} />);

describe('CrrImpactSection', () => {
  it('shows the period total with its change', () => {
    renderSection(crr());

    const heading = screen.getByRole('region', { name: 'Community risk reduction' });
    expect(within(heading).getByText('3 activities this year')).toBeInTheDocument();
    expect(within(heading).getAllByText('+50%')[0]).toBeInTheDocument();
  });

  it('lists each activity type with its counts and their changes', () => {
    renderSection(crr());

    const types = screen.getByRole('list', { name: 'By activity' });
    const smoke = within(types).getByRole('listitem', { name: 'Smoke alarm install' });
    expect(within(smoke).getByText('Alarms installed')).toBeInTheDocument();
    expect(within(smoke).getByText('+25%')).toBeInTheDocument();
    expect(within(smoke).getByText('no change')).toBeInTheDocument();
  });

  it('splits risks from populations and says the tags overlap', () => {
    renderSection(crr());

    expect(within(screen.getByRole('list', { name: 'By risk' })).getByText('Fire')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'By priority population' })).getByText('Older adults')
    ).toBeInTheDocument();
    expect(screen.getByText(/do not add up to the total/)).toBeInTheDocument();
  });

  it('lists ZIP codes with their place, and counts what had none', () => {
    renderSection(crr());

    const zips = screen.getByRole('list', { name: 'By ZIP code' });
    expect(within(zips).getByRole('listitem', { name: '22046 Falls Church, VA' })).toBeInTheDocument();
    expect(screen.getByText('1 activity had no ZIP code and are not listed here.')).toBeInTheDocument();
  });

  it('loads the map only when asked for it', async () => {
    const user = userEvent.setup();
    renderSection(crr());

    expect(screen.queryByTestId('crr-map')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Show map' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);

    expect(await screen.findByTestId('crr-map')).toHaveTextContent('22046');
    expect(screen.getByRole('button', { name: 'Hide map' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/loaded from openstreetmap\.org when shown/)).toBeInTheDocument();
  });

  it('offers no map when no activity has a ZIP code', () => {
    renderSection(crr({ by_zip: [], unplaced_activities: 3 }));

    expect(screen.queryByRole('button', { name: 'Show map' })).not.toBeInTheDocument();
    expect(screen.getByText('No activities in this period have a ZIP code.')).toBeInTheDocument();
  });

  it('says so when nothing was recorded, and claims no change for all time', () => {
    renderSection(
      crr({ activities: 0, previous_activities: null, by_type: [], by_tag: [], by_zip: [], unplaced_activities: 0 }),
      null
    );

    expect(screen.getByText('No CRR activities recorded in this period.')).toBeInTheDocument();
    expect(screen.queryByText(/%|no change/)).not.toBeInTheDocument();
  });
});
