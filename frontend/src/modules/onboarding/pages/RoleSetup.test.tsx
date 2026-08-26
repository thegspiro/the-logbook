import { describe, it, expect } from 'vitest';

import { buildPositionTemplates } from './RoleSetup';
import { MODULE_REGISTRY } from '../config/moduleRegistry';
import type { OrganizationType } from '../store';

const idsFor = (organizationType?: OrganizationType): string[] =>
  Object.values(buildPositionTemplates(MODULE_REGISTRY, organizationType))
    .flatMap((category) => category.positions)
    .map((position) => position.id);

const named = (organizationType: OrganizationType, id: string): string | undefined =>
  Object.values(buildPositionTemplates(MODULE_REGISTRY, organizationType))
    .flatMap((category) => category.positions)
    .find((position) => position.id === id)?.name;

describe('buildPositionTemplates — the wizard follows the agency', () => {
  it('offers an EMS-only service no firefighter', () => {
    // Not cosmetic: the save handler creates a system position for any id it
    // does not already know, so an offered-and-ticked Firefighter puts back the
    // exact row the backend declined to seed.
    expect(idsFor('ems_only')).not.toContain('firefighter');
  });

  it('keeps EMT and the whole officer ladder for an EMS-only service', () => {
    const ids = idsFor('ems_only');
    expect(ids).toContain('emt');
    for (const officer of ['fire_chief', 'deputy_chief', 'assistant_chief', 'captain', 'lieutenant']) {
      expect(ids).toContain(officer);
    }
  });

  it('calls the chief a Chief and the engineer a Driver / Operator', () => {
    expect(named('ems_only', 'fire_chief')).toBe('Chief');
    expect(named('ems_only', 'engineer')).toBe('Driver / Operator');
  });

  it('leaves a fire department exactly as it was', () => {
    const ids = idsFor('fire_department');
    expect(ids).toContain('firefighter');
    expect(ids).toContain('emt');
    expect(named('fire_department', 'fire_chief')).toBe('Fire Chief');
    expect(named('fire_department', 'engineer')).toBe('Engineer / Driver Operator');
  });

  it('treats a combined agency as a fire department', () => {
    expect(idsFor('fire_ems_combined')).toEqual(idsFor('fire_department'));
  });

  it('falls back to the full set when the agency is unknown', () => {
    // Matches the backend fallback. A department shown one position too many
    // can untick it; one shown too few has no indication anything is absent —
    // and this is the path a wizard resumed with a cleared store takes.
    expect(idsFor(undefined)).toEqual(idsFor('fire_department'));
  });

  it('renames without dropping, so nothing goes missing on the way', () => {
    // fire_chief is renamed for ems_only and must still be offered; a filter
    // that ran on the renamed entry would lose it.
    expect(idsFor('ems_only')).toContain('fire_chief');
    expect(idsFor('ems_only').length).toBe(idsFor('fire_department').length - 1);
  });
});
