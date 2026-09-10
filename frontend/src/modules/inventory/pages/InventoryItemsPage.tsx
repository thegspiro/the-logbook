/**
 * InventoryItemsPage — Items listing with filtering, sorting, bulk ops,
 * real-time WebSocket updates, CSV export, and add/edit modal.
 *
 * Items are split into two tables: Available and Unavailable, so admins
 * can quickly see what's in stock vs what's checked out / in maintenance / etc.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  RefreshCw,
  Search,
  ChevronUp,
  ChevronDown,
  Printer,
  Download,
  Archive,
  ArrowUpDown,
  Plus,
  Package,
  PackagePlus,
  AlertTriangle,
  Wrench,
  ChevronRight,
  MapPin,
  UserPlus,
  CheckCircle2,
  XCircle,
  ListPlus,
  Upload,
  Truck,
  Pin,
  PinOff,
  GripVertical,
} from 'lucide-react';
import { inventoryService, locationsService } from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { getTodayLocalDate, formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ITEM_CONDITION_OPTIONS } from '../../../constants/enums';
import { useInventoryWebSocket } from '../../../hooks/useInventoryWebSocket';
import { useRegisterPullToRefresh } from '../../../hooks/useRegisterPullToRefresh';
import { FloatingActionButton } from '../../../components/ux/FloatingActionButton';
import { EmptyState } from '../../../components/ux/EmptyState';
import { Modal } from '../../../components/Modal';
import { MemberPickerModal } from '../../../components/MemberPickerModal';
import { InventoryScanModal } from '../../../components/InventoryScanModal';
import { ItemFormModal } from '../components/ItemFormModal';
import ReceiveStockModal from '../components/ReceiveStockModal';
import BulkAddItemsModal from '../components/BulkAddItemsModal';
import { VariantCapsules } from '../components/VariantCapsules';
import type { VariantAttribute } from '../components/VariantCapsules';
import { displaySize, getDisplayName } from '../utils/variantHelpers';
import type {
  InventoryItem,
  InventoryCategory,
  ItemGroupCount,
  InventorySummary,
  LocationInventorySummary,
  StorageAreaResponse,
  Location,
} from '../types';
import {
  STATUS_OPTIONS,
  ITEM_TYPES,
  SIZE_PICKER_GROUPS,
  GARMENT_STYLE_AXES,
  getStatusStyle,
  getConditionColor,
  sizeLabel,
} from '../types';
import { onHandQuantity } from '../utils/onHand';
import { asArray } from '../../../utils/asArray';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { Breadcrumbs } from '../../../components/ux';

const PAGE_SIZE = 50;

/**
 * Consecutive pages the list may fetch on its own to refill a table that a
 * collapsed group emptied.
 *
 * Three, so a group spanning a page boundary or two still resolves without a
 * tap, while collapsing a category of several hundred cannot walk the whole
 * catalogue. On the fourth the member gets the Load More button back and
 * decides for themselves — the point is that the automatic path is a
 * convenience, and a convenience that issues eight requests is not one.
 */
const MAX_AUTO_TOP_UPS = 3;

/**
 * Delay before a filter change is sent, applied to every control alike.
 *
 * Search needs it — a request per keystroke otherwise — and giving the
 * dropdowns the same path costs a third of a second and removes the second
 * code path that used to reload the list.
 */
const FILTER_DEBOUNCE_MS = 350;

/**
 * `fLoc` value standing for the location panel's "Unassigned" bucket.
 *
 * Not the empty string: that is "All Locations", and collapsing the two made
 * the Unassigned card unfilterable *and* permanently ring-highlighted, since
 * clicking it set the state the unfiltered page already sat in. A sentinel a
 * location id can never take, sent to the API as its own flag rather than as
 * a `location_id`.
 */
const UNASSIGNED_LOCATION = 'unassigned';
const SORT_COLS = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'condition', label: 'Condition' },
  { key: 'created_at', label: 'Date Added' },
] as const;
type SortKey = (typeof SORT_COLS)[number]['key'];

/**
 * Dimensions the list can be grouped by.
 *
 * Mirrors `InventoryService.GROUPABLE` on the backend, which owns the join and
 * the counting for each. An unknown value degrades to an ungrouped list rather
 * than erroring, so a stale link shows items instead of a failure page.
 */
const GROUP_COLS = [
  { key: '', label: 'No grouping' },
  { key: 'category', label: 'Category' },
  { key: 'item_type', label: 'Item type' },
  { key: 'color', label: 'Color' },
  { key: 'size', label: 'Size' },
  { key: 'condition', label: 'Condition' },
  { key: 'style', label: 'Style' },
  { key: 'location', label: 'Location' },
  { key: 'vendor', label: 'Vendor' },
] as const;
type GroupKey = (typeof GROUP_COLS)[number]['key'];

/** Header for the bucket of items with no value on the grouped dimension. */
const UNSPECIFIED_GROUP = 'Unspecified';

/** Dimensions whose values are enum members rather than text somebody typed. */
const ENUM_GROUPS = new Set<string>(['condition', 'style', 'item_type']);

/**
 * A group heading, formatted for the dimension it came from.
 *
 * Only enum-backed values get their underscores opened out. Category, colour,
 * location and vendor names are entered by the department, so a station really
 * called "Station_1" or a category "SCBA_Equipment" must render as typed — an
 * unconditional replace rewrites the department's own data.
 *
 * Size is mixed: `one_size` comes from the picker vocabulary, `10.5 EE` is free
 * text. `sizeLabel` maps the former and returns the latter unchanged.
 */
function groupLabelText(dimension: GroupKey, label: string): string {
  if (dimension === 'size') return sizeLabel(label) || label;
  return ENUM_GROUPS.has(dimension) ? label.replace(/_/g, ' ') : label;
}

/**
 * The key a collapsed group is stored under, scoped to the section showing it.
 *
 * Available and Unavailable are different populations that happen to share a
 * heading, so "Uniforms" under one must not vanish from the other. Both tables
 * read one `Set`, so without the section in the key they did exactly that --
 * the state's own comment said otherwise and the implementation was what was
 * wrong.
 *
 * Length-prefixed rather than joined by a separator: a bucket is a category
 * name, a colour or a station somebody typed, so there is no character it
 * cannot contain and any separator can be forged into a collision. The prefix
 * is unambiguous whatever either half holds.
 */
function collapseKey(section: string, bucket: string): string {
  return `${section.length}:${section}${bucket}`;
}

function locLabel(item: InventoryItem, locs: Location[]): string {
  if (item.storage_location) return item.storage_location;
  if (item.location_id) return locs.find((l) => l.id === item.location_id)?.name ?? '';
  return item.station ?? '';
}

/**
 * Consecutive rows in one group run that are size/colour variants of the same
 * product, keyed by the id of the row that leads each run.
 *
 * Adjacency is the contract, deliberately. `variant_group_id` is the backend's
 * own grouping (`ItemVariantGroup` — "Dept T-Shirt" across S/M/L/XL), so the
 * key is not re-derived here; what IS a judgement is which rows may be folded
 * together, and folding only neighbours keeps the fold honest under whatever
 * sort the member picked. Under the default name sort variants share a name
 * prefix and land together, so the fold happens; under a sort that scatters
 * them (quantity, purchase date) it simply does not, and the list renders
 * exactly as it did before. Regrouping non-adjacent rows would instead move
 * rows away from the order the member asked for, which is a worse trade than
 * folding less often.
 *
 * Runs of one are not clusters — a lone variant is just a row.
 */
function variantClusters(entries: { item: InventoryItem }[]): {
  leads: Map<string, InventoryItem[]>;
  followerOf: Map<string, string>;
} {
  const leads = new Map<string, InventoryItem[]>();
  const followerOf = new Map<string, string>();
  let i = 0;
  while (i < entries.length) {
    const groupId = entries[i]?.item.variant_group_id;
    let j = i + 1;
    if (groupId) {
      while (j < entries.length && entries[j]?.item.variant_group_id === groupId) j += 1;
    }
    const members = entries.slice(i, j).map((e) => e.item);
    const lead = members[0];
    if (lead && members.length > 1) {
      leads.set(lead.id, members);
      members.slice(1).forEach((m) => followerOf.set(m.id, lead.id));
    }
    i = j;
  }
  return { leads, followerOf };
}

/**
 * The one value every member shares, or `{shared: false}` when they differ.
 *
 * A tagged result rather than `T | null`, because for a nullable column the two
 * answers collide: every member of an uncategorised product agrees, and their
 * shared value IS null. Returning null for both made the row read "Mixed" —
 * telling a quartermaster a product spans several categories when it belongs
 * to none.
 */
function sharedValue<T>(
  members: InventoryItem[],
  read: (item: InventoryItem) => T
): { shared: true; value: T } | { shared: false } {
  const first = members[0];
  if (!first) return { shared: false };
  const value = read(first);
  return members.every((m) => read(m) === value) ? { shared: true, value } : { shared: false };
}

/**
 * On-hand across a folded product row's loaded variants.
 *
 * Null when any member is serial-tracked, because those have no count to add
 * and a sum that silently skipped them would understate the shelf. Counts only
 * the variants ON THIS PAGE — see the "(n so far)" reasoning on `countLabel`;
 * a folded row must not read as a catalogue total either.
 */
function clusterOnHand(members: InventoryItem[]): number | null {
  if (members.some((m) => !m.is_lot_stocked && m.tracking_type !== 'pool')) return null;
  return members.reduce((sum, m) => sum + onHandQuantity(m), 0);
}

function qtyLabel(item: InventoryItem): string {
  // For an item kept as dated stock lots, the lots are the count. `quantity`
  // is a separate ledger that lot bookkeeping never writes to, so showing it
  // here would report a stale number for every consumable the supply officer
  // manages — the same disagreement the reorder alert had to be taught about.
  if (item.is_lot_stocked) return String(onHandQuantity(item));
  if (item.tracking_type !== 'pool') return '-';
  // `quantity` is already the on-hand count — issuing decrements it and a
  // return adds it back — so the department's total is on-hand *plus* what is
  // currently out, not the other way round. Subtracting quantity_issued here
  // counts every issued unit twice and can drive the figure negative.
  return `${item.quantity} / ${item.quantity + item.quantity_issued}`;
}

/* ------------------------------------------------------------------ */
/*  VariantProductRow — one row standing in for a product's variants    */
/* ------------------------------------------------------------------ */
interface VariantProductRowProps {
  members: InventoryItem[];
  open: boolean;
  categories: InventoryCategory[];
  locations: Location[];
  selIds: Set<string>;
  toggle: (id: string) => void;
  showStatus: boolean;
  showCategory: boolean;
  showSize: boolean;
  showCondition: boolean;
  showLocation: boolean;
  canManage: boolean;
  onToggle: () => void;
}

/**
 * The single row a folded variant cluster shows, and the header it keeps when
 * opened.
 *
 * Every per-item column here reports the value the members SHARE, or "Mixed"
 * when they do not. Picking the lead's value and presenting it as the
 * product's would be a quiet lie the moment one size sat in a different
 * cupboard — and a quartermaster reading "Station 2" off a folded row would
 * walk to the wrong shelf. Same reasoning as the group header's count: state
 * what is true of the whole thing, or say you cannot.
 */
const VariantProductRow: React.FC<VariantProductRowProps> = ({
  members,
  open,
  categories,
  locations,
  selIds,
  toggle,
  showStatus,
  showCategory,
  showSize,
  showCondition,
  showLocation,
  canManage,
  onToggle,
}) => {
  const lead = members[0];
  if (!lead) return null;

  const name = getDisplayName(lead);
  const allSelected = members.every((m) => selIds.has(m.id));
  const onHand = clusterOnHand(members);
  const status = sharedValue(members, (m) => m.status);
  const condition = sharedValue(members, (m) => m.condition);
  const categoryId = sharedValue(members, (m) => m.category_id);
  const location = sharedValue(members, (m) => locLabel(m, locations));
  // Distinct, in the order the rows arrived. A product stocked in two colours
  // holds each size twice, and "L, L, M, M, S, S, XL, XL" reads as a fault in
  // the list rather than as four sizes in two colours.
  const sizes = [...new Set(members.map((m) => displaySize(m)).filter(Boolean))];
  const mixed = <span className="text-theme-text-muted italic">Mixed</span>;

  return (
    <tr className="hover:bg-theme-surface-hover bg-theme-surface-hover/25 transition-colors">
      <td data-label="" className="px-3 py-3">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => {
            // `toggle` flips one id, so drive every member to the same target
            // state rather than flipping each: a cluster with two of four
            // already ticked must end all-on, not swap which two are ticked.
            const target = !allSelected;
            members.forEach((m) => {
              if (selIds.has(m.id) !== target) toggle(m.id);
            });
          }}
          className="form-checkbox"
          aria-label={`Select every variant of ${name}`}
        />
      </td>
      <td data-label="Name" className="px-3 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="text-theme-text-primary hover:text-theme-text-primary inline-flex items-center gap-2 text-left font-medium"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span>{name}</span>
          {/* Loaded members, not a catalogue total -- a cluster split across a
              page boundary grows when the next page arrives, and this must
              never read as "the product has 3 sizes" when it has five. */}
          <span className="text-theme-text-muted text-xs font-normal">{members.length} loaded</span>
        </button>
      </td>
      <td data-label="Status" className={`px-3 py-3 ${showStatus ? '' : 'md:hidden'}`}>
        {status.shared ? (
          <span
            className={`inline-flex rounded-sm border px-2 py-0.5 text-[11px] font-semibold ${getStatusStyle(status.value)}`}
          >
            {status.value.replace(/_/g, ' ').toUpperCase()}
          </span>
        ) : (
          mixed
        )}
      </td>
      {showCategory && (
        <td data-label="Category" className="text-theme-text-muted px-3 py-3">
          {!categoryId.shared ? mixed : (categories.find((c) => c.id === categoryId.value)?.name ?? '')}
        </td>
      )}
      <td data-label="Variant" className="text-theme-text-muted px-3 py-3 text-xs">
        {sizes.length ? sizes.join(', ') : ''}
      </td>
      {showSize && (
        <td data-label="Size" className="text-theme-text-muted px-3 py-3">
          {mixed}
        </td>
      )}
      <td data-label="Qty" className="text-theme-text-muted px-3 py-3 text-center tabular-nums">
        {/* Null when any member is serial-tracked: those carry no count, and a
            sum that skipped them would understate the shelf. */}
        {onHand === null ? '--' : onHand}
      </td>
      {showCondition && (
        <td
          data-label="Condition"
          className={`px-3 py-3 capitalize ${condition.shared ? getConditionColor(condition.value) : ''}`}
        >
          {condition.shared ? condition.value.replace(/_/g, ' ') : mixed}
        </td>
      )}
      {showLocation && (
        <td data-label="Location" className="text-theme-text-muted max-w-[160px] truncate px-3 py-3">
          {!location.shared ? mixed : location.value || '-'}
        </td>
      )}
      {/* No mobile-only detail cells here. They describe one physical item
          (serial, asset tag, barcode) and a product row is not one -- and below
          768px `.rwd-table tbody td` is display:flex with only the cells
          carrying NO data-label hidden, so rendering them empty put five blank
          labelled rows in every folded card. They are `hidden` on desktop, so
          leaving them out costs no column there. */}
      <td className="px-3 py-3" />
      {canManage && <td data-label="" className="hidden" />}
    </tr>
  );
};

/* ------------------------------------------------------------------ */
/*  ItemTable — reusable table for available / unavailable sections     */
/* ------------------------------------------------------------------ */
interface ItemTableProps {
  label: string;
  icon: React.ReactNode;
  items: InventoryItem[];
  categories: InventoryCategory[];
  locations: Location[];
  selIds: Set<string>;
  toggle: (id: string) => void;
  toggleAll: () => void;
  toggleSort: (k: SortKey) => void;
  SortIc: React.FC<{ col: SortKey }>;
  sortBy: SortKey;
  sortOrd: 'asc' | 'desc';
  showStatus: boolean;
  canManage: boolean;
  onEdit: (item: InventoryItem) => void;
  onRetire: (item: InventoryItem) => void;
  onTogglePin: (item: InventoryItem) => void;
  /**
   * True when the page has more matching items than it has loaded. The split
   * into these sections happens client-side over the loaded rows, so the count
   * is a running tally rather than a section total, and must not be shown as
   * one.
   */
  truncated?: boolean;
  /** Active grouping dimension, '' for none. */
  groupBy?: GroupKey;
  /** Whole-set counts keyed by group key; '' keys the Unspecified bucket. */
  groupTotals?: Map<string, number>;
  /** Display names per key — a category id is not a heading. */
  groupLabels?: Map<string, string>;
  collapsed?: Set<string>;
  onToggleGroup?: (key: string) => void;
  /** Variant clusters the member has opened, keyed by `collapseKey`. */
  expandedVariants?: Set<string>;
  onToggleVariants?: (key: string) => void;
  /** Renders the drag handle and the move arrows. Pinned section only. */
  pinnedMode?: boolean;
  onMovePin?: (itemId: string, toIndex: number) => void;
}

const ItemTable: React.FC<ItemTableProps> = ({
  label,
  icon,
  items,
  categories,
  locations,
  selIds,
  toggle,
  toggleAll,
  toggleSort,
  SortIc,
  sortBy,
  sortOrd,
  showStatus,
  canManage,
  onEdit,
  onRetire,
  onTogglePin,
  truncated = false,
  groupBy = '',
  groupTotals,
  groupLabels,
  collapsed,
  onToggleGroup,
  expandedVariants,
  onToggleVariants,
  pinnedMode = false,
  onMovePin,
}) => {
  const [dragId, setDragId] = useState<string | null>(null);

  if (items.length === 0) return null;

  const allSelected = items.length > 0 && items.every((i) => selIds.has(i.id));
  // `items` is what this page has LOADED, not what matches the filters — the
  // three-way split is client-side over the loaded rows. Rendering a bare
  // "(12)" while 87 match reads as a section total and silently understates
  // the department's stock the moment the list runs past one page.
  const countLabel = truncated ? `(${items.length} so far)` : `(${items.length})`;
  const ariaSort = (col: SortKey): 'ascending' | 'descending' | 'none' =>
    sortBy === col ? (sortOrd === 'asc' ? 'ascending' : 'descending') : 'none';

  // Contiguous runs of rows sharing a group key, each rendered as its own
  // <tbody>.
  //
  // One <tbody> for the whole table is what made `scope="rowgroup"` wrong: it
  // binds a header to its ROW GROUP, so with every heading in a single tbody
  // each one claimed the rows to the end of the table rather than its own, and
  // a screen reader got the wrong group-to-row map. The rows already arrive
  // ordered by group key, so a run break is simply where the key changes.
  const runs: { key: string | null; entries: { item: InventoryItem; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const key = groupBy ? (item.group_key ?? null) : null;
    const last = runs[runs.length - 1];
    if (last && (!groupBy || last.key === key)) last.entries.push({ item, index });
    else runs.push({ key, entries: [{ item, index }] });
  });

  // Never in the pinned shortlist. Its rows carry the reorder arrows, whose
  // `index` is a position in `items`, and folding rows away leaves those
  // positions pointing at something the member cannot see. A pin is also an
  // explicit per-item choice, so folding the chosen items back together
  // undoes the thing they asked for.
  const { leads: variantLeads, followerOf: variantFollowerOf } = pinnedMode
    ? { leads: new Map<string, InventoryItem[]>(), followerOf: new Map<string, string>() }
    : runs.reduce(
        (acc, run) => {
          const found = variantClusters(run.entries);
          found.leads.forEach((members, id) => acc.leads.set(id, members));
          found.followerOf.forEach((leadId, id) => acc.followerOf.set(id, leadId));
          return acc;
        },
        { leads: new Map<string, InventoryItem[]>(), followerOf: new Map<string, string>() }
      );

  // One rule: the grouped dimension never appears in the row. The group header
  // states it once; repeating it on every row beneath is dead width. It applies
  // the same whether the dimension lives in a real column (Category, Condition,
  // Location) or in a variant capsule (Colour, Size, Style).
  const grouped = (dimension: GroupKey) => groupBy === dimension;
  // Size earns a column of its own in the space a hidden column vacates — it is
  // what a quartermaster scans for, and a chip wedged between colour and style
  // is not scannable. Never when size IS the grouping, because then the header
  // already says it and a column would be the very redundancy being removed.
  const showSizeColumn = Boolean(groupBy) && !grouped('size');
  const omitCapsules: VariantAttribute[] = [
    // Whenever anything is grouped: either the Size column carries it, or the
    // group header does.
    ...(groupBy ? (['size'] as const) : []),
    ...(grouped('color') ? (['color'] as const) : []),
    ...(grouped('style') ? (['style'] as const) : []),
  ];

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h2 className="text-theme-text-secondary text-sm font-semibold tracking-wide uppercase">{label}</h2>
        <span className="text-theme-text-muted text-xs">{countLabel}</span>
      </div>
      <div className="card-secondary overflow-x-auto">
        {/* Single responsive table: a table on >=md, stacked cards below.
            Cells marked `hidden` are mobile-only (revealed by the reflow);
            cells with no data-label are hidden in the stacked view. */}
        {/* Named, because the page renders up to three of these and a screen
            reader announcing "table" three times gives no way to tell the
            pinned shortlist from the rest of the shelf. */}
        <table aria-label={label} className="rwd-table w-full text-sm">
          <thead>
            <tr className="border-theme-surface-border border-b">
              {pinnedMode && <th scope="col" className="w-24 px-2 py-3" />}
              <th scope="col" className="w-10 px-3 py-3 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="form-checkbox"
                  aria-label={`Select all ${label.toLowerCase()}`}
                />
              </th>
              {/* aria-sort is set by hand because this page predates
                  components/ux/SortableHeader and hand-rolls its sort buttons;
                  without it a screen reader announces a plain button and never
                  says which column the table is ordered by. */}
              <th scope="col" aria-sort={ariaSort('name')} className="px-3 py-3 text-left">
                <button
                  onClick={() => toggleSort('name')}
                  className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1 font-medium"
                >
                  Name <SortIc col="name" />
                </button>
              </th>
              {showStatus && (
                <th scope="col" aria-sort={ariaSort('status')} className="px-3 py-3 text-left">
                  <button
                    onClick={() => toggleSort('status')}
                    className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1 font-medium"
                  >
                    Status <SortIc col="status" />
                  </button>
                </th>
              )}
              {!grouped('category') && (
                <th scope="col" className="text-theme-text-secondary px-3 py-3 text-left font-medium">
                  Category
                </th>
              )}
              <th scope="col" className="text-theme-text-secondary px-3 py-3 text-left font-medium">
                Variant
              </th>
              {/* Not sortable, deliberately: the backend's _SORTABLE_COLUMNS has
                  no size key and silently falls back to name, so a sort button
                  here would look live and do nothing. */}
              {showSizeColumn && (
                <th scope="col" className="text-theme-text-secondary px-3 py-3 text-left font-medium">
                  Size
                </th>
              )}
              <th scope="col" className="text-theme-text-secondary px-3 py-3 text-center font-medium">
                Qty
              </th>
              {/* Hiding this also hides its sort button, which is right:
                  sorting by the dimension you are grouped by is meaningless
                  (the group order dominates it), and the mobile Sort dropdown
                  still offers Condition. */}
              {!grouped('condition') && (
                <th scope="col" aria-sort={ariaSort('condition')} className="px-3 py-3 text-left">
                  <button
                    onClick={() => toggleSort('condition')}
                    className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1 font-medium"
                  >
                    Condition <SortIc col="condition" />
                  </button>
                </th>
              )}
              {!grouped('location') && (
                <th scope="col" className="text-theme-text-secondary px-3 py-3 text-left font-medium">
                  Location
                </th>
              )}
              <th scope="col" className="w-20 px-3 py-3" />
            </tr>
          </thead>
          {runs.map((run, runIndex) => (
            <tbody key={`${run.key ?? ''}-${runIndex}`} className="divide-theme-surface-border divide-y">
              {run.entries.map(({ item, index }, entryIndex) => {
                // The key the SERVER filed this row under, not one re-derived
                // here. Colour keys lower-cased, location follows a COALESCE over
                // the whole locations table (this page's own lookup is capped at
                // 100 rows), item_type lives on the category, and an enum keys to
                // its value — reproducing any of those is a chance to disagree
                // with the header's count (CLAUDE.md pitfall #29).
                const gKey = run.key;
                const startsGroup = Boolean(groupBy) && entryIndex === 0;
                const bucket = gKey ?? '';
                // Scoped to this section: `collapsed` is one Set shared by both
                // tables, and the group key alone made a collapse in Available
                // hide the same heading's rows in Unavailable.
                const collapseId = collapseKey(label, bucket);
                const isCollapsed = Boolean(groupBy) && (collapsed?.has(collapseId) ?? false);
                const groupTotal = groupTotals?.get(bucket);
                // Variant folding. A lead with an unopened cluster renders one
                // product row in place of its members; a follower renders
                // nothing until the cluster is opened.
                const clusterMembers = variantLeads.get(item.id);
                const clusterLeadId = clusterMembers ? item.id : variantFollowerOf.get(item.id);
                const variantsOpen = clusterLeadId
                  ? (expandedVariants?.has(collapseKey(label, clusterLeadId)) ?? false)
                  : false;
                // The product row stands in for the WHOLE cluster, its lead
                // included, so while it is folded no member renders its own row.
                const foldedAway = Boolean(clusterLeadId) && !variantsOpen;
                const cat = categories.find((ct) => ct.id === item.category_id);
                const loc = locLabel(item, locations);
                const manufacturer = [item.manufacturer, item.model_number].filter(Boolean).join(' ');
                const cost =
                  item.purchase_price != null
                    ? `$${formatNumber(item.purchase_price, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : '';
                return (
                  <React.Fragment key={item.id}>
                    {startsGroup && (
                      <tr className="bg-theme-surface-hover/60">
                        <th
                          scope="rowgroup"
                          colSpan={20}
                          className="border-theme-surface-border border-y px-3 py-2 text-left"
                        >
                          <button
                            type="button"
                            onClick={() => onToggleGroup?.(collapseId)}
                            aria-expanded={!isCollapsed}
                            className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-xs font-semibold tracking-wide uppercase"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                            <span className={gKey === null ? 'italic' : ''}>
                              {gKey === null
                                ? UNSPECIFIED_GROUP
                                : groupLabelText(groupBy, groupLabels?.get(bucket) ?? bucket)}
                            </span>
                            {/* The backend's count, not the loaded rows': a
                              collapsed group must state its total, and a
                              tally of what arrived would understate it. */}
                            <span className="text-theme-text-muted font-normal normal-case">({groupTotal ?? '—'})</span>
                          </button>
                        </th>
                      </tr>
                    )}
                    {/* Rendered open as well as folded, so the way back is in
                        the same place as the way in. Open, it is the cluster's
                        header and its members follow indented beneath. */}
                    {!isCollapsed && clusterMembers && (
                      <VariantProductRow
                        members={clusterMembers}
                        open={variantsOpen}
                        categories={categories}
                        locations={locations}
                        selIds={selIds}
                        toggle={toggle}
                        showStatus={showStatus}
                        showCategory={!grouped('category')}
                        showSize={showSizeColumn}
                        showCondition={!grouped('condition')}
                        showLocation={!grouped('location')}
                        canManage={canManage}
                        onToggle={() => onToggleVariants?.(collapseKey(label, item.id))}
                      />
                    )}
                    {!isCollapsed && !foldedAway && (
                      <tr
                        {...(pinnedMode
                          ? {
                              draggable: true,
                              onDragStart: () => setDragId(item.id),
                              onDragEnd: () => setDragId(null),
                              onDragOver: (e: React.DragEvent) => e.preventDefault(),
                              onDrop: (e: React.DragEvent) => {
                                e.preventDefault();
                                if (dragId && dragId !== item.id) onMovePin?.(dragId, index);
                                setDragId(null);
                              },
                            }
                          : {})}
                        className={`hover:bg-theme-surface-hover transition-colors ${selIds.has(item.id) ? 'bg-theme-surface-hover/50' : ''} ${dragId === item.id ? 'opacity-60' : ''}`}
                      >
                        {pinnedMode && (
                          <td data-label="Order" className="text-theme-text-muted px-2 py-3">
                            {/* Grip and arrows in ONE cell so the reflow keeps them
                          together: split across the row's two ends, the arrows
                          landed after ten stacked field rows on a phone, which
                          is where they matter most — HTML5 drag never fires on
                          touch, so there they are the only way to reorder. */}
                            <div className="flex items-center gap-0.5">
                              <GripVertical className="hidden h-4 w-4 cursor-grab md:block" aria-hidden="true" />
                              <button
                                type="button"
                                onClick={() => onMovePin?.(item.id, index - 1)}
                                disabled={index === 0}
                                className="btn-icon-sm mobile-touch-target hover:text-theme-text-primary disabled:opacity-30"
                                aria-label={`Move ${getDisplayName(item)} up`}
                              >
                                <ChevronUp className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onMovePin?.(item.id, index + 1)}
                                disabled={index === items.length - 1}
                                className="btn-icon-sm mobile-touch-target hover:text-theme-text-primary disabled:opacity-30"
                                aria-label={`Move ${getDisplayName(item)} down`}
                              >
                                <ChevronDown className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        )}
                        <td data-label="" className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selIds.has(item.id)}
                            onChange={() => toggle(item.id)}
                            className="form-checkbox"
                            aria-label={`Select ${item.name}`}
                          />
                        </td>
                        {/* Indented under its product row, on the table layout
                            only: below 768px `rwd-table` stacks each row into
                            its own card, where there is no row above to be
                            indented under and the padding would just be a
                            ragged edge. */}
                        <td data-label="Name" className={`py-3 pr-3 ${clusterLeadId ? 'pl-3 md:pl-9' : 'pl-3'}`}>
                          <Link
                            to={`/inventory/items/${item.id}`}
                            className="text-theme-text-primary font-medium hover:text-blue-600 dark:hover:text-blue-400"
                          >
                            {/* The size, not the shared product name: under an
                                open product row every member would otherwise
                                read as the same word repeated. */}
                            {clusterLeadId ? displaySize(item) || getDisplayName(item) : getDisplayName(item)}
                          </Link>
                        </td>
                        {/* Status: a desktop column only when showStatus, but always
                      surfaced on mobile (where items aren't column-grouped). */}
                        <td data-label="Status" className={`px-3 py-3 ${showStatus ? '' : 'md:hidden'}`}>
                          <span
                            className={`inline-flex rounded-sm border px-2 py-0.5 text-[11px] font-semibold ${getStatusStyle(item.status)}`}
                          >
                            {item.status.replace(/_/g, ' ').toUpperCase()}
                          </span>
                        </td>
                        {!grouped('category') && (
                          <td data-label="Category" className="text-theme-text-muted px-3 py-3">
                            {cat?.name ?? ''}
                          </td>
                        )}
                        <td data-label="Variant" className="px-3 py-3">
                          <VariantCapsules item={item} omit={omitCapsules} />
                        </td>
                        {showSizeColumn && (
                          <td data-label="Size" className="text-theme-text-primary px-3 py-3">
                            {displaySize(item) || '--'}
                          </td>
                        )}
                        <td data-label="Qty" className="text-theme-text-muted px-3 py-3 text-center tabular-nums">
                          {qtyLabel(item)}
                          {item.is_lot_stocked && (
                            <span
                              className="text-theme-text-muted block text-[10px] leading-tight"
                              title="Ready units across in-date stock lots. Expired lots are not counted — they cannot be issued or swapped onto an apparatus."
                            >
                              in-date lots
                            </span>
                          )}
                        </td>
                        {!grouped('condition') && (
                          <td
                            data-label="Condition"
                            className={`px-3 py-3 capitalize ${getConditionColor(item.condition)}`}
                          >
                            {item.condition.replace(/_/g, ' ')}
                          </td>
                        )}
                        {!grouped('location') && (
                          <td data-label="Location" className="text-theme-text-muted max-w-[160px] truncate px-3 py-3">
                            {loc || '-'}
                          </td>
                        )}
                        {/* Mobile-only detail cells (hidden on desktop, revealed by the reflow) */}
                        <td data-label="Manufacturer" className="hidden">
                          {manufacturer || '--'}
                        </td>
                        <td data-label="Serial #" className="hidden">
                          {item.serial_number || '--'}
                        </td>
                        <td data-label="Asset Tag" className="hidden">
                          {item.asset_tag || '--'}
                        </td>
                        <td data-label="Barcode" className="hidden">
                          {item.barcode || '--'}
                        </td>
                        <td data-label="Cost" className="hidden">
                          {cost || '--'}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => onTogglePin(item)}
                              className={`btn-icon-sm ${
                                item.pin_position != null
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-theme-text-muted hover:text-theme-text-primary'
                              }`}
                              aria-label={`${item.pin_position != null ? 'Unpin' : 'Pin'} ${getDisplayName(item)}`}
                              aria-pressed={item.pin_position != null}
                            >
                              {item.pin_position != null ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                            </button>
                            <Link
                              to={`/inventory/items/${item.id}`}
                              className="text-theme-text-muted hover:text-theme-text-primary"
                              aria-label={`View ${item.name}`}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          </div>
                        </td>
                        {/* Mobile-only inline actions */}
                        {canManage && (
                          <td data-label="" className="hidden">
                            <div className="flex flex-wrap gap-2">
                              <button onClick={() => onEdit(item)} className="btn-secondary btn-sm">
                                Edit
                              </button>
                              {item.status !== 'retired' && (
                                <button onClick={() => onRetire(item)} className="btn-secondary btn-sm">
                                  Retire
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
const InventoryItemsPage: React.FC = () => {
  const navigate = useNavigate();
  // Vendor scoping lives in the URL rather than in a filter dropdown: it is
  // arrived at from a vendor card ("show me what we bought from them"), and a
  // shareable link is the point.
  const [searchParams, setSearchParams] = useSearchParams();
  const vendorFilter = searchParams.get('vendor_id') ?? '';
  // The type filter is URL-driven for the same reason vendor scoping is: the
  // inventory hub's supply-line cards link straight at one domain
  // (?item_type=uniform), and that only works if the list reads the URL.
  // Derived rather than mirrored into state on mount — mirroring reads the
  // parameter once, so moving from one supply line to another, or pressing
  // Back between them, would leave the list showing the first.
  //
  // An unrecognized value is dropped rather than passed through: GET /items
  // 400s on a type outside the enum, so a hand-edited URL would turn a filter
  // into an error page instead of degrading to the unfiltered list.
  const requestedType = searchParams.get('item_type');
  const fType = ITEM_TYPES.some((option) => option.value === requestedType) ? (requestedType ?? '') : '';
  const setFType = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set('item_type', value);
      else next.delete('item_type');
      // replace, like the vendor chip's clear: changing a dropdown should not
      // stack a history entry the Back button then has to walk through.
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const canManage = useAuthStore((s) => s.checkPermission)('inventory.manage');

  const [items, setItems] = useState<InventoryItem[]>([]);
  // Loaded once from the org's distinct colours rather than derived from
  // `items`: that derivation was bounded by the loaded page AND narrowed by
  // the colour filter itself, so choosing a colour left it as the only option.
  const [colorOptions, setColorOptions] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [storageAreas, setStorageAreas] = useState<StorageAreaResponse[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [locSummary, setLocSummary] = useState<LocationInventorySummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [fCat, setFCat] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fCond, setFCond] = useState('');
  const [fLoc, setFLoc] = useState('');
  const [fSize, setFSize] = useState('');
  const [fColor, setFColor] = useState('');
  const [fStyle, setFStyle] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [sortOrd, setSortOrd] = useState<'asc' | 'desc'>('asc');
  const [groupBy, setGroupBy] = useState<GroupKey>('');
  const [groupCounts, setGroupCounts] = useState<ItemGroupCount[]>([]);
  // The dimension the rows currently in `items` were fetched for.
  //
  // `groupBy` changes the moment the dropdown does, but the rows keep the
  // `group_key` the server stamped for the PREVIOUS dimension until the
  // debounced fetch lands — so rendering against `groupBy` files category ids
  // under colour headings for a third of a second, and indefinitely if that
  // fetch fails. Everything that renders a grouping reads this instead, so the
  // table holds the last consistent state rather than a mixture of two.
  const [loadedGroupBy, setLoadedGroupBy] = useState<GroupKey>('');
  // The filter set that produced the rows currently on screen, stamped on a
  // SUCCESSFUL load. Export sends this, so the file is the list a member is
  // looking at rather than the controls they have most recently touched.
  // Null until the first load lands, which is the one state where there is
  // nothing to export.
  const [loadedParams, setLoadedParams] = useState<ReturnType<typeof filterParams> | null>(null);
  // Collapsed group keys, per section. A group collapsed under Available
  // should not also vanish from Unavailable — they are different populations
  // that happen to share a heading. `collapseKey` is what makes that true;
  // storing the bare group key here meant both tables answered to one toggle.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Variant clusters the member has opened, same keying. Folded is the
  // default: a product stocked in six sizes is one line on the shelf list and
  // six only when somebody asks which sizes are in.
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set());
  const [skip, setSkip] = useState(0);
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkNewStatus, setBulkNewStatus] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ userId: string; memberName: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* ---- split items into pinned / available / unavailable ----
     A pinned item is REMOVED from the lower two tables rather than repeated in
     both. Not cosmetic: `selIds` is a Set of ids, so one row rendered twice
     would show two checkboxes for the same item and desynchronise
     `toggleAll`. */
  const pinnedItems = useMemo(
    () => items.filter((i) => i.pin_position != null).sort((a, b) => (a.pin_position ?? 0) - (b.pin_position ?? 0)),
    [items]
  );
  const availableItems = useMemo(
    () => items.filter((i) => i.pin_position == null && i.status === 'available'),
    [items]
  );
  const unavailableItems = useMemo(
    () => items.filter((i) => i.pin_position == null && i.status !== 'available'),
    [items]
  );

  /* ---- grouping lookups ----
     Keyed on the same strings the server stamps on each row's `group_key`,
     with '' standing for the
     Unspecified bucket, so a header always finds the count for its rows. */
  const groupAvailable = useMemo(() => {
    const m = new Map<string, number>();
    groupCounts.forEach((g) => m.set(g.key ?? '', g.available_count));
    return m;
  }, [groupCounts]);
  const groupUnavailable = useMemo(() => {
    const m = new Map<string, number>();
    groupCounts.forEach((g) => m.set(g.key ?? '', g.unavailable_count));
    return m;
  }, [groupCounts]);
  const groupLabels = useMemo(() => {
    const m = new Map<string, string>();
    groupCounts.forEach((g) => {
      if (g.label) m.set(g.key ?? '', g.label);
    });
    return m;
  }, [groupCounts]);

  const toggleIn = (set: React.Dispatch<React.SetStateAction<Set<string>>>) => (key: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleGroup = toggleIn(setCollapsed);
  const toggleVariants = toggleIn(setExpandedVariants);

  /* ---- helpers ---- */
  const filterParams = useCallback(
    () => ({
      search: search.trim() || undefined,
      category_id: fCat || undefined,
      status: fStatus || undefined,
      condition: fCond || undefined,
      item_type: fType || undefined,
      location_id: fLoc && fLoc !== UNASSIGNED_LOCATION ? fLoc : undefined,
      unassigned_location: fLoc === UNASSIGNED_LOCATION ? true : undefined,
      vendor_id: vendorFilter || undefined,
      size: fSize || undefined,
      color: fColor || undefined,
      style: fStyle || undefined,
      sort_by: sortBy,
      sort_order: sortOrd,
      group_by: groupBy || undefined,
    }),
    [search, fCat, fStatus, fCond, fType, fLoc, vendorFilter, fSize, fColor, fStyle, sortBy, sortOrd, groupBy]
  );

  const loadItems = useCallback(
    async (reset = false) => {
      const s = reset ? 0 : skip;
      const params = filterParams();
      const requestedGroupBy = params.group_by ?? '';
      try {
        const res = await inventoryService.getItems({ ...params, skip: s, limit: PAGE_SIZE });
        const items = asArray(res.items);
        setItems(reset || s === 0 ? items : (prev) => [...prev, ...items]);
        setTotal(res.total ?? 0);
        // Whole-set counts, so a collapsed header states a total rather than
        // however much of the group happened to load.
        setGroupCounts(asArray(res.groups ?? []));
        // From the request that produced these rows, not from current state, so
        // a response arriving after another dimension was picked cannot claim
        // rows it did not fetch.
        setLoadedGroupBy(requestedGroupBy);
        // Same reasoning, for the whole filter set rather than just the
        // grouping: Export reads this, never live control state. Filter
        // changes are debounced by FILTER_DEBOUNCE_MS, so `filterParams()`
        // holds the new selection while `items` still holds the previous
        // response — and if that debounced request FAILS, it stays that way,
        // because the catch below leaves the old rows on screen. Either way an
        // export taken from live state describes rows the file does not
        // contain.
        setLoadedParams(params);
        if (reset) setSkip(0);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load items'));
      }
    },
    [filterParams, skip]
  );

  const loadSummary = useCallback(async () => {
    try {
      const [s, ls] = await Promise.all([inventoryService.getSummary(), inventoryService.getSummaryByLocation()]);
      setSummary(s);
      setLocSummary(ls);
    } catch {
      /* non-critical */
    }
  }, []);

  const loadRef = useCallback(async () => {
    try {
      const [c, l, a] = await Promise.all([
        inventoryService.getCategories(),
        locationsService.getLocations(),
        inventoryService.getStorageAreas({ flat: true }),
      ]);
      setCategories(c);
      setLocations(l);
      setStorageAreas(a);
    } catch {
      /* non-critical */
    }
  }, []);

  // The colour vocabulary, fetched once and only after the first load settles.
  //
  // Deliberately not inside the Promise.all above, and deliberately not racing
  // it either. Two separate reasons, both learned the hard way:
  //
  // 1. A rejection inside that Promise.all skips every setter in it, so a
  //    colours endpoint an older backend does not serve yet would empty the
  //    category, location and storage-area pickers along with it.
  // 2. That Promise.all is the gate that clears `loading`, and until it clears
  //    the page renders neither its rows nor its empty state — which is where
  //    the only "Add Item" button a phone shows lives. Adding a request to the
  //    gate delayed it; adding one *beside* it still competed with the item
  //    fetch for the connection. Either way `mobile-create-edit.spec.ts` looked
  //    for that button before it existed, and its lookup has no retry.
  //
  // So it waits. A filter that populates a moment late costs nothing; the page
  // taking longer to become usable costs a great deal.
  const colorsRequested = useRef(false);
  useEffect(() => {
    if (loading || colorsRequested.current) return;
    colorsRequested.current = true;
    let cancelled = false;
    void inventoryService
      .getItemColors()
      // Rendered straight into <option>s, so a shape that is not a list takes
      // the whole page down rather than just the filter.
      .then((colors) => {
        if (!cancelled) setColorOptions(Array.isArray(colors) ? colors : []);
      })
      .catch(() => {
        if (!cancelled) setColorOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loading]);

  useRegisterPullToRefresh(async () => {
    await Promise.all([loadItems(true), loadSummary()]);
  });

  useEffect(() => {
    const go = async () => {
      setLoading(true);
      await Promise.all([loadItems(true), loadSummary(), loadRef()]);
      setLoading(false);
    };
    void go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter / sort changes, keyed on `filterParams` rather than on a list of
  // the filters themselves.
  //
  // This was two effects over a hand-written array of six names, beside a
  // `filterParams` that read eleven. Location, size, colour, style and the
  // vendor scope were missing from it, so those five controls changed the
  // request the page *would* send and never sent it — the list stayed put
  // until an unrelated reload (a websocket event, a bulk edit) applied a
  // filter nobody had touched since. It is what made the location cards
  // impossible to reconcile with the list beneath them.
  //
  // Adding the five back left the mirror in place for the next filter to fall
  // out of. `filterParams` is that whole set as one identity and ESLint
  // maintains *its* dependency array, so a filter added there reaches this
  // effect with no second list to remember. `effectDepsIntegrity.test.ts`
  // holds the line.
  //
  // One debounced path, not an immediate one for the dropdowns and a debounced
  // one for the text box: `filterParams` changes on a keystroke as readily as
  // on a select, so a single effect covers both, and rapid changes across
  // several controls coalesce into one request instead of racing.
  useEffect(() => {
    if (loading) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void loadItems(true), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
    // `loadItems` and `loading` are deliberately omitted, and both would
    // misfire if listed: `loadItems` changes identity with `skip`, which this
    // effect resets to 0, and re-running when the mount load clears `loading`
    // would send a second identical request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterParams]);

  // WebSocket
  const onWs = useCallback(() => {
    void loadItems(true);
    void loadSummary();
  }, [loadItems, loadSummary]);
  useInventoryWebSocket({ onEvent: onWs });

  /* ---- pagination ----
     Returns whether the page actually arrived, because the automatic top-up
     below has to stop on a failure rather than treat it as "try again". */
  const loadMorePage = async (): Promise<boolean> => {
    const ns = skip + PAGE_SIZE;
    setLoadingMore(true);
    try {
      const res = await inventoryService.getItems({ ...filterParams(), skip: ns, limit: PAGE_SIZE });
      setItems((prev) => [...prev, ...asArray(res.items)]);
      setTotal(res.total ?? 0);
      // Advanced only on success. Moving it before the request meant a failed
      // page still consumed its offset, so the next attempt asked for the one
      // after it and the rows in between were never fetched.
      setSkip(ns);
      return true;
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load more'));
      return false;
    } finally {
      setLoadingMore(false);
    }
  };

  const handleMore = async () => {
    // A manual press is the member asking again, so it clears whatever stopped
    // the automatic top-up.
    autoTopUpsRef.current = 0;
    topUpHaltedRef.current = false;
    await loadMorePage();
  };

  /* ---- sorting ---- */
  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setSortOrd((p) => (p === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(k);
      setSortOrd('asc');
    }
  };
  const SortIc: React.FC<{ col: SortKey }> = ({ col }) => {
    if (sortBy !== col) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;
    return sortOrd === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  };

  /* ---- pinning ----
     Pins are the caller's own shortlist, hoisted above the rest of the list by
     the backend. Every mutation applies to local state first and reconciles
     from the server afterwards, so the row moves under the tap rather than a
     third of a second later. */
  const togglePin = async (item: InventoryItem) => {
    const wasPinned = item.pin_position != null;
    try {
      if (wasPinned) await inventoryService.unpinItem(item.id);
      else await inventoryService.pinItem(item.id);
      await loadItems(true);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, wasPinned ? 'Failed to unpin item' : 'Failed to pin item'));
    }
  };

  const movePin = async (itemId: string, toIndex: number) => {
    const current = pinnedItems.map((i) => i.id);
    const from = current.indexOf(itemId);
    if (from === -1) return;
    const target = Math.max(0, Math.min(current.length - 1, toIndex));
    if (from === target) return;

    const next = [...current];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);

    // Optimistic: restamp pin_position locally so the row moves immediately.
    const order = new Map(next.map((id, index) => [id, index]));
    setItems((prev) => prev.map((i) => (order.has(i.id) ? { ...i, pin_position: order.get(i.id) ?? null } : i)));

    try {
      // Every pinned id, not just the ones that moved — the backend rejects a
      // partial list rather than guessing which pins were dropped.
      await inventoryService.reorderItemPins(next);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reorder pinned items'));
      // Reload rather than restore a local snapshot. The rejection this path
      // exists for is "your list no longer matches ours" — pinned on a phone a
      // minute ago — and putting back the stale order the browser already had
      // leaves every retry failing the same way. Refetching gives the next
      // attempt the real set to reorder.
      await loadItems(true);
    }
  };

  /* ---- selection ---- */
  const toggle = (id: string) =>
    setSelIds((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /* ---- section-level toggleAll helpers ---- */
  const toggleAllPinned = () =>
    setSelIds((prev) => {
      const allSelected = pinnedItems.length > 0 && pinnedItems.every((i) => prev.has(i.id));
      if (allSelected) {
        const next = new Set(prev);
        pinnedItems.forEach((i) => next.delete(i.id));
        return next;
      }
      return new Set([...prev, ...pinnedItems.map((i) => i.id)]);
    });
  const toggleAllAvailable = () =>
    setSelIds((prev) => {
      const allSelected = availableItems.length > 0 && availableItems.every((i) => prev.has(i.id));
      if (allSelected) {
        const next = new Set(prev);
        availableItems.forEach((i) => next.delete(i.id));
        return next;
      }
      return new Set([...prev, ...availableItems.map((i) => i.id)]);
    });
  const toggleAllUnavailable = () =>
    setSelIds((prev) => {
      const allSelected = unavailableItems.length > 0 && unavailableItems.every((i) => prev.has(i.id));
      if (allSelected) {
        const next = new Set(prev);
        unavailableItems.forEach((i) => next.delete(i.id));
        return next;
      }
      return new Set([...prev, ...unavailableItems.map((i) => i.id)]);
    });

  /* ---- bulk ops ---- */
  const printLabels = () => void navigate(`/inventory/print-labels?ids=${Array.from(selIds).join(',')}`);

  /**
   * Run one request per selected item and report the split honestly.
   *
   * `Promise.all` rejects on the first failure, so everything after the await
   * — the toast, the cleared selection, the two reloads — was skipped while
   * the items that *had* succeeded stayed changed on the server and stale on
   * screen. That became reachable when `status='available'` started being
   * refused per item: a bulk change would half-apply, say only "Failed to
   * update", and leave the list showing the old values.
   */
  const runForEach = async <T,>(
    ids: string[],
    request: (id: string) => Promise<T>
  ): Promise<{ done: number; failed: number; firstError: unknown }> => {
    const settled = await Promise.allSettled(ids.map(request));
    const rejected = settled.filter((r) => r.status === 'rejected');
    return {
      done: settled.length - rejected.length,
      failed: rejected.length,
      firstError: rejected[0]?.reason,
    };
  };

  const bulkRetire = async () => {
    if (
      !(await confirm({
        title: 'Retire items',
        message: `Retire ${selIds.size} item(s)? This cannot be undone.`,
        confirmLabel: 'Retire',
        cancelLabel: 'Keep them',
      }))
    )
      return;
    const { done, failed, firstError } = await runForEach(Array.from(selIds), (id) => inventoryService.retireItem(id));
    if (done) toast.success(`${done} item(s) retired`);
    if (failed) {
      toast.error(`${failed} item(s) could not be retired: ${getErrorMessage(firstError, 'unknown error')}`);
    }
    setSelIds(new Set());
    void loadItems(true);
    void loadSummary();
  };

  const bulkStatus = async () => {
    if (!bulkNewStatus) return;
    setBulkSaving(true);
    try {
      const { done, failed, firstError } = await runForEach(Array.from(selIds), (id) =>
        inventoryService.updateItem(id, { status: bulkNewStatus })
      );
      if (done) toast.success(`Updated ${done} item(s)`);
      if (failed) {
        // Named rather than swallowed: with the AVAILABLE-state rule, an item
        // whose condition forbids the new status is refused individually, and
        // "Failed to update" alone leaves the operator unable to tell which.
        toast.error(`${failed} item(s) could not be updated: ${getErrorMessage(firstError, 'unknown error')}`);
      }
      setSelIds(new Set());
      setBulkStatusOpen(false);
      setBulkNewStatus('');
      // Always: the successful half is already changed on the server, and a
      // list still showing their old status is the worse of the two lies.
      void loadItems(true);
      void loadSummary();
    } finally {
      setBulkSaving(false);
    }
  };

  /* ---- export ---- */
  const exportCsv = async () => {
    try {
      // The same object the list itself is fetched with, not a hand-picked
      // subset of it: this handler used to name three of the eleven filters,
      // so a member who narrowed to one colour and size exported the entire
      // department's uniforms under a filename claiming otherwise. Reusing
      // `filterParams` means the next filter added to the page reaches the
      // export with no second list to remember.
      //
      // `group_by` is dropped deliberately — it orders rows on screen, and a
      // spreadsheet regroups for itself.
      //
      // `loadedParams`, not `filterParams()`: filter changes are debounced, so
      // live control state can already hold a selection the rows on screen
      // were never fetched with. The button is disabled until the first load
      // stamps this, so the guard below is for TypeScript, not for a state a
      // member can reach.
      if (!loadedParams) return;
      const { group_by: _groupBy, ...exportParams } = loadedParams;
      const blob = await inventoryService.exportItemsCsv(exportParams);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventory-items-${getTodayLocalDate(tz)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('CSV exported');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Export failed'));
    }
  };

  const refresh = () => {
    setSelIds(new Set());
    void loadItems(true);
    void loadSummary();
  };
  const openAdd = () => {
    setEditItem(null);
    setModalOpen(true);
  };
  const openEdit = (it: InventoryItem) => {
    setEditItem(it);
    setModalOpen(true);
  };
  const onSaved = () => {
    void loadItems(true);
    void loadSummary();
  };
  const retireOne = (it: InventoryItem) => {
    void inventoryService
      .retireItem(it.id)
      .then(() => {
        toast.success(`${it.name} retired`);
        void loadItems(true);
        void loadSummary();
      })
      .catch((err: unknown) => toast.error(getErrorMessage(err, 'Failed to retire item')));
  };

  const fabActions = useMemo(() => {
    const a = [];
    if (canManage)
      a.push({
        id: 'add',
        label: 'Add Item',
        icon: <Plus className="h-5 w-5" />,
        onClick: openAdd,
        color: 'bg-emerald-600',
      });
    if (canManage)
      a.push({
        id: 'assign',
        label: 'Distribute Items',
        icon: <UserPlus className="h-5 w-5" />,
        onClick: () => setMemberPickerOpen(true),
        color: 'bg-blue-600',
      });
    return a;
  }, [canManage]);

  const hasMore = items.length < total;

  /* ---- collapsed groups must not strand an empty page ----
     Paging is by ITEM ROW — that is what the server counts and what
     "Load More (n of m)" reports, and those numbers stay in item terms
     because changing them to count visible rows would make the button
     disagree with the total beside it.

     What that costs is a page whose every row sits inside a collapsed group:
     nothing renders, the member sees headings over an empty table, and
     pressing Load More is the only way out of a state they did not choose to
     enter. So when a load leaves ZERO visible rows in the two grouped
     sections, fetch the next page until something is visible or the set runs
     out.

     Zero, not "fewer than a full page": topping up to a full page means
     collapsing one 400-row category pulls most of the catalogue. Pinned rows
     are excluded because they are never grouped — counting them would suppress
     the top-up permanently for anyone who keeps a shortlist, which is exactly
     the member most likely to collapse a group.

     Zero-visible is NOT self-limiting on its own, which an earlier version of
     this comment claimed. The backend orders by group key and then applies
     offset/limit (`_run_items_page`); nothing keeps a group inside one page. A
     collapsed group larger than PAGE_SIZE therefore yields page after page of
     entirely hidden rows, and "keep going until something is visible" walks
     the whole group — the very burst the paragraph above rules out. A failed
     request is worse: it leaves the visible count at zero with `hasMore` still
     true, so the effect fires again immediately, forever, one toast per turn.

     So the top-up is bounded twice over: at most MAX_AUTO_TOP_UPS consecutive
     pages, and it halts outright on the first failure. Both counters reset
     when the member presses Load More or changes what is on screen, because
     either is them asking again. */
  const autoTopUpsRef = useRef(0);
  const topUpHaltedRef = useRef(false);
  const visibleGroupedRows = useMemo(() => {
    if (!loadedGroupBy) return availableItems.length + unavailableItems.length;
    const shown = (section: string, list: InventoryItem[]) =>
      list.filter((i) => !collapsed.has(collapseKey(section, i.group_key ?? ''))).length;
    return shown('Available', availableItems) + shown('Unavailable', unavailableItems);
  }, [loadedGroupBy, availableItems, unavailableItems, collapsed]);

  // Anything the member does to change what is on screen is them asking again.
  useEffect(() => {
    autoTopUpsRef.current = 0;
    topUpHaltedRef.current = false;
  }, [collapsed, loadedGroupBy]);

  useEffect(() => {
    if (loading || loadingMore || !hasMore) return;
    if (visibleGroupedRows > 0) return;
    if (topUpHaltedRef.current || autoTopUpsRef.current >= MAX_AUTO_TOP_UPS) return;
    autoTopUpsRef.current += 1;
    void loadMorePage().then((ok) => {
      if (!ok) topUpHaltedRef.current = true;
    });
    // `loadMorePage` is omitted on purpose: it is redefined on every render, so
    // listing it re-runs this effect continuously. The refs above are what
    // terminate the loop, and they do it without depending on the response —
    // `hasMore` alone does not, because a rejected request leaves it true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleGroupedRows, hasMore, loading, loadingMore]);

  /* ================================================================ */
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Breadcrumbs />

      <Link
        to="/inventory/admin"
        className="text-theme-text-muted hover:text-theme-text-secondary mb-6 flex items-center gap-1 text-sm max-md:min-h-[44px]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Inventory Items</h1>
          {summary && (
            <div className="text-theme-text-muted mt-2 flex flex-wrap gap-4 text-sm">
              <span className="flex items-center gap-1.5">
                {/* non_medical_items, not total_items: the latter sums
                    quantities across every domain including medical, while
                    the list below counts rows and excludes it. A header of 82
                    over a list of 6 reads as a bug in the list. */}
                <Package className="h-4 w-4" /> {summary.non_medical_items} items
              </span>
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> {summary.overdue_checkouts} overdue
              </span>
              <span className="flex items-center gap-1.5">
                <Wrench className="h-4 w-4" /> {summary.maintenance_due_count} maint. due
              </span>
              {summary.total_value > 0 && <span>${formatNumber(summary.total_value)}</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="btn-secondary btn-icon-sm" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => void exportCsv()}
            // Until the first load lands there is no list to export, and a
            // button that silently does nothing is worse than one that says so.
            disabled={!loadedParams}
            className="btn-secondary btn-md hidden items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex"
          >
            <Download className="h-4 w-4" /> Export
          </button>
          {canManage && (
            <button
              onClick={() => setMemberPickerOpen(true)}
              className="btn-secondary btn-md hidden items-center gap-2 sm:inline-flex"
            >
              <UserPlus className="h-4 w-4" /> Assign
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setReceiveOpen(true)}
              className="btn-secondary btn-md hidden items-center gap-2 sm:inline-flex"
            >
              <PackagePlus className="h-4 w-4" /> Receive Stock
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setBulkAddOpen(true)}
              className="btn-secondary btn-md hidden items-center gap-2 sm:inline-flex"
              title="Paste a list of item names"
            >
              <ListPlus className="h-4 w-4" /> Add Several
            </button>
          )}
          {canManage && (
            <Link
              to="/inventory/import"
              className="btn-secondary btn-md hidden items-center gap-2 sm:inline-flex"
              title="Import items from a CSV file"
            >
              <Upload className="h-4 w-4" /> Import CSV
            </Link>
          )}
          {canManage && (
            <button onClick={openAdd} className="btn-info btn-md hidden items-center gap-2 sm:inline-flex">
              <Plus className="h-4 w-4" /> Add Item
            </button>
          )}
        </div>
      </div>

      {/* Location summary */}
      {locSummary.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {locSummary.map((loc) => (
            <button
              key={loc.location_id ?? 'unassigned'}
              onClick={() => {
                const value = loc.location_id ?? UNASSIGNED_LOCATION;
                setFLoc((prev) => (prev === value ? '' : value));
              }}
              aria-pressed={fLoc === (loc.location_id ?? UNASSIGNED_LOCATION)}
              className={`card-secondary hover:bg-theme-surface-hover p-3 text-left ${fLoc === (loc.location_id ?? UNASSIGNED_LOCATION) ? 'ring-2 ring-blue-500' : ''}`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <MapPin className="text-theme-text-muted h-3.5 w-3.5 shrink-0" />
                <span className="text-theme-text-primary truncate text-xs font-medium">{loc.location_name}</span>
              </div>
              <div className="text-theme-text-primary text-lg font-bold">{loc.total_quantity}</div>
              <div className="text-theme-text-muted text-xs">
                {loc.item_count} item{loc.item_count !== 1 ? 's' : ''}
                {loc.total_value > 0 && (
                  <span className="ml-1">&middot; ${formatNumber(loc.total_value, { maximumFractionDigits: 0 })}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Vendor scope, arrived at from a vendor card */}
      {vendorFilter && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2">
          <Truck className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Showing items purchased from{' '}
            <span className="font-semibold">
              {items.find((i) => i.vendor_id === vendorFilter)?.vendor_name ?? 'this vendor'}
            </span>
          </p>
          <button
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('vendor_id');
              setSearchParams(next, { replace: true });
            }}
            className="ml-auto text-xs font-medium text-blue-700 hover:underline dark:text-blue-300"
          >
            Clear vendor filter
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="card-secondary mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <div className="relative lg:col-span-2">
            <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              type="text"
              aria-label="Search items..."
              placeholder="Search items..."
              className="form-input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter by category"
            className="form-input"
            value={fCat}
            onChange={(e) => setFCat(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            className="form-input"
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by condition"
            className="form-input"
            value={fCond}
            onChange={(e) => setFCond(e.target.value)}
          >
            <option value="">All Conditions</option>
            {ITEM_CONDITION_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by type"
            className="form-input"
            value={fType}
            onChange={(e) => setFType(e.target.value)}
          >
            <option value="">All Types</option>
            {ITEM_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by location"
            className="form-input"
            value={fLoc}
            onChange={(e) => setFLoc(e.target.value)}
          >
            <option value="">All Locations</option>
            <option value={UNASSIGNED_LOCATION}>Unassigned</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <select
            aria-label="Filter by size"
            className="form-input"
            value={fSize}
            onChange={(e) => setFSize(e.target.value)}
          >
            <option value="">All Sizes</option>
            {/* Grouped like the styles filter. The flat letter list also made
                boot and waist sizes unfilterable, even for items created one
                at a time through the Physical picker, which does offer them. */}
            {SIZE_PICKER_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select
            aria-label="Filter by color"
            className="form-input"
            value={fColor}
            onChange={(e) => setFColor(e.target.value)}
          >
            <option value="">All Colors</option>
            {colorOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by style"
            className="form-input"
            value={fStyle}
            onChange={(e) => setFStyle(e.target.value)}
          >
            <option value="">All Styles</option>
            {/* Grouped by axis, so "Long Sleeve" reads as a sleeve choice
                rather than as a garment type. The posted value is unchanged. */}
            {GARMENT_STYLE_AXES.map((axis) => (
              <optgroup key={axis.key} label={axis.label}>
                {axis.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {/* Bulk bar */}
      {selIds.size > 0 && (
        <div className="card-secondary mb-4 flex flex-wrap items-center gap-3 p-3">
          <span className="text-theme-text-primary text-sm font-medium">{selIds.size} selected</span>
          <button onClick={printLabels} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
            <Printer className="h-3.5 w-3.5" /> Print Labels
          </button>
          <button
            onClick={() => setBulkStatusOpen(true)}
            className="btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <ArrowUpDown className="h-3.5 w-3.5" /> Change Status
          </button>
          {canManage && (
            <button onClick={() => void bulkRetire()} className="btn-primary btn-sm inline-flex items-center gap-1.5">
              <Archive className="h-3.5 w-3.5" /> Retire
            </button>
          )}
          <button
            onClick={() => setSelIds(new Set())}
            className="text-theme-text-muted hover:text-theme-text-primary ml-auto text-xs"
          >
            Clear
          </button>
        </div>
      )}

      {/* Bulk status modal */}
      <Modal
        isOpen={bulkStatusOpen}
        onClose={() => setBulkStatusOpen(false)}
        title="Bulk Status Change"
        size="sm"
        footer={
          <>
            <button
              onClick={() => void bulkStatus()}
              disabled={!bulkNewStatus || bulkSaving}
              className="btn-info btn-md ml-2"
            >
              {bulkSaving ? 'Updating...' : 'Apply'}
            </button>
            <button onClick={() => setBulkStatusOpen(false)} className="btn-secondary btn-md">
              Cancel
            </button>
          </>
        }
      >
        <p className="text-theme-text-secondary mb-3 text-sm">Set status for {selIds.size} item(s):</p>
        <select
          className="form-input"
          value={bulkNewStatus}
          onChange={(e) => setBulkNewStatus(e.target.value)}
          aria-label="New status"
        >
          <option value="">-- Select Status --</option>
          {/* Retiring is Retire's job alone -- the backend rejects a
              status/condition pair of retired through this generic PATCH
              path, so offering it here would deterministically 400. Use
              the dedicated Retire action (above) instead. */}
          {STATUS_OPTIONS.filter((s) => s.value !== 'retired').map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Modal>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card-secondary animate-pulse p-4">
              <div className="bg-theme-surface-hover mb-2 h-4 w-1/3 rounded" />
              <div className="bg-theme-surface-hover h-3 w-2/3 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && items.length === 0 && (
        <EmptyState
          icon={Package}
          title="No items found"
          description={
            search || fCat || fStatus || fCond || fType || fLoc || fSize || fColor || fStyle || vendorFilter
              ? 'Try adjusting your filters.'
              : 'Get started by adding your first inventory item.'
          }
          actions={canManage ? [{ label: 'Add Item', onClick: openAdd, icon: Plus }] : undefined}
        />
      )}

      {/* Group-by — a view control, not a filter: it changes how rows are
          arranged, never which ones match, so it sits with Sort rather than in
          the filter card above. */}
      {!loading && items.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <label htmlFor="group-by" className="text-theme-text-muted shrink-0 text-xs">
            Group by:
          </label>
          <select
            id="group-by"
            className="form-input w-auto py-1.5 text-xs"
            value={groupBy}
            onChange={(e) => {
              setGroupBy(e.target.value as GroupKey);
              // Collapse state is keyed by group VALUE, and those values mean
              // different things on a different dimension — a key collapsed
              // under Colour must not silently collapse a Category.
              setCollapsed(new Set());
            }}
          >
            {GROUP_COLS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Mobile sort controls — the table's header-sort buttons are hidden
          when rows reflow into cards on mobile, so expose sorting here. */}
      {!loading && items.length > 0 && (
        <div className="mb-3 flex items-center gap-2 md:hidden">
          <label className="text-theme-text-muted shrink-0 text-xs">Sort:</label>
          <select
            className="form-input flex-1 py-1.5 text-xs"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
          >
            {SORT_COLS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setSortOrd((p) => (p === 'asc' ? 'desc' : 'asc'))}
            className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary active:bg-theme-surface-hover rounded border p-2"
            aria-label={`Sort ${sortOrd === 'asc' ? 'descending' : 'ascending'}`}
          >
            {sortOrd === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      )}

      {/* Items — single responsive tables split by availability (a table on
          >=md, stacked cards below). */}
      {!loading && items.length > 0 && (
        <div className="space-y-6">
          {/* Pinned first, and with Status shown: a pinned item that has gone
              into maintenance is exactly what its owner needs to see. */}
          <ItemTable
            label="Pinned"
            icon={<Pin className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
            items={pinnedItems}
            categories={categories}
            locations={locations}
            selIds={selIds}
            toggle={toggle}
            toggleAll={toggleAllPinned}
            toggleSort={toggleSort}
            SortIc={SortIc}
            sortBy={sortBy}
            sortOrd={sortOrd}
            showStatus
            canManage={canManage}
            onEdit={openEdit}
            onRetire={retireOne}
            onTogglePin={(item) => void togglePin(item)}
            onMovePin={(id, to) => void movePin(id, to)}
            pinnedMode
          />
          <ItemTable
            label="Available"
            icon={<CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />}
            items={availableItems}
            categories={categories}
            locations={locations}
            selIds={selIds}
            toggle={toggle}
            toggleAll={toggleAllAvailable}
            toggleSort={toggleSort}
            SortIc={SortIc}
            sortBy={sortBy}
            sortOrd={sortOrd}
            showStatus={false}
            canManage={canManage}
            onEdit={openEdit}
            onRetire={retireOne}
            onTogglePin={(item) => void togglePin(item)}
            truncated={hasMore}
            groupBy={loadedGroupBy}
            groupTotals={groupAvailable}
            groupLabels={groupLabels}
            collapsed={collapsed}
            onToggleGroup={toggleGroup}
            expandedVariants={expandedVariants}
            onToggleVariants={toggleVariants}
          />
          <ItemTable
            label="Unavailable"
            icon={<XCircle className="h-4 w-4 text-red-500 dark:text-red-400" />}
            items={unavailableItems}
            categories={categories}
            locations={locations}
            selIds={selIds}
            toggle={toggle}
            toggleAll={toggleAllUnavailable}
            toggleSort={toggleSort}
            SortIc={SortIc}
            sortBy={sortBy}
            sortOrd={sortOrd}
            showStatus
            canManage={canManage}
            onEdit={openEdit}
            onRetire={retireOne}
            onTogglePin={(item) => void togglePin(item)}
            truncated={hasMore}
            groupBy={loadedGroupBy}
            groupTotals={groupUnavailable}
            groupLabels={groupLabels}
            collapsed={collapsed}
            onToggleGroup={toggleGroup}
            expandedVariants={expandedVariants}
            onToggleVariants={toggleVariants}
          />
        </div>
      )}

      {/* Load more */}
      {!loading && hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => void handleMore()}
            disabled={loadingMore}
            className="btn-secondary btn-md inline-flex items-center gap-2"
          >
            {loadingMore ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" /> Loading...
              </>
            ) : (
              <>
                Load More ({items.length} of {total})
              </>
            )}
          </button>
        </div>
      )}

      {/* Item form modal */}
      <ItemFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={onSaved}
        categories={categories}
        locations={locations}
        storageAreas={storageAreas}
        editItem={editItem}
      />

      <ReceiveStockModal isOpen={receiveOpen} onClose={() => setReceiveOpen(false)} onReceived={refresh} />
      <BulkAddItemsModal
        isOpen={bulkAddOpen}
        onClose={() => setBulkAddOpen(false)}
        categories={categories}
        onCreated={refresh}
      />

      {/* Quick-assign: pick a member, then assign items to them */}
      <MemberPickerModal
        isOpen={memberPickerOpen}
        onClose={() => setMemberPickerOpen(false)}
        title="Distribute Items — Select a Member"
        onSelect={(member) => {
          setMemberPickerOpen(false);
          setAssignTarget(member);
        }}
      />
      <InventoryScanModal
        isOpen={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        mode="distribute"
        userId={assignTarget?.userId ?? ''}
        memberName={assignTarget?.memberName ?? ''}
        onComplete={() => {
          void loadItems(true);
          void loadSummary();
        }}
      />

      {/* Mobile FAB */}
      <FloatingActionButton actions={fabActions} />
    </div>
  );
};

export default InventoryItemsPage;
