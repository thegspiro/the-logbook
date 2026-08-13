import { describe, expect, it } from 'vitest';
import { FACILITY_DETAIL_SECTIONS, getVisibleFacilitySections } from '../facilityDetailSections';

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

  it('marks exactly the restricted sections as sensitive', () => {
    const sensitiveIds = FACILITY_DETAIL_SECTIONS.filter((section) => section.sensitive).map((section) => section.id);
    expect(sensitiveIds).toEqual(['utilities', 'access-keys', 'capital-projects', 'insurance', 'occupants']);
  });

  it('hides sensitive sections from members without facilities.edit/manage', () => {
    expect(getVisibleFacilitySections(false).map((section) => section.id)).toEqual([
      'overview',
      'rooms',
      'systems',
      'maintenance',
      'inspections',
      'contacts',
      'shutoffs',
      'compliance',
    ]);
  });

  it('shows every section to users with sensitive access', () => {
    expect(getVisibleFacilitySections(true)).toEqual(FACILITY_DETAIL_SECTIONS);
  });
});
