import { describe, expect, it } from 'vitest';

import { toAnswerMap, toItemResult } from './checkSweepBridge';
import { stopRestocks } from './checkLapModel';

import type { ItemResult } from './EquipmentCheckForm';

describe('toAnswerMap', () => {
  it('hands the results the form already keeps straight to the sweep', () => {
    // The point of the function is the type check around it: if ItemResult
    // ever grows a field the sweep's answer shape does not have, this stops
    // compiling and names it, rather than the field being dropped at runtime.
    const results: Record<string, ItemResult> = {
      gauze: { status: 'pass', quantityFound: 12 },
      epi: { status: 'fail', expiryConfirmed: true, notes: 'Expired' },
    };
    expect(toAnswerMap(results).gauze).toEqual({ status: 'pass', quantityFound: 12 });
    expect(toAnswerMap(results).epi?.expiryConfirmed).toBe(true);
  });
});

describe('toItemResult', () => {
  it('keeps everything the record needs', () => {
    expect(toItemResult({ status: 'pass', quantityFound: 4, notes: 'ok' })).toEqual({
      status: 'pass',
      quantityFound: 4,
      notes: 'ok',
    });
  });

  it('keeps the expiry confirmation, which status alone cannot carry', () => {
    // An expiry sets status from the date — expired fails whatever the crew
    // taps — so without this the row could never tell "read" from "not read"
    // and would keep offering Confirm on a date already confirmed.
    expect(toItemResult({ expiryConfirmed: true, status: 'pass' })).toEqual({
      expiryConfirmed: true,
      status: 'pass',
    });
  });

  it('drops restockNeeded, which is derived rather than recorded', () => {
    // "Came in under par" is a comparison, not a fact about the answer. Stored
    // as well as derived, the two disagree the moment a par changes — and the
    // stored one is the stale half.
    expect(toItemResult({ status: 'pass', quantityFound: 2, restockNeeded: true })).toEqual({
      status: 'pass',
      quantityFound: 2,
    });
  });

  it('leaves the derivation intact after the round trip', () => {
    const stop = {
      id: 's',
      name: 'EMS',
      items: [{ id: 'gauze', name: 'Gauze', checkType: 'count', expectedQuantity: 10 }],
    };
    const stored = toItemResult({ status: 'pass', quantityFound: 6, restockNeeded: true });
    expect(stopRestocks(stop, { gauze: stored }).map((i) => i.id)).toEqual(['gauze']);
  });
});
