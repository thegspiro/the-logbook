import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequirementMonthlyHours } from './RequirementMonthlyHours';
import type { RequirementDetail } from '../../types/training';

const MONTHS = [
  { month: '2025-11', hours: 2 },
  { month: '2025-12', hours: 7.5 },
  { month: '2026-01', hours: 1 },
  { month: '2026-02', hours: 0 },
];

const requirement = (overrides: Partial<RequirementDetail> = {}): RequirementDetail => ({
  id: 'req-1',
  name: 'Annual Training Hours',
  frequency: 'annual',
  required_hours: 72,
  completed_hours: 10.5,
  progress_percentage: 14.6,
  is_met: false,
  window_months: 12,
  monthly_hours: MONTHS,
  ...overrides,
});

const open = async (req: RequirementDetail) => {
  const user = userEvent.setup();
  render(<RequirementMonthlyHours requirement={req} />);
  await user.click(screen.getByRole('button', { name: /show monthly hours/i }));
};

describe('RequirementMonthlyHours', () => {
  it('draws nothing for a requirement with no monthly breakdown', () => {
    const { container } = render(<RequirementMonthlyHours requirement={requirement({ monthly_hours: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is collapsed until asked', () => {
    render(<RequirementMonthlyHours requirement={requirement()} />);
    expect(screen.getByRole('button', { name: /show monthly hours/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('lists every month, empty ones included, and states the total and average', async () => {
    await open(requirement());
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByLabelText('Feb 2026: 0 hours')).toBeInTheDocument();
    expect(screen.getByText(/10\.5 hrs over 4 months · average 2\.6 hrs\/month/)).toBeInTheDocument();
  });

  it("takes the monthly pace from the department's annual hours", async () => {
    await open(requirement());
    expect(screen.getByText(/6 hrs\/month needed/)).toBeInTheDocument();
  });

  it('follows the requirement when the department changes the annual level', async () => {
    await open(requirement({ required_hours: 48 }));
    expect(screen.getByText(/4 hrs\/month needed/)).toBeInTheDocument();
  });

  it('paces against the unadjusted level when leave has prorated the total', async () => {
    await open(requirement({ required_hours: 54, original_required_hours: 72 }));
    expect(screen.getByText(/6 hrs\/month needed/)).toBeInTheDocument();
  });

  it('shows no pace when the window length is unknown', async () => {
    await open(requirement({ window_months: null }));
    expect(screen.queryByText(/needed/)).not.toBeInTheDocument();
  });

  it('marks leave months and keeps them out of the average', async () => {
    await open(
      requirement({
        monthly_hours: [
          { month: '2026-01', hours: 3 },
          { month: '2026-02', hours: 0, waived: true, waived_share: 1, on_leave: true },
          { month: '2026-03', hours: 0, waived: true, waived_share: 1, on_leave: true },
          { month: '2026-04', hours: 1 },
        ],
      })
    );
    expect(screen.getByLabelText('Feb 2026: leave, 0 hours')).toBeInTheDocument();
    expect(screen.getAllByText('Leave')).toHaveLength(2);
    expect(screen.getByText(/average 2 hrs\/month in the 2 months not excused/)).toBeInTheDocument();
  });

  it('shows the leave and the hours earned during it', async () => {
    await open(
      requirement({ monthly_hours: [{ month: '2026-01', hours: 2, waived: true, waived_share: 1, on_leave: true }] })
    );
    expect(screen.getByText('Leave')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByLabelText('Jan 2026: leave, 2 hours')).toBeInTheDocument();
  });

  it("states the owner's example without inflating the average", async () => {
    // 26 hours, 23 of them on leave; 3 earned in the one month not excused.
    const leave = (month: string, hours: number) => ({
      month,
      hours,
      waived: true,
      waived_share: 1,
      on_leave: true,
    });
    await open(
      requirement({
        required_hours: 6,
        original_required_hours: 72,
        completed_hours: 26,
        monthly_hours: [
          leave('2025-11', 5),
          leave('2025-12', 4),
          leave('2026-01', 2),
          leave('2026-02', 1),
          leave('2026-03', 0),
          leave('2026-04', 3),
          leave('2026-05', 4),
          leave('2026-06', 1),
          leave('2026-07', 3),
          leave('2026-08', 0),
          leave('2026-09', 0),
          { month: '2026-10', hours: 3 },
        ],
      })
    );
    expect(
      screen.getByText(
        /26 hrs over 12 months \(23 earned on leave\) · average 3 hrs\/month in the 1 month not excused · 6 hrs\/month needed/
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText('Leave')).toHaveLength(11);
  });

  it('names a training waiver rather than calling it leave', async () => {
    await open(
      requirement({ monthly_hours: [{ month: '2026-01', hours: 1, waived: true, waived_share: 1, on_waiver: true }] })
    );
    expect(screen.getByText('Waived')).toBeInTheDocument();
    expect(screen.queryByText('Leave')).not.toBeInTheDocument();
    expect(screen.getByText(/1 earned while waived/)).toBeInTheDocument();
  });

  it('labels a partly excused month', async () => {
    await open(
      requirement({
        monthly_hours: [
          { month: '2026-09', hours: 0, waived: true, waived_share: 0.5, on_leave: true },
          { month: '2026-10', hours: 0, waived: true, waived_share: 0.5, on_waiver: true },
        ],
      })
    );
    expect(screen.getByLabelText('Sep 2026: partial leave, 0 hours')).toBeInTheDocument();
    expect(screen.getByLabelText('Oct 2026: partly waived, 0 hours')).toBeInTheDocument();
  });

  it('reads an excused month from an older server, with no reason flags, as leave', async () => {
    await open(requirement({ monthly_hours: [{ month: '2026-01', hours: 0, waived: true }] }));
    expect(screen.getByLabelText('Jan 2026: leave, 0 hours')).toBeInTheDocument();
  });

  it('breaks a shift requirement down by month, with its leave', async () => {
    const user = userEvent.setup();
    render(
      <RequirementMonthlyHours
        requirement={requirement({
          name: 'Shift Coverage',
          requirement_type: 'shifts',
          required_hours: 2,
          original_required_hours: 24,
          completed_hours: 3,
          monthly_hours: null,
          monthly_counts: [
            { month: '2025-12', count: 2, waived: true, waived_share: 1, on_leave: true },
            { month: '2026-01', count: 0, waived: false },
            { month: '2026-02', count: 1, waived: false },
          ],
        })}
      />
    );
    await user.click(screen.getByRole('button', { name: /show monthly shifts/i }));
    expect(screen.getByLabelText('Dec 2025: leave, 2 shifts')).toBeInTheDocument();
    expect(screen.getByLabelText('Feb 2026: 1 shift')).toBeInTheDocument();
    expect(
      screen.getByText(/3 shifts over 3 months \(2 on leave\) · average 0\.5 shifts\/month in the 2 months not excused/)
    ).toBeInTheDocument();
    expect(screen.getByText(/2 shifts\/month needed/)).toBeInTheDocument();
  });

  it('says calls for a call requirement', async () => {
    const user = userEvent.setup();
    render(
      <RequirementMonthlyHours
        requirement={requirement({
          requirement_type: 'calls',
          monthly_hours: null,
          monthly_counts: [{ month: '2026-01', count: 1, waived: false }],
        })}
      />
    );
    await user.click(screen.getByRole('button', { name: /show monthly calls/i }));
    expect(screen.getByLabelText('Jan 2026: 1 call')).toBeInTheDocument();
  });
});
