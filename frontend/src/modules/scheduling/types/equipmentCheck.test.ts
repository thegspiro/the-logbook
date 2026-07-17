import { describe, it, expect } from 'vitest';
import {
  containerTypeLabel,
  isPresetContainerType,
} from './equipmentCheck';

describe('containerTypeLabel', () => {
  it('maps known preset keys to their display label', () => {
    expect(containerTypeLabel('bag')).toBe('Bag');
    expect(containerTypeLabel('pack')).toBe('Pack');
    expect(containerTypeLabel('compartment')).toBe('Compartment');
  });

  it('returns a custom label verbatim', () => {
    expect(containerTypeLabel('Trauma Kit')).toBe('Trauma Kit');
  });

  it('falls back to Compartment when empty or missing', () => {
    expect(containerTypeLabel('')).toBe('Compartment');
    expect(containerTypeLabel(undefined)).toBe('Compartment');
    expect(containerTypeLabel(null)).toBe('Compartment');
  });
});

describe('isPresetContainerType', () => {
  it('is true for preset keys and empty (default) values', () => {
    expect(isPresetContainerType('bag')).toBe(true);
    expect(isPresetContainerType('')).toBe(true);
    expect(isPresetContainerType(undefined)).toBe(true);
  });

  it('is false for a custom label', () => {
    expect(isPresetContainerType('Trauma Kit')).toBe(false);
  });
});
