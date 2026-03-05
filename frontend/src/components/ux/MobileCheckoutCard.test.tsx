import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileCheckoutCard } from './MobileCheckoutCard';

describe('MobileCheckoutCard', () => {
  const baseProps = {
    itemName: 'Thermal Camera',
  };

  it('renders item name', () => {
    render(<MobileCheckoutCard {...baseProps} />);
    expect(screen.getByText('Thermal Camera')).toBeInTheDocument();
  });

  it('shows Active badge when not overdue', () => {
    render(<MobileCheckoutCard {...baseProps} isOverdue={false} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });

  it('shows Overdue badge when overdue', () => {
    render(<MobileCheckoutCard {...baseProps} isOverdue />);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('renders member name and dates', () => {
    render(
      <MobileCheckoutCard
        {...baseProps}
        memberName="John Smith"
        checkoutDate="Jan 15, 2026"
        dueDate="Feb 15, 2026"
      />
    );
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('Jan 15, 2026')).toBeInTheDocument();
    expect(screen.getByText('Feb 15, 2026')).toBeInTheDocument();
  });

  it('calls onCheckIn when check in button is clicked', async () => {
    const user = userEvent.setup();
    const onCheckIn = vi.fn();
    render(<MobileCheckoutCard {...baseProps} onCheckIn={onCheckIn} />);
    await user.click(screen.getByText('Check In'));
    expect(onCheckIn).toHaveBeenCalledTimes(1);
  });

  it('calls onExtend when extend button is clicked', async () => {
    const user = userEvent.setup();
    const onExtend = vi.fn();
    render(<MobileCheckoutCard {...baseProps} onExtend={onExtend} />);
    await user.click(screen.getByText('Extend'));
    expect(onExtend).toHaveBeenCalledTimes(1);
  });

  it('does not render action buttons when handlers are not provided', () => {
    render(<MobileCheckoutCard {...baseProps} />);
    expect(screen.queryByText('Check In')).not.toBeInTheDocument();
    expect(screen.queryByText('Extend')).not.toBeInTheDocument();
  });

  it('applies overdue styling to due date', () => {
    render(
      <MobileCheckoutCard
        {...baseProps}
        dueDate="Jan 1, 2026"
        isOverdue
      />
    );
    const dueDate = screen.getByText('Jan 1, 2026');
    expect(dueDate.className).toContain('text-red');
  });
});
