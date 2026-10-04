/**
 * Workflow review W52, in a department on Chicago time.
 *
 * At 7:50 PM on 3 October (00:50 UTC on the 4th) the page showed an item due
 * 4 October as "10/3/2026" and counted it overdue; its "Open" filter found
 * nothing beside an Open tile reading 3; and its rows could not be reached by
 * keyboard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { ActionItemSummary } from '../services/api';

const mockGetActionItems = vi.fn();
vi.mock('../services/api', () => ({
  dashboardService: {
    getActionItems: (...args: unknown[]) => mockGetActionItems(...args) as unknown,
  },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import ActionItemsPage from './ActionItemsPage';

const item = (overrides: Partial<ActionItemSummary>): ActionItemSummary => ({
  id: 'a1',
  source: 'minutes',
  source_id: 'm1',
  description: 'Order replacement hose',
  status: 'pending',
  created_at: '2026-09-01T00:00:00Z',
  ...overrides,
});

describe('ActionItemsPage on the department calendar (W52)', () => {
  beforeEach(() => {
    // Only Date is faked: timers stay real so the page's fetch resolves.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-04T00:50:00Z') });
    mockGetActionItems.mockReset();
    mockGetActionItems.mockResolvedValue([
      // Minutes items arrive as the UTC midnight of their calendar day.
      item({ id: 'a1', due_date: '2026-10-04T00:00:00+00:00' }),
      item({ id: 'a2', description: 'Schedule pump test', due_date: '2026-10-02T00:00:00+00:00' }),
      // Meeting items arrive as a bare DATE.
      item({ id: 'a3', source: 'meeting', status: 'open', description: 'Fix bay door', due_date: '2026-10-10' }),
      item({ id: 'a4', status: 'completed', description: 'Wash rig', due_date: '2026-09-01T00:00:00+00:00' }),
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows each due date as the calendar day it was entered for', async () => {
    renderWithRouter(<ActionItemsPage />);

    expect(await screen.findByText('Oct 4, 2026')).toBeInTheDocument();
    expect(screen.getByText('Oct 10, 2026')).toBeInTheDocument();
  });

  it('counts overdue against today on the department calendar', async () => {
    renderWithRouter(<ActionItemsPage />);
    await screen.findByText('Oct 4, 2026');

    // Four items, three open, and only the one due 2 Oct is late: 4 Oct is
    // tomorrow in Chicago, and the completed item does not count. The three
    // tiles therefore read 4, 3 and 1 — before the fix, Overdue read 2.
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });

  it('filters "Open" to everything not done, from both sources', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    renderWithRouter(<ActionItemsPage />);
    await screen.findByText('Oct 4, 2026');

    await user.selectOptions(screen.getByLabelText('Filter action items by status'), 'open');

    expect(mockGetActionItems).toHaveBeenLastCalledWith({});
    expect(await screen.findByText('Fix bay door')).toBeInTheDocument();
    expect(screen.getByText('Order replacement hose')).toBeInTheDocument();
    expect(screen.queryByText('Wash rig')).not.toBeInTheDocument();
    // Total and Open both read 3 once the closed item is filtered out.
    expect(screen.getAllByText('3')).toHaveLength(2);
  });

  it('makes each row a link to its minutes', async () => {
    renderWithRouter(<ActionItemsPage />);

    const link = await screen.findByRole('link', { name: /Order replacement hose/ });
    expect(link).toHaveAttribute('href', '/minutes/m1');
    expect(screen.getByRole('link', { name: /Fix bay door/ })).toHaveAttribute('href', '/minutes');
  });
});
