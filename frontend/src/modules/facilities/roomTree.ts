/**
 * Room hierarchy helpers.
 *
 * Rooms can be nested — a quartermaster's storage space inside the volunteer
 * office — and the API returns the facility's rooms as one flat list with a
 * `parentRoomId` on each. Everything that has to show that shape (the rooms
 * section, the cross-module room picker) builds its tree from here rather
 * than re-deriving it.
 */

import type { Room } from './types';

export interface RoomNode {
  room: Room;
  /** 0 for a room sitting directly on the facility */
  depth: number;
  children: RoomNode[];
}

/** Separator between path segments, outermost space first. */
export const ROOM_PATH_SEPARATOR = ' › ';

function compareRooms(a: Room, b: Room): number {
  const orderA = a.sortOrder ?? 0;
  const orderB = b.sortOrder ?? 0;
  if (orderA !== orderB) return orderA - orderB;
  return a.name.localeCompare(b.name);
}

/**
 * Build the nesting tree for a flat list of rooms.
 *
 * A room whose parent is missing from the list (filtered out, on another
 * page, or deleted between fetches) is surfaced at the top level rather than
 * dropped — a room the user cannot see is worse than one shown a level up.
 */
export function buildRoomTree(rooms: Room[]): RoomNode[] {
  const byId = new Map<string, Room>(rooms.map((room) => [room.id, room]));
  const childrenByParent = new Map<string, Room[]>();
  const roots: Room[] = [];

  for (const room of rooms) {
    const parentId = room.parentRoomId;
    // Self-parenting is rejected by the API, but a corrupt row must not hang the render.
    if (parentId && parentId !== room.id && byId.has(parentId)) {
      const siblings = childrenByParent.get(parentId);
      if (siblings) {
        siblings.push(room);
      } else {
        childrenByParent.set(parentId, [room]);
      }
    } else {
      roots.push(room);
    }
  }

  const visited = new Set<string>();

  const toNode = (room: Room, depth: number): RoomNode => {
    visited.add(room.id);
    const children = (childrenByParent.get(room.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .sort(compareRooms)
      .map((child) => toNode(child, depth + 1));
    return { room, depth, children };
  };

  return roots.sort(compareRooms).map((room) => toNode(room, 0));
}

/** Flatten a tree back into render order, parents immediately before their children. */
export function flattenRoomTree(nodes: RoomNode[]): RoomNode[] {
  return nodes.flatMap((node) => [node, ...flattenRoomTree(node.children)]);
}

/** Rooms in nesting order, each tagged with its depth. */
export function orderRoomsByHierarchy(rooms: Room[]): RoomNode[] {
  return flattenRoomTree(buildRoomTree(rooms));
}

/** Total rooms nested underneath this node, at any depth. */
export function countDescendants(node: RoomNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

/**
 * Ids of every room nested under `roomId`, plus `roomId` itself.
 *
 * Used to keep a room's own subtree out of its "located inside" picker — a
 * room cannot be moved into one of its own sub-rooms.
 */
export function collectSubtreeIds(rooms: Room[], roomId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const room of rooms) {
    if (!room.parentRoomId) continue;
    const siblings = childrenByParent.get(room.parentRoomId);
    if (siblings) {
      siblings.push(room.id);
    } else {
      childrenByParent.set(room.parentRoomId, [room.id]);
    }
  }

  const subtree = new Set<string>([roomId]);
  const queue = [roomId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const childId of childrenByParent.get(current) ?? []) {
      if (subtree.has(childId)) continue;
      subtree.add(childId);
      queue.push(childId);
    }
  }
  return subtree;
}

/**
 * Human-readable containment path, outermost first:
 * "Volunteer Office › Quartermaster's Storage".
 */
export function roomPath(rooms: Room[], roomId: string): string[] {
  const byId = new Map<string, Room>(rooms.map((room) => [room.id, room]));
  const names: string[] = [];
  const seen = new Set<string>();

  let current = byId.get(roomId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentRoomId ? byId.get(current.parentRoomId) : undefined;
  }
  return names;
}

/** `roomPath` joined for display in a single line, e.g. a `<select>` option. */
export function roomPathLabel(rooms: Room[], roomId: string): string {
  return roomPath(rooms, roomId).join(ROOM_PATH_SEPARATOR);
}
