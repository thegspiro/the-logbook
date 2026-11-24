import { describe, it, expect } from 'vitest';
import { describePreset, initialRoleNeeds } from './outreachRoles';

const ROLES = [
  { value: 'tour_guide', label: 'Tour Guide' },
  { value: 'greeter', label: 'Greeter' },
];
const TYPES = [
  {
    value: 'station_tour',
    label: 'Station Tour',
    default_roles: [
      { role: 'tour_guide', count: 2 },
      { role: 'retired_role', count: 1 },
    ],
  },
  { value: 'other', label: 'Other' },
];

describe('outreach role presets', () => {
  it('starts a sheet from the type preset, without roles no longer configured', () => {
    expect(initialRoleNeeds(TYPES, 'station_tour', ROLES)).toEqual([{ role: 'tour_guide', count: 2 }]);
  });

  it('falls back to one of the first role for a type with no preset', () => {
    expect(initialRoleNeeds(TYPES, 'other', ROLES)).toEqual([{ role: 'tour_guide', count: 1 }]);
    expect(initialRoleNeeds(TYPES, undefined, ROLES)).toEqual([{ role: 'tour_guide', count: 1 }]);
    expect(initialRoleNeeds(TYPES, 'other', [])).toEqual([]);
  });

  it('describes a preset by label, and a removed role by its value', () => {
    expect(describePreset(TYPES[0]?.default_roles, ROLES)).toBe('2 × Tour Guide, 1 × retired_role');
    expect(describePreset(undefined, ROLES)).toBe('');
  });

  it('names an optional role as optional', () => {
    expect(
      describePreset(
        [
          { role: 'tour_guide', count: 2 },
          { role: 'greeter', count: 1, essential: false },
        ],
        ROLES
      )
    ).toBe('2 × Tour Guide, 1 × Greeter (optional)');
  });
});
