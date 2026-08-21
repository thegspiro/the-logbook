import { describe, expect, it } from 'vitest';
import { descendantCompartmentIds, storedInsideOptions } from './equipmentCheckHierarchy';

type Compartment = Parameters<typeof storedInsideOptions>[0][number];

const compartment = (id: string, name: string, parentCompartmentId = ''): Compartment => ({
  id,
  name,
  parentCompartmentId,
  description: '',
  imageUrl: '',
  isHeader: false,
  containerType: 'compartment',
  items: [],
});

describe('EquipmentCheckTemplateBuilder Stored Inside options', () => {
  it('excludes the current compartment and all descendants while showing their paths', () => {
    const root = compartment('root', 'Cab');
    const current = compartment('current', 'Cabinet', 'root');
    const child = compartment('child', 'Shelf', 'current');
    const grandchild = compartment('grandchild', 'Bin', 'child');
    const sibling = compartment('sibling', 'Cabinet', 'root');
    const compartments = [root, current, child, grandchild, sibling];

    expect([...descendantCompartmentIds(compartments, current.id)]).toEqual(['child', 'grandchild']);
    expect(storedInsideOptions(compartments, current)).toEqual([
      { id: 'root', label: 'Compartment: Cab' },
      { id: 'sibling', label: 'Compartment: Cab › Cabinet' },
    ]);
  });

  it('excludes section headers because they cannot contain equipment', () => {
    const current = compartment('current', 'Cab');
    const destination = compartment('destination', 'Medical bag');
    const section = { ...compartment('section', 'Supplies'), isHeader: true };

    expect(storedInsideOptions([current, destination, section], current)).toEqual([
      { id: 'destination', label: 'Compartment: Medical bag' },
    ]);
  });
});
