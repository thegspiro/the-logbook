/**
 * Workflow review W52, in a department on Chicago time.
 *
 * At 7:50 PM on 3 October (00:50 UTC on the 4th) the page showed an item due
 * 4 October as "10/3/2026" and counted it overdue; its "Open" filter found
 * nothing beside an Open tile reading 3; and its rows could not be reached by
 * keyboard.
 *
 * Since DASH-40 the Total / Open / Overdue tiles are the feed's own totals,
 * counted on the server with the department's date (the backend's
 * test_dashboard_action_items_paging.py); what stays on this page is the
 * calendar-day display and colouring of each row's due date.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { ActionItemPage, ActionItemSummary } from '../services/api';

const mockGetActionItems = vi.fn();
vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  dashboardService: {
    getActionItems: (...args: unknown[]) => mockGetActionItems(...args) as unknown,
  },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import ActionItemsPage from './ActionItemsPage';

const pageOf = (items: ActionItemSummary[]): ActionItemPage => ({
  items,
  total: items.length,
  open_total: 0,
  overdue_total: 0,
  limit: 25,
  offset: 0,
});

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
    mockGetActionItems.mockResolvedValue(
      pageOf([
        // Minutes items arrive as the UTC midnight of their calendar day.
        item({ id: 'a1', due_date: '2026-10-04T00:00:00+00:00' }),
        item({ id: 'a2', description: 'Schedule pump test', due_date: '2026-10-02T00:00:00+00:00' }),
        // Meeting items arrive as a bare DATE.
        item({ id: 'a3', source: 'meeting', status: 'open', description: 'Fix bay door', due_date: '2026-10-10' }),
      ])
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows each due date as the calendar day it was entered for', async () => {
    renderWithRouter(<ActionItemsPage />);

    expect(await screen.findByText('Oct 4, 2026')).toBeInTheDocument();
    expect(screen.getByText('Oct 10, 2026')).toBeInTheDocument();
  });

  it('marks late only the item due before today on the department calendar', async () => {
    renderWithRouter(<ActionItemsPage />);

    // 4 October is tomorrow in Chicago: due soon, not late. Before the fix it
    // was coloured as overdue.
    expect((await screen.findByText('Oct 4, 2026')).className).toContain('text-orange-700');
    expect(screen.getByText('Oct 2, 2026').className).toContain('text-red-700');
  });

  it('asks the server for "Open" — everything not done, from both sources', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    renderWithRouter(<ActionItemsPage />);
    await screen.findByText('Oct 4, 2026');

    await user.selectOptions(screen.getByLabelText('Filter action items by status'), 'open');

    expect(mockGetActionItems).toHaveBeenLastCalledWith({ open_only: true, limit: 25, offset: 0 });
  });

  it('makes each row a link to its minutes', async () => {
    renderWithRouter(<ActionItemsPage />);

    const link = await screen.findByRole('link', { name: /Order replacement hose/ });
    expect(link).toHaveAttribute('href', '/minutes/m1');
    expect(screen.getByRole('link', { name: /Fix bay door/ })).toHaveAttribute('href', '/minutes');
  });
});
