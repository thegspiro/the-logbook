/**
 * Template compartments → the stops the sweep walks.
 *
 * The template is stored the way an admin builds it: a flat list of
 * compartments carrying `parentCompartmentId`, section dividers mixed in among
 * them, and per-item columns that mean different things depending on which of
 * four types the item is. The sweep wants a walk — an ordered list of places,
 * each holding what to ask there. This is the only place that translation
 * happens, so a rule about it has one home rather than one per screen.
 *
 * **Pockets nest, and stay nested.** The accordion on main reaches the same
 * hierarchy by flattening it: `flattenCompartmentTree` merges an unsealed
 * pocket's items into its parent's card under a synthetic header row, and
 * *promotes* a sealed one to a card of its own, because a seal is a claim
 * about one container and needs a group it can clear on its own. Both are
 * consequences of one card per top-level compartment.
 *
 * The sweep hands over one place at a time, so it needs neither workaround: a
 * pocket is a stop inside a stop, a sealed pocket carries its own seal on its
 * own body, and an outer tag clearing says nothing about an inner one. That is
 * why this returns a tree where the accordion takes a list.
 *
 * Submission still goes through `flattenCompartmentTree` for
 * `storagePathByItemId`, so where an item lives on the record is unchanged.
 *
 * Nothing is ever dropped. A compartment whose parent id points at nothing,
 * or at something that would form a cycle, comes back as a top-level stop —
 * losing a crew's items is a worse failure than an unexpected stop, and a
 * template that has been edited across deploys is exactly where a dangling id
 * turns up.
 */

import {
  CheckType,
  normalizeCheckType,
  soonestExpiration,
  type CheckTemplateCompartment,
  type CheckTemplateItem,
  type LastCheckItemResult,
  type LastSealRecord,
} from '@/modules/inventory/types/equipmentCheck';

import type { SealState as FormSealState } from '@/modules/inventory/components/SealPanel';
import type { CheckItemSpec } from './CheckItemControls';
import type { LapStop, SealState } from './checkLapModel';

export interface SweepSource {
  compartments: CheckTemplateCompartment[];
  /** The crew's answers to each seal so far, keyed by compartment id. */
  seals?: Record<string, FormSealState> | undefined;
  /** What each sealed container's tag read at the last count. */
  lastSeals?: Record<string, LastSealRecord> | undefined;
  /** What the last check recorded, keyed by item id. */
  lastResults?: Record<string, LastCheckItemResult> | undefined;
}

/**
 * Par: what the truck is supposed to hold.
 *
 * `requiredQuantity` wins where both are set, matching `acceptShownCounts` on
 * main — `expectedQuantity` is the older column and some templates carry both.
 */
function par(item: CheckTemplateItem): number | undefined {
  return item.requiredQuantity ?? item.expectedQuantity;
}

/**
 * The number the next crew opens on.
 *
 * The running on-truck count outranks the last check, because it carries
 * everything used since: a crew that pulled two at 03:00 opens this at 2
 * rather than at the 4 the last check recorded. Same precedence the accordion
 * seeds with.
 */
function carried(item: CheckTemplateItem, lastResults: Record<string, LastCheckItemResult> | undefined) {
  return item.quantityOnTruck ?? lastResults?.[item.id]?.quantity_found;
}

function toItemSpec(item: CheckTemplateItem, source: SweepSource): CheckItemSpec {
  const last = source.lastResults?.[item.id];
  const isCount = normalizeCheckType(item.checkType) === CheckType.COUNT;
  const parValue = par(item);
  const carriedValue = isCount ? carried(item, source.lastResults) : undefined;
  // The soonest date *aboard*, not the position's column: a position holding
  // three boxes holds three dates and the truck is exposed by its oldest.
  const expiry = soonestExpiration(item);

  return {
    id: item.id,
    name: item.name,
    checkType: normalizeCheckType(item.checkType),
    ...(item.description !== undefined ? { description: item.description } : {}),
    ...(item.minLevel !== undefined ? { minLevel: item.minLevel } : {}),
    ...(item.levelUnit !== undefined ? { levelUnit: item.levelUnit } : {}),
    ...(last?.level_reading !== undefined ? { lastLevelReading: last.level_reading } : {}),
    ...(parValue !== undefined ? { expectedQuantity: parValue } : {}),
    ...(carriedValue !== undefined ? { carriedQuantity: carriedValue } : {}),
    ...(expiry !== undefined ? { expirationDate: expiry } : {}),
    ...(item.inventoryItemId !== undefined ? { inventoryItemId: item.inventoryItemId } : {}),
    ...(item.expirationWarningDays !== undefined ? { expirationWarningDays: item.expirationWarningDays } : {}),
  };
}

/**
 * The seal as the crew meets it: the number off the record, the answer so far.
 *
 * The two are separate on purpose. The tag number is known before anybody has
 * looked, and `status` stays absent until the crew has actually read it — an
 * unread seal is not evidence of anything, and the model treats it as such.
 *
 * `cleared` is carried across rather than folded into `status`. The sweep's
 * own two buttons only ever produce intact-and-clearing or broken, but the
 * accordion asks the fuller question, and a draft resumed from it can hold an
 * intact tag that does not match the record. Calling that one `broken` would
 * put a broken seal on the record for a tag that is physically fine; calling
 * it `intact` would clear a count that the mismatch is the reason to do.
 */
function toSeal(compartment: CheckTemplateCompartment, source: SweepSource): SealState | undefined {
  if (!compartment.isSealed) return undefined;
  const answered = source.seals?.[compartment.id];
  const last = source.lastSeals?.[compartment.id];
  const onRecord = last?.sealNumber;
  const status = answered?.confirmed ? (answered.intact ? 'intact' : 'broken') : undefined;
  return {
    ...(status !== undefined ? { status } : {}),
    ...(status === 'intact' && answered?.cleared === false ? { cleared: false } : {}),
    ...(onRecord != null ? { tagNumber: onRecord } : {}),
    ...(last?.intact !== undefined ? { priorIntact: last.intact } : {}),
  };
}

export function toLapStops(source: SweepSource): LapStop[] {
  const { compartments } = source;
  const byId = new Map(compartments.map((c) => [c.id, c]));

  /**
   * Whether `compartment` can safely be treated as a child of its parent.
   *
   * Walks up the chain rather than checking one link: a two-deep cycle is the
   * obvious case, but a template edited across several deploys can produce a
   * longer one, and either way the recursion below would not terminate.
   */
  const parentOf = (compartment: CheckTemplateCompartment): string | undefined => {
    const parentId = compartment.parentCompartmentId;
    if (!parentId || parentId === compartment.id || !byId.has(parentId)) return undefined;
    const seen = new Set<string>([compartment.id]);
    let cursor = byId.get(parentId);
    while (cursor) {
      if (seen.has(cursor.id)) return undefined;
      seen.add(cursor.id);
      const next = cursor.parentCompartmentId;
      cursor = next ? byId.get(next) : undefined;
    }
    return parentId;
  };

  const childrenOf = new Map<string, CheckTemplateCompartment[]>();
  const roots: CheckTemplateCompartment[] = [];
  for (const compartment of compartments) {
    // A header is a divider between sections of a flat list. The sweep has no
    // sections — it hands over one place at a time — so a header is not a
    // stop. One that somehow carries items is kept anyway, because dropping
    // a crew's items to honour a layout flag is the wrong trade.
    if (compartment.isHeader && compartment.items.length === 0) continue;
    const parentId = parentOf(compartment);
    if (parentId === undefined) {
      roots.push(compartment);
      continue;
    }
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(compartment);
    else childrenOf.set(parentId, [compartment]);
  }

  const bySortOrder = (a: CheckTemplateCompartment, b: CheckTemplateCompartment) => a.sortOrder - b.sortOrder;

  const build = (compartment: CheckTemplateCompartment): LapStop => {
    const pockets = (childrenOf.get(compartment.id) ?? []).slice().sort(bySortOrder);
    const seal = toSeal(compartment, source);
    return {
      id: compartment.id,
      name: compartment.name,
      ...(compartment.containerType !== undefined ? { containerType: compartment.containerType } : {}),
      ...(compartment.isSealed ? { isSealed: true } : {}),
      ...(seal !== undefined ? { seal } : {}),
      items: compartment.items
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => toItemSpec(item, source)),
      ...(pockets.length > 0 ? { children: pockets.map(build) } : {}),
    };
  };

  return roots.slice().sort(bySortOrder).map(build);
}
