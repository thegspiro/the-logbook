import { describe, it, expect } from 'vitest';
import { containerTypeLabel, daysUntil, isPresetContainerType } from './equipmentCheck';

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

describe('daysUntil', () => {
  // Moved here from CheckItemControls.test.tsx when the four controls were
  // deleted. The function outlived them: expiryUrgency, the sweep's expiry row
  // and the seal-blocker rule all count days with it.
  it('returns null for a missing or unparseable date', () => {
    expect(daysUntil(null, new Date())).toBeNull();
    expect(daysUntil('not-a-date', new Date())).toBeNull();
  });

  it('is zero on the day itself', () => {
    const today = new Date(2026, 7, 23);
    expect(daysUntil('2026-08-23', today)).toBe(0);
  });

  it('is negative once past', () => {
    const today = new Date(2026, 7, 23);
    expect(daysUntil('2026-08-20', today)).toBe(-3);
  });
});
