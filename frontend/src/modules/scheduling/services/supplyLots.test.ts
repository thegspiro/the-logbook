import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}));

import { schedulingService } from './api';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('schedulingService supply + swap', () => {
  it('getSupplyExpiringItems GETs with days_ahead and returns the overview', async () => {
    const overview = { daysAhead: 30, total: 1, items: [] };
    mockGet.mockResolvedValueOnce({ data: overview });

    const result = await schedulingService.getSupplyExpiringItems(30);

    expect(mockGet).toHaveBeenCalledWith('/equipment-checks/supply/expiring-items', {
      params: { days_ahead: 30 },
    });
    expect(result).toEqual(overview);
  });

  it('getSupplyExpiringItems defaults days_ahead to 30', async () => {
    mockGet.mockResolvedValueOnce({ data: { daysAhead: 30, total: 0, items: [] } });

    await schedulingService.getSupplyExpiringItems();

    expect(mockGet).toHaveBeenCalledWith('/equipment-checks/supply/expiring-items', {
      params: { days_ahead: 30 },
    });
  });

  it('swapItemLot POSTs the lot id to the item swap endpoint', async () => {
    const res = { templateItemId: 'ti1', lotNumber: 'LOT-9', remainingQuantity: 4 };
    mockPost.mockResolvedValueOnce({ data: res });

    const result = await schedulingService.swapItemLot('ti1', 'lot-9');

    expect(mockPost).toHaveBeenCalledWith('/equipment-checks/items/ti1/swap', {
      inventory_lot_id: 'lot-9',
    });
    expect(result).toEqual(res);
  });
});
