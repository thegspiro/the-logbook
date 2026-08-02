import { describe, it, expect } from 'vitest';
import { toDisplayString } from './displayValue';

describe('toDisplayString', () => {
  it('renders nullish values as an empty string', () => {
    expect(toDisplayString(null)).toBe('');
    expect(toDisplayString(undefined)).toBe('');
  });

  it('passes strings through untouched', () => {
    expect(toDisplayString('Engine 1')).toBe('Engine 1');
    expect(toDisplayString('')).toBe('');
  });

  it('stringifies primitives', () => {
    expect(toDisplayString(42)).toBe('42');
    expect(toDisplayString(0)).toBe('0');
    expect(toDisplayString(true)).toBe('true');
    expect(toDisplayString(false)).toBe('false');
    expect(toDisplayString(9007199254740993n)).toBe('9007199254740993');
  });

  it('JSON-encodes objects and arrays instead of rendering [object Object]', () => {
    expect(toDisplayString({ rank: 'Captain' })).toBe('{"rank":"Captain"}');
    expect(toDisplayString([1, 2])).toBe('[1,2]');
  });

  it('returns an empty string for circular structures', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toDisplayString(circular)).toBe('');
  });

  it('describes symbols and functions without throwing', () => {
    expect(toDisplayString(Symbol('shift'))).toBe('shift');
    expect(toDisplayString(function namedFn() {})).toBe('namedFn');
  });
});
