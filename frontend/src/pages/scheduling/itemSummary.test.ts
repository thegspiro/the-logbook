import { describe, expect, it } from 'vitest';
import type { CheckType } from '@/modules/scheduling/types/equipmentCheck';
import { formatItemSummary, type ItemSummarySource } from './itemSummary';

const item = (overrides: Partial<ItemSummarySource> = {}): ItemSummarySource => ({
  checkType: 'function',
  isRequired: false,
  requiredQuantity: '',
  expectedQuantity: '',
  criticalMinimumQuantity: '',
  minLevel: '',
  levelUnit: '',
  serialNumber: '',
  lotNumber: '',
  hasExpiration: false,
  expirationDate: '',
  ...overrides,
});

const texts = (overrides: Partial<ItemSummarySource>) => formatItemSummary(item(overrides)).map(({ text }) => text);

describe('formatItemSummary', () => {
  it.each<[CheckType, string]>([
    ['function', 'Function'],
    ['count', 'Count'],
    ['level', 'Level'],
    ['expiry', 'Expiry'],
    ['text', 'Statement'],
    ['header', 'Section Header'],
  ])('labels a configured %s item', (checkType, label) => {
    const configuration =
      checkType === 'count'
        ? { expectedQuantity: '2' }
        : checkType === 'level'
          ? { minLevel: '500' }
          : checkType === 'expiry'
            ? { lotNumber: 'LOT-1' }
            : {};
    expect(texts({ checkType, ...configuration })[0]).toBe(label);
  });

  it('uses the most consequential configuration and never returns more than two labels', () => {
    expect(
      texts({
        checkType: 'count',
        expectedQuantity: '4',
        isRequired: true,
        hasExpiration: true,
        expirationDate: '2027-01-01',
      })
    ).toEqual(['Count', 'Par 4']);
    expect(texts({ checkType: 'level', minLevel: '500', levelUnit: 'psi', isRequired: true })).toEqual([
      'Level',
      'Minimum 500 psi',
    ]);
    expect(texts({ isRequired: true })).toEqual(['Function', 'Required']);
    expect(texts({ hasExpiration: true, expirationDate: '2027-01-01', isRequired: true })).toEqual([
      'Function',
      'Expiration tracked',
    ]);
  });

  it('puts incomplete and invalid configuration ahead of ordinary metadata', () => {
    expect(texts({ checkType: 'count', isRequired: true })).toEqual(['Needs quantity']);
    expect(texts({ checkType: 'level' })).toEqual(['Needs minimum']);
    expect(texts({ checkType: 'expiry' })).toEqual(['Needs serial or lot']);
    expect(texts({ hasExpiration: true })).toEqual(['Needs expiration date']);
    expect(texts({ checkType: 'count', expectedQuantity: '4', criticalMinimumQuantity: '4' })).toEqual([
      'Fix critical minimum',
    ]);
  });

  it('shows both validation problems while preserving the two-label limit', () => {
    const summary = formatItemSummary(item({ checkType: 'count', hasExpiration: true }));
    expect(summary.map(({ text }) => text)).toEqual(['Needs quantity', 'Needs expiration date']);
    expect(summary.every(({ tone }) => tone === 'problem')).toBe(true);
  });
});
