import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockMine = vi.fn();
const mockUpdate = vi.fn();
const toastError = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    getMyActionItems: (...a: unknown[]) => mockMine(...a) as unknown,
    updateActionItem: (...a: unknown[]) => mockUpdate(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: (...a: unknown[]) => toastError(...a) as unknown, success: vi.fn() },
}));

import { MyActionItemsPanel } from './MyActionItemsPanel';
import { renderWithRouter } from '../../../test/utils';

const pending = {
  id: 'i1',
  minutes_id: 'm1',
  minutes_title: 'October business meeting',
  meeting_date: '2026-10-01T23:00:00Z',
  minutes_status: 'approved',
  description: 'Order hose',
  due_date: '2026-11-01T00:00:00Z',
  priority: 'high',
  status: 'pending',
};
const started = { ...pending, id: 'i2', description: 'Paint the bay', status: 'in_progress', due_date: undefined };

describe('MyActionItemsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMine.mockReset();
    mockUpdate.mockReset();
    mockMine.mockResolvedValue([pending, started]);
    mockUpdate.mockResolvedValue({});
  });

  it('lists the member’s items with their meeting and due date', async () => {
    renderWithRouter(<MyActionItemsPanel />);

    expect(await screen.findByRole('heading', { name: 'Assigned to me (2)' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'October business meeting' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/minutes/m1');
    expect(screen.getByText(/due Nov 1, 2026 · Pending/)).toBeInTheDocument();
  });

  it('renders nothing for a member with no items', async () => {
    mockMine.mockResolvedValue([]);
    const { container } = renderWithRouter(<MyActionItemsPanel />);
    await waitFor(() => expect(mockMine).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing if the list cannot be loaded', async () => {
    mockMine.mockRejectedValue(new Error('403'));
    const { container } = renderWithRouter(<MyActionItemsPanel />);
    await waitFor(() => expect(mockMine).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('starts only a pending item, and sends only the status', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MyActionItemsPanel />);

    const starts = await screen.findAllByRole('button', { name: 'Start' });
    expect(starts).toHaveLength(1);
    await user.click(starts[0] as HTMLElement);

    expect(mockUpdate).toHaveBeenCalledWith('m1', 'i1', { status: 'in_progress' });
  });

  it('marks an item done and reloads the list', async () => {
    mockMine.mockResolvedValueOnce([pending]).mockResolvedValueOnce([]);
    const user = userEvent.setup();
    const { container } = renderWithRouter(<MyActionItemsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Mark done' }));

    expect(mockUpdate).toHaveBeenCalledWith('m1', 'i1', { status: 'completed' });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('reports a failed update and keeps the item', async () => {
    mockUpdate.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    renderWithRouter(<MyActionItemsPanel />);

    await user.click((await screen.findAllByRole('button', { name: 'Mark done' }))[0] as HTMLElement);

    expect(toastError).toHaveBeenCalled();
    expect(screen.getByText('Order hose')).toBeInTheDocument();
  });
});
