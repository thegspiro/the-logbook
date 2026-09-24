/**
 * The URL contract of `/inventory/print-labels`.
 *
 * The page is addressed two ways. `?ids=a,b,c` names items one by one — a
 * hand-picked selection, or a single item from its detail page. `?all=1` plus
 * any of the list filters names "every item matching these filters", which is
 * how a whole category, location or storage area gets labelled without the
 * browser carrying hundreds of ids around: 500 UUIDs is ~18KB of query string,
 * past nginx's default 8KB request-line buffer, so a refresh of an id-addressed
 * batch that size is answered with a 414 before the app ever loads.
 *
 * The filter keys are the ones `GET /inventory/items` accepts, so the page
 * fetches exactly the rows the list showed rather than re-deriving them.
 */

/** The label PDF endpoint's per-request cap, which also bounds a print batch. */
export const MAX_LABEL_BATCH = 500;

/** `?all=1` marks a filter-addressed batch; with no filters it means every item. */
export const ALL_ITEMS_PARAM = 'all';

const STRING_FILTER_KEYS = [
  'search',
  'category_id',
  'status',
  'condition',
  'item_type',
  'location_id',
  'storage_area_id',
  'vendor_id',
  'size',
  'color',
  'style',
  'sort_by',
] as const;

type StringFilterKey = (typeof STRING_FILTER_KEYS)[number];

export type LabelFilterParams = {
  [K in StringFilterKey]?: string | undefined;
} & {
  unassigned_location?: boolean | undefined;
  /** false = only items still needing a label; true = only labelled ones. */
  label_printed?: boolean | undefined;
  sort_order?: 'asc' | 'desc' | undefined;
};

export type LabelPrintRequest =
  { kind: 'ids'; ids: string[] } | { kind: 'filter'; filters: LabelFilterParams } | { kind: 'none' };

/**
 * Serialise a filter set as a print-page URL. Blank values are omitted, so the
 * URL states only the filters that narrow the batch.
 */
export function buildLabelFilterPath(filters: LabelFilterParams): string {
  const qs = new URLSearchParams();
  qs.set(ALL_ITEMS_PARAM, '1');
  for (const key of STRING_FILTER_KEYS) {
    const value = filters[key]?.trim();
    if (value) qs.set(key, value);
  }
  if (filters.unassigned_location) qs.set('unassigned_location', 'true');
  if (filters.label_printed !== undefined) qs.set('label_printed', String(filters.label_printed));
  if (filters.sort_order) qs.set('sort_order', filters.sort_order);
  return `/inventory/print-labels?${qs.toString()}`;
}

/**
 * Read the print page's URL. `ids` wins when both are present, because it is
 * the narrower request: a stale `all=1` must never widen a hand-picked batch
 * into the whole catalogue.
 */
export function parseLabelPrintQuery(params: URLSearchParams): LabelPrintRequest {
  const idsParam = params.get('ids');
  if (idsParam !== null) {
    return { kind: 'ids', ids: idsParam.split(',').filter(Boolean) };
  }
  if (params.get(ALL_ITEMS_PARAM) !== '1') return { kind: 'none' };

  const filters: LabelFilterParams = {};
  for (const key of STRING_FILTER_KEYS) {
    const value = params.get(key)?.trim();
    if (value) filters[key] = value;
  }
  if (params.get('unassigned_location') === 'true') filters.unassigned_location = true;
  const printed = params.get('label_printed');
  if (printed === 'true' || printed === 'false') filters.label_printed = printed === 'true';
  const order = params.get('sort_order');
  if (order === 'asc' || order === 'desc') filters.sort_order = order;
  return { kind: 'filter', filters };
}
