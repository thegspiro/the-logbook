/**
 * The cases that a split(',') parser gets wrong, and which of them a supply
 * catalog actually contains.
 */

import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvRecords, csvValue, normalizeHeader } from './csv';

describe('parseCsv', () => {
  it('splits plain rows and columns', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a quoted comma inside its own field', () => {
    // The case that motivated this: splitting on the comma shifts every
    // column after it, so the quantity gets read out of the unit column.
    expect(parseCsv('name,qty\n"Gauze Pads, 4x4 Sterile",4')).toEqual([
      ['name', 'qty'],
      ['Gauze Pads, 4x4 Sterile', '4'],
    ]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('size\n"2"" hose"')).toEqual([['size'], ['2" hose']]);
  });

  it('keeps a newline inside a quoted field', () => {
    expect(parseCsv('notes\n"line one\nline two"')).toEqual([['notes'], ['line one\nline two']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads the last row when the file has no trailing newline', () => {
    expect(parseCsv('a\n1')).toEqual([['a'], ['1']]);
  });

  it('drops blank lines rather than emitting empty rows', () => {
    expect(parseCsv('a\n\n1\n\n')).toEqual([['a'], ['1']]);
  });

  it('trims an unquoted field but not a quoted one', () => {
    expect(parseCsv('a,b\n  padded  ,"  kept  "')).toEqual([
      ['a', 'b'],
      ['padded', '  kept  '],
    ]);
  });

  it('preserves empty fields in the middle of a row', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('treats a quote mid-field as literal text', () => {
    // Not valid RFC 4180, but real files contain it and dropping the row
    // would be worse than reading it as written.
    expect(parseCsv('a\n2" hose')).toEqual([['a'], ['2" hose']]);
  });
});

describe('parseCsvRecords', () => {
  it('keys rows by normalized header', () => {
    const { rows } = parseCsvRecords('Item Name,Check Type\nGauze,quantity');
    expect(rows[0]).toEqual({ 'item name': 'Gauze', 'check type': 'quantity' });
  });

  it('reports the headers it found', () => {
    const { headers } = parseCsvRecords('Item_Name,QTY\nGauze,4');
    expect(headers).toEqual(['item name', 'qty']);
  });

  it('fills missing trailing columns with empty strings', () => {
    const { rows } = parseCsvRecords('a,b,c\n1,2');
    expect(rows[0]).toEqual({ a: '1', b: '2', c: '' });
  });

  it('returns nothing for a file with no header row', () => {
    expect(parseCsvRecords('')).toEqual({ headers: [], rows: [] });
  });
});

describe('normalizeHeader', () => {
  it('collapses spelling variants onto one key', () => {
    expect(normalizeHeader('Item_Type')).toBe(normalizeHeader('ITEM TYPE'));
    expect(normalizeHeader('  Serial-Number ')).toBe('serial number');
  });
});

describe('csvValue', () => {
  const record = { 'item name': 'Gauze', qty: '' };

  it('reads the first alias that is present', () => {
    expect(csvValue(record, 'Name', 'Item Name')).toBe('Gauze');
  });

  it('skips an alias whose value is empty', () => {
    expect(csvValue({ ...record, quantity: '4' }, 'qty', 'quantity')).toBe('4');
  });

  it('returns an empty string when no alias matches', () => {
    expect(csvValue(record, 'nothing')).toBe('');
  });
});
