/**
 * Medical Supplies Page
 *
 * The EMS side of the department's stock, on its own page so it can be run by
 * its own officer. Gear and uniforms live at /inventory and never appear here.
 *
 * The page opens on what expires rather than on a full item list: dated stock
 * is the thing that goes wrong quietly, and an officer checking in wants to
 * know what is about to lapse before they want an inventory count.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Tag,
  TrendingDown,
} from 'lucide-react';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import type { MedicalSupplySummary } from '../../../services/medicalSuppliesService';
import type { ExpiringLot, InventoryCategory, InventoryItem } from '../../../services/eventServices';
import { useAuthStore } from '../../../stores/authStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useRegisterPullToRefresh } from '../../../hooks/useRegisterPullToRefresh';
import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonCard } from '../../../components/ux/Skeleton';
import { MedicalItemFormModal } from '../components/MedicalItemFormModal';
import { ReceiveDeliveryModal } from '../components/ReceiveDeliveryModal';
import { EXPIRY_WINDOW_DAYS } from '../types';
import { onHandQuantity } from '../../inventory/utils/onHand';

type Tab = 'expiring' | 'stock';
const PAGE_SIZE = 200;

/** Severity of a dated lot, by how long is left on it. */
function expiryTone(days: number | undefined): string {
  if (days === undefined || days === null) return 'text-theme-text-muted';
  if (days < 0) return 'text-red-700 dark:text-red-400';
  if (days <= 7) return 'text-orange-700 dark:text-orange-400';
  return 'text-amber-700 dark:text-amber-400';
}

function expiryLabel(days: number | undefined): string {
  if (days === undefined || days === null) return '—';
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  return `${days}d left`;
}

/**
 * Identity of an item query: what the rendered rows are an answer to.
 *
 * NUL separator, because a plain space would let search "a b" with no category
 * collide with search "a" under category "b".
 */
function itemQueryKey(searchTerm: string, category: string, pageIndex: number): string {
  return `${searchTerm}\u0000${category}\u0000${pageIndex}`;
}

type Section = 'summary' | 'items' | 'categories' | 'expiring';

const ALL_SECTIONS: Section[] = ['summary', 'items', 'categories', 'expiring'];

const SECTION_LABELS: Record<Section, string> = {
  summary: 'overview',
  items: 'supply table',
  categories: 'category list',
  expiring: 'expiring stock',
};

interface SectionErrorProps {
  section: Section;
  message: string;
  isStale: boolean;
  onRetry: () => void;
}

const SectionError: React.FC<SectionErrorProps> = ({ section, message, isStale, onRetry }) => (
  <div className="alert-danger mb-4 flex flex-wrap items-center justify-between gap-3" role="alert">
    <div>
      <p className="font-medium">Could not load the {SECTION_LABELS[section]}.</p>
      <p className="text-sm">{message}</p>
      {isStale && <p className="mt-1 text-xs font-semibold uppercase">Showing previously loaded data</p>}
    </div>
    <button
      type="button"
      onClick={onRetry}
      // Two of these render together when categories and items both fail, and
      // a screen reader reads only the button's own name -- the heading beside
      // it is not part of it. Same reason the Dashboard's SectionError takes a
      // source.
      aria-label={`Retry ${SECTION_LABELS[section]}`}
      className="mobile-touch-target rounded-md border border-current px-3 py-2 text-sm font-medium"
    >
      Retry
    </button>
  </div>
);

interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: string;
}

const StatTile: React.FC<StatTileProps> = ({ icon, label, value, tone }) => (
  <div className="card flex items-center gap-3 p-4">
    <div className={`rounded-md p-2 ${tone}`}>{icon}</div>
    <div className="min-w-0">
      <p className="text-theme-text-primary text-xl font-semibold tabular-nums">{formatNumber(value)}</p>
      <p className="text-theme-text-muted truncate text-xs">{label}</p>
    </div>
  </div>
);

const MedicalSuppliesPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  // Either grant works: a department running one supply line holds the broad
  // one, a department that split the job holds the medical one.
  const canManage = checkPermission('inventory.manage_medical') || checkPermission('inventory.manage');
  // The cross-reference below points into the gear catalogue, which is
  // manager-only — a medical-only supply officer would be sent to Access
  // Denied by a sentence that was only ever an aside.
  const canManageGear = checkPermission('inventory.manage');
  const tz = useTimezone();

  const [tab, setTab] = useState<Tab>('expiring');
  const [summary, setSummary] = useState<MedicalSupplySummary | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [expiring, setExpiring] = useState<ExpiringLot[]>([]);
  const [loading, setLoading] = useState<Record<Section, boolean>>({
    summary: true,
    items: true,
    categories: true,
    expiring: true,
  });
  const [errors, setErrors] = useState<Partial<Record<Section, string>>>({});
  // Whether a section has ever completed a load. Distinct from "has rows": a
  // section that loaded and came back empty is loaded, and one that has only
  // ever failed is not -- so an empty state is an answer rather than a guess.
  const [loaded, setLoaded] = useState<Record<Section, boolean>>({
    summary: false,
    items: false,
    categories: false,
    expiring: false,
  });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(0);
  const [itemPage, setItemPage] = useState({ total: 0, skip: 0, limit: PAGE_SIZE });
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);

  // Which query the rows in `items` actually answer. Rendering the empty state
  // off `items.length` alone reports "no medical supplies" whenever the list
  // has not caught up with the controls -- before the first response, and in
  // the window after a filter or page changes -- which reads as an empty
  // catalogue rather than as a pending request. null until the first response.
  const [itemsFilterKey, setItemsFilterKey] = useState<string | null>(null);

  // Which query the standing item error belongs to. A failure answers one
  // query; left unkeyed it reads as the next filter's failure, and its Retry
  // re-runs the query the user has already moved on from.
  const [itemsErrorKey, setItemsErrorKey] = useState<string | null>(null);

  // Monotonic request ids, one per section. Clicking Next and then editing the
  // filter starts two item loads; without this both commit, and if the older
  // one lands last the table shows rows that do not match the visible filter
  // while `page` and `itemPage.skip` disagree -- a state the Previous button
  // cannot recover from, because decrementing page 0 is a no-op.
  const sectionRequestIds = useRef<Record<Section, number>>({
    summary: 0,
    items: 0,
    categories: 0,
    expiring: 0,
  });
  const itemsAbortController = useRef<AbortController | null>(null);

  const filterKey = itemQueryKey(debouncedSearch, categoryFilter, page);

  /**
   * Shown while the numbers still describe something real: the rows on screen,
   * or the request that is replacing them. A query that settles without
   * producing rows for itself has failed, and `itemPage` still holds the
   * previous response -- so the range would sit above an empty table, under
   * the error explaining why it is empty.
   *
   * Deliberately still shown during an ordinary page change: hiding the pager
   * on the click that uses it is worse than leaving it in place, disabled.
   */
  /**
   * Whether the range and total describe the rows on screen. A query that
   * settled without producing rows for itself has failed, and `itemPage` still
   * holds the previous response -- so the range would sit above an empty
   * table, under the error explaining why it is empty.
   */
  const pagerAnswersScreen = itemsFilterKey === filterKey;

  /**
   * Whether paging is meaningful at all: some page of some query has loaded,
   * so there is a place to go back to.
   *
   * Deliberately weaker than `pagerAnswersScreen`. Hiding the whole pager
   * whenever the numbers went stale also removed the only control that could
   * recover: a rejected Next leaves `page` at 1 with `itemPage` still
   * describing page 0, and with no Previous on screen there is nothing that
   * returns the officer to a page that loads.
   */
  const pagerNavigable = itemsFilterKey !== null;

  /**
   * Whether the on-screen controls have actually been asked yet.
   *
   * During the search debounce no request has started, so nothing is loading
   * and Next would otherwise stay live. One click there advances the page, and
   * the typed search is then requested at skip 200 -- past its own first page,
   * for a range like "Showing 201-5 of 5".
   */
  const filtersSettled = search === debouncedSearch;

  const loadSections = useCallback(
    async (sections: Section[], { bypassCache = false }: { bypassCache?: boolean } = {}) => {
      const requestedFilterKey = itemQueryKey(debouncedSearch, categoryFilter, page);
      setLoading((current) => ({ ...current, ...Object.fromEntries(sections.map((section) => [section, true])) }));

      let controller: AbortController | undefined;
      if (sections.includes('items')) {
        itemsAbortController.current?.abort();
        controller = new AbortController();
        itemsAbortController.current = controller;
      }

      // undefined rather than {} when there is nothing to say: a caller that
      // passes no options should reach the service the same way it always did.
      const base = bypassCache ? { bypassCache: true } : undefined;
      const requests: Record<Section, () => Promise<unknown>> = {
        summary: () => medicalSuppliesService.getSummary(EXPIRY_WINDOW_DAYS, base),
        items: () =>
          medicalSuppliesService.getItems(
            {
              search: debouncedSearch || undefined,
              category_id: categoryFilter || undefined,
              skip: page * PAGE_SIZE,
              limit: PAGE_SIZE,
            },
            { ...base, ...(controller ? { signal: controller.signal } : {}) }
          ),
        categories: () => medicalSuppliesService.getCategories(true, base),
        expiring: () => medicalSuppliesService.getExpiringLots(EXPIRY_WINDOW_DAYS, base),
      };

      // Settled per section, not through one Promise.all or allSettled. Those
      // forms wait for the slowest request before any section updates, so a
      // categories call hanging to the API timeout held summary and expiring
      // stock on their skeletons -- which is the coupling this split exists to
      // remove.
      await Promise.all(
        sections.map(async (section) => {
          const requestId = sectionRequestIds.current[section] + 1;
          sectionRequestIds.current[section] = requestId;
          const superseded = () => sectionRequestIds.current[section] !== requestId;
          try {
            const value = await requests[section]();
            if (superseded()) return;
            setErrors((current) => {
              const next = { ...current };
              delete next[section];
              return next;
            });
            setLoaded((current) => ({ ...current, [section]: true }));
            if (section === 'summary') setSummary(value as MedicalSupplySummary);
            if (section === 'items') {
              const data = value as { items: InventoryItem[]; total: number; skip: number; limit: number };
              setItems(data.items);
              setItemPage({ total: data.total, skip: data.skip, limit: data.limit });
              // Stamped from this closure's own values, not from the render's
              // `filterKey`: those are what the request actually asked for.
              setItemsFilterKey(requestedFilterKey);
            }
            if (section === 'categories') setCategories(value as InventoryCategory[]);
            if (section === 'expiring') setExpiring(value as ExpiringLot[]);
          } catch (reason: unknown) {
            if (superseded()) return;
            if (section === 'items' && controller?.signal.aborted) return;
            setErrors((current) => ({
              ...current,
              [section]: getErrorMessage(reason, `Failed to load the ${SECTION_LABELS[section]}`),
            }));
            if (section === 'items') setItemsErrorKey(requestedFilterKey);
          } finally {
            // Only the newest request clears the flag: an older one finishing
            // last would otherwise report the section idle while the request
            // the user is actually waiting on is still running.
            if (!superseded()) setLoading((current) => ({ ...current, [section]: false }));
          }
        })
      );
    },
    [debouncedSearch, categoryFilter, page]
  );

  const loadSectionsRef = useRef(loadSections);
  loadSectionsRef.current = loadSections;

  // A refresh the user asked for goes to the server. The shared client would
  // otherwise answer a GET from cache for 30s, and serve a stale one for 90s
  // while swallowing the revalidation's failure -- so the refresh would report
  // success against old quantities and never raise the error it exists to find.
  const refresh = useCallback(() => loadSectionsRef.current(ALL_SECTIONS, { bypassCache: true }), []);

  // Two effects, not one. `loadSections` closes over the filters, so a single
  // effect keyed on it reloaded all four sections on every keystroke -- and
  // since each section's newest request wins, those filter-driven requests
  // superseded an explicit refresh's four, letting cached summary, category
  // and expiring responses land while the refresh's fresh data was discarded.
  useEffect(() => {
    void loadSectionsRef.current(ALL_SECTIONS);
    return () => itemsAbortController.current?.abort();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Compared by value rather than gated on a "has mounted" ref: the mount
  // effect above runs first, so a flag would let this one fire immediately
  // after it and load the items twice.
  const lastItemQuery = useRef(itemQueryKey('', '', 0));
  useEffect(() => {
    const key = itemQueryKey(debouncedSearch, categoryFilter, page);
    if (lastItemQuery.current === key) return;
    lastItemQuery.current = key;
    void loadSectionsRef.current(['items']);
  }, [debouncedSearch, categoryFilter, page]);

  useRegisterPullToRefresh(refresh);

  /** Lot stock is the real count for dated items; quantity is what's left over. */

  /**
   * Resolve the category from the list this page already loaded.
   *
   * Not `item.category_name`: that field is not on `InventoryItemResponse`, so
   * FastAPI strips it on the way out and every categorized supply rendered a
   * dash. The categories are in hand anyway — one lookup beats widening a
   * response model shared with the gear endpoints.
   */
  const categoryName = (item: InventoryItem): string => {
    if (!item.category_id) return '—';
    const known = categories.find((c) => c.id === item.category_id)?.name;
    if (known) return known;
    // Pending, not absent: '—' is an answer ("no category"), and the page is
    // not entitled to give it while the list that would name the category is
    // still in flight -- on a refresh as much as on the first load, since
    // another session can add a category between them. A *failed* list is a
    // different state: the section error says so, and it keeps the dash.
    return loading.categories ? '…' : '—';
  };

  const handleSaved = () => {
    setShowItemModal(false);
    setEditingItem(null);
    setShowDeliveryModal(false);
    void refresh();
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-6">
        <Link
          to="/dashboard"
          className="text-theme-text-muted hover:text-theme-text-primary mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-semibold">
              <Stethoscope className="h-6 w-6" />
              Medical Supplies
            </h1>
            <p className="text-theme-text-muted mt-1 text-sm">
              EMS stock with lot numbers and expiration dates, run on the same catalog as gear and uniforms
              {canManageGear && (
                <>
                  {' '}
                  under{' '}
                  <Link to="/inventory" className="underline">
                    Inventory
                  </Link>
                </>
              )}
              .
            </p>
          </div>

          <div className="hscroll flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="btn-icon"
              aria-label="Refresh medical supplies"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            {canManage && (
              <>
                <Link
                  to="/medical-supplies/categories"
                  className="btn-icon"
                  aria-label="Manage medical supply categories"
                >
                  <Tag className="h-4 w-4" />
                </Link>
                <button
                  type="button"
                  onClick={() => setShowDeliveryModal(true)}
                  className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
                >
                  <PackagePlus className="h-4 w-4" />
                  Receive delivery
                </button>
                <button type="button" onClick={() => setShowItemModal(true)} className="btn-primary">
                  <Plus className="h-4 w-4" />
                  Add supply
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {errors.summary && (
        <SectionError
          section="summary"
          message={errors.summary}
          isStale={loaded.summary}
          onRetry={() => void loadSections(['summary'], { bypassCache: true })}
        />
      )}
      {/*
       * Its own skeleton, not the expiring section's. The two requests settle
       * independently now, so a summary still pending after expiring stock
       * arrives would otherwise leave the stat grid simply absent -- a
       * half-loaded page that looks complete, with the tiles appearing later
       * without warning.
       */}
      {loading.summary && !loaded.summary && (
        // Labelled, because SkeletonCard renders no role of its own: without
        // this the tiles' absence is announced as nothing at all rather than
        // as something still arriving.
        <div className="mb-6" role="status" aria-live="polite" aria-label="Loading the overview">
          <SkeletonCard />
        </div>
      )}
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={<Stethoscope className="h-4 w-4 text-sky-700 dark:text-sky-400" />}
            label="Supply items"
            value={summary.total_items}
            tone="bg-sky-500/10"
          />
          <StatTile
            icon={<CalendarClock className="h-4 w-4 text-amber-700 dark:text-amber-400" />}
            label={`Expiring within ${summary.expiring_within_days}d`}
            value={summary.expiring_soon}
            tone="bg-amber-500/10"
          />
          <StatTile
            icon={<AlertTriangle className="h-4 w-4 text-red-700 dark:text-red-400" />}
            label="Already expired"
            value={summary.expired}
            tone="bg-red-500/10"
          />
          <StatTile
            icon={<TrendingDown className="h-4 w-4 text-orange-700 dark:text-orange-400" />}
            label="Below reorder point"
            value={summary.low_stock}
            tone="bg-orange-500/10"
          />
        </div>
      )}

      <div className="tab-scroll mb-4">
        <button
          type="button"
          onClick={() => setTab('expiring')}
          aria-current={tab === 'expiring' ? 'page' : undefined}
          className={`mobile-touch-target px-4 py-2 text-sm font-medium ${
            tab === 'expiring'
              ? 'border-b-2 border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-400'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          Expiring stock
        </button>
        <button
          type="button"
          onClick={() => setTab('stock')}
          aria-current={tab === 'stock' ? 'page' : undefined}
          className={`mobile-touch-target px-4 py-2 text-sm font-medium ${
            tab === 'stock'
              ? 'border-b-2 border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-400'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          All supplies
        </button>
      </div>

      {tab === 'expiring' && errors.expiring && (
        <SectionError
          section="expiring"
          message={errors.expiring}
          isStale={loaded.expiring}
          onRetry={() => void loadSections(['expiring'], { bypassCache: true })}
        />
      )}
      {tab === 'stock' && errors.categories && (
        <SectionError
          section="categories"
          message={errors.categories}
          isStale={loaded.categories}
          onRetry={() => void loadSections(['categories'], { bypassCache: true })}
        />
      )}
      {/*
       * Keyed to the query that failed. Without that, changing the filter after
       * a failure left A's error standing under B's controls for as long as B
       * took to load, and its Retry re-ran A.
       */}
      {tab === 'stock' && errors.items && itemsErrorKey === filterKey && (
        <SectionError
          section="items"
          message={errors.items}
          isStale={loaded.items && itemsFilterKey === filterKey}
          onRetry={() => void loadSections(['items'], { bypassCache: true })}
        />
      )}

      {tab === 'expiring' && loading.expiring && !loaded.expiring ? (
        <SkeletonCard />
      ) : tab === 'expiring' ? (
        <section aria-label="Expiring stock">
          {loaded.expiring && expiring.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nothing expiring"
              description={`No medical stock lot expires within ${EXPIRY_WINDOW_DAYS} days.`}
            />
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="rwd-table w-full text-sm">
                <thead>
                  <tr className="border-theme-surface-border border-b">
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">Item</th>
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">Lot</th>
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">
                      Expires
                    </th>
                    <th className="text-theme-text-muted px-4 py-3 text-right text-xs font-semibold uppercase">
                      On hand
                    </th>
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {expiring.map((lot) => (
                    <tr key={lot.id} className="border-theme-surface-border border-b last:border-0">
                      <td data-label="Item" className="text-theme-text-primary px-4 py-3 font-medium">
                        {lot.item_name ?? '—'}
                      </td>
                      <td data-label="Lot" className="text-theme-text-muted px-4 py-3 font-mono text-xs">
                        {lot.lot_number || '—'}
                      </td>
                      <td data-label="Expires" className="text-theme-text-muted px-4 py-3">
                        {lot.expiration_date ? formatDate(lot.expiration_date, tz) : '—'}
                      </td>
                      <td data-label="On hand" className="text-theme-text-primary px-4 py-3 text-right tabular-nums">
                        {formatNumber(lot.quantity)}
                      </td>
                      <td
                        data-label="Status"
                        className={`px-4 py-3 font-medium ${expiryTone(lot.days_until_expiration)}`}
                      >
                        {expiryLabel(lot.days_until_expiration)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section aria-label="All supplies" aria-busy={loading.items}>
          <div className="mb-4 flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Search supplies"
                aria-label="Search medical supplies"
                className="form-input w-full pl-9"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(0);
              }}
              aria-label="Filter by category"
              className="form-input w-auto"
              // Disabled only before the list has ever loaded. A *failed* list
              // leaves the control usable: the server still filters, and the
              // section alert above says why the names are missing.
              disabled={loading.categories && !loaded.categories}
            >
              <option value="">
                {loading.categories && !loaded.categories ? 'Loading categories…' : 'All categories'}
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/*
           * Rows are shown only when they answer the query that is on screen.
           * Anything else is a pending request (skeleton) or a failed one -- and
           * a failed one renders nothing here, because the alert above already
           * says what happened and "No medical supplies yet" would contradict
           * it. The controls above stay mounted throughout: putting the
           * skeleton over them would unmount the search box mid-keystroke.
           */}
          {itemsFilterKey !== filterKey ? (
            loading.items ? (
              <SkeletonCard />
            ) : null
          ) : loaded.items && items.length === 0 ? (
            <EmptyState
              icon={Stethoscope}
              title="No medical supplies yet"
              description={
                canManage
                  ? 'Add a category first, then the supplies that go in it.'
                  : 'Nothing has been added to the medical catalog yet.'
              }
            />
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="rwd-table w-full text-sm">
                <thead>
                  <tr className="border-theme-surface-border border-b">
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">Item</th>
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">
                      Category
                    </th>
                    <th className="text-theme-text-muted px-4 py-3 text-right text-xs font-semibold uppercase">
                      On hand
                    </th>
                    <th className="text-theme-text-muted px-4 py-3 text-right text-xs font-semibold uppercase">
                      Reorder at
                    </th>
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">
                      Storage
                    </th>
                    {canManage && (
                      <th className="px-4 py-3 text-right">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const isLow = item.reorder_point !== undefined && onHandQuantity(item) <= (item.reorder_point ?? 0);
                    return (
                      <tr key={item.id} className="border-theme-surface-border border-b last:border-0">
                        <td data-label="Item" className="text-theme-text-primary px-4 py-3 font-medium">
                          {item.name}
                          {item.unit_of_measure && (
                            <span className="text-theme-text-muted ml-1 text-xs">({item.unit_of_measure})</span>
                          )}
                        </td>
                        <td data-label="Category" className="text-theme-text-muted px-4 py-3">
                          {categoryName(item)}
                        </td>
                        <td
                          data-label="On hand"
                          className={`px-4 py-3 text-right tabular-nums ${
                            isLow ? 'font-semibold text-orange-700 dark:text-orange-400' : 'text-theme-text-primary'
                          }`}
                        >
                          {formatNumber(onHandQuantity(item))}
                        </td>
                        <td data-label="Reorder at" className="text-theme-text-muted px-4 py-3 text-right tabular-nums">
                          {item.reorder_point === undefined ? '—' : formatNumber(item.reorder_point)}
                        </td>
                        <td data-label="Storage" className="text-theme-text-muted px-4 py-3">
                          {item.storage_location || '—'}
                        </td>
                        {canManage && (
                          <td data-label="Actions" className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setEditingItem(item)}
                              className="btn-icon"
                              aria-label={`Edit ${item.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {pagerNavigable && itemPage.total > 0 && (
            <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Medical supplies pagination">
              <button
                type="button"
                className="btn-secondary"
                // Keyed on the requested `page`, not on the loaded
                // `itemPage.skip`. After a rejected Next those disagree --
                // page 1, skip 0 -- and keying on skip disabled the one
                // control that could get back to a page that loads.
                disabled={loading.items || !filtersSettled || page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <p className="text-theme-text-muted text-sm" aria-live="polite">
                {pagerAnswersScreen
                  ? `Showing ${formatNumber(itemPage.skip + 1)}–${formatNumber(
                      Math.min(itemPage.skip + items.length, itemPage.total)
                    )} of ${formatNumber(itemPage.total)}`
                  : `Page ${formatNumber(page + 1)}`}
              </p>
              <button
                type="button"
                className="btn-secondary"
                // Disabled while a page is in flight, and bounded by the known
                // total. The enabled state otherwise came from the *previous*
                // response, so a second activation before this one landed
                // stepped past the last page -- skip=400 on a 201-item catalog,
                // an empty table and a range reading "Showing 401-201 of 201".
                //
                // Also disabled when the totals belong to a different query:
                // stepping forward on them would ask for page 2 of a query
                // whose page 1 never arrived.
                disabled={
                  loading.items ||
                  !filtersSettled ||
                  !pagerAnswersScreen ||
                  itemPage.skip + itemPage.limit >= itemPage.total
                }
                onClick={() => setPage((p) => Math.min(p + 1, Math.max(0, Math.ceil(itemPage.total / PAGE_SIZE) - 1)))}
              >
                Next
              </button>
            </nav>
          )}
        </section>
      )}

      {editingItem && (
        <MedicalItemFormModal
          categories={categories}
          categoriesError={errors.categories ?? null}
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={handleSaved}
        />
      )}

      {showItemModal && (
        <MedicalItemFormModal
          categories={categories}
          categoriesError={errors.categories ?? null}
          onClose={() => setShowItemModal(false)}
          onSaved={handleSaved}
        />
      )}

      {showDeliveryModal && <ReceiveDeliveryModal onClose={() => setShowDeliveryModal(false)} onSaved={handleSaved} />}
    </div>
  );
};

export default MedicalSuppliesPage;
