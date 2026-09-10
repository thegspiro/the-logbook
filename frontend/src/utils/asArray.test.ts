/**
 * The two halves of one decision, and why a service has to pick.
 *
 * `api.get<T[]>(...)` asserts the wire format rather than verifying it, so a
 * captive portal or proxy answering HTTP 200 with an HTML body hands a
 * component something that is not an array. Every service read faces the same
 * fork: degrade to empty, or fail.
 *
 * Getting it wrong in either direction has cost this codebase a real defect.
 * Swallowing where the list is a claim rendered "no ranks configured" to a
 * department that had a full ladder. Not swallowing at all crashed two
 * scheduling settings sections through the ErrorBoundary.
 */

import { describe, it, expect } from 'vitest';
import { asArray, expectArray } from './asArray';

const NOT_ARRAYS = [
  ['a proxy error page', '<html>502 Bad Gateway</html>'],
  ['an error object', { detail: 'Not Found' }],
  ['null', null],
  ['undefined', undefined],
  ['a number', 0],
] as const;

describe('asArray — keep the page alive', () => {
  it('passes a real array through untouched', () => {
    const ranks = [{ id: 'r1' }, { id: 'r2' }];

    // Same reference, not a copy: callers compare and memoize on it.
    expect(asArray(ranks)).toBe(ranks);
  });

  it.each(NOT_ARRAYS)('degrades %s to an empty list', (_label, body) => {
    expect(asArray(body as unknown as unknown[])).toEqual([]);
  });
});

describe('expectArray — keep the page honest', () => {
  it('passes a real array through untouched', () => {
    const rules = [{ name: 'shift-open' }];

    expect(expectArray(rules, 'notification rules')).toBe(rules);
  });

  it.each(NOT_ARRAYS)('throws on %s rather than reporting emptiness', (_label, body) => {
    expect(() => expectArray(body as unknown as unknown[], 'notification rules')).toThrow(TypeError);
  });

  it('names the thing, because a page reads more than one endpoint', () => {
    // "response was not an array" from a screen that loads four lists says
    // nothing about which one; the name is what makes the error actionable.
    expect(() => expectArray(undefined as unknown as unknown[], 'open positions')).toThrow(/open positions/);
  });

  it('accepts an empty array — empty is a fine answer, absent is not', () => {
    // The distinction the whole helper turns on. A department really can have
    // nothing excluded; that is not the case being guarded against.
    expect(expectArray([], 'excluded membership types')).toEqual([]);
  });
});
