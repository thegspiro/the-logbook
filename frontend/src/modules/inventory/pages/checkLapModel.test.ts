/**
 * The rules a walk is read by, independent of any screen.
 *
 * These lived in `CheckLap.test.tsx` until that component was deleted — it was
 * a second crew experience nothing ever rendered. The component tests went with
 * it; these did not, because they are about the model the sweep now runs on:
 * what counts as a question, when a stop is finished, and exactly how far an
 * intact tamper seal's word extends.
 */

import { describe, expect, it } from 'vitest';

import {
  answerableItems,
  bulkConfirmable,
  isStopComplete,
  sealCannotClear,
  stopFailures,
  stopItems,
  type LapStop,
} from './checkLapModel';
import type { CheckItemSpec } from './CheckItemControls';

const fn = (id: string, name: string): CheckItemSpec => ({ id, name, checkType: 'function' });
const count = (id: string, name: string, par = 2): CheckItemSpec => ({
  id,
  name,
  checkType: 'count',
  expectedQuantity: par,
});
const level = (id: string, name: string): CheckItemSpec => ({ id, name, checkType: 'level', minLevel: 500 });

const stop = (id: string, name: string, items: CheckItemSpec[], over: Partial<LapStop> = {}): LapStop => ({
  id,
  name,
  items,
  ...over,
});

const pocket = (id: string, name: string, items: CheckItemSpec[]): LapStop =>
  stop(id, name, items, { containerType: 'pocket' });

const bag = (over: Partial<LapStop> = {}): LapStop =>
  stop('bag', 'Airway bag', [fn('tag', 'Seal tag matches')], {
    isSealed: true,
    containerType: 'bag',
    children: [
      pocket('p1', 'Front pocket · airways', [count('a1', 'i-gel size 4', 2)]),
      pocket('p2', 'Main compartment', [count('a2', 'ET tube 7.5', 2)]),
      pocket('p3', 'Side pocket · dressings', [count('a3', 'Gauze', 4)]),
    ],
    ...over,
  });

/** Well clear of any pull window. */
const FAR_OFF = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
/** Inside the default 30-day pull window. */
const DUE_SOON = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

const WALL = stop('s2', "Exterior · officer's side", [fn('i2', 'Scene light, rear'), fn('i3', 'Ladder')]);

describe('what counts as a question', () => {
  it('counts items through pockets', () => {
    const b = stop('b', 'Airway bag', [fn('x', 'Tag')], {
      children: [stop('p1', 'Front pocket', [count('y', 'i-gel')])],
    });
    expect(stopItems(b).map((i) => i.id)).toEqual(['x', 'y']);
  });

  it('does not treat layout rows as questions', () => {
    const s = stop('s', 'Wall', [
      { id: 'h', name: 'Wall mounts', checkType: 'header' },
      { id: 't', name: 'Then the shelf below', checkType: 'text' },
      fn('a', 'Suction'),
    ]);
    expect(answerableItems(s).map((i) => i.id)).toEqual(['a']);
    // A stop of pure layout is complete because it asks nothing.
    expect(isStopComplete(stop('e', 'Notes', [{ id: 'h2', name: 'X', checkType: 'header' }]), {})).toBe(true);
  });

  it('is incomplete until every question is answered', () => {
    expect(isStopComplete(WALL, {})).toBe(false);
    expect(isStopComplete(WALL, { i2: { status: 'pass' } })).toBe(false);
    expect(isStopComplete(WALL, { i2: { status: 'pass' }, i3: { status: 'pass' } })).toBe(true);
  });

  it('does not count "not_checked" as answered', () => {
    expect(isStopComplete(stop('s1', 'Cab', [fn('i1', 'Seat belts')]), { i1: { status: 'not_checked' } })).toBe(false);
  });

  it('treats out of service as a failure', () => {
    expect(stopFailures(WALL, { i2: { status: 'out_of_service' } }).map((i) => i.id)).toEqual(['i2']);
  });

  it('excludes levels from a bulk claim', () => {
    // Inventing a gauge reading is a fabricated record on the one type whose
    // whole purpose is the stored value.
    const items = [fn('a', 'Siren'), level('b', 'O2'), count('c', 'Gauze')];
    expect(bulkConfirmable(items).map((i) => i.id)).toEqual(['a', 'c']);
  });
});

describe('how far the word of a seal extends', () => {
  it('names what a seal cannot vouch for', () => {
    const items: CheckItemSpec[] = [
      fn('a', 'Siren'),
      count('b', 'Gauze', 4),
      level('c', 'O2 cylinder'),
      { id: 'd', name: 'Epinephrine', checkType: 'expiry', expirationDate: '2026-09-02' },
      { id: 'e', name: 'Saline', checkType: 'count', expectedQuantity: 2, expirationDate: '2026-10-01' },
    ];
    // A seal proves nothing was touched. It cannot stop a drug expiring or a
    // cylinder losing pressure, and an expiring item is excluded whatever its
    // type — hence the count with a date on it.
    expect(sealCannotClear(items).map((i) => i.id)).toEqual(['c', 'd', 'e']);
  });

  it('clears the counting inside, so the tag is the whole check', () => {
    // Nothing in this bag expires or holds pressure.
    expect(
      isStopComplete(bag({ seal: { status: 'intact', tagNumber: 'M2-40871' } }), { tag: { status: 'pass' } })
    ).toBe(true);
  });

  it('does NOT clear an expiry inside — it proves unchanged, not full', () => {
    const withDrug = bag({
      seal: { status: 'intact', tagNumber: 'M2-40871' },
      children: [
        pocket('p1', 'Front pocket · airways', [count('a1', 'i-gel size 4', 2)]),
        // Far out on purpose: this is about the seal not clearing a date, not
        // about the date being close. A fixed date drifts into the pull window
        // as the calendar moves and starts failing for the reason below.
        pocket('pd', 'Drug pocket', [
          { id: 'epi', name: 'Epinephrine 1:1000', checkType: 'expiry', expirationDate: FAR_OFF },
        ]),
      ],
    });
    // A drug expires whether or not anybody opened the bag. Hiding it behind
    // an intact tag is the one thing this rule exists to prevent.
    expect(isStopComplete(withDrug, { tag: { status: 'pass' } })).toBe(false);
    expect(isStopComplete(withDrug, { tag: { status: 'pass' }, epi: { status: 'pass' } })).toBe(true);
  });

  it('stops clearing anything once something inside is due to be pulled', () => {
    const withDueDrug = bag({
      seal: { status: 'intact', tagNumber: 'M2-40871' },
      children: [
        pocket('p1', 'Front pocket · airways', [count('a1', 'i-gel size 4', 2)]),
        pocket('pd', 'Drug pocket', [
          { id: 'epi', name: 'Epinephrine 1:1000', checkType: 'expiry', expirationDate: DUE_SOON },
        ]),
      ],
    });
    // The crew has to open this bag to swap the drug, so the tag has stopped
    // being evidence of anything: the counts inside come back with it.
    expect(isStopComplete(withDueDrug, { tag: { status: 'pass' }, epi: { status: 'pass' } })).toBe(false);
    expect(
      isStopComplete(withDueDrug, { tag: { status: 'pass' }, epi: { status: 'pass' }, a1: { status: 'pass' } })
    ).toBe(true);
  });

  it('does NOT clear a pressure reading inside', () => {
    const withCylinder = bag({
      seal: { status: 'intact', tagNumber: 'M2-40871' },
      children: [pocket('pb', 'Back pocket · O2 D cylinder', [level('o2', 'O2 D cylinder')])],
    });
    // A cylinder loses pressure while the bag sits shut.
    expect(isStopComplete(withCylinder, { tag: { status: 'pass' } })).toBe(false);
  });

  it('makes every pocket count again once it is broken', () => {
    const b = bag({ seal: { status: 'broken', tagNumber: 'M2-40871' } });
    expect(isStopComplete(b, { tag: { status: 'pass' } })).toBe(false);
  });
});
