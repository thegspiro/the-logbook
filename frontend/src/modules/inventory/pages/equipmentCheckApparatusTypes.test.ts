import { describe, it, expect } from 'vitest';
import { APPARATUS_TYPES, apparatusTypeLabel, apparatusTypeOptions } from './equipmentCheckPresets';

/**
 * A type-level checklist reaches a vehicle only when its code matches the one
 * the vehicle stores. The backend's DefaultApparatusType is that vocabulary.
 */
const BACKEND_DEFAULT_TYPES = [
  'engine',
  'ladder',
  'quint',
  'rescue',
  'ambulance',
  'squad',
  'tanker',
  'brush',
  'hazmat',
  'command',
  'utility',
  'boat',
  'atv',
  'staff',
  'reserve',
  'other',
];

describe('checklist apparatus types', () => {
  it('offers exactly the codes a vehicle can carry', () => {
    expect([...APPARATUS_TYPES].sort()).toEqual([...BACKEND_DEFAULT_TYPES].sort());
  });

  it('no longer offers codes no vehicle can have', () => {
    const values = apparatusTypeOptions([], '').map((o) => o.value);
    expect(values).not.toContain('tower');
    expect(values).not.toContain('chief');
  });

  it("adds a custom type from the department's own fleet, once", () => {
    const values = apparatusTypeOptions(['engine', 'heavy_rescue', 'heavy_rescue'], '').map((o) => o.value);
    expect(values.filter((v) => v === 'heavy_rescue')).toHaveLength(1);
    expect(values.filter((v) => v === 'engine')).toHaveLength(1);
  });

  it('keeps the type an existing checklist was saved with, so editing it does not blank the field', () => {
    const options = apparatusTypeOptions([], 'tower');
    expect(options).toContainEqual({ value: 'tower', label: 'Tower' });
  });

  it('labels codes the way a person reads them', () => {
    expect(apparatusTypeLabel('hazmat')).toBe('HazMat');
    expect(apparatusTypeLabel('atv')).toBe('ATV / UTV');
    expect(apparatusTypeLabel('heavy_rescue')).toBe('Heavy rescue');
  });
});
