/**
 * An early close was dated to the scheduled end on every card and nothing
 * said who closed it (W50-14). The backend now records `closed_at` /
 * `closed_by_name`; the stamp prints the real close, names the officer, and
 * says "automatically" only when the detail response carries no actor.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import ElectionCloseStamp from './ElectionCloseStamp';

const closed = {
  status: 'closed',
  end_date: '2026-10-02T05:45:00Z',
  closed_at: '2026-09-30T07:07:00Z',
  closed_by_name: 'Jordan Avery',
};

describe('ElectionCloseStamp (W50-14)', () => {
  it('dates the close to closed_at and names the officer', () => {
    render(<ElectionCloseStamp election={closed} showActor />);
    const stamp = screen.getByText(/^Closed/);
    expect(stamp).toHaveTextContent('September 30, 2026');
    expect(stamp).toHaveTextContent('by Jordan Avery');
    expect(stamp).not.toHaveTextContent('October 2, 2026');
  });

  it('says an actor-less close was automatic, at the scheduled end', () => {
    render(<ElectionCloseStamp election={{ ...closed, closed_by_name: null }} showActor />);
    expect(screen.getByText(/^Closed/)).toHaveTextContent('closed automatically at the scheduled end');
  });

  it('falls back to end_date for a row closed before closed_at existed', () => {
    render(<ElectionCloseStamp election={{ ...closed, closed_at: null, closed_by_name: null }} showActor />);
    expect(screen.getByText(/^Closed/)).toHaveTextContent('October 2, 2026');
  });

  it('omits the actor on a list item, which does not carry one', () => {
    render(
      <ElectionCloseStamp election={{ status: 'closed', end_date: closed.end_date, closed_at: closed.closed_at }} />
    );
    const stamp = screen.getByText(/^Closed/);
    expect(stamp).toHaveTextContent('September 30, 2026');
    expect(stamp).not.toHaveTextContent('automatically');
    expect(stamp).not.toHaveTextContent(' by ');
  });

  it('renders nothing for an election that is not closed', () => {
    const { container } = render(<ElectionCloseStamp election={{ ...closed, status: 'open' }} showActor />);
    expect(container).toBeEmptyDOMElement();
  });
});
