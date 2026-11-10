import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getCalendarFeed: vi.fn(),
    rotateCalendarFeed: vi.fn(),
  },
}));

import { CalendarSubscribeCard } from './CalendarSubscribeCard';

describe('CalendarSubscribeCard', () => {
  // The `card` utility carries no padding of its own, so without an inset the
  // icon and the "Add to calendar app" hint sit flush against the border.
  it('insets its content from the card border', () => {
    render(<CalendarSubscribeCard />);
    expect(screen.getByTestId('calendar-subscribe-card')).toHaveClass('card', 'px-4', 'py-3');
  });
});
