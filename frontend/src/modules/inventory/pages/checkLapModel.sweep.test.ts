import { describe, expect, it } from 'vitest';

import {
  bulkClaim,
  stopFailures,
  contentsAreSealed,
  expiryUrgency,
  sealBlockers,
  shownQuantity,
  stopMapState,
  stopRestocks,
  sweepSummary,
  unreadGauges,
  type AnswerMap,
  type LapStop,
} from './checkLapModel';

import type { CheckItemSpec } from './CheckItemControls';

/**
 * The derivations the sweep adds on top of the lap's rules.
 *
 * The rules themselves — level is not bulk-confirmable, an intact seal clears
 * counting but never a date or a gauge — are covered by `CheckLap.test.tsx` and
 * are deliberately not restated here. What is new is the arithmetic the sweep
 * puts on screen: what a map segment says, what the bulk button claims, and
 * what the finish screen owes the crew.
 */
const count = (id: string, par: number): CheckItemSpec => ({ id, name: id, checkType: 'count', expectedQuantity: par });
const fn = (id: string): CheckItemSpec => ({ id, name: id, checkType: 'function' });
const level = (id: string): CheckItemSpec => ({ id, name: id, checkType: 'level', minLevel: 100 });
const expiry = (id: string): CheckItemSpec => ({ id, name: id, checkType: 'expiry', expirationDate: '2027-01-01' });
const stop = (id: string, items: CheckItemSpec[], over: Partial<LapStop> = {}): LapStop => ({
  id,
  name: id,
  items,
  ...over,
});

describe('bulkClaim', () => {
  it('names the number of items it speaks for, and what it claims about them', () => {
    expect(bulkClaim([count('a', 2), count('b', 4), count('c', 1), count('d', 6)])?.label).toBe('All 4 counts at par');
    expect(bulkClaim([fn('a'), fn('b'), fn('c'), fn('d'), fn('e'), fn('f')])?.label).toBe('All 6 work');
    expect(bulkClaim([count('a', 2), fn('b')])?.label).toBe('All 2 good');
  });

  it('covers only what somebody can claim from where they are standing', () => {
    // A gauge is a number nobody has looked at; a printed date is read off the
    // vial in your hand. Neither can be claimed for a whole cabinet, so neither
    // is in the count — and the label cannot disagree with the set it answers,
    // because they come back together.
    const mixed = bulkClaim([count('a', 2), count('b', 4), count('c', 1), count('d', 6), expiry('e'), level('g')]);
    expect(mixed?.label).toBe('All 4 counts at par');
    expect(mixed?.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);

    expect(bulkClaim([level('g'), level('h')])).toBeNull();
    expect(bulkClaim([expiry('e')])).toBeNull();
  });
});

describe('stopRestocks', () => {
  it('is short of par, not a failure and not an absence of one', () => {
    const s = stop('s', [count('a', 4), count('b', 4), count('c', 4)]);
    const answers: AnswerMap = {
      a: { status: 'pass', quantityFound: 2 },
      b: { status: 'pass', quantityFound: 4 },
      // Unanswered: no reading yet, which is not the same as being short.
      c: {},
    };
    expect(stopRestocks(s, answers).map((i) => i.id)).toEqual(['a']);
  });
});

describe('stopMapState', () => {
  const s = stop('s', [count('a', 4), fn('b')]);

  it('ranks what the crew has to act on above how far through they are', () => {
    expect(stopMapState(s, { a: { status: 'pass', quantityFound: 4 }, b: { status: 'fail' } })).toBe('fault');
    // A fault outranks a restock in the same stop.
    expect(stopMapState(s, { a: { status: 'pass', quantityFound: 1 }, b: { status: 'fail' } })).toBe('fault');
    expect(stopMapState(s, { a: { status: 'pass', quantityFound: 1 }, b: { status: 'pass' } })).toBe('restock');
    expect(stopMapState(s, { a: { status: 'pass', quantityFound: 4 }, b: { status: 'pass' } })).toBe('complete');
  });

  it('reads a part-answered stop as left to do', () => {
    // The strip answers "what is left"; half a stop is left.
    expect(stopMapState(s, { a: { status: 'pass', quantityFound: 4 } })).toBe('untouched');
    expect(stopMapState(s, {})).toBe('untouched');
  });
});

describe('unreadGauges', () => {
  it('is what keeps a gauge stop from being finished by a claim', () => {
    const s = stop('s', [level('g1'), level('g2'), fn('f')]);
    expect(unreadGauges(s, {}).map((i) => i.id)).toEqual(['g1', 'g2']);
    expect(unreadGauges(s, { g1: { levelReading: 120 } }).map((i) => i.id)).toEqual(['g2']);
    expect(unreadGauges(s, { g1: { levelReading: 120 }, g2: { levelReading: 0 } })).toEqual([]);
  });
});

describe('sweepSummary', () => {
  const stops = [
    stop('Cab', [fn('lights'), fn('siren')]),
    stop('EMS', [count('gauze', 10), count('saline', 6), expiry('epi')]),
  ];

  it('sorts every item into exactly one consequence, and counts the rest', () => {
    const summary = sweepSummary(stops, {
      lights: { status: 'pass' },
      siren: { status: 'fail' },
      gauze: { status: 'pass', quantityFound: 4 },
      saline: { status: 'pass', quantityFound: 6 },
      epi: {},
    });

    expect(summary.faults.map((e) => e.item.id)).toEqual(['siren']);
    expect(summary.restocks.map((e) => e.item.id)).toEqual(['gauze']);
    expect(summary.unanswered.map((e) => e.item.id)).toEqual(['epi']);
    // lights and saline: answered, nothing to report, one line rather than two.
    expect(summary.goodCount).toBe(2);
    expect(summary.answeredCount).toBe(4);
    expect(summary.totalCount).toBe(5);
  });

  it('carries the stop an exception belongs to, because going there is the action', () => {
    const summary = sweepSummary(stops, {});
    expect(summary.unanswered[0]).toMatchObject({ stopNumber: 1, stopName: 'Cab' });
    expect(summary.unanswered[2]).toMatchObject({ stopNumber: 2, stopName: 'EMS' });
  });

  it('does not hold the crew to items an intact seal has answered', () => {
    const sealed = stop('Drug box', [count('morphine', 2), expiry('midaz')], {
      isSealed: true,
      seal: { status: 'intact', tagNumber: 'M2-40871' },
    });
    const summary = sweepSummary([sealed], {});

    // The count is cleared by the tag; the date is not, because a date moves
    // while the box sits shut. So one item is owed, not two.
    expect(summary.totalCount).toBe(1);
    expect(summary.unanswered.map((e) => e.item.id)).toEqual(['midaz']);
  });
});

describe('contentsAreSealed', () => {
  const box = (seal?: LapStop['seal']): LapStop => ({
    id: 'drugs',
    name: 'Drug box',
    isSealed: true,
    ...(seal ? { seal } : {}),
    items: [],
  });

  it('is false until somebody has actually read the tag', () => {
    // The predicate reads as "sealed and not broken", which quietly answers
    // the counting inside for a crew that has not looked at the container.
    // A seal is evidence; an unread one is not.
    expect(contentsAreSealed(box())).toBe(false);
    expect(contentsAreSealed(box({ tagNumber: 'M2-40871' }))).toBe(false);
  });

  it('is true only on a tag the crew has confirmed matches', () => {
    expect(contentsAreSealed(box({ status: 'intact', tagNumber: 'M2-40871' }))).toBe(true);
  });

  it('is false on a broken tag, and on a container that is not sealed at all', () => {
    expect(contentsAreSealed(box({ status: 'broken' }))).toBe(false);
    expect(contentsAreSealed({ id: 'cab', name: 'Cab', items: [] })).toBe(false);
  });
});

describe('carried counts', () => {
  const carried = (over: Partial<CheckItemSpec> = {}): CheckItemSpec => ({
    id: 'gauze',
    name: 'Roller gauze',
    checkType: 'count',
    expectedQuantity: 10,
    ...over,
  });

  it('shows what was last counted, because par is what the truck should hold and this is what it did', () => {
    expect(shownQuantity(carried({ carriedQuantity: 12 }))).toBe(12);
    expect(shownQuantity(carried())).toBe(10);
    expect(shownQuantity({ id: 'x', name: 'x', checkType: 'count' })).toBeNull();
  });

  it('stops claiming "at par" once a carried number is not par', () => {
    // The label is the claim. "All 1 count at par" over a carried 12 would be
    // a button that says one thing and writes another.
    expect(bulkClaim([carried({ carriedQuantity: 12 })])?.label).toBe('All 1 counts as carried');
    expect(bulkClaim([carried({ carriedQuantity: 10 })])?.label).toBe('All 1 count at par');
    expect(bulkClaim([carried()])?.label).toBe('All 1 count at par');
  });

  it('spells out the quantity it is claiming, so par cannot be written over a surplus', () => {
    expect(bulkClaim([carried({ carriedQuantity: 12 })])?.quantities).toEqual({ gauze: 12 });
    expect(bulkClaim([carried()])?.quantities).toEqual({ gauze: 10 });
  });
});

describe('sealBlockers', () => {
  const today = new Date('2026-06-01T12:00:00');
  const dated = (id: string, date: string, over: Partial<CheckItemSpec> = {}): CheckItemSpec => ({
    id,
    name: id,
    checkType: 'expiry',
    expirationDate: date,
    ...over,
  });

  const tray = (items: CheckItemSpec[], children?: LapStop[]): LapStop => ({
    id: 'tray',
    name: 'Medication tray',
    isSealed: true,
    seal: { status: 'intact' },
    items,
    ...(children ? { children } : {}),
  });

  it('grades an expiry against the pull window the item itself sets', () => {
    expect(expiryUrgency(dated('a', '2026-05-30'), today)).toBe('expired');
    expect(expiryUrgency(dated('b', '2026-06-20'), today)).toBe('due');
    expect(expiryUrgency(dated('c', '2026-09-01'), today)).toBe('ok');
    expect(expiryUrgency(dated('d', '2026-06-20', { expirationWarningDays: 5 }), today)).toBe('ok');
    expect(expiryUrgency({ id: 'e', name: 'e', checkType: 'function' }, today)).toBe('none');
  });

  it('names what forces the container open', () => {
    expect(sealBlockers(tray([dated('epi', '2026-05-30')]), today).map((i) => i.id)).toEqual(['epi']);
    expect(sealBlockers(tray([dated('epi', '2026-09-01')]), today)).toEqual([]);
  });

  it('looks inside the pockets, which are behind the same seal', () => {
    const stop = tray([], [{ id: 'sleeve', name: 'Sleeve', items: [dated('midaz', '2026-05-01')] }]);
    expect(sealBlockers(stop, today).map((i) => i.id)).toEqual(['midaz']);
  });

  it('ignores a container that is not sealed at all', () => {
    expect(sealBlockers({ id: 'cab', name: 'Cab', items: [dated('epi', '2026-05-30')] }, today)).toEqual([]);
  });

  it('stops an intact tag standing in for contents that have to come out', () => {
    // This is the whole rule: the tag proves nothing was taken, and proves
    // nothing at all about whether what is left is still usable.
    expect(contentsAreSealed(tray([dated('epi', '2026-09-01')]), today)).toBe(true);
    expect(contentsAreSealed(tray([dated('epi', '2026-05-30')]), today)).toBe(false);
  });
});

describe('a shortfall is one thing, reported once', () => {
  const gauze: CheckItemSpec = { id: 'gauze', name: 'Gauze', checkType: 'count', expectedQuantity: 10 };
  const siren: CheckItemSpec = { id: 'siren', name: 'Siren', checkType: 'function' };
  const stop: LapStop = { id: 's', name: 'EMS', items: [gauze, siren] };

  it('reports a short count as a restock and not as a fault', () => {
    // It is stored `fail` — the server rewrites it to that anyway and the
    // out-of-service verdict is built on it — but showing it in both places
    // would put one shortfall on screen twice: once as something to act on
    // now, once as a supply order.
    const answers: AnswerMap = { gauze: { status: 'fail', quantityFound: 6 } };
    expect(stopRestocks(stop, answers).map((i) => i.id)).toEqual(['gauze']);
    expect(stopFailures(stop, answers)).toEqual([]);
  });

  it('still reports a genuine fault as one', () => {
    const answers: AnswerMap = { siren: { status: 'fail' } };
    expect(stopFailures(stop, answers).map((i) => i.id)).toEqual(['siren']);
  });

  it('reports a count that failed for some other reason as a fault', () => {
    // At par and still failed is not a shortfall, so nothing hides it.
    const answers: AnswerMap = { gauze: { status: 'out_of_service', quantityFound: 10 } };
    expect(stopFailures(stop, answers).map((i) => i.id)).toEqual(['gauze']);
  });
});
