/**
 * Compartment tree flattening for equipment checks.
 *
 * Templates model storage as a tree of compartments (a "pack" inside a "bag"
 * inside a "compartment"). The check form renders one card per top-level
 * compartment, so nested containers are flattened in beneath their parent as
 * synthetic sub-headings. This is a pure helper so the (previously one-level,
 * grandchild-dropping) logic can be unit-tested independently of React.
 */

import type {
  CheckTemplateCompartment,
  CheckTemplateItem,
} from '../types/equipmentCheck';
import { containerTypeLabel } from '../types/equipmentCheck';

export interface FlattenedCompartments {
  /** One entry per top-level compartment, descendants merged into `items`. */
  compartments: CheckTemplateCompartment[];
  /** itemId → full storage path (e.g. "Airway Cabinet › Trauma Bag"). */
  storagePathByItemId: Map<string, string>;
}

function subHeaderName(
  child: CheckTemplateCompartment,
  depth: number,
): string {
  const indent = '› '.repeat(depth);
  const ct = (child.containerType ?? '').trim();
  // Only prefix the container kind when it is something other than the
  // generic default, so a plain "Compartment: Cab" doesn't add noise.
  const prefix =
    ct && ct !== 'compartment'
      ? `${containerTypeLabel(child.containerType)}: `
      : '';
  return `${indent}${prefix}${child.name}`;
}

/**
 * Flatten a compartment tree to any depth. Each top-level compartment keeps
 * its own items first; every descendant is appended below a synthetic header
 * item that names it (with its container type and depth), so no items are ever
 * dropped regardless of nesting depth.
 */
export function flattenCompartmentTree(
  raw: CheckTemplateCompartment[],
): FlattenedCompartments {
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
  const bySortOrder = (
    a: CheckTemplateCompartment,
    b: CheckTemplateCompartment,
  ) => a.sortOrder - b.sortOrder;
  topLevel.sort(bySortOrder);
  for (const siblings of childrenByParent.values()) siblings.sort(bySortOrder);

  const pathById = new Map<string, string>();
  const seen = new Set<string>();

  const collectDescendants = (
    comp: CheckTemplateCompartment,
    parentPath: string,
    depth: number,
    out: CheckTemplateItem[],
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

  const compartments: CheckTemplateCompartment[] = topLevel.map((comp) => {
    seen.add(comp.id);
    const mergedItems: CheckTemplateItem[] = [...comp.items];
    for (const item of comp.items) pathById.set(item.id, comp.name);
    collectDescendants(comp, comp.name, 1, mergedItems);
    return { ...comp, items: mergedItems };
  });

  return { compartments, storagePathByItemId: pathById };
}
