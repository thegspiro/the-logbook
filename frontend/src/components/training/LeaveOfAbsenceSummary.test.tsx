import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LeaveOfAbsenceSummary } from './LeaveOfAbsenceSummary';
import type { MemberLeavePeriod } from '../../types/training';

const leave = (overrides: Partial<MemberLeavePeriod> = {}): MemberLeavePeriod => ({
  id: 'loa-1',
  leave_type: 'leave_of_absence',
  start_date: '2025-07-01',
  end_date: '2026-09-01',
  excuses_training: true,
  ...overrides,
});

describe('LeaveOfAbsenceSummary', () => {
  it('draws nothing without a leave', () => {
    const { container } = render(<LeaveOfAbsenceSummary leaves={[]} rule="full_month" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the leave's dates and the department's rule", () => {
    render(<LeaveOfAbsenceSummary leaves={[leave()]} rule="half" />);
    expect(screen.getByText(/Jul 1, 2025 – Sep 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/15 or more days of leave excuses half the month/)).toBeInTheDocument();
  });

  it('says an exempt leave keeps the requirements in force, and gives no rule for it', () => {
    render(<LeaveOfAbsenceSummary leaves={[leave({ excuses_training: false })]} rule="full_month" />);
    expect(screen.getByText(/training requirements stay in force/)).toBeInTheDocument();
    expect(screen.queryByText(/Training done during leave still counts/)).not.toBeInTheDocument();
  });

  it('reads a leave from a server without the flag as excusing training', () => {
    const { excuses_training: _omit, ...older } = leave();
    render(<LeaveOfAbsenceSummary leaves={[older]} rule="full_month" />);
    expect(screen.queryByText(/stay in force/)).not.toBeInTheDocument();
    expect(screen.getByText(/Training done during leave still counts/)).toBeInTheDocument();
  });

  it('names a permanent leave as having no end date', () => {
    render(<LeaveOfAbsenceSummary leaves={[leave({ end_date: null })]} rule="full_month" />);
    expect(screen.getByText(/no end date/)).toBeInTheDocument();
  });
});
