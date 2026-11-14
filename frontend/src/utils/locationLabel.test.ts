import { describe, it, expect } from 'vitest';
import { buildingNotInName } from './locationLabel';

describe('buildingNotInName', () => {
  it('drops the building a facility room name already ends with', () => {
    expect(buildingNotInName('Volunteer Office — Station 1 - Headquarters', 'Station 1 - Headquarters')).toBeNull();
  });

  it('drops it for a nested room whose path ends with the facility', () => {
    expect(
      buildingNotInName('Records Closet — Volunteer Office — Station 1 - Headquarters', 'Station 1 - Headquarters')
    ).toBeNull();
  });

  it('drops a building that is the whole name', () => {
    expect(buildingNotInName('Station 1 - Headquarters', 'Station 1 - Headquarters')).toBeNull();
  });

  it('keeps a building the name does not carry', () => {
    expect(buildingNotInName('Training Room', 'Station 1')).toBe('Station 1');
  });

  it('keeps a building that only appears inside the name, not as its last part', () => {
    expect(buildingNotInName('Station 1 Kitchen', 'Station 1')).toBe('Station 1');
  });

  it('returns null for a blank or missing building', () => {
    expect(buildingNotInName('Training Room', '  ')).toBeNull();
    expect(buildingNotInName('Training Room', null)).toBeNull();
    expect(buildingNotInName('Training Room', undefined)).toBeNull();
  });
});
