/**
 * W52-7: a member assigned an action item (by assignee_id) may change its
 * status and completion notes from the Action Items page; nothing else, and
 * only on their own minutes items.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { ActionItemSummary } from '../services/api';

const ME = 'user-me';

const mockGetActionItems = vi.fn();
const mockUpdateActionItem = vi.fn();
const authState = { user: { id: ME }, checkPermission: () => false };

vi.mock('../services/api', () => ({
  dashboardService: {
    getActionItems: (...args: unknown[]) => mockGetActionItems(...args) as unknown,
  },
}));
vi.mock('../modules/minutes/services/api', () => ({
  minutesService: {
    updateActionItem: (...args: unknown[]) => mockUpdateActionItem(...args) as unknown,
  },
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import ActionItemsPage from './ActionItemsPage';

const item = (overrides: Partial<ActionItemSummary>): ActionItemSummary => ({
  id: 'a1',
  source: 'minutes',
  source_id: 'm1',
  description: 'Inspect hose bed',
  status: 'pending',
  created_at: '2026-09-01T00:00:00Z',
  ...overrides,
});

describe('ActionItemsPage — an assignee updates their own item (W52-7)', () => {
  beforeEach(() => {
    mockGetActionItems.mockReset();
    mockUpdateActionItem.mockReset();
    mockGetActionItems.mockResolvedValue([
      item({ id: 'mine', assignee_id: ME, description: 'Order hose' }),
      item({ id: 'theirs', assignee_id: 'someone-else', description: 'Fix door' }),
      item({ id: 'by-name', assignee_name: 'Me, typed', description: 'Sweep bay' }),
      item({ id: 'meeting', source: 'meeting', assignee_id: ME, description: 'Radio check' }),
    ]);
    mockUpdateActionItem.mockResolvedValue({});
  });

  it('offers the update only on minutes items assigned to the viewer by member', async () => {
    renderWithRouter(<ActionItemsPage />);

    expect(await screen.findByRole('button', { name: 'Update status of Order hose' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Update status of/ })).toHaveLength(1);
  });

  it('sends only the status and completion notes', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ActionItemsPage />);

    await user.click(await screen.findByRole('button', { name: 'Update status of Order hose' }));
    await user.selectOptions(screen.getByLabelText('Status'), 'completed');
    await user.type(screen.getByLabelText('Completion notes'), 'Ordered two lengths');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdateActionItem).toHaveBeenCalledWith('m1', 'mine', {
      status: 'completed',
      completion_notes: 'Ordered two lengths',
    });
  });

  it('clears the notes with an explicit null', async () => {
    mockGetActionItems.mockResolvedValue([
      item({ id: 'mine', assignee_id: ME, description: 'Order hose', completion_notes: 'old note' }),
    ]);
    const user = userEvent.setup();
    renderWithRouter(<ActionItemsPage />);

    await user.click(await screen.findByRole('button', { name: 'Update status of Order hose' }));
    await user.clear(screen.getByLabelText('Completion notes'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdateActionItem).toHaveBeenCalledWith('m1', 'mine', {
      status: 'pending',
      completion_notes: null,
    });
  });
});
