import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MemberRequirementsResponse, RequirementDetail } from '../../types/training';

const mockGetMemberRequirements = vi.fn();

vi.mock('../../services/api', () => ({
  trainingModuleConfigService: {
    getMemberRequirements: (...args: unknown[]) => mockGetMemberRequirements(...args) as unknown,
  },
}));

import { MemberRequirementsSection } from './MemberRequirementsSection';

const hours: RequirementDetail = {
  id: 'req-1',
  name: 'Annual Training Hours',
  frequency: 'annual',
  required_hours: 6,
  original_required_hours: 72,
  completed_hours: 26,
  progress_percentage: 100,
  is_met: true,
  waived_months: 11,
  leave_months: 11,
  waiver_months: 0,
  active_months: 1,
  window_months: 12,
  monthly_hours: [{ month: '2026-09', hours: 2, waived: true, waived_share: 1, on_leave: true }],
};

const response = (overrides: Partial<MemberRequirementsResponse> = {}): MemberRequirementsResponse => ({
  user_id: 'member-1',
  as_of: '2026-10-21',
  leave_month_rule: 'full_month',
  requirements_summary: { total_requirements: 1, met_requirements: 1, avg_compliance: 100 },
  requirements_detail: [hours],
  leaves_of_absence: [
    { id: 'loa-1', leave_type: 'leave_of_absence', start_date: '2025-07-01', end_date: '2026-09-01' },
  ],
  ...overrides,
});

describe('MemberRequirementsSection', () => {
  beforeEach(() => {
    mockGetMemberRequirements.mockReset();
    mockGetMemberRequirements.mockResolvedValue(response());
  });

  it("loads the member's requirements by id", async () => {
    render(<MemberRequirementsSection userId="member-1" timezone="UTC" />);
    expect(await screen.findByText('Annual Training Hours')).toBeInTheDocument();
    expect(mockGetMemberRequirements).toHaveBeenCalledWith('member-1');
    expect(screen.getByText('1 of 1 met')).toBeInTheDocument();
  });

  it('shows the leave of absence beside the training done during it', async () => {
    render(<MemberRequirementsSection userId="member-1" timezone="UTC" />);
    expect(await screen.findByText('Leave of absence')).toBeInTheDocument();
    expect(
      screen.getByText(/Training done during leave still counts\. Any day of leave excuses the whole month\./)
    ).toBeInTheDocument();
    expect(screen.getByText(/Adjusted for 11 months on leave/)).toBeInTheDocument();
    expect(screen.getByText('26/6 hrs')).toBeInTheDocument();
  });

  it('describes the member rather than addressing the officer', async () => {
    mockGetMemberRequirements.mockResolvedValue(
      response({ requirements_detail: [{ ...hours, is_met: false, blocks_activity: true }] })
    );
    render(<MemberRequirementsSection userId="member-1" timezone="UTC" />);
    expect(await screen.findByText(/may prevent the member from signing up/)).toBeInTheDocument();
  });

  it('says so when nothing applies, rather than reading as compliant', async () => {
    mockGetMemberRequirements.mockResolvedValue(
      response({
        requirements_detail: [],
        leaves_of_absence: [],
        requirements_summary: { total_requirements: 0, met_requirements: 0, avg_compliance: null },
      })
    );
    render(<MemberRequirementsSection userId="member-1" timezone="UTC" />);
    expect(await screen.findByText('No training requirements apply to this member.')).toBeInTheDocument();
    expect(screen.queryByText(/met$/)).not.toBeInTheDocument();
  });

  it('reports a failed load without hiding the rest of the page', async () => {
    mockGetMemberRequirements.mockRejectedValue(new Error('Network down'));
    render(<MemberRequirementsSection userId="member-1" timezone="UTC" />);
    expect(await screen.findByText('Network down')).toBeInTheDocument();
  });
});
