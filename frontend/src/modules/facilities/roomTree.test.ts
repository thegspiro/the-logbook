import { describe, expect, it } from 'vitest';

import type { Room } from './types';
import {
  buildRoomTree,
  collectSubtreeIds,
  countDescendants,
  orderRoomsByHierarchy,
  roomPath,
  roomPathLabel,
} from './roomTree';

function makeRoom(id: string, name: string, parentRoomId?: string | null, sortOrder?: number): Room {
  return {
    id,
    facilityId: 'facility-1',
    name,
    parentRoomId: parentRoomId ?? null,
    ...(sortOrder === undefined ? {} : { sortOrder }),
    createdAt: '2026-08-16T00:00:00Z',
    updatedAt: '2026-08-16T00:00:00Z',
  };
}

const volunteerOffice = makeRoom('office', 'Volunteer Office');
const quartermaster = makeRoom('qm', "Quartermaster's Storage", 'office');
const gearCage = makeRoom('cage', 'Gear Cage', 'qm');
const apparatusBay = makeRoom('bay', 'Apparatus Bay');

describe('buildRoomTree', () => {
  it('nests each room under the room that contains it', () => {
    const tree = buildRoomTree([quartermaster, apparatusBay, volunteerOffice, gearCage]);

    expect(tree.map((node) => node.room.id)).toEqual(['bay', 'office']);
    const office = tree[1];
    expect(office?.children.map((node) => node.room.id)).toEqual(['qm']);
    expect(office?.children[0]?.children.map((node) => node.room.id)).toEqual(['cage']);
    expect(office?.children[0]?.children[0]?.depth).toBe(2);
  });

  it('sorts siblings by sort order, then name', () => {
    const tree = buildRoomTree([
      makeRoom('c', 'Chief Office', null, 2),
      makeRoom('a', 'Alpha Room', null, 5),
      makeRoom('b', 'Bunk Room', null, 2),
    ]);

    expect(tree.map((node) => node.room.id)).toEqual(['b', 'c', 'a']);
  });

  it('surfaces a room whose parent is missing rather than dropping it', () => {
    const orphan = makeRoom('orphan', 'Closet', 'not-loaded');

    const tree = buildRoomTree([orphan]);

    expect(tree.map((node) => node.room.id)).toEqual(['orphan']);
    expect(tree[0]?.depth).toBe(0);
  });

  it('does not recurse forever on a self-parented row', () => {
    const selfParented: Room = { ...makeRoom('loop', 'Loop'), parentRoomId: 'loop' };

    const tree = buildRoomTree([selfParented]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toEqual([]);
  });
});

describe('orderRoomsByHierarchy', () => {
  it('returns parents immediately before their own children', () => {
    const ordered = orderRoomsByHierarchy([gearCage, apparatusBay, quartermaster, volunteerOffice]);

    expect(ordered.map((node) => [node.room.id, node.depth])).toEqual([
      ['bay', 0],
      ['office', 0],
      ['qm', 1],
      ['cage', 2],
    ]);
  });
});

describe('countDescendants', () => {
  it('counts every room underneath, at any depth', () => {
    const [office] = buildRoomTree([volunteerOffice, quartermaster, gearCage]);

    expect(office && countDescendants(office)).toBe(2);
  });
});

describe('collectSubtreeIds', () => {
  it('includes the room and everything nested under it', () => {
    const subtree = collectSubtreeIds([volunteerOffice, quartermaster, gearCage, apparatusBay], 'office');

    expect(subtree).toEqual(new Set(['office', 'qm', 'cage']));
  });

  it('is just the room itself for a leaf', () => {
    const subtree = collectSubtreeIds([volunteerOffice, quartermaster], 'qm');

    expect(subtree).toEqual(new Set(['qm']));
  });
});

describe('roomPath', () => {
  it('reads outermost space first', () => {
    expect(roomPath([volunteerOffice, quartermaster, gearCage], 'cage')).toEqual([
      'Volunteer Office',
      "Quartermaster's Storage",
      'Gear Cage',
    ]);
  });

  it('joins the path for single-line display', () => {
    expect(roomPathLabel([volunteerOffice, quartermaster], 'qm')).toBe("Volunteer Office › Quartermaster's Storage");
  });

  it('stops at an ancestor that is not in the list', () => {
    expect(roomPath([quartermaster], 'qm')).toEqual(["Quartermaster's Storage"]);
  });
});
