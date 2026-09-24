import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemNfcLastSeen } from './ItemNfcLastSeen';

const { getItemNfcScans } = vi.hoisted(() => ({ getItemNfcScans: vi.fn() }));
vi.mock('../../../services/api', () => ({ inventoryService: { getItemNfcScans } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const scan = (overrides: Record<string, unknown>) => ({
  id: 's-1',
  item_id: 'item-1',
  action: 'lookup',
  tag_uid_preview: '1180',
  storage_area_id: null,
  storage_area_name: null,
  from_storage_area_id: null,
  from_storage_area_name: null,
  scanned_by: 'u-1',
  scanned_by_name: 'Pat Quartermaster',
  scanned_at: '2026-09-20T12:00:00Z',
  ...overrides,
});

describe('ItemNfcLastSeen', () => {
  beforeEach(() => {
    getItemNfcScans.mockReset();
    getItemNfcScans.mockResolvedValue({ items: [], total: 0 });
  });

  it('asks for a short recent trail', async () => {
    render(<ItemNfcLastSeen itemId="item-1" />);
    expect(await screen.findByText(/No NFC taps recorded/)).toBeInTheDocument();
    expect(getItemNfcScans).toHaveBeenCalledWith('item-1', 10);
  });

  it('describes each kind of tap with who did it', async () => {
    getItemNfcScans.mockResolvedValue({
      total: 4,
      items: [
        scan({
          id: 's-4',
          action: 'put_away',
          storage_area_id: 'b',
          storage_area_name: 'Shelf B',
          from_storage_area_id: 'a',
          from_storage_area_name: 'Shelf A',
        }),
        scan({ id: 's-3', action: 'put_away', storage_area_id: 'a', storage_area_name: 'Shelf A' }),
        scan({
          id: 's-2',
          action: 'put_away',
          storage_area_id: 'a',
          storage_area_name: 'Shelf A',
          from_storage_area_id: 'a',
          from_storage_area_name: 'Shelf A',
        }),
        scan({ id: 's-1' }),
      ],
    });
    render(<ItemNfcLastSeen itemId="item-1" />);
    expect(await screen.findByText('Moved from Shelf A to Shelf B')).toBeInTheDocument();
    expect(screen.getByText('Put away on Shelf A')).toBeInTheDocument();
    expect(screen.getByText('Seen on Shelf A')).toBeInTheDocument();
    expect(screen.getByText('Tag tapped')).toBeInTheDocument();
    expect(screen.getAllByText(/Pat Quartermaster/)).toHaveLength(4);
  });

  it('describes a shelf-audit tap by the shelf it was found on', async () => {
    getItemNfcScans.mockResolvedValue({
      total: 1,
      items: [scan({ action: 'audit', storage_area_id: 'c', storage_area_name: 'Cabinet C' })],
    });
    render(<ItemNfcLastSeen itemId="item-1" />);
    expect(await screen.findByText('Found on Cabinet C during a shelf audit')).toBeInTheDocument();
  });
});
