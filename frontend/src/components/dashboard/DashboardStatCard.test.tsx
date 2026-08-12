import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Clock } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import DashboardStatCard from './DashboardStatCard';

describe('DashboardStatCard', () => {
  it('keeps compact mobile supporting text available to assistive technology', () => {
    render(
      <DashboardStatCard
        label="Training"
        value={12}
        icon={Clock}
        iconColor="text-green-700"
        description="Completed courses, this month"
        loading={false}
      />
    );

    expect(screen.getByText('Completed courses, this month')).toHaveClass('sr-only', 'sm:not-sr-only');
  });

  it('renders actionable cards as native buttons with keyboard activation', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <DashboardStatCard
        label="Standby"
        value={8}
        icon={Clock}
        iconColor="text-yellow-700"
        description="Shifts worked, this month"
        loading={false}
        onClick={onClick}
        ariaLabel="Open standby hours"
      />
    );

    const card = screen.getByRole('button', { name: 'Open standby hours' });
    expect(card).toHaveAttribute('type', 'button');
    card.focus();
    await user.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not expose informational cards as interactive controls', () => {
    render(
      <DashboardStatCard
        label="Training"
        value={12}
        icon={Clock}
        iconColor="text-green-700"
        description="Completed courses, this month"
        loading={false}
      />
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
