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
          { month: '2026-02', hours: 0, waived: true },
          { month: '2026-03', hours: 0, waived: true },
          { month: '2026-04', hours: 1 },
        ],
      })
    );
    expect(screen.getByLabelText('Feb 2026: leave, 0 hours')).toBeInTheDocument();
    expect(screen.getAllByText('Leave')).toHaveLength(2);
    expect(screen.getByText(/average 2 hrs\/month \(2 months of leave not counted\)/)).toBeInTheDocument();
  });

  it('still shows hours earned in a month of leave', async () => {
    await open(requirement({ monthly_hours: [{ month: '2026-01', hours: 2, waived: true }] }));
    expect(screen.queryByText('Leave')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Jan 2026: leave, 2 hours')).toBeInTheDocument();
  });
});
