import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithRouter } from '../test/utils';

const mockGetComplianceReport = vi.fn();
vi.mock('../modules/scheduling/services/api', () => ({
  schedulingService: {
    getMemberHoursReport: vi
      .fn()
      .mockResolvedValue({ members: [], period_start: '2026-09-01', period_end: '2026-09-29' }),
    getCoverageReport: vi.fn().mockResolvedValue([]),
    getCallVolumeReport: vi.fn().mockResolvedValue([]),
    getAvailability: vi.fn().mockResolvedValue([]),
    getComplianceReport: (...a: unknown[]) => mockGetComplianceReport(...a) as unknown,
  },
}));

vi.mock('../hooks/useRanks', () => ({ useRanks: () => ({ formatRank: (r: string) => r, ranks: [], loading: false }) }));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector?: (s: { checkPermission: () => boolean }) => unknown) => {
    const state = { checkPermission: () => true };
    return selector ? selector(state) : state;
  },
}));
vi.mock('./scheduling/ExternalApparatusSummary', () => ({ ExternalApparatusSummary: () => null }));
vi.mock('./scheduling/ExternalShiftsReview', () => ({ ExternalShiftsReview: () => null }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { SchedulingReportsPage } from './SchedulingReportsPage';

const requirement = (overrides: Record<string, unknown>) => ({
  requirement_id: 'req',
  requirement_name: 'Requirement',
  requirement_type: 'hours',
  required_value: 20,
  frequency: 'one_time',
  period_start: '2025-09-29',
  period_end: '2026-09-29',
  members: [],
  total_members: 0,
  compliant_count: 0,
  non_compliant_count: 0,
  compliance_rate: 0,
  ...overrides,
});

beforeEach(() => {
  mockGetComplianceReport.mockReset();
  mockGetComplianceReport.mockResolvedValue({
    requirements: [
      requirement({ requirement_id: 'empty', requirement_name: 'Supervised Driving Hours' }),
      requirement({
        requirement_id: 'held',
        requirement_name: 'Annual Hazmat Hours',
        total_members: 27,
        compliant_count: 1,
        non_compliant_count: 26,
        compliance_rate: 3.7,
      }),
    ],
    reference_date: '2026-09-29',
    total_requirements: 2,
  });
});

describe('SchedulingReportsPage shift compliance', () => {
  it('reads a requirement nobody is held to as not applicable, not as 0%', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SchedulingReportsPage />);

    await user.click(screen.getByRole('tab', { name: /Shift Compliance/ }));
    await user.click(await screen.findByRole('button', { name: 'Check Compliance' }));

    const empty = await screen.findByRole('button', { name: /Supervised Driving Hours/ });
    expect(empty).toHaveTextContent('Not applicable');
    expect(empty).not.toHaveTextContent('0/0 compliant');

    const held = screen.getByRole('button', { name: /Annual Hazmat Hours/ });
    expect(held).toHaveTextContent('1/27 compliant');
  });

  it('labels the summary totals as requirement checks, not members', async () => {
    // Each requirement grades its own cohort, so the totals sum
    // member-requirement pairs; a member under two requirements counts twice.
    mockGetComplianceReport.mockResolvedValue({
      requirements: [
        requirement({ requirement_id: 'a', total_members: 3, compliant_count: 2, non_compliant_count: 1 }),
        requirement({ requirement_id: 'b', total_members: 3, compliant_count: 3, non_compliant_count: 0 }),
      ],
      reference_date: '2026-09-29',
      total_requirements: 2,
    });
    const user = userEvent.setup();
    renderWithRouter(<SchedulingReportsPage />);

    await user.click(screen.getByRole('tab', { name: /Shift Compliance/ }));
    await user.click(await screen.findByRole('button', { name: 'Check Compliance' }));

    expect(await screen.findByText('Requirement Checks')).toBeInTheDocument();
    expect(screen.getByText('Checks Met')).toBeInTheDocument();
    expect(screen.getByText('Checks Not Met')).toBeInTheDocument();
    // 3 + 3 checks across two requirements: the pair count, labelled as such.
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.queryByText('Total Members')).not.toBeInTheDocument();
    expect(screen.queryByText('Non-Compliant')).not.toBeInTheDocument();
  });

  it('names an open window rather than formatting a missing date', async () => {
    // A one-time shifts requirement counts every shift on record, so the
    // report sends no window bounds; formatting them read "N/A — N/A".
    mockGetComplianceReport.mockResolvedValue({
      requirements: [
        requirement({
          requirement_id: 'lifetime',
          requirement_name: 'Probationary Shifts',
          requirement_type: 'shifts',
          period_start: null,
          period_end: null,
        }),
      ],
      reference_date: '2026-09-29',
      total_requirements: 1,
    });
    const user = userEvent.setup();
    renderWithRouter(<SchedulingReportsPage />);

    await user.click(screen.getByRole('tab', { name: /Shift Compliance/ }));
    await user.click(await screen.findByRole('button', { name: 'Check Compliance' }));

    const row = await screen.findByRole('button', { name: /Probationary Shifts/ });
    expect(row).toHaveTextContent('All shifts on record');
    expect(row).not.toHaveTextContent('N/A');
  });
});
