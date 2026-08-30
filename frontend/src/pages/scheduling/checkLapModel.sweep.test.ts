import { describe, expect, it } from 'vitest';

import {
  bulkClaim,
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
