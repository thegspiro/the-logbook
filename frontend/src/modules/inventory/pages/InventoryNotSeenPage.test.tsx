import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import { InventoryNotSeenPage } from './InventoryNotSeenPage';

const { service } = vi.hoisted(() => ({
  service: { getCategories: vi.fn(), getNotSeenReport: vi.fn(), exportNotSeenReport: vi.fn() },
}));

vi.mock('../../../services/api', () => ({ inventoryService: service }));
vi.mock('../../../components/ux', () => ({ Breadcrumbs: () => null }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  name: 'Helmet',
  serial_number: 'H-1',
  asset_tag: null,
  category_name: 'PPE',
  status: 'available',
  storage_area_name: 'Shelf A',
  last_seen_at: '2026-01-02T03:04:00Z',
  last_seen_source: 'return',
  days_since_seen: 265,
  ...overrides,
});

describe('InventoryNotSeenPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getCategories.mockReset();
    service.getCategories.mockResolvedValue([{ id: 'cat-1', name: 'PPE' }]);
    service.getNotSeenReport.mockReset();
    service.getNotSeenReport.mockResolvedValue({
      cutoff: '2026-03-28T12:00:00Z',
      total: 2,
      items: [
        row({ id: 'item-2', name: 'Radio', last_seen_at: null, last_seen_source: null, days_since_seen: null }),
        row(),
      ],
    });
    service.exportNotSeenReport.mockReset();
    service.exportNotSeenReport.mockResolvedValue(new Blob(['a,b'], { type: 'text/csv' }));
  });

  it('loads 180 days by default and shows never-seen items and the source', async () => {
    renderWithRouter(<InventoryNotSeenPage />);
    expect(await screen.findByText(/2 item\(s\) not seen since/)).toBeInTheDocument();
    expect(service.getNotSeenReport).toHaveBeenCalledWith({ days: 180, category_id: undefined, limit: 500 });
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByText(/Returned · 265 days ago/)).toBeInTheDocument();
    expect(screen.getAllByText('Available')).toHaveLength(2);
  });

  it('reloads for a new window and category', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryNotSeenPage />);
    await screen.findByText(/not seen since/);
    await user.selectOptions(screen.getByLabelText('Not seen in'), '30');
    await user.selectOptions(screen.getByLabelText('Category'), 'cat-1');
    await waitFor(() =>
      expect(service.getNotSeenReport).toHaveBeenLastCalledWith({ days: 30, category_id: 'cat-1', limit: 500 })
    );
  });

  it('says when every item has been seen', async () => {
    service.getNotSeenReport.mockResolvedValue({ cutoff: '2026-03-28T12:00:00Z', total: 0, items: [] });
    renderWithRouter(<InventoryNotSeenPage />);
    expect(await screen.findByText(/Every active item has been seen in the last 180 days/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download CSV/ })).toBeDisabled();
  });

  it('notes when the list is cut short and downloads the CSV with the same filters', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:csv');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    service.getNotSeenReport.mockResolvedValue({ cutoff: '2026-03-28T12:00:00Z', total: 900, items: [row()] });
    renderWithRouter(<InventoryNotSeenPage />);
    expect(await screen.findByText(/first 1 shown; the CSV has them all/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Download CSV/ }));
    await waitFor(() =>
      expect(service.exportNotSeenReport).toHaveBeenCalledWith({ days: 180, category_id: undefined })
    );
    expect(createObjectURL).toHaveBeenCalled();
  });
});
