import { describe, it, expect } from 'vitest';
import type { InventoryItem, StorageAreaResponse } from '../types';
import {
  EMPTY_LABEL_NAMES,
  labelExtraLine,
  labelIdentifierLine,
  sanitizeLabelLines,
  storageAreaPaths,
} from './labelLines';

const item = {
  id: 'it-1',
  name: 'Radio',
  barcode: 'INV-1',
  asset_tag: 'INV-1',
  serial_number: 'SN-9',
  condition: 'needs_repair',
  location_id: 'loc-1',
} as InventoryItem;

const area = (id: string, name: string, parent_id?: string) => ({ id, name, parent_id }) as StorageAreaResponse;

describe('labelLines', () => {
  it('keeps only known keys, once each', () => {
    expect(sanitizeLabelLines(['size', 'size', 'bogus', 3, 'no_asset_tag'])).toEqual(['size', 'no_asset_tag']);
    expect(sanitizeLabelLines('size')).toBeNull();
  });

  it('leaves off an identifier the code already shows', () => {
    expect(labelIdentifierLine(item, 'INV-1', [])).toBe('S/N: SN-9');
    expect(labelIdentifierLine(item, 'INV-1', ['no_serial_number'])).toBeNull();
  });

  it('builds the extra line in the chosen order, falling back as the PDF does', () => {
    expect(labelExtraLine(item, ['condition', 'location'], EMPTY_LABEL_NAMES)).toBe('Needs Repair | loc-1');
  });

  it('walks storage areas to the root and survives a cycle', () => {
    const paths = storageAreaPaths([area('a', 'A', 'b'), area('b', 'B', 'a'), area('c', 'C', 'a')]);
    expect(paths.get('c')).toBe('B > A > C');
    expect(paths.get('a')).toBe('B > A');
  });
});
