/**
 * Compartment tree flattening for equipment checks.
 *
 * Templates model storage as a tree of compartments (a "pack" inside a "bag"
 * inside a "compartment"). The check form renders one card per top-level
 * compartment, so nested containers are flattened in beneath their parent as
 * synthetic sub-headings. This is a pure helper so the (previously one-level,
 * grandchild-dropping) logic can be unit-tested independently of React.
 */

import type { CheckTemplateCompartment, CheckTemplateItem } from '../types/equipmentCheck';
import { containerTypeLabel } from '../types/equipmentCheck';

export interface FlattenedCompartments {
  /** One entry per top-level compartment, descendants merged into `items`. */
  compartments: CheckTemplateCompartment[];
  /** itemId → full storage path (e.g. "Airway Cabinet › Trauma Bag"). */
  storagePathByItemId: Map<string, string>;
}

function subHeaderName(child: CheckTemplateCompartment, depth: number): string {
  const indent = '› '.repeat(depth);
  const ct = (child.containerType ?? '').trim();
  // Only prefix the container kind when it is something other than the
  // generic default, so a plain "Compartment: Cab" doesn't add noise.
  const prefix = ct && ct !== 'compartment' ? `${containerTypeLabel(child.containerType)}: ` : '';
  return `${indent}${prefix}${child.name}`;
}

/**
 * Flatten a compartment tree to any depth. Each top-level compartment keeps
 * its own items first; every descendant is appended below a synthetic header
 * item that names it (with its container type and depth), so no items are ever
 * dropped regardless of nesting depth.
 *
 * A sealed container is the exception: it becomes its own card rather than
 * being merged into its parent. The seal is a claim about one bag, and the
 * gesture that clears its contents has to act on that bag alone — merged into
 * a parent it would either clear the parent's own items too or have nothing to
 * attach itself to. Its card is named with its full storage path so two bags
 * with the same name in different cabinets stay distinguishable.
 */
export function flattenCompartmentTree(raw: CheckTemplateCompartment[]): FlattenedCompartments {
  const childrenByParent = new Map<string, CheckTemplateCompartment[]>();
  const topLevel: CheckTemplateCompartment[] = [];
  for (const c of raw) {
    if (c.parentCompartmentId) {
      const siblings = childrenByParent.get(c.parentCompartmentId) ?? [];
      siblings.push(c);
      childrenByParent.set(c.parentCompartmentId, siblings);
    } else {
      topLevel.push(c);
    }
  }
  const bySortOrder = (a: CheckTemplateCompartment, b: CheckTemplateCompartment) => a.sortOrder - b.sortOrder;
  topLevel.sort(bySortOrder);
  for (const siblings of childrenByParent.values()) siblings.sort(bySortOrder);

  const pathById = new Map<string, string>();
  const seen = new Set<string>();

  const collectDescendants = (
    comp: CheckTemplateCompartment,
    parentPath: string,
    depth: number,
    out: CheckTemplateItem[]
  ) => {
    for (const child of childrenByParent.get(comp.id) ?? []) {
      if (seen.has(child.id)) continue; // guard against parent-cycle loops
      seen.add(child.id);
      const childPath = `${parentPath} › ${child.name}`;
      const subHeader: CheckTemplateItem = {
        id: `subheader-${child.id}`,
        compartmentId: comp.id,
        name: subHeaderName(child, depth),
        sortOrder: out.length,
        checkType: 'header',
        isRequired: false,
        hasExpiration: false,
        expirationWarningDays: 0,
      };
      if (child.description) subHeader.description = child.description;
      out.push(subHeader);
      for (const item of child.items) {
        pathById.set(item.id, childPath);
        out.push(item);
      }
      collectDescendants(child, childPath, depth + 1, out);
    }
  };

  // Sealed descendants are pulled out of their parent and emitted as their own
  // cards, immediately after it, so the seal has a group of its own to clear.
  const promoted = new Map<string, CheckTemplateCompartment[]>();

  const collectSealed = (comp: CheckTemplateCompartment, parentPath: string, rootId: string) => {
    for (const child of childrenByParent.get(comp.id) ?? []) {
      const childPath = `${parentPath} › ${child.name}`;
      if (child.isSealed && !seen.has(child.id)) {
        seen.add(child.id);
        const ownItems: CheckTemplateItem[] = [...child.items];
        for (const item of child.items) pathById.set(item.id, childPath);
        collectDescendants(child, childPath, 1, ownItems);
        promoted.set(rootId, [...(promoted.get(rootId) ?? []), { ...child, name: childPath, items: ownItems }]);
        continue;
      }
      collectSealed(child, childPath, rootId);
    }
  };

  const compartments: CheckTemplateCompartment[] = [];
  for (const comp of topLevel) {
    seen.add(comp.id);
    // Sealed children first: collectDescendants below skips anything already
    // seen, which is what keeps a promoted bag out of its parent's list.
    collectSealed(comp, comp.name, comp.id);

    const mergedItems: CheckTemplateItem[] = [...comp.items];
    for (const item of comp.items) pathById.set(item.id, comp.name);
    collectDescendants(comp, comp.name, 1, mergedItems);
    compartments.push({ ...comp, items: mergedItems });
    compartments.push(...(promoted.get(comp.id) ?? []));
  }

  return { compartments, storagePathByItemId: pathById };
}

/**
 * Canonical compartment-tree ordering.
 *
 * Ordinary moves operate on a visible sibling group (nodes with the same
 * parent id). They never reparent a node. Because the canonical array is a
 * depth-first traversal, moving a parent also moves its complete subtree.
 * Reparenting is intentionally exposed as a separate, named operation.
 */
export interface CompartmentNode {
  id?: string;
  parentCompartmentId: string;
}

export interface OrderedCompartment<T> {
  node: T;
  depth: number;
}

/** The parent that determines the node's visible sibling group. */
function visibleParentId(nodes: readonly CompartmentNode[], node: CompartmentNode): string {
  if (!node.parentCompartmentId) return '';
  return nodes.some((candidate) => candidate.id === node.parentCompartmentId) ? node.parentCompartmentId : '';
}

export function canonicalCompartmentOrder<T extends CompartmentNode>(nodes: readonly T[]): T[] {
  const byParent = new Map<string, T[]>();
  const ids = new Set(nodes.flatMap((node) => (node.id ? [node.id] : [])));
  for (const node of nodes) {
    const parent = node.parentCompartmentId && ids.has(node.parentCompartmentId) ? node.parentCompartmentId : '';
    byParent.set(parent, [...(byParent.get(parent) ?? []), node]);
  }

  const result: T[] = [];
  const seen = new Set<T>();
  const visit = (node: T) => {
    if (seen.has(node)) return;
    seen.add(node);
    result.push(node);
    if (node.id) for (const child of byParent.get(node.id) ?? []) visit(child);
  };
  for (const root of byParent.get('') ?? []) visit(root);
  // Cycles cannot form a tree; retain their records rather than losing them.
  for (const node of nodes) visit(node);
  return result;
}

export function orderedCompartments<T extends CompartmentNode>(nodes: readonly T[]): OrderedCompartment<T>[] {
  const byId = new Map(nodes.flatMap((node) => (node.id ? [[node.id, node] as const] : [])));
  return canonicalCompartmentOrder(nodes).map((node) => {
    let depth = 0;
    let parent = byId.get(node.parentCompartmentId);
    const seen = new Set<T>([node]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      depth += 1;
      parent = byId.get(parent.parentCompartmentId);
    }
    // Cyclic records are retained by canonicalCompartmentOrder as fallback
    // roots. Render them as roots too rather than inventing a partial depth.
    if (parent) depth = 0;
    return { node, depth };
  });
}

/** Reorder a saved node relative to another saved node in its visible sibling group. */
export function reorderCompartment<T extends CompartmentNode>(
  nodes: readonly T[],
  activeId: string,
  overId: string
): T[] {
  const active = nodes.find((node) => node.id === activeId);
  const over = nodes.find((node) => node.id === overId);
  if (!active || !over) return [...nodes];
  const parentId = visibleParentId(nodes, active);
  if (parentId !== visibleParentId(nodes, over)) return [...nodes];
  const siblings = nodes.filter((node) => visibleParentId(nodes, node) === parentId);
  const from = siblings.indexOf(active);
  const to = siblings.indexOf(over);
  siblings.splice(from, 1);
  siblings.splice(to, 0, active);
  let siblingIndex = 0;
  const arranged = nodes.map((node) =>
    visibleParentId(nodes, node) === parentId ? (siblings[siblingIndex++] ?? node) : node
  );
  return canonicalCompartmentOrder(arranged);
}

export function moveCompartment<T extends CompartmentNode>(
  nodes: readonly T[],
  id: string,
  direction: 'up' | 'down'
): T[] {
  const active = nodes.find((node) => node.id === id);
  if (!active) return [...nodes];
  const parentId = visibleParentId(nodes, active);
  // Unsaved records are visible but unsupported reorder targets. Select the
  // adjacent persisted sibling so they cannot trap the arrow controls.
  const siblings = nodes.filter((node) => visibleParentId(nodes, node) === parentId && node.id);
  const index = siblings.indexOf(active);
  const target = siblings[index + (direction === 'up' ? -1 : 1)];
  return target?.id ? reorderCompartment(nodes, id, target.id) : [...nodes];
}

export function canMoveCompartment(
  nodes: readonly CompartmentNode[],
  id: string | undefined,
  direction: 'up' | 'down'
): boolean {
  if (!id) return false;
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) return false;
  const parentId = visibleParentId(nodes, node);
  const savedSiblings = nodes.filter((candidate) => visibleParentId(nodes, candidate) === parentId && candidate.id);
  const index = savedSiblings.indexOf(node);
  return direction === 'up' ? index > 0 : index >= 0 && index < savedSiblings.length - 1;
}

/** Explicitly reparent a saved node. This is not performed by ordinary reorder operations. */
export function reparentCompartment<T extends CompartmentNode>(nodes: readonly T[], id: string, parentId: string): T[] {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node || id === parentId) return [...nodes];
  const descendants = new Set<string>();
  let hasCycle = false;
  const collect = (parent: string) => {
    for (const child of nodes.filter((candidate) => candidate.parentCompartmentId === parent)) {
      if (child.id) {
        if (child.id === id || descendants.has(child.id)) {
          hasCycle = true;
          continue;
        }
        descendants.add(child.id);
        collect(child.id);
      }
    }
  };
  collect(id);
  if (hasCycle || (parentId && (!nodes.some((candidate) => candidate.id === parentId) || descendants.has(parentId))))
    return [...nodes];
  return canonicalCompartmentOrder(
    nodes.map((candidate) => (candidate === node ? { ...candidate, parentCompartmentId: parentId } : candidate))
  );
}

export function orderedCompartmentIds(nodes: readonly CompartmentNode[]): string[] {
  return canonicalCompartmentOrder(nodes).flatMap((node) => (node.id ? [node.id] : []));
}
