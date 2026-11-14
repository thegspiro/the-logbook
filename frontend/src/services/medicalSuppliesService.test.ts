/**
 * The storage options a supply is filed under: a body missing either list is
 * a failed load, so the item form shows its "could not be loaded" notice
 * instead of mapping over nothing and taking the dialog down.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
  },
}));

import { medicalSuppliesService } from './medicalSuppliesService';

describe('medicalSuppliesService.getStorageOptions', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('returns the rooms and areas from their route', async () => {
    const body = { rooms: [{ id: 'r1', name: 'Bay' }], areas: [] };
    mockGet.mockResolvedValue({ data: body });
    await expect(medicalSuppliesService.getStorageOptions()).resolves.toEqual(body);
    expect(mockGet).toHaveBeenCalledWith('/medical-supplies/storage-options');
  });

  it('fails the load when a list is missing', async () => {
    mockGet.mockResolvedValue({ data: {} });
    await expect(medicalSuppliesService.getStorageOptions()).rejects.toThrow(
      'The storage rooms response was not an array'
    );
  });
});
