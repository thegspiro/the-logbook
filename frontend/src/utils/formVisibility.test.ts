import { describe, it, expect } from 'vitest';
import { conditionMatches, getDescendantFieldIds, getVisibleFieldIds } from './formVisibility';
import type { ConditionalField } from './formVisibility';

// The backend twin is FormsService._visible_field_ids; test_form_branching.py
// asserts the same cases there, so a change to one side fails on both.

const field = (id: string, field_type: string, rule?: [string, string, string?]): ConditionalField => ({
  id,
  field_type,
  ...(rule ? { condition_field_id: rule[0], condition_operator: rule[1], condition_value: rule[2] } : {}),
});

// The form built in the W60 drive.
const intake = [
  field('certified', 'radio'),
  field('which', 'checkbox', ['certified', 'equals', 'yes']),
  field('card', 'text', ['which', 'contains', 'EMT']),
  field('name', 'text'),
];

describe('getVisibleFieldIds (workflow review W60)', () => {
  it('hides a follow-up whose own question is hidden, whatever answer it still holds', () => {
    expect(getVisibleFieldIds(intake, { certified: 'no', which: 'EMT' })).toEqual(new Set(['certified', 'name']));
  });

  it('shows the whole branch once every level is answered', () => {
    expect(getVisibleFieldIds(intake, { certified: 'yes', which: 'EMT,Paramedic' })).toEqual(
      new Set(['certified', 'which', 'card', 'name'])
    );
  });

  it('keeps a negative rule under a hidden question hidden', () => {
    const fields = [...intake, field('why-not', 'text', ['card', 'is_empty'])];
    expect(getVisibleFieldIds(fields, { certified: 'no' }).has('why-not')).toBe(false);
  });

  it('matches "contains" against a whole checkbox option, not a substring', () => {
    expect(getVisibleFieldIds(intake, { certified: 'yes', which: 'AEMT' }).has('card')).toBe(false);
  });

  it('keeps "contains" a substring match on free text', () => {
    const fields = [field('notes', 'text'), field('ems', 'text', ['notes', 'contains', 'ems'])];
    expect(getVisibleFieldIds(fields, { notes: 'I do EMS calls' }).has('ems')).toBe(true);
  });

  it('judges a rule naming a missing question against an empty answer', () => {
    const fields = [field('a', 'text', ['gone', 'is_empty']), field('b', 'text', ['gone', 'equals', 'yes'])];
    expect(getVisibleFieldIds(fields, {})).toEqual(new Set(['a']));
  });

  it('terminates on a cycle and judges each rule on its own', () => {
    const fields = [field('a', 'text', ['b', 'not_empty']), field('b', 'text', ['a', 'not_empty'])];
    expect(getVisibleFieldIds(fields, { a: 'x', b: 'y' })).toEqual(new Set(['a', 'b']));
    expect(getVisibleFieldIds(fields, {})).toEqual(new Set());
  });
});

describe('conditionMatches', () => {
  it('treats an unknown operator as passing so the question stays required', () => {
    expect(conditionMatches(field('x', 'text', ['p', 'bogus']), '')).toBe(true);
  });
});

describe('getDescendantFieldIds', () => {
  it('returns the field and everything that branches from it', () => {
    expect(getDescendantFieldIds(intake, 'certified')).toEqual(new Set(['certified', 'which', 'card']));
    expect(getDescendantFieldIds(intake, 'name')).toEqual(new Set(['name']));
  });
});
