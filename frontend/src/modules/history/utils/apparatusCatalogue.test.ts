import { describe, expect, it } from 'vitest';
import {
  EMPTY_APPARATUS_FORM,
  apparatusForCreate,
  apparatusForUpdate,
  blankDesignation,
  type ApparatusForm,
} from './apparatusCatalogue';

const filled = (overrides: Partial<ApparatusForm> = {}): ApparatusForm => ({
  ...EMPTY_APPARATUS_FORM,
  name: ' 1924 Ahrens-Fox ',
  year: '1924',
  pump_gpm: '1,000',
  make: '  ',
  designations: [
    { ...blankDesignation(), designation: ' Engine 1 ', station_id: 's1' },
    { ...blankDesignation(), designation: '   ' },
  ],
  ...overrides,
});

describe('apparatusForCreate', () => {
  it('omits blanks and numbers that are not whole numbers', () => {
    const payload = apparatusForCreate(filled());
    expect(payload.name).toBe('1924 Ahrens-Fox');
    expect(payload.year).toBe(1924);
    expect('pump_gpm' in payload).toBe(false);
    expect(payload.make).toBeUndefined();
    expect(payload.designations).toEqual([expect.objectContaining({ designation: 'Engine 1', station_id: 's1' })]);
  });

  it('leaves out a fraction or a negative figure rather than sending it', () => {
    const payload = apparatusForCreate(filled({ tank_gallons: '12.5', ladder_feet: '-3' }));
    expect('tank_gallons' in payload).toBe(false);
    expect('ladder_feet' in payload).toBe(false);
  });
});

describe('apparatusForUpdate', () => {
  it('sends a cleared field as null so the clear is saved (pitfall #1)', () => {
    const payload = apparatusForUpdate(filled({ year: '', current_location: '', apparatus_type_id: '' }));
    expect(payload.year).toBeNull();
    expect(payload.current_location).toBeNull();
    expect(payload.apparatus_type_id).toBeNull();
    expect(payload.make).toBeNull();
  });

  it('sends every designation, so a removed one is removed', () => {
    expect(apparatusForUpdate(filled({ designations: [] })).designations).toEqual([]);
  });
});
