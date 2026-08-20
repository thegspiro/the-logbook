import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}));

import { schedulingService } from './api';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * A shift's `positions` is untyped JSON on the backend and `ShiftCreate`
 * accepts bare strings, so both shapes are on the wire. Consumers — the
 * structured position editor above all, which spreads each entry — treat the
 * field as PositionSlot[]. These lock the shape down at the boundary.
 */
describe('shift position normalization', () => {
  it('converts legacy string seats on a fetched shift', async () => {
    mockGet.mockResolvedValueOnce({
      data: { id: 'shift-1', positions: ['officer', 'driver'], apparatus_positions: ['officer'] },
    });

    const shift = await schedulingService.getShift('shift-1');

    expect(shift.positions).toEqual([
      { position: 'officer', required: true },
      { position: 'driver', required: true },
    ]);
    expect(shift.apparatus_positions).toEqual([{ position: 'officer', required: true }]);
  });

  it('preserves the required flag on structured seats', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        id: 'shift-1',
        positions: [
          { position: 'officer', required: true },
          { position: 'firefighter', required: false },
        ],
      },
    });

    const shift = await schedulingService.getShift('shift-1');

    expect(shift.positions).toEqual([
      { position: 'officer', required: true },
      { position: 'firefighter', required: false },
    ]);
  });

  it('leaves a shift without seats untouched', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'shift-1' } });

    const shift = await schedulingService.getShift('shift-1');

    expect(shift.positions).toBeUndefined();
    expect(shift.apparatus_positions).toBeUndefined();
  });

  it('normalizes seats in the week calendar', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'shift-1', positions: ['ems'] }] });

    const shifts = await schedulingService.getWeekCalendar('2026-08-02');

    expect(shifts[0]?.positions).toEqual([{ position: 'ems', required: true }]);
  });

  it('normalizes seats in the paginated shift list', async () => {
    mockGet.mockResolvedValueOnce({
      data: { shifts: [{ id: 'shift-1', positions: ['ems'] }], total: 1, skip: 0, limit: 25 },
    });

    const result = await schedulingService.getShifts();

    expect(result.total).toBe(1);
    expect(result.shifts[0]?.positions).toEqual([{ position: 'ems', required: true }]);
  });

  it('survives a shift list body that is not an envelope', async () => {
    mockGet.mockResolvedValueOnce({ data: null });

    await expect(schedulingService.getShifts()).resolves.toEqual({ shifts: [] });
  });
});

describe('apparatus position normalization', () => {
  it('converts legacy string seats on the basic apparatus list', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'a1', positions: ['officer', 'driver'] }] });

    const apparatus = await schedulingService.getBasicApparatus();

    expect(apparatus[0]?.positions).toEqual([
      { position: 'officer', required: true },
      { position: 'driver', required: true },
    ]);
  });

  it('converts legacy string seats on the apparatus picker options', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        options: [{ name: 'Engine 1', apparatus_type: 'engine', source: 'basic', positions: ['ems'] }],
        source: 'basic',
      },
    });

    const resp = await schedulingService.getApparatusOptions();

    expect(resp.source).toBe('basic');
    expect(resp.options[0]?.positions).toEqual([{ position: 'ems', required: true }]);
  });
});
