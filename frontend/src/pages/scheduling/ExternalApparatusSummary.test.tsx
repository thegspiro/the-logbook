import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ExternalApparatusSummary } from './ExternalApparatusSummary';

const mockSummary = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getExternalApparatusSummary: (...args: unknown[]) => mockSummary(...args) as unknown,
  },
}));

const rows = [
  {
    external_apparatus_id: 'u1',
    agency_name: 'Township Fire Company',
    apparatus_name: 'Engine 42',
    apparatus_type: 'engine',
    shifts: 3,
    minutes: 1800,
    hours: 30,
    members: 2,
  },
  {
    external_apparatus_id: null,
    agency_name: 'Gone Co',
    apparatus_name: 'Rescue 9',
    apparatus_type: null,
    shifts: 1,
    minutes: 480,
    hours: 8,
    members: 1,
  },
];

describe('ExternalApparatusSummary', () => {
  beforeEach(() => {
    mockSummary.mockReset();
    mockSummary.mockResolvedValue({ rows, period_start: '2026-03-01', period_end: '2026-03-31' });
  });

  it('shows shifts, hours and members per unit for the period', async () => {
    render(<ExternalApparatusSummary startDate="2026-03-01" endDate="2026-03-31" refreshKey={0} />);

    expect(await screen.findByText('Engine 42')).toBeInTheDocument();
    expect(screen.getByText('Rescue 9')).toBeInTheDocument();
    expect(screen.getByText('38')).toBeInTheDocument();
    expect(mockSummary).toHaveBeenCalledWith({ start_date: '2026-03-01', end_date: '2026-03-31' });
  });

  it('re-reads when the parent bumps the refresh key', async () => {
    const { rerender } = render(
      <ExternalApparatusSummary startDate="2026-03-01" endDate="2026-03-31" refreshKey={0} />
    );
    await screen.findByText('Engine 42');

    rerender(<ExternalApparatusSummary startDate="2026-03-01" endDate="2026-03-31" refreshKey={1} />);

    await waitFor(() => expect(mockSummary).toHaveBeenCalledTimes(2));
  });

  it('says so when nothing was staffed', async () => {
    mockSummary.mockResolvedValue({ rows: [], period_start: '2026-03-01', period_end: '2026-03-31' });
    render(<ExternalApparatusSummary startDate="2026-03-01" endDate="2026-03-31" refreshKey={0} />);

    expect(await screen.findByText('No outside apparatus was staffed in this period.')).toBeInTheDocument();
  });
});
