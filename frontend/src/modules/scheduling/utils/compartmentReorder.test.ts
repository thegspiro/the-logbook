import { describe, expect, it } from 'vitest';
import {
  canonicalCompartmentOrder,
  moveCompartment,
  orderedCompartmentIds,
  orderedCompartments,
  reorderCompartment,
  reparentCompartment,
} from './compartmentTree';

type Node = { id: string; parentCompartmentId: string; header?: boolean };
const nodes: Node[] = [
  { id: 'root-a', parentCompartmentId: '' },
  { id: 'child-a', parentCompartmentId: 'root-a' },
  { id: 'grand-a', parentCompartmentId: 'child-a' },
  { id: 'child-b', parentCompartmentId: 'root-a', header: true },
  { id: 'root-header', parentCompartmentId: '', header: true },
  { id: 'root-b', parentCompartmentId: '' },
  { id: 'child-c', parentCompartmentId: 'root-b' },
  { id: 'grand-b', parentCompartmentId: 'child-c' },
];
const ids = (value: Node[]) => value.map((node) => node.id);

describe('compartment tree ordering', () => {
  it('constructs a depth-first visible tree with headers at their actual depth', () => {
    expect(orderedCompartments(nodes).map(({ node, depth }) => [node.id, depth])).toEqual([
      ['root-a', 0],
      ['child-a', 1],
      ['grand-a', 2],
      ['child-b', 1],
      ['root-header', 0],
      ['root-b', 0],
      ['child-c', 1],
      ['grand-b', 2],
    ]);
  });

  it('keyboard movement reorders only siblings at every depth', () => {
    expect(ids(moveCompartment(nodes, 'root-b', 'up'))).toEqual([
      'root-a',
      'child-a',
      'grand-a',
      'child-b',
      'root-b',
      'child-c',
      'grand-b',
      'root-header',
    ]);
    expect(ids(moveCompartment(nodes, 'child-b', 'up')).slice(0, 4)).toEqual([
      'root-a',
      'child-b',
      'child-a',
      'grand-a',
    ]);
    expect(ids(moveCompartment(nodes, 'grand-a', 'down'))).toEqual(ids(canonicalCompartmentOrder(nodes)));
  });

  it('dragging a root or nested parent moves its complete subtree', () => {
    expect(ids(reorderCompartment(nodes, 'root-a', 'root-b'))).toEqual([
      'root-header',
      'root-b',
      'child-c',
      'grand-b',
      'root-a',
      'child-a',
      'grand-a',
      'child-b',
    ]);
    expect(ids(reorderCompartment(nodes, 'child-c', 'child-c'))).toEqual(ids(canonicalCompartmentOrder(nodes)));
    expect(ids(reorderCompartment(nodes, 'child-a', 'child-b')).slice(0, 4)).toEqual([
      'root-a',
      'child-b',
      'child-a',
      'grand-a',
    ]);
  });

  it('rejects cross-group drag and reserves parent changes for labeled reparenting', () => {
    expect(reorderCompartment(nodes, 'child-a', 'child-c').find((n) => n.id === 'child-a')?.parentCompartmentId).toBe(
      'root-a'
    );
    const reparented = reparentCompartment(nodes, 'child-a', 'root-b');
    expect(reparented.find((n) => n.id === 'child-a')?.parentCompartmentId).toBe('root-b');
    expect(reparentCompartment(nodes, 'root-a', 'grand-a')).toEqual(nodes);
  });

  it('builds the payload from canonical saved ids and excludes unsaved records', () => {
    expect(orderedCompartmentIds([...nodes, { parentCompartmentId: '' }])).toEqual(
      ids(canonicalCompartmentOrder(nodes))
    );
  });
});
