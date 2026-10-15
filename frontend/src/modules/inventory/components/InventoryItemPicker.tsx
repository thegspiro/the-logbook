/**
 * InventoryItemPicker
 *
 * Compact search-and-select for linking a checklist item to an inventory
 * catalog item. Linking enables ready-stock tracking and lot swaps: once
 * linked, the supply-officer view shows replacement stock and the check form
 * exposes a "swap in newer" action.
 *
 * When the catalog has no match, `canCreateInventory` lets the viewer add one
 * from here. Without it the field dead-ends on "No matching items." — which is
 * the state a fresh department is always in, because nothing seeds the catalog,
 * so the control whose whole purpose is making the link could never make one.
 *
 * Creating goes through a server-side create-if-absent: the search here
 * excludes medical stock and returns one page, so "nothing on screen" is not
 * "nothing on file". A name already on the books comes back as the existing
 * row to link rather than as a second one beside it.
 *
 * What gets created is a bare name. The position's own numbers — required
 * quantity, critical minimum, min level — are deliberately not copied onto it:
 * one catalog item is stocked in many places (gauze in a jump bag, a cabinet
 * and two rigs), each counted on its own, so a count taken at one spot must
 * never become a department-wide floor. Those numbers live on
 * `check_template_items`; `reorder_point` on the catalog row is the
 * quartermaster's call and stays unset here.
 *
 * With `searchScope.medical` on, medical supplies are searched too and listed
 * first, and `canCreateMedical` offers creating the item in Medical Supplies
 * under a medical category the viewer picks.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2, Package, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '@/services/inventoryService';
import { medicalSuppliesService } from '@/services/medicalSuppliesService';
import type { InventoryItem } from '@/services/eventServices';
import { getErrorMessage } from '@/utils/errorHandling';
import MedicalCreatePanel from './MedicalCreatePanel';
import { searchChecklistCatalog, type CatalogDomain, type CatalogSearchScope } from '../utils/checklistCatalogSearch';

const GEAR_ONLY: CatalogSearchScope = { gear: true, medical: false };

/**
 * Resolve a linked item's name through whichever endpoint the viewer can read.
 *
 * The gear endpoint needs `inventory.view`; a medical-only supply officer
 * holds only `inventory.view_medical`, and used to see every link they made
 * read back as "Linked item".
 */
async function resolveItemName(itemId: string, scope: CatalogSearchScope): Promise<string> {
  if (scope.gear) {
    try {
      return (await inventoryService.getItem(itemId)).name;
    } catch (err: unknown) {
      if (!scope.medical) throw err;
    }
  }
  return (await medicalSuppliesService.getItem(itemId)).name;
}

interface InventoryItemPickerProps {
  value?: string | undefined;
  onChange: (id: string | undefined, name?: string) => void;
  /** Overrides the link-specific wording for other uses (e.g. receiving stock). */
  placeholder?: string;
  /**
   * Whether the viewer may write to the catalog (`inventory.manage`), which
   * turns on the create-and-link row. Defaults off so ReceiveStockModal — which
   * receives stock *against* an existing item — is unaffected.
   */
  canCreateInventory?: boolean;
  /**
   * How a newly created item should be tracked. Counted stock is a `pool`
   * row; a single device or vessel is `individual`, which is what the custody,
   * serial and transfer paths require. Forcing every creation to `pool` left a
   * thermal imager unable to use any of them until somebody reclassified it.
   */
  createTrackingType?: 'pool' | 'individual';
  /** Which halves of the catalog the viewer can read. Gear only by default. */
  searchScope?: CatalogSearchScope;
  /**
   * Whether the viewer may create medical supplies (inventory.manage_medical
   * or inventory.manage). Only meaningful with `searchScope.medical` on.
   */
  canCreateMedical?: boolean;
}

const InventoryItemPicker: React.FC<InventoryItemPickerProps> = ({
  value,
  onChange,
  placeholder = 'Search inventory to link…',
  canCreateInventory = false,
  createTrackingType = 'pool',
  searchScope = GEAR_ONLY,
  canCreateMedical = false,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; sub?: string; domain: CatalogDomain }[]>([]);
  const [medicalDraft, setMedicalDraft] = useState<string | null>(null);
  const { gear: searchGear, medical: searchMedical } = searchScope;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sequences responses: a slow earlier search resolving last would otherwise
  // gate the create row against a query the user has already moved on from.
  const requestRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cancel any pending debounced search when unmounting.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      requestRef.current += 1;
    };
  }, []);

  // Close the results dropdown when clicking outside the picker.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Resolve the display name for an already-linked item.
  useEffect(() => {
    if (!value) {
      setSelectedName(null);
      return;
    }
    let cancelled = false;
    void resolveItemName(value, { gear: searchGear, medical: searchMedical })
      .then((name) => {
        if (!cancelled) setSelectedName(name);
      })
      .catch(() => {
        if (!cancelled) setSelectedName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, searchGear, searchMedical]);

  const runSearch = useCallback(
    (q: string, request: number) => {
      if (!q.trim()) {
        setResults([]);
        setLoading(false);
        return;
      }
      void searchChecklistCatalog(q.trim(), { gear: searchGear, medical: searchMedical }, 10)
        .then(({ hits, incomplete }) => {
          if (request !== requestRef.current) return;
          // A failed search establishes nothing. Reporting it as an empty
          // catalog would let the create row offer to add an item that may
          // already be on file, splitting its checklist links and lots across
          // two rows — so absence has to be proven, not assumed.
          setSearchFailed(incomplete);
          setResults(
            hits.map(({ item: i, domain }) => {
              const sub = [i.manufacturer, i.model_number || i.serial_number].filter(Boolean).join(' · ');
              return { id: i.id, name: i.name, domain, ...(sub ? { sub } : {}) };
            })
          );
        })
        .finally(() => {
          if (request === requestRef.current) setLoading(false);
        });
    },
    [searchGear, searchMedical]
  );

  const handleQueryChange = (q: string) => {
    setMedicalDraft(null);
    setQuery(q);
    setOpen(true);
    setResults([]);
    setSearchFailed(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Loading covers the debounce interval too, so an empty settled result is
    // the only thing that means "no match". Otherwise the create row and the
    // empty state both flicker in during the 300ms before the request fires.
    setLoading(Boolean(q.trim()));
    const request = ++requestRef.current;
    debounceRef.current = setTimeout(() => runSearch(q, request), 300);
  };

  const typed = query.trim();
  const hasExactMatch = results.some((r) => r.name.trim().toLowerCase() === typed.toLowerCase());
  const canOfferCreate = typed.length > 0 && !loading && !searchFailed && !hasExactMatch;
  const showCreate = canCreateInventory && canOfferCreate;
  const showCreateMedical = canCreateMedical && searchMedical && canOfferCreate;
  const gearCreateLabel = showCreateMedical
    ? `Create “${typed}” as equipment or gear`
    : `Create “${typed}” in inventory`;

  const finishMedicalCreate = (item: InventoryItem) => {
    onChange(item.id, item.name);
    setSelectedName(item.name);
    setMedicalDraft(null);
    setQuery('');
    setResults([]);
  };

  /**
   * Add the typed name to the catalog and link it in one step.
   *
   * The server decides whether that means creating a row or handing back one
   * already carrying the name, so a name the search could not see is linked
   * rather than duplicated — nothing in the UI afterwards would reveal an
   * item's lots and links split across two rows.
   */
  const createAndLink = async () => {
    if (!typed || creating) return;
    setCreating(true);
    try {
      // One call, not a check followed by a create: the search above cannot
      // prove absence (it excludes medical stock and returns one page of ten),
      // and asking from here would leave seconds before the write in which
      // another editor can file the same name.
      const { item, created } = await inventoryService.createItemIfAbsent({
        name: typed,
        tracking_type: createTrackingType,
        // Counted stock starts at nothing on hand; an individually tracked
        // row is the one physical asset it describes.
        quantity: createTrackingType === 'pool' ? 0 : 1,
      });
      onChange(item.id, item.name);
      setSelectedName(item.name);
      setOpen(false);
      setQuery('');
      setResults([]);
      // Linking what was already on file is the good outcome, not a failure —
      // but say so, because the row was not in the results the user just read.
      toast.success(
        created ? `Added “${item.name}” to inventory` : `“${item.name}” was already in the catalog — linked it`
      );
    } catch (err: unknown) {
      // The query stays put so the name is not retyped to retry.
      toast.error(getErrorMessage(err, 'Failed to create the inventory item'));
    } finally {
      setCreating(false);
    }
  };

  if (value) {
    return (
      <div className="card-secondary flex items-center gap-2 px-3 py-2">
        <Package className="text-theme-text-muted h-4 w-4 shrink-0" />
        <span className="text-theme-text-primary min-w-0 flex-1 truncate text-sm">{selectedName ?? 'Linked item'}</span>
        <button
          type="button"
          onClick={() => {
            onChange(undefined);
            setQuery('');
            setResults([]);
          }}
          className="text-theme-text-muted hover:text-red-500"
          aria-label="Unlink inventory item"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="card focus-within:ring-theme-focus-ring flex items-center gap-2 px-3 py-2 focus-within:ring-2">
        <Search className="text-theme-text-muted h-4 w-4 shrink-0" />
        <input
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          type="text"
          className="text-theme-text-primary placeholder:text-theme-text-muted min-w-0 flex-1 bg-transparent text-sm outline-none"
          placeholder={placeholder}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => setOpen(true)}
        />
        {loading && <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" />}
      </div>
      {open && typed && (
        <div className="popover-panel absolute z-20 mt-1 max-h-56 w-full overflow-auto">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              // A pending create must be the only selection that can land.
              // Left enabled, a slow POST gave the user time to pick a result —
              // and the create's response then replaced their choice with the
              // new row, leaving the extra catalog entry behind.
              disabled={creating}
              onClick={() => {
                if (creating) return;
                onChange(r.id, r.name);
                setSelectedName(r.name);
                setOpen(false);
                setQuery('');
                setResults([]);
              }}
              className="hover:bg-theme-surface-secondary block w-full px-3 py-2 text-left disabled:opacity-50"
            >
              <span className="text-theme-text-primary block text-sm">{r.name}</span>
              {r.sub && <span className="text-theme-text-muted block text-xs">{r.sub}</span>}
              {r.domain === 'medical' && (
                <span className="badge mt-1 bg-blue-500/10 text-[10px] text-blue-800 dark:text-blue-300">Medical</span>
              )}
            </button>
          ))}

          {showCreateMedical && (
            <button
              type="button"
              onClick={() => {
                setMedicalDraft(typed);
                setOpen(false);
              }}
              disabled={creating}
              className="hover:bg-theme-surface-secondary border-theme-surface-border flex w-full items-center gap-2 border-t px-3 py-2 text-left first:border-t-0 disabled:opacity-50"
            >
              <Plus className="text-theme-text-muted h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="text-theme-text-primary block truncate text-sm">
                  Create “{typed}” in Medical Supplies
                </span>
                <span className="text-theme-text-muted block text-xs">
                  Choose a medical category, then it&rsquo;s added and linked
                </span>
              </span>
            </button>
          )}

          {showCreate && (
            <button
              type="button"
              onClick={() => void createAndLink()}
              disabled={creating}
              className="hover:bg-theme-surface-secondary border-theme-surface-border flex w-full items-center gap-2 border-t px-3 py-2 text-left first:border-t-0 disabled:opacity-50"
            >
              {creating ? (
                <Loader2 className="text-theme-text-muted h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Plus className="text-theme-text-muted h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                <span className="text-theme-text-primary block truncate text-sm">{gearCreateLabel}</span>
                <span className="text-theme-text-muted block text-xs">Adds it to the catalog and links this item</span>
              </span>
            </button>
          )}

          {searchFailed ? (
            <p role="status" className="text-theme-text-muted px-3 py-2 text-xs">
              {results.length > 0
                ? 'Part of the catalog couldn’t be searched, so creating a new item is off for now.'
                : 'Couldn’t search the catalog. Check your connection and try again.'}
            </p>
          ) : (
            results.length === 0 &&
            !loading &&
            !showCreate &&
            !showCreateMedical && <p className="text-theme-text-muted px-3 py-2 text-xs">No matching items.</p>
          )}
        </div>
      )}

      {medicalDraft !== null && (
        <MedicalCreatePanel
          name={medicalDraft}
          trackingType={createTrackingType}
          onCreated={finishMedicalCreate}
          onCancel={() => setMedicalDraft(null)}
        />
      )}
    </div>
  );
};

export default InventoryItemPicker;
