import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { renderWithRouter } from '../test/utils';
import type { ActionItemSummary } from '../services/api';

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
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import ActionItemsPage from './ActionItemsPage';

const LocationProbe: React.FC = () => <output data-testid="location">{useLocation().search}</output>;

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ActionItemsPage />
      <LocationProbe />
    </MemoryRouter>
  );

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

describe('ActionItemsPage opened from a dashboard card (DASH-37)', () => {
  beforeEach(() => {
    mockGetActionItems.mockReset();
    // The server applies the overdue predicate; it answers with what it kept.
    mockGetActionItems.mockResolvedValue([
      item({
        id: 'a1',
        source: 'minutes',
        status: 'pending',
        description: 'Order radios',
        due_date: '2026-09-01T00:00:00+00:00',
      }),
    ]);
  });

  it('asks for overdue minutes items and shows both filters as set', async () => {
    renderAt('/action-items?source=minutes&status=overdue');

    expect(await screen.findByText('Order radios')).toBeInTheDocument();
    expect(mockGetActionItems).toHaveBeenCalledTimes(1);
    expect(mockGetActionItems).toHaveBeenCalledWith({ overdue: true, source: 'minutes' });
    expect(screen.getByLabelText('Filter action items by status')).toHaveValue('overdue');
    expect(screen.getByLabelText('Filter action items by source')).toHaveValue('minutes');
  });

  it('asks for overdue meeting items from the meeting card', async () => {
    mockGetActionItems.mockResolvedValue([
      item({ id: 'a2', source: 'meeting', status: 'open', description: 'Fix bay door', due_date: '2026-09-01' }),
    ]);
    renderAt('/action-items?source=meeting&status=overdue');

    expect(await screen.findByText('Fix bay door')).toBeInTheDocument();
    expect(mockGetActionItems).toHaveBeenCalledWith({ overdue: true, source: 'meeting' });
    expect(screen.getByLabelText('Filter action items by source')).toHaveValue('meeting');
  });

  it('never sends overdue as a stored status', async () => {
    renderAt('/action-items?status=overdue');

    await screen.findByText('Order radios');
    expect(mockGetActionItems).toHaveBeenCalledWith({ overdue: true });
    expect(screen.getByLabelText('Filter action items by source')).toHaveValue('');
  });

  it('clears a seeded filter from the control and from the address', async () => {
    renderAt('/action-items?source=minutes&status=overdue');
    await screen.findByText('Order radios');

    await userEvent.selectOptions(screen.getByLabelText('Filter action items by status'), '');
    expect(mockGetActionItems).toHaveBeenLastCalledWith({ source: 'minutes' });
    expect(screen.getByTestId('location')).toHaveTextContent('?source=minutes');

    await userEvent.selectOptions(screen.getByLabelText('Filter action items by source'), '');
    expect(mockGetActionItems).toHaveBeenLastCalledWith({});
    expect(screen.getByTestId('location')).toBeEmptyDOMElement();
  });

  it('ignores a parameter it does not offer', async () => {
    renderAt('/action-items?status=bogus&source=elsewhere');

    await screen.findByText('Order radios');
    expect(mockGetActionItems).toHaveBeenCalledWith({});
    expect(screen.getByLabelText('Filter action items by status')).toHaveValue('');
  });
});
