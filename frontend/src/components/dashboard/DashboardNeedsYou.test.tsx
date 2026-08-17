import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraduationCap, Megaphone } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import DashboardNeedsYou from './DashboardNeedsYou';
import type { NeedsYouItem } from './DashboardNeedsYou';

const makeItem = (overrides: Partial<NeedsYouItem> = {}): NeedsYouItem => ({
  id: 'item-1',
  icon: GraduationCap,
  title: 'EMT-B Recertification expires in 24 days',
  actionLabel: 'Start Renewal',
  onAction: vi.fn(),
  ...overrides,
});

/**
 * Rows in source order. Item rows come first and the collapsed summary line
 * last, so an index addresses the row itself rather than the line that names
 * it — the two spell the same title.
 */
const rowAt = (index: number) => screen.getAllByRole('listitem')[index];

describe('DashboardNeedsYou', () => {
  it('stays out of the page entirely when nothing needs the member', () => {
    const { container } = render(<DashboardNeedsYou items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps every row on screen at desk width', () => {
    render(
      <DashboardNeedsYou
        items={[
          makeItem({ id: 'a', title: 'First' }),
          makeItem({ id: 'b', title: 'Second' }),
          makeItem({ id: 'c', title: 'Third', icon: Megaphone }),
        ]}
      />
    );

    expect(rowAt(2)).toHaveClass('sm:flex');
    expect(screen.getAllByRole('button', { name: 'Start Renewal' })).toHaveLength(3);
  });

  // The three quick actions sit below this panel on a phone, in reach of a
  // thumb. A third 44px action row pushes them off the first screen, so the
  // rest of the list collapses onto one line that names what is held back.
  it('holds the third row and beyond back on a phone, naming them on one line', () => {
    render(
      <DashboardNeedsYou
        items={[
          makeItem({ id: 'a', title: 'First' }),
          makeItem({ id: 'b', title: 'Second' }),
          makeItem({ id: 'c', title: 'Third' }),
          makeItem({ id: 'd', title: 'Fourth' }),
        ]}
      />
    );

    expect(rowAt(0)).not.toHaveClass('hidden');
    expect(rowAt(1)).not.toHaveClass('hidden');
    expect(rowAt(2)).toHaveClass('hidden', 'sm:flex');
    expect(rowAt(3)).toHaveClass('hidden', 'sm:flex');
    expect(screen.getByRole('button', { name: /Third, and 1 more/ })).toBeInTheDocument();
  });

  it('counts the panel badge from every item, not the rows a phone shows', () => {
    render(
      <DashboardNeedsYou
        items={[
          makeItem({ id: 'a', title: 'First' }),
          makeItem({ id: 'b', title: 'Second' }),
          makeItem({ id: 'c', title: 'Third' }),
        ]}
      />
    );

    expect(screen.getByLabelText('3 items need your attention')).toHaveTextContent('3');
  });

  it('leaves the list alone when it already fits a phone', () => {
    render(
      <DashboardNeedsYou items={[makeItem({ id: 'a', title: 'First' }), makeItem({ id: 'b', title: 'Second' })]} />
    );

    expect(rowAt(1)).not.toHaveClass('hidden');
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  it('reveals the held-back rows with their own actions when the line is tapped', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <DashboardNeedsYou
        items={[
          makeItem({ id: 'a', title: 'First' }),
          makeItem({ id: 'b', title: 'Second' }),
          makeItem({ id: 'c', title: 'Third', actionLabel: 'Acknowledge', onAction }),
        ]}
      />
    );

    await user.click(screen.getByRole('button', { name: /Third/ }));

    expect(rowAt(2)).not.toHaveClass('hidden');
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(onAction).toHaveBeenCalled();
  });
});
