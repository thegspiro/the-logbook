import { containerTypeLabel } from '@/modules/inventory/types/equipmentCheck';

export interface HierarchyCompartment {
  id?: string;
  name: string;
  containerType: string;
  parentCompartmentId: string;
  isHeader?: boolean;
}

export function descendantCompartmentIds(
  compartments: HierarchyCompartment[],
  compartmentId: string | undefined
): Set<string> {
  if (!compartmentId) return new Set();
  const descendants = new Set<string>();
  const pending = [compartmentId];
  while (pending.length > 0) {
    const parentId = pending.pop();
    for (const compartment of compartments) {
      if (compartment.id && compartment.parentCompartmentId === parentId && !descendants.has(compartment.id)) {
        descendants.add(compartment.id);
        pending.push(compartment.id);
      }
    }
  }
  return descendants;
}

/**
 * Descendant ids of `rootId`, walked from a flat `id -> parentCompartmentId`
 * map rather than a live `HierarchyCompartment[]` — used to compare the
 * *last known server* subtree against the current, possibly locally-edited
 * one (AP-13 finding 2: reparenting has no auto-save path, so the client's
 * in-memory hierarchy can disagree with what the backend still has).
 */
export function descendantIdsFromParentMap(parentById: Map<string, string>, rootId: string): Set<string> {
  const descendants = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const parentId = pending.pop();
    for (const [id, pid] of parentById) {
      if (pid === parentId && !descendants.has(id)) {
        descendants.add(id);
        pending.push(id);
      }
    }
  }
  return descendants;
}

function compartmentPath(compartments: HierarchyCompartment[], compartment: HierarchyCompartment): string {
  const names = [compartment.name || 'Untitled'];
  const visited = new Set<string>();
  let parentId = compartment.parentCompartmentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = compartments.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    names.unshift(parent.name || 'Untitled');
    parentId = parent.parentCompartmentId;
  }
  return names.join(' › ');
}

export function storedInsideOptions(
  compartments: HierarchyCompartment[],
  current: HierarchyCompartment
): Array<{ id: string; label: string }> {
  const unavailable = descendantCompartmentIds(compartments, current.id);
  if (current.id) unavailable.add(current.id);
  return compartments
    .filter(
      (candidate): candidate is HierarchyCompartment & { id: string } =>
        Boolean(candidate.id) && !candidate.isHeader && !unavailable.has(candidate.id as string)
    )
    .map((candidate) => ({
      id: candidate.id,
      label: `${containerTypeLabel(candidate.containerType)}: ${compartmentPath(compartments, candidate)}`,
    }));
}
