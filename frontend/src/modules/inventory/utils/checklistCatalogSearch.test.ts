/**
 * The builder's catalog search across gear and medical stock.
 *
 * What matters is what a caller may conclude from the answer: medical rows
 * lead, nothing appears twice, and a half that failed is reported so the
 * caller does not offer to create an item that may already be on file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGearItems = vi.fn();
const mockGearLots = vi.fn();
const mockMedicalItems = vi.fn();
const mockMedicalLots = vi.fn();

vi.mock('@/services/inventoryService', () => ({
  inventoryService: {
    getItems: (...a: unknown[]) => mockGearItems(...a) as unknown,
    getItemLots: (...a: unknown[]) => mockGearLots(...a) as unknown,
  },
}));

vi.mock('@/services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    getItems: (...a: unknown[]) => mockMedicalItems(...a) as unknown,
    getItemLots: (...a: unknown[]) => mockMedicalLots(...a) as unknown,
  },
}));

import { getCatalogItemLots, searchChecklistCatalog } from './checklistCatalogSearch';

const page = (items: Array<{ id: string; name: string }>) => ({ items, total: items.length, skip: 0, limit: 6 });

describe('searchChecklistCatalog', () => {
  beforeEach(() => {
    mockGearItems.mockReset();
    mockGearLots.mockReset();
    mockMedicalItems.mockReset();
    mockMedicalLots.mockReset();
    mockGearItems.mockResolvedValue(page([{ id: 'g-1', name: 'Halligan' }]));
    mockMedicalItems.mockResolvedValue(page([{ id: 'm-1', name: 'Gauze 4x4' }]));
  });

  it('lists medical rows before gear rows', async () => {
    const { hits, incomplete } = await searchChecklistCatalog('a', { gear: true, medical: true }, 6);

    expect(incomplete).toBe(false);
    expect(hits.map((h) => [h.item.id, h.domain])).toEqual([
      ['m-1', 'medical'],
      ['g-1', 'gear'],
    ]);
  });

  it('sends the same bounded query to both halves', async () => {
    await searchChecklistCatalog('gauze', { gear: true, medical: true }, 6);

    const params = { search: 'gauze', limit: 6, active_only: true };
    expect(mockMedicalItems).toHaveBeenCalledWith(params);
    expect(mockGearItems).toHaveBeenCalledWith(params);
  });

  it('skips a half the viewer cannot read', async () => {
    const { hits } = await searchChecklistCatalog('a', { gear: false, medical: true }, 6);

    expect(mockGearItems).not.toHaveBeenCalled();
    expect(hits.map((h) => h.item.id)).toEqual(['m-1']);
  });

  it('never lists one row twice', async () => {
    mockGearItems.mockResolvedValue(page([{ id: 'm-1', name: 'Gauze 4x4' }]));

    const { hits } = await searchChecklistCatalog('a', { gear: true, medical: true }, 6);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.domain).toBe('medical');
  });

  it('caps the merged list at the limit', async () => {
    mockMedicalItems.mockResolvedValue(
      page([
        { id: 'm-1', name: 'a' },
        { id: 'm-2', name: 'b' },
      ])
    );

    const { hits } = await searchChecklistCatalog('a', { gear: true, medical: true }, 2);

    expect(hits.map((h) => h.item.id)).toEqual(['m-1', 'm-2']);
  });

  it('reports a failed half as incomplete and keeps what did answer', async () => {
    mockMedicalItems.mockRejectedValue(new Error('offline'));

    const { hits, incomplete } = await searchChecklistCatalog('a', { gear: true, medical: true }, 6);

    expect(incomplete).toBe(true);
    expect(hits.map((h) => h.item.id)).toEqual(['g-1']);
  });
});

describe('getCatalogItemLots', () => {
  beforeEach(() => {
    mockGearLots.mockReset();
    mockMedicalLots.mockReset();
    mockGearLots.mockResolvedValue([]);
    mockMedicalLots.mockResolvedValue([]);
  });

  it('reads a medical item through the medical endpoint', async () => {
    await getCatalogItemLots('m-1', 'medical');

    expect(mockMedicalLots).toHaveBeenCalledWith('m-1');
    expect(mockGearLots).not.toHaveBeenCalled();
  });

  it('reads a gear item through the gear endpoint', async () => {
    await getCatalogItemLots('g-1', 'gear');

    expect(mockGearLots).toHaveBeenCalledWith('g-1');
    expect(mockMedicalLots).not.toHaveBeenCalled();
  });
});
