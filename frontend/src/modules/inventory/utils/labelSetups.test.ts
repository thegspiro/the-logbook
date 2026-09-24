import { describe, it, expect, beforeEach } from 'vitest';
import { loadLabelSetups, storeLabelSetups, upsertLabelSetup } from './labelSetups';
import type { LabelSetup } from './labelSetups';

const setup = (name: string, copies = 1): LabelSetup => ({
  name,
  preset: 'rollo_2x1',
  customWidth: '2',
  customHeight: '1',
  symbology: 'qr',
  lines: ['size'],
  copies,
  printerId: null,
});

describe('labelSetups', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips through storage', () => {
    storeLabelSetups([setup('Rollo QR', 2)]);
    expect(loadLabelSetups()).toEqual([setup('Rollo QR', 2)]);
  });

  it('drops malformed entries and clamps what it keeps', () => {
    localStorage.setItem(
      'inventory:labelSetups',
      JSON.stringify([
        { name: '', preset: 'letter' },
        { name: 'No preset' },
        { name: 'Odd', preset: 'letter', copies: 999, symbology: 'bogus', lines: ['size', 'bogus'] },
        'nonsense',
      ])
    );
    const [only, ...rest] = loadLabelSetups();
    expect(rest).toHaveLength(0);
    expect(only).toMatchObject({ name: 'Odd', copies: 50, symbology: 'code128', lines: ['size'] });
  });

  it('survives unreadable storage', () => {
    localStorage.setItem('inventory:labelSetups', '{not json');
    expect(loadLabelSetups()).toEqual([]);
  });

  it('replaces a setup of the same name, whatever its case, in place', () => {
    const next = upsertLabelSetup([setup('A'), setup('Rollo QR'), setup('B')], setup('rollo qr', 3));
    expect(next.map((s) => [s.name, s.copies])).toEqual([
      ['A', 1],
      ['rollo qr', 3],
      ['B', 1],
    ]);
  });
});
