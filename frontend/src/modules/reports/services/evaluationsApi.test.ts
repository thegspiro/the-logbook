/**
 * The evaluations service tolerates a malformed body on the two responses the
 * member and draft screens destructure, so a bad payload renders an empty
 * state instead of taking the page down.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args) as unknown,
  }),
}));

import { evaluationsService } from './evaluationsApi';

describe('evaluationsService', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('reads draft options from their route, with every list present', async () => {
    mockGet.mockResolvedValue({ data: {} });
    await expect(evaluationsService.draftOptions()).resolves.toEqual({ members: [], evaluators: [], periods: [] });
    expect(mockGet).toHaveBeenCalledWith('/evaluations/draft-options');
  });

  it('keeps live figures it was given and fills in what is missing', async () => {
    mockGet.mockResolvedValue({
      data: { period_name: '2026 Annual', data: { 'training.hours': { available: true, value: 3 } } },
    });
    await expect(evaluationsService.liveData()).resolves.toEqual({
      period_id: null,
      period_name: '2026 Annual',
      coverage_start: null,
      coverage_end: null,
      excluded_ranges: [],
      sources: [],
      data: { 'training.hours': { available: true, value: 3 } },
      note: null,
    });
    expect(mockGet).toHaveBeenCalledWith('/evaluations/mine/live-data');
  });
});
