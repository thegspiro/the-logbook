import { describe, it, expect } from 'vitest';
import type { CrrImpactZip } from '../../services/communicationsServices';
import { markerRadius, placedZips } from './crrImpact';

const zip = (overrides: Partial<CrrImpactZip>): CrrImpactZip => ({
  zip_code: '22046',
  city: 'Falls Church',
  state: 'VA',
  latitude: 38.8856,
  longitude: -77.1802,
  activities: 1,
  counts: [],
  ...overrides,
});

describe('markerRadius', () => {
  it('scales by area, so four times the work reads as twice the size', () => {
    const one = markerRadius(1, 4) - 6;
    const four = markerRadius(4, 4) - 6;
    expect(four / one).toBeCloseTo(2);
  });

  it('gives the busiest ZIP the largest circle and never shrinks below the floor', () => {
    expect(markerRadius(4, 4)).toBe(20);
    expect(markerRadius(0, 4)).toBe(6);
    expect(markerRadius(3, 0)).toBe(6);
  });
});

describe('placedZips', () => {
  it('keeps only ZIP codes with a known centre', () => {
    const placed = placedZips([zip({}), zip({ zip_code: '00000', latitude: null, longitude: null })]);
    expect(placed.map((z) => z.zip_code)).toEqual(['22046']);
  });
});
