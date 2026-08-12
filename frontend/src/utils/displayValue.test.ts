import { describe, it, expect } from 'vitest';
import { enumLabel, toDisplayString } from './displayValue';

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

describe('enumLabel', () => {
  // CSS `capitalize` uppercases the first letter of each *word*, and a
  // snake_case value is one word — so the impact planner rendered a deputy
  // chief's rank as "Deputy_chief", underscore and all.
  it('turns a snake_case enum into words', () => {
    expect(enumLabel('deputy_chief')).toBe('Deputy Chief');
    expect(enumLabel('building_code')).toBe('Building Code');
  });

  it('leaves a single word capitalised', () => {
    expect(enumLabel('firefighter')).toBe('Firefighter');
  });

  it('keeps acronyms uppercase', () => {
    expect(enumLabel('ada')).toBe('ADA');
    expect(enumLabel('scba_donning')).toBe('SCBA Donning');
  });

  // Apparatus types reach the client lowercased so they can be matched against
  // the skill mappings, which left the manual shift-report form offering
  // "Engine 1 (E-1) — ladder truck".
  it('capitalises every word of a multi-word value', () => {
    expect(enumLabel('ladder truck')).toBe('Ladder Truck');
    expect(enumLabel('brush truck')).toBe('Brush Truck');
  });

  it('capitalises across a slash without breaking the pair apart', () => {
    expect(enumLabel('brush/wildland')).toBe('Brush/Wildland');
    expect(enumLabel('rescue/extrication')).toBe('Rescue/Extrication');
  });

  it('collapses repeated separators rather than emitting blanks', () => {
    expect(enumLabel('heavy  rescue')).toBe('Heavy Rescue');
    expect(enumLabel('  engine  ')).toBe('Engine');
  });

  it('returns an empty string for nothing', () => {
    expect(enumLabel(undefined)).toBe('');
    expect(enumLabel(null)).toBe('');
    expect(enumLabel('')).toBe('');
    expect(enumLabel('   ')).toBe('');
  });
});
