import { describe, expect, it } from 'vitest';
import { operationsNavItems, visibleOperationsNavItems } from './operationsNavigation';

const allModulesOn = () => true;

const labelsFor = (isAdministrative: boolean, grants: string[]): string[] =>
  visibleOperationsNavItems(operationsNavItems(allModulesOn, isAdministrative), (permission) =>
    grants.includes(permission)
  ).map((item) => item.label);

// The default member position carries both, which is why neither can tell an
// administrative member from a rider.
const BASELINE_MEMBER = ['inventory.view', 'inventory.check_submit'];

describe('operationsNavItems for an administrative member', () => {
  it('holds back the crew rows from a member with only the baseline grants', () => {
    const labels = labelsFor(true, BASELINE_MEMBER);

    expect(labels).not.toContain('My Checklists');
    expect(labels).not.toContain('Apparatus Inventory');
    expect(labels).toContain('My Issued Gear');
  });

  it('keeps both rows for someone a position has given fleet check access', () => {
    const labels = labelsFor(true, [...BASELINE_MEMBER, 'inventory.check_view']);

    expect(labels).toContain('My Checklists');
    expect(labels).toContain('Apparatus Inventory');
  });

  it('opens My Checklists, but not Apparatus Inventory, for inventory.manage alone', () => {
    // The Apparatus Inventory route does not accept manage, so a row for it
    // would lead to the route's Access Denied.
    const labels = labelsFor(true, [...BASELINE_MEMBER, 'inventory.manage']);

    expect(labels).toContain('My Checklists');
    expect(labels).not.toContain('Apparatus Inventory');
  });

  it('leaves what an Apparatus Manager is granted exactly as it is for anyone else', () => {
    const grants = [...BASELINE_MEMBER, 'inventory.manage', 'inventory.view_medical', 'inventory.check_view'];

    expect(labelsFor(true, grants)).toEqual(labelsFor(false, grants));
    expect(labelsFor(true, grants)).toEqual(expect.arrayContaining(['Inventory', 'Medical Supplies']));
  });
});

describe('operationsNavItems for everyone else', () => {
  it('still offers both crew rows on the baseline grants', () => {
    const labels = labelsFor(false, BASELINE_MEMBER);

    expect(labels).toContain('My Checklists');
    expect(labels).toContain('Apparatus Inventory');
  });

  it('is the same list whether or not the class argument is passed', () => {
    expect(operationsNavItems(allModulesOn)).toEqual(operationsNavItems(allModulesOn, false));
  });
});
