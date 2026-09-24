import { describe, it, expect } from 'vitest';
import { buildLabelFilterPath, parseLabelPrintQuery } from './labelPrintQuery';

const parse = (path: string) => parseLabelPrintQuery(new URL(path, 'http://x').searchParams);

describe('labelPrintQuery', () => {
  it('round-trips a filter set through the URL, omitting blanks', () => {
    const path = buildLabelFilterPath({
      category_id: 'cat-1',
      search: '  ',
      unassigned_location: true,
      sort_by: 'name',
      sort_order: 'desc',
    });

    expect(path).toBe(
      '/inventory/print-labels?all=1&category_id=cat-1&sort_by=name&unassigned_location=true&sort_order=desc'
    );
    expect(parse(path)).toEqual({
      kind: 'filter',
      filters: { category_id: 'cat-1', unassigned_location: true, sort_by: 'name', sort_order: 'desc' },
    });
  });

  it('carries the needs-a-label filter in both directions', () => {
    const needs = buildLabelFilterPath({ label_printed: false });
    expect(needs).toBe('/inventory/print-labels?all=1&label_printed=false');
    expect(parse(needs)).toEqual({ kind: 'filter', filters: { label_printed: false } });
    expect(parse('/p?all=1&label_printed=true')).toEqual({ kind: 'filter', filters: { label_printed: true } });
    expect(parse('/p?all=1&label_printed=maybe')).toEqual({ kind: 'filter', filters: {} });
  });

  it('treats a bare all=1 as every item', () => {
    expect(parse('/p?all=1')).toEqual({ kind: 'filter', filters: {} });
  });

  it('reads ids, and lets them win over a stale all=1', () => {
    expect(parse('/p?ids=a,,b')).toEqual({ kind: 'ids', ids: ['a', 'b'] });
    expect(parse('/p?all=1&category_id=c&ids=a')).toEqual({ kind: 'ids', ids: ['a'] });
  });

  it('keeps an empty ids param distinct from no request at all', () => {
    expect(parse('/p?ids=')).toEqual({ kind: 'ids', ids: [] });
    expect(parse('/p')).toEqual({ kind: 'none' });
  });

  it('ignores unknown keys and malformed values', () => {
    expect(parse('/p?all=1&organization_id=o&sort_order=sideways&unassigned_location=yes')).toEqual({
      kind: 'filter',
      filters: {},
    });
  });
});
