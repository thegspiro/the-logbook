import { describe, it, expect, vi, beforeEach } from 'vitest';
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
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import ActionItemsPage from './ActionItemsPage';

const item = (overrides: Partial<ActionItemSummary>): ActionItemSummary => ({
  id: 'a1',
  source: 'minutes',
  source_id: 'm1',
  description: 'Inspect hose bed',
  status: 'open',
  created_at: '2026-09-01T00:00:00Z',
  ...overrides,
});

describe('ActionItemsPage', () => {
  beforeEach(() => {
    mockGetActionItems.mockReset();
    mockGetActionItems.mockResolvedValue([]);
  });

  it('explains where action items come from when nothing is filtered', async () => {
    renderWithRouter(<ActionItemsPage />);
    expect(await screen.findByText('No action items')).toBeInTheDocument();
    expect(screen.getByText('Action items recorded in meetings and minutes appear here.')).toBeInTheDocument();
  });

  it('points at the filters when a filter hides everything', async () => {
    renderWithRouter(<ActionItemsPage />);
    await screen.findByText('No action items');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Assigned to me' }));
    expect(await screen.findByText('No matching action items')).toBeInTheDocument();
    expect(screen.getByText('Choose a different status or clear "Assigned to me" to see more.')).toBeInTheDocument();
    expect(mockGetActionItems).toHaveBeenLastCalledWith({ assigned_to_me: true });
  });

  it('shows a meeting item priority as a word, not its stored number', async () => {
    mockGetActionItems.mockResolvedValue([
      item({ id: 'a1', source: 'meeting', priority: '2', description: 'Order radios' }),
      item({ id: 'a2', source: 'meeting', priority: '1', description: 'Fix door' }),
      item({ id: 'a3', source: 'minutes', priority: 'medium', description: 'Update roster' }),
    ]);
    renderWithRouter(<ActionItemsPage />);
    expect(await screen.findByText('urgent')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });
});
