import { describe, it, expect } from 'vitest';
import { flattenCompartmentTree } from './compartmentTree';
import type { CheckTemplateCompartment } from '../types/equipmentCheck';

function comp(
  over: Partial<CheckTemplateCompartment> & { id: string; name: string },
): CheckTemplateCompartment {
  return {
    templateId: 'tmpl',
    sortOrder: 0,
    items: [],
    ...over,
  };
}

function item(id: string, name: string) {
  return {
    id,
    compartmentId: 'x',
    name,
    sortOrder: 0,
    checkType: 'pass_fail' as const,
    isRequired: false,
    hasExpiration: false,
    expirationWarningDays: 30,
  };
}

describe('flattenCompartmentTree', () => {
  it('keeps top-level compartments as separate cards', () => {
    const { compartments } = flattenCompartmentTree([
      comp({ id: 'a', name: 'Cab', sortOrder: 0, items: [item('i1', 'Radio')] }),
      comp({ id: 'b', name: 'Rear', sortOrder: 1, items: [item('i2', 'Hose')] }),
    ]);
    expect(compartments.map((c) => c.name)).toEqual(['Cab', 'Rear']);
  });

  it('merges a child compartment under its parent with a sub-header', () => {
    const { compartments } = flattenCompartmentTree([
      comp({ id: 'a', name: 'Cabinet', items: [item('i1', 'Gloves')] }),
      comp({
        id: 'b',
        name: 'Trauma Bag',
        containerType: 'bag',
        parentCompartmentId: 'a',
        items: [item('i2', 'Tourniquet')],
      }),
    ]);
    expect(compartments).toHaveLength(1);
    const names = compartments[0]?.items.map((i) => i.name);
    // Parent item, then a synthetic bag sub-header, then the child's item.
    expect(names).toEqual(['Gloves', '› Bag: Trauma Bag', 'Tourniquet']);
  });

  it('recurses to any depth — a pack inside a bag inside a compartment', () => {
    const { compartments, storagePathByItemId } = flattenCompartmentTree([
      comp({ id: 'c', name: 'Compartment', items: [item('i1', 'Flashlight')] }),
      comp({
        id: 'bag',
        name: 'Airway Bag',
        containerType: 'bag',
        parentCompartmentId: 'c',
        items: [item('i2', 'BVM')],
      }),
      comp({
        id: 'pack',
        name: 'IV Pack',
        containerType: 'pack',
        parentCompartmentId: 'bag',
        items: [item('i3', 'IV Catheter')],
      }),
    ]);
    expect(compartments).toHaveLength(1);
    const names = compartments[0]?.items.map((i) => i.name);
    // The grandchild's item must NOT be dropped (the bug this fixes).
    expect(names).toContain('IV Catheter');
    expect(names).toEqual([
      'Flashlight',
      '› Bag: Airway Bag',
      'BVM',
      '› › Pack: IV Pack',
      'IV Catheter',
    ]);
    // Storage path reflects the full location for reports.
    expect(storagePathByItemId.get('i3')).toBe(
      'Compartment › Airway Bag › IV Pack',
    );
    expect(storagePathByItemId.get('i1')).toBe('Compartment');
  });

  it('orders siblings by sortOrder', () => {
    const { compartments } = flattenCompartmentTree([
      comp({ id: 'p', name: 'Parent', items: [] }),
      comp({
        id: 'second',
        name: 'Second',
        parentCompartmentId: 'p',
        sortOrder: 2,
        items: [],
      }),
      comp({
        id: 'first',
        name: 'First',
        parentCompartmentId: 'p',
        sortOrder: 1,
        items: [],
      }),
    ]);
    const headers = compartments[0]?.items
      .filter((i) => i.checkType === 'header')
      .map((i) => i.name);
    expect(headers).toEqual(['› First', '› Second']);
  });

  it('does not infinite-loop on a parent cycle', () => {
    const { compartments } = flattenCompartmentTree([
      comp({ id: 'a', name: 'A', parentCompartmentId: 'b', items: [] }),
      comp({ id: 'b', name: 'B', parentCompartmentId: 'a', items: [] }),
    ]);
    // A cycle leaves nothing at the top level; the guard prevents a hang.
    expect(compartments).toEqual([]);
  });
});
