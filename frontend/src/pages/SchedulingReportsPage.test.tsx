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
});
