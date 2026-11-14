/**
 * Owner decisions 2026-11-01:
 * - "Build a screen" for meeting action items: the Action Items page is where
 *   a `meetings.manage` holder edits, completes and deletes them, and where
 *   both sources are filtered by assignee and meeting.
 * - DASH-40 "page or cap": the page asks the feed for one page and takes its
 *   tiles from the feed's totals, not from the rows it was sent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import type { ActionItemPage, ActionItemSummary } from '../services/api';

const mockGetActionItems = vi.fn();
const mockGetMeetings = vi.fn();
const mockUpdateMeetingItem = vi.fn();
const mockDeleteMeetingItem = vi.fn();
const mockUpdateMinutesItem = vi.fn();
const mockGetAssignees = vi.fn();
const granted = new Set<string>();
const authState = {
  user: { id: 'user-me' },
  checkPermission: (permission: string) => granted.has(permission),
};

vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  dashboardService: {
    getActionItems: (...args: unknown[]) => mockGetActionItems(...args) as unknown,
  },
  meetingsService: {
    getMeetings: (...args: unknown[]) => mockGetMeetings(...args) as unknown,
    updateActionItem: (...args: unknown[]) => mockUpdateMeetingItem(...args) as unknown,
    deleteActionItem: (...args: unknown[]) => mockDeleteMeetingItem(...args) as unknown,
  },
}));
vi.mock('../modules/minutes/services/api', () => ({
  minutesService: {
    updateActionItem: (...args: unknown[]) => mockUpdateMinutesItem(...args) as unknown,
    getActionItemAssignees: (...args: unknown[]) => mockGetAssignees(...args) as unknown,
  },
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import ActionItemsPage from './ActionItemsPage';

const item = (overrides: Partial<ActionItemSummary>): ActionItemSummary => ({
  id: 'a1',
  source: 'meeting',
  source_id: 'meet-1',
  description: 'Order radios',
  status: 'open',
  created_at: '2026-09-01T00:00:00Z',
  ...overrides,
});

const pageOf = (items: ActionItemSummary[], totals: Partial<ActionItemPage> = {}): ActionItemPage => ({
  items,
  total: items.length,
  open_total: items.length,
  overdue_total: 0,
  limit: 25,
  offset: 0,
  ...totals,
});

const renderAt = (url = '/action-items') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ConfirmProvider>
        <ActionItemsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

const PAGE_ONE = { limit: 25, offset: 0 };

beforeEach(() => {
  granted.clear();
  mockGetActionItems.mockReset();
  mockGetActionItems.mockResolvedValue(pageOf([]));
  mockGetMeetings.mockReset();
  mockGetMeetings.mockResolvedValue({
    meetings: [
      { id: 'meet-1', title: 'October business meeting', meeting_date: '2026-10-01' },
      { id: 'meet-2', title: 'November business meeting', meeting_date: '2026-11-01' },
    ],
    total: 2,
    skip: 0,
    limit: 100,
  });
  mockUpdateMeetingItem.mockReset();
  mockUpdateMeetingItem.mockResolvedValue({});
  mockDeleteMeetingItem.mockReset();
  mockDeleteMeetingItem.mockResolvedValue(undefined);
  mockUpdateMinutesItem.mockReset();
  mockUpdateMinutesItem.mockResolvedValue({});
  mockGetAssignees.mockReset();
  mockGetAssignees.mockResolvedValue([
    { id: 'alice', name: 'Alice Avery' },
    { id: 'bob', name: 'Bob Brown' },
  ]);
});

describe('ActionItemsPage pages the feed (DASH-40)', () => {
  it('asks for one page and shows the totals over every matching item', async () => {
    mockGetActionItems.mockResolvedValue(
      pageOf([item({ id: 'a1' }), item({ id: 'a2', description: 'Fix door' })], {
        total: 120,
        open_total: 47,
        overdue_total: 9,
      })
    );
    renderAt();

    expect(await screen.findByText('Fix door')).toBeInTheDocument();
    expect(mockGetActionItems).toHaveBeenCalledWith(PAGE_ONE);
    expect(screen.getByTestId('action-items-total')).toHaveTextContent('120');
    expect(screen.getByTestId('action-items-open')).toHaveTextContent('47');
    expect(screen.getByTestId('action-items-overdue')).toHaveTextContent('9');
  });

  it('asks for the next page from where the first ended', async () => {
    mockGetActionItems.mockResolvedValue(pageOf([item({})], { total: 60 }));
    const user = userEvent.setup();
    renderAt();
    await screen.findByText('Order radios');

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => expect(mockGetActionItems).toHaveBeenLastCalledWith({ limit: 25, offset: 25 }));
  });

  it('asks the server for open items rather than filtering a page', async () => {
    renderAt('/action-items?status=open');

    await screen.findByText('No matching action items');
    expect(mockGetActionItems).toHaveBeenCalledWith({ open_only: true, ...PAGE_ONE });
  });

  it('returns to the first page when a filter changes', async () => {
    mockGetActionItems.mockResolvedValue(pageOf([item({})], { total: 60 }));
    const user = userEvent.setup();
    renderAt();
    await screen.findByText('Order radios');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(mockGetActionItems).toHaveBeenLastCalledWith({ limit: 25, offset: 25 }));

    await user.selectOptions(screen.getByLabelText('Filter action items by status'), 'completed');

    await waitFor(() =>
      expect(mockGetActionItems).toHaveBeenLastCalledWith({ status_filter: 'completed', ...PAGE_ONE })
    );
  });
});

describe('ActionItemsPage filters by meeting and assignee', () => {
  it('opens on one meeting’s items from the Minutes page link', async () => {
    granted.add('minutes.view');
    renderAt('/action-items?meeting=meet-2');

    await screen.findByText('No matching action items');
    expect(mockGetActionItems).toHaveBeenCalledWith({ source: 'meeting', source_id: 'meet-2', ...PAGE_ONE });
    expect(await screen.findByLabelText('Filter action items by meeting')).toHaveValue('meet-2');
  });

  it('filters by assignee for someone who assigns items', async () => {
    granted.add('meetings.manage');
    const user = userEvent.setup();
    renderAt();

    const picker = await screen.findByLabelText('Filter action items by assignee');
    await user.selectOptions(picker, 'bob');

    await waitFor(() => expect(mockGetActionItems).toHaveBeenLastCalledWith({ assignee_id: 'bob', ...PAGE_ONE }));
  });

  it('does not ask for the member list for someone who cannot assign', async () => {
    granted.add('minutes.view');
    renderAt();

    await screen.findByText('No action items');
    expect(mockGetAssignees).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Filter action items by assignee')).not.toBeInTheDocument();
  });
});

describe('ActionItemsPage manages meeting action items', () => {
  beforeEach(() => {
    mockGetActionItems.mockResolvedValue(
      pageOf([
        item({
          id: 'mi-1',
          description: 'Order radios',
          assignee_id: 'alice',
          assignee_name: 'Alice Avery',
          due_date: '2026-11-20',
          priority: '1',
          completion_notes: 'Quote requested',
          source_title: 'October business meeting',
        }),
      ])
    );
  });

  it('offers nothing to change without meetings.manage', async () => {
    granted.add('minutes.view');
    renderAt();

    await screen.findByText('Order radios');
    expect(screen.queryByRole('button', { name: /Edit Order radios/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark Order radios complete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Order radios/ })).not.toBeInTheDocument();
  });

  it('names the meeting an item came from', async () => {
    renderAt();

    expect(await screen.findByText('October business meeting')).toBeInTheDocument();
  });

  it('marks an item complete', async () => {
    granted.add('meetings.manage');
    const user = userEvent.setup();
    renderAt();

    await user.click(await screen.findByRole('button', { name: 'Mark Order radios complete' }));

    expect(mockUpdateMeetingItem).toHaveBeenCalledWith('mi-1', { status: 'completed' });
    await waitFor(() => expect(mockGetActionItems).toHaveBeenCalledTimes(2));
  });

  it('saves every field the form owns, clearing with null', async () => {
    granted.add('meetings.manage');
    const user = userEvent.setup();
    renderAt();

    await user.click(await screen.findByRole('button', { name: 'Edit Order radios' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Assigned to')).toHaveValue('alice');
    expect(within(dialog).getByLabelText('Due date')).toHaveValue('2026-11-20');
    expect(within(dialog).getByLabelText('Priority')).toHaveValue('1');

    await user.selectOptions(within(dialog).getByLabelText('Assigned to'), '');
    await user.clear(within(dialog).getByLabelText('Due date'));
    await user.clear(within(dialog).getByLabelText('Completion notes'));
    await user.selectOptions(within(dialog).getByLabelText('Status'), 'in_progress');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(mockUpdateMeetingItem).toHaveBeenCalledWith('mi-1', {
      description: 'Order radios',
      assigned_to: null,
      due_date: null,
      priority: 1,
      status: 'in_progress',
      completion_notes: null,
    });
  });

  it('keeps a former member as the assignee rather than unassigning on save', async () => {
    granted.add('meetings.manage');
    mockGetActionItems.mockResolvedValue(
      pageOf([item({ id: 'mi-2', description: 'Wash rig', assignee_id: 'gone', assignee_name: 'Carol Former' })])
    );
    const user = userEvent.setup();
    renderAt();

    await user.click(await screen.findByRole('button', { name: 'Edit Wash rig' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Assigned to')).toHaveValue('gone');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(mockUpdateMeetingItem).toHaveBeenCalledWith('mi-2', expect.objectContaining({ assigned_to: 'gone' }));
  });

  it('deletes only after the decision is confirmed', async () => {
    granted.add('meetings.manage');
    const user = userEvent.setup();
    renderAt();

    await user.click(await screen.findByRole('button', { name: 'Delete Order radios' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(mockDeleteMeetingItem).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete Order radios' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockDeleteMeetingItem).toHaveBeenCalledWith('mi-1'));
  });
});

describe('ActionItemsPage and minutes items', () => {
  it('lets a minutes.manage holder close any minutes item, but not a carried one', async () => {
    granted.add('minutes.manage');
    mockGetActionItems.mockResolvedValue(
      pageOf([
        item({ id: 'x1', source: 'minutes', source_id: 'min-1', status: 'pending', description: 'Theirs' }),
        item({
          id: 'x2',
          source: 'minutes',
          source_id: 'min-1',
          status: 'pending',
          description: 'Carried',
          carried_forward: true,
        }),
      ])
    );
    const user = userEvent.setup();
    renderAt();

    await user.click(await screen.findByRole('button', { name: 'Mark Theirs complete' }));
    expect(mockUpdateMinutesItem).toHaveBeenCalledWith('min-1', 'x1', { status: 'completed' });
    expect(screen.getByText('Carried forward')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark Carried complete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update status of Carried' })).not.toBeInTheDocument();
  });
});
