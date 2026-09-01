/**
 * What answering an item stores.
 *
 * These rules used to be asserted through the four controls in
 * `CheckItemControls`, which the sweep replaced and this change deletes. They
 * are asserted here instead, against the module that owns them, because they
 * are the rules a well-meaning refactor flattens — short of par quietly
 * becoming a failure, an emptied box reading as zero, an expired unit passing
 * because somebody confirmed they looked at it — and they should not depend on
 * any particular layout being around to catch it.
 */

import { describe, expect, it } from 'vitest';

import { countAnswer, expiryAnswer, levelAnswer } from './checkAnswers';

import type { CheckItemSpec } from './CheckItemControls';

const item = (over: Partial<CheckItemSpec> = {}): CheckItemSpec => ({ id: 'i1', name: 'Item', ...over });

const inDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('countAnswer', () => {
  it('counting is answering, and at par is a pass', () => {
    expect(countAnswer(item({ expectedQuantity: 24 }), 24)).toEqual({
      quantityFound: 24,
      status: 'pass',
      restockNeeded: false,
    });
  });

  it('records short of par as a failure, because that is what gets stored', () => {
    // The server rewrites any quantity under the required one to `fail`
    // whatever is sent, and the accordion stores `fail` too. Storing `pass`
    // here told a crew the truck had no fault immediately before the saved
    // report gave it one. The restock/fault distinction is kept in what the
    // sweep reports — see stopFailures and stopRestocks.
    expect(countAnswer(item({ expectedQuantity: 24 }), 23)).toEqual({
      quantityFound: 23,
      status: 'fail',
      restockNeeded: true,
    });
  });

  it('never stores a negative count', () => {
    expect(countAnswer(item({ expectedQuantity: 2 }), -1).quantityFound).toBe(0);
  });

  it('raises no restock line where there is no par to fall short of', () => {
    expect(countAnswer(item(), 3).restockNeeded).toBe(false);
  });
});

describe('levelAnswer', () => {
  it('stores the reading rather than reducing it to a tick', () => {
    expect(levelAnswer(item({ minLevel: 500 }), '1850')).toEqual({ levelReading: 1850, status: 'pass' });
  });

  it('fails a reading under the threshold', () => {
    expect(levelAnswer(item({ minLevel: 500 }), '400')).toEqual({ levelReading: 400, status: 'fail' });
  });

  it('reads an emptied box as unread, not as zero', () => {
    // Zero would report an empty cylinder and open a swap task for a gauge
    // nobody has looked at.
    expect(levelAnswer(item({ minLevel: 500 }), '')).toEqual({ levelReading: undefined, status: 'not_checked' });
  });

  it('passes a reading on a gauge with no threshold set', () => {
    expect(levelAnswer(item(), '90')).toEqual({ levelReading: 90, status: 'pass' });
  });
});

describe('expiryAnswer', () => {
  it('records that the date was read, and passes one still in date', () => {
    expect(expiryAnswer(item({ expirationDate: inDays(200) }))).toEqual({ expiryConfirmed: true, status: 'pass' });
  });

  it('fails an expired unit whatever the crew confirms', () => {
    // The department's own record says the thing aboard is out of date.
    // Confirming that you read it does not make it usable.
    expect(expiryAnswer(item({ expirationDate: inDays(-3) }))).toEqual({ expiryConfirmed: true, status: 'fail' });
  });

  it('confirms an item with no date on record rather than failing it', () => {
    expect(expiryAnswer(item())).toEqual({ expiryConfirmed: true, status: 'pass' });
  });
});
