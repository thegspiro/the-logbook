import { describe, expect, it } from 'vitest';
import { FACILITY_DETAIL_SECTIONS } from '../facilityDetailSections';

describe('Facility detail section contract', () => {
  it('registers every section advertised in the application page catalog', () => {
    expect(FACILITY_DETAIL_SECTIONS.map((section) => section.id)).toEqual([
      'overview',
      'rooms',
      'systems',
      'maintenance',
      'inspections',
      'utilities',
      'contacts',
      'access-keys',
      'shutoffs',
      'capital-projects',
      'insurance',
      'occupants',
      'compliance',
    ]);
  });
});
