import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithRouter } from '../../test/utils';
import AdminAttentionQueue from './AdminAttentionQueue';
import type { AdminAttentionItem } from '../../types/adminHub';

const makeItem = (overrides: Partial<AdminAttentionItem> = {}): AdminAttentionItem => ({
  key: 'pending_submissions',
  title: '6 training submissions awaiting approval',
  detail: 'oldest waiting 9 days · 31.0 hours total',
  actionLabel: 'Review queue',
  href: '/training/admin?page=records&tab=submissions',
  severity: 'warning',
  count: 6,
  oldestAgeDays: 9,
  ...overrides,
});

/**
 * Rows in source order. Exception rows come first and the collapsed summary
 * line last, so an index addresses the row itself rather than the line naming
 * it — the two spell the same title.
 */
const rowAt = (index: number) => screen.getAllByRole('listitem')[index];

describe('AdminAttentionQueue', () => {
  // An empty queue is not an empty state. A card announcing that nothing is
  // wrong costs the same vertical space as three real exceptions, on a page
  // whose job is the work below it.
  it('disappears entirely when the module has no exceptions', () => {
    const { container } = render(<AdminAttentionQueue items={[]} moduleLabel="Training" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('names each exception and links its one ending action', () => {
    renderWithRouter(<AdminAttentionQueue items={[makeItem()]} moduleLabel="Training" />);

    expect(screen.getByText('6 training submissions awaiting approval')).toBeInTheDocument();
    expect(screen.getByText('oldest waiting 9 days · 31.0 hours total')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review queue' })).toHaveAttribute(
      'href',
      '/training/admin?page=records&tab=submissions'
    );
  });

  // The frame's rule: exactly one red control. A queue where every row shouts
  // gives an admin no order to work in.
  it('gives the red treatment only to a critical row', () => {
    renderWithRouter(
      <AdminAttentionQueue
        items={[
          makeItem({ key: 'a', actionLabel: 'Send renewals', severity: 'critical' }),
          makeItem({ key: 'b', actionLabel: 'Notify members', severity: 'warning' }),
        ]}
        moduleLabel="Training"
      />
    );

    expect(screen.getByRole('link', { name: 'Send renewals' })).toHaveClass('bg-red-600');
    expect(screen.getByRole('link', { name: 'Notify members' })).not.toHaveClass('bg-red-600');
  });

  it('counts the exceptions in the header badge', () => {
    renderWithRouter(
      <AdminAttentionQueue
        items={[makeItem({ key: 'a' }), makeItem({ key: 'b' }), makeItem({ key: 'c' })]}
        moduleLabel="Inventory"
      />
    );

    expect(screen.getByLabelText('3 exceptions in Inventory')).toHaveTextContent('3');
  });

  // A 44px action per row is most of a phone screen; two rows keep the tab bar
  // and the work below it on the first screen, and the line names what is held
  // back rather than hiding it.
  it('holds the third row and beyond back on a phone, naming them on one line', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <AdminAttentionQueue
        items={[
          makeItem({ key: 'a', title: 'First' }),
          makeItem({ key: 'b', title: 'Second' }),
          makeItem({ key: 'c', title: 'Third' }),
          makeItem({ key: 'd', title: 'Fourth' }),
        ]}
        moduleLabel="Members"
      />
    );

    expect(rowAt(2)).toHaveClass('hidden');
    expect(screen.getByText(/Third, and 1 more/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show all/ }));

    expect(rowAt(2)).not.toHaveClass('hidden');
    expect(screen.queryByText(/and 1 more/)).not.toBeInTheDocument();
  });
});
