import { describe, it, expect } from 'vitest';
import { ITEM_CONDITION_OPTIONS, RETURN_CONDITION_OPTIONS } from './enums';

describe('Inventory condition constants', () => {
  it('ITEM_CONDITION_OPTIONS includes out_of_service', () => {
    const values = ITEM_CONDITION_OPTIONS.map((o) => o.value);
    expect(values).toContain('out_of_service');
    expect(values).toContain('excellent');
    expect(values).toContain('good');
    expect(values).toContain('fair');
    expect(values).toContain('poor');
    expect(values).toContain('damaged');
    expect(values).toContain('retired');
    expect(values).toHaveLength(7);
  });

  it('RETURN_CONDITION_OPTIONS excludes out_of_service', () => {
    const values = RETURN_CONDITION_OPTIONS.map((o) => o.value);
    expect(values).not.toContain('out_of_service');
    expect(values).toContain('excellent');
    expect(values).toContain('good');
    expect(values).toContain('fair');
    expect(values).toContain('poor');
    expect(values).toContain('damaged');
    expect(values).toHaveLength(5);
  });

  it('RETURN_CONDITION_OPTIONS is a subset of ITEM_CONDITION_OPTIONS', () => {
    const allValues = ITEM_CONDITION_OPTIONS.map((o) => o.value);
    for (const opt of RETURN_CONDITION_OPTIONS) {
      expect(allValues).toContain(opt.value);
    }
  });

  it('all options have value and label', () => {
    for (const opt of ITEM_CONDITION_OPTIONS) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
    }
    for (const opt of RETURN_CONDITION_OPTIONS) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
    }
  });
});
