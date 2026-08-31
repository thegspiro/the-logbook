import { describe, expect, it } from 'vitest';

import { toLapStops } from './checkSweepAdapter';
import { contentsAreSealed, sealBlockers, shownQuantity, stopItems } from './checkLapModel';

import type { CheckTemplateCompartment, CheckTemplateItem } from '@/modules/scheduling/types/equipmentCheck';

const item = (over: Partial<CheckTemplateItem> & { id: string }): CheckTemplateItem => ({
  compartmentId: 'c',
  name: over.id,
  sortOrder: 0,
  checkType: 'count',
  isRequired: true,
  hasExpiration: false,
  expirationWarningDays: 30,
  ...over,
});

const comp = (over: Partial<CheckTemplateCompartment> & { id: string }): CheckTemplateCompartment => ({
  templateId: 't',
  name: over.id,
  sortOrder: 0,
  items: [],
  ...over,
});

describe('toLapStops — structure', () => {
  it('walks the compartments in sort order, not payload order', () => {
    const stops = toLapStops({
      compartments: [comp({ id: 'b', sortOrder: 2 }), comp({ id: 'a', sortOrder: 1 })],
    });
    expect(stops.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('puts a pocket inside its bag rather than beside it', () => {
    // The accordion on main renders every compartment as a sibling, so a
    // pocket shows up next to the bag it is physically inside. This is the
    // deliberate change.
    const stops = toLapStops({
      compartments: [
        comp({ id: 'bag', sortOrder: 1 }),
        comp({ id: 'front', sortOrder: 1, parentCompartmentId: 'bag' }),
        comp({ id: 'main', sortOrder: 2, parentCompartmentId: 'bag' }),
      ],
    });
    expect(stops.map((s) => s.id)).toEqual(['bag']);
    expect(stops[0]?.children?.map((c) => c.id)).toEqual(['front', 'main']);
  });

  it('nests as deep as the template goes', () => {
    const stops = toLapStops({
      compartments: [
        comp({ id: 'bag' }),
        comp({ id: 'main', parentCompartmentId: 'bag' }),
        comp({ id: 'sleeve', parentCompartmentId: 'main' }),
      ],
    });
    expect(stops[0]?.children?.[0]?.children?.[0]?.id).toBe('sleeve');
  });

  it('drops a section divider, which is layout rather than a place', () => {
    const stops = toLapStops({
      compartments: [comp({ id: 'ems-section', isHeader: true }), comp({ id: 'cabinet' })],
    });
    expect(stops.map((s) => s.id)).toEqual(['cabinet']);
  });

  it('keeps a divider that somehow carries items, rather than losing them', () => {
    // Dropping a crew's items to honour a layout flag is the wrong trade.
    const stops = toLapStops({
      compartments: [comp({ id: 'odd', isHeader: true, items: [item({ id: 'gauze' })] })],
    });
    expect(stops.map((s) => s.id)).toEqual(['odd']);
  });

  it('keeps a compartment whose parent does not exist', () => {
    // A template edited across deploys is exactly where a dangling id turns
    // up, and an orphan is still a place on the truck.
    const stops = toLapStops({ compartments: [comp({ id: 'orphan', parentCompartmentId: 'deleted' })] });
    expect(stops.map((s) => s.id)).toEqual(['orphan']);
  });

  it('does not hang on a cycle, and loses nothing to one', () => {
    const stops = toLapStops({
      compartments: [
        comp({ id: 'a', parentCompartmentId: 'b' }),
        comp({ id: 'b', parentCompartmentId: 'a' }),
        comp({ id: 'c', parentCompartmentId: 'c' }),
      ],
    });
    expect(stops.map((s) => s.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('toLapStops — items', () => {
  it('takes par from requiredQuantity where a template carries both columns', () => {
    const stops = toLapStops({
      compartments: [comp({ id: 'c', items: [item({ id: 'gauze', requiredQuantity: 10, expectedQuantity: 4 })] })],
    });
    expect(stops[0]?.items[0]?.expectedQuantity).toBe(10);
  });

  it('carries the last recorded count forward', () => {
    const stops = toLapStops({
      compartments: [comp({ id: 'c', items: [item({ id: 'gauze', requiredQuantity: 10 })] })],
      lastResults: { gauze: { status: 'pass', quantity_found: 12 } },
    });
    expect(shownQuantity(stops[0]?.items[0] as never)).toBe(12);
  });

  it('lets the running on-truck count outrank the last check', () => {
    // It carries everything used since: a crew that pulled two at 03:00 opens
    // at 2, not at the 4 the last check recorded.
    const stops = toLapStops({
      compartments: [comp({ id: 'c', items: [item({ id: 'gauze', requiredQuantity: 10, quantityOnTruck: 2 })] })],
      lastResults: { gauze: { status: 'pass', quantity_found: 4 } },
    });
    expect(stops[0]?.items[0]?.carriedQuantity).toBe(2);
  });

  it('carries a gauge reading, but never as a count', () => {
    const stops = toLapStops({
      compartments: [comp({ id: 'c', items: [item({ id: 'o2', checkType: 'level' })] })],
      lastResults: { o2: { status: 'pass', level_reading: 1800 } },
    });
    expect(stops[0]?.items[0]?.lastLevelReading).toBe(1800);
    expect(stops[0]?.items[0]?.carriedQuantity).toBeUndefined();
  });

  it('reads the soonest date aboard, not the position column', () => {
    // A position holding three boxes holds three dates, and the truck is
    // exposed by its oldest — reading the column reports whichever lot was
    // restocked last.
    const stops = toLapStops({
      compartments: [
        comp({
          id: 'c',
          items: [
            item({
              id: 'epi',
              checkType: 'expiry',
              hasExpiration: true,
              expirationDate: '2030-01-01',
              lotsAboard: [
                { id: 'l1', quantity: 1, isExpired: false, expirationDate: '2027-04-01' },
                { id: 'l2', quantity: 1, isExpired: false, expirationDate: '2026-11-01' },
              ],
            }),
          ],
        }),
      ],
    });
    expect(stops[0]?.items[0]?.expirationDate).toBe('2026-11-01');
  });

  it('ignores a date column the item does not claim to have', () => {
    const stops = toLapStops({
      compartments: [comp({ id: 'c', items: [item({ id: 'x', hasExpiration: false, expirationDate: '2026-09-09' })] })],
    });
    expect(stops[0]?.items[0]?.expirationDate).toBeUndefined();
  });

  it('normalizes a legacy check type on the way through', () => {
    const stops = toLapStops({
      compartments: [comp({ id: 'c', items: [item({ id: 'siren', checkType: 'pass_fail' as never })] })],
    });
    expect(stops[0]?.items[0]?.checkType).toBe('function');
  });
});

describe('toLapStops — seals', () => {
  const bag = (over: Partial<CheckTemplateCompartment> = {}) =>
    comp({ id: 'bag', isSealed: true, items: [item({ id: 'morphine', requiredQuantity: 2 })], ...over });

  it('shows the tag on record before anybody has read it, without claiming it was read', () => {
    const stops = toLapStops({
      compartments: [bag()],
      lastSeals: { bag: { sealNumber: 'M2-40871', intact: true } },
    });
    expect(stops[0]?.seal?.tagNumber).toBe('M2-40871');
    expect(stops[0]?.seal?.status).toBeUndefined();
    expect(contentsAreSealed(stops[0] as never)).toBe(false);
  });

  it('records the crew confirming a matching tag', () => {
    const stops = toLapStops({
      compartments: [bag()],
      seals: { bag: { sealNumber: 'M2-40871', intact: true, confirmed: true, cleared: true } },
    });
    expect(stops[0]?.seal?.status).toBe('intact');
    expect(contentsAreSealed(stops[0] as never)).toBe(true);
  });

  it('keeps an intact-but-unrecognised tag out of the broken pile, and still counts', () => {
    // The tag is physically fine, so calling it broken puts a false record on
    // the check — but an unrecognised number is evidence the bag was opened,
    // so it clears nothing either.
    const stops = toLapStops({
      compartments: [bag()],
      seals: { bag: { sealNumber: 'X-999', intact: true, confirmed: true, cleared: false } },
    });
    expect(stops[0]?.seal?.status).toBe('intact');
    expect(stops[0]?.seal?.cleared).toBe(false);
    expect(contentsAreSealed(stops[0] as never)).toBe(false);
  });

  it('records a broken seal', () => {
    const stops = toLapStops({
      compartments: [bag()],
      seals: { bag: { sealNumber: '', intact: false, confirmed: true, cleared: false } },
    });
    expect(stops[0]?.seal?.status).toBe('broken');
  });

  it('leaves an unsealed compartment with no seal at all', () => {
    const stops = toLapStops({ compartments: [comp({ id: 'cab' })] });
    expect(stops[0]?.isSealed).toBeUndefined();
    expect(stops[0]?.seal).toBeUndefined();
  });

  it('lets an expiring drug in a pocket override the bag it is sealed inside', () => {
    // End to end: the date has to survive the adapter for the seal rule to
    // see it, and the pocket has to be inside the bag for the rule to look.
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const stops = toLapStops({
      compartments: [
        bag(),
        comp({
          id: 'drug-pocket',
          parentCompartmentId: 'bag',
          items: [item({ id: 'epi', checkType: 'expiry', hasExpiration: true, expirationDate: soon })],
        }),
      ],
      seals: { bag: { sealNumber: 'M2-40871', intact: true, confirmed: true, cleared: true } },
    });
    expect(sealBlockers(stops[0] as never).map((i) => i.id)).toEqual(['epi']);
    expect(contentsAreSealed(stops[0] as never)).toBe(false);
    // And nothing was lost getting there.
    expect(stopItems(stops[0] as never).map((i) => i.id)).toEqual(['morphine', 'epi']);
  });
});
