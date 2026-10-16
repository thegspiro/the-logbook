/**
 * CatalogQuickAdd
 *
 * The add-an-item bar in the template builder, taught to see the inventory
 * catalog.
 *
 * Adding an item and linking it to the catalog used to be two separate acts,
 * and the second one lived three clicks deep inside the item's advanced panel.
 * Nobody performs it two hundred times, so on a real rig checklist almost
 * nothing was linked — and expiration, lot and restock tracking all hang off
 * that link, so almost nothing was tracked. Searching the catalog from the
 * same box that names the item collapses the two into one.
 *
 * Free text is still a first-class outcome: plenty of checklist lines ("Check
 * tire pressure", "Cab clean") are not stock and never will be. Enter adds
 * what was typed, exactly as before.
 *
 * Medical stock is searched alongside gear when `searchScope.medical` is on,
 * and listed first. A new item can be created in Medical Supplies (with a
 * medical category, so it lands on the supply officer's page) or as gear.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Package, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '@/services/inventoryService';
import type { InventoryItem } from '@/services/eventServices';
import { getErrorMessage } from '@/utils/errorHandling';
import MedicalCreatePanel from './MedicalCreatePanel';
import {
  getCatalogItemLots,
  searchChecklistCatalog,
  type CatalogDomain,
  type CatalogSearchScope,
} from '../utils/checklistCatalogSearch';

export interface CatalogAddPayload {
  name: string;
  inventoryItemId?: string | undefined;
  /** Pool-tracked catalog items are counted, so the position should be too. */
  checkType?: 'count' | undefined;
  /** True when the catalog item carries dated stock. */
  hasExpiration?: boolean | undefined;
}

interface CatalogResult {
  id: string;
  name: string;
  sub?: string;
  trackingType: string;
  domain: CatalogDomain;
}

const GEAR_ONLY: CatalogSearchScope = { gear: true, medical: false };

interface CatalogQuickAddProps {
  value: string;
  onChange: (value: string) => void;
  onAdd: (payload: CatalogAddPayload) => void | Promise<void>;
  /** Whether the viewer may write to the gear catalog (inventory.manage). */
  canCreateInventory: boolean;
  /**
   * Whether the viewer may create medical supplies (inventory.manage_medical
   * or inventory.manage). Only meaningful with `searchScope.medical` on.
   */
  canCreateMedical?: boolean;
  /** Which halves of the catalog the viewer can read. Gear only by default. */
  searchScope?: CatalogSearchScope;
  disabled?: boolean;
  autoFocus?: boolean;
  /**
   * DOM id for the text input. `autoFocus` only fires on mount, so a caller
   * that re-opens an already-open composer needs something to focus.
   */
  inputId?: string;
  placeholder?: string;
}

const CatalogQuickAdd: React.FC<CatalogQuickAddProps> = ({
  value,
  onChange,
  onAdd,
  canCreateInventory,
  canCreateMedical = false,
  searchScope = GEAR_ONLY,
  disabled = false,
  autoFocus = false,
  inputId,
  placeholder = 'Search inventory or type a new item name…',
}) => {
  const [results, setResults] = useState<CatalogResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [medicalDraft, setMedicalDraft] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const submittingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const [anchor, setAnchor] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      requestRef.current += 1;
    };
  }, []);

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

  const { gear: searchGear, medical: searchMedical } = searchScope;
  const runSearch = useCallback(
    (query: string, request: number) => {
      void searchChecklistCatalog(query, { gear: searchGear, medical: searchMedical }, 6)
        .then(({ hits, incomplete }) => {
          if (request !== requestRef.current) return;
          // A half that failed is not the same as an empty catalog. Saying
          // "no catalog match" here invites the crew to add a plain checklist
          // line for an item that is on file and linkable, which is the link
          // this bar exists to make — so whatever did come back is shown, and
          // creating is withheld until a search covers everything.
          setSearchFailed(incomplete);
          setResults(
            hits.map(({ item: i, domain }) => {
              const sub = [i.category_name, i.unit_of_measure].filter(Boolean).join(' · ');
              return { id: i.id, name: i.name, trackingType: i.tracking_type, domain, ...(sub ? { sub } : {}) };
            })
          );
          setHighlightedIndex(-1);
        })
        .finally(() => {
          if (request === requestRef.current) setSearching(false);
        });
    },
    [searchGear, searchMedical]
  );

  const handleChange = (q: string) => {
    submittingRef.current = false;
    setMedicalDraft(null);
    onChange(q);
    setOpen(true);
    setResults([]);
    setSearchFailed(false);
    setHighlightedIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const request = ++requestRef.current;
    const query = q.trim();
    if (!query) {
      setSearching(false);
      return;
    }
    // Searching includes the debounce interval, while an empty settled result
    // means "no matches". This prevents the previous query's empty state from
    // flashing while the next query is in flight.
    setSearching(true);
    debounceRef.current = setTimeout(() => runSearch(query, request), 300);
  };

  const reset = () => {
    onChange('');
    setResults([]);
    setOpen(false);
    setSearching(false);
    setHighlightedIndex(-1);
    requestRef.current += 1;
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };

  /** Add exactly what was typed, with no catalog link. */
  const addAsFreeText = async () => {
    const name = value.trim();
    if (!name || submittingRef.current) return;
    submittingRef.current = true;
    reset();
    await onAdd({ name });
    inputRef.current?.focus();
  };

  /**
   * Whether the catalog item carries dated stock.
   *
   * Asked only once the crew has actually chosen an item, so the round trip
   * lands on a deliberate act rather than on every keystroke. A failed lookup
   * answers "no" rather than propagating: expiration can be switched on by
   * hand afterwards, but an item that never got added cannot.
   */
  const hasDatedStock = async (itemId: string, domain: CatalogDomain): Promise<boolean> => {
    try {
      const lots = await getCatalogItemLots(itemId, domain);
      return lots.some((lot) => Boolean(lot.expiration_date));
    } catch {
      return false;
    }
  };

  const addLinked = async (result: CatalogResult) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    reset();
    const hasExpiration = await hasDatedStock(result.id, result.domain);

    await onAdd({
      // The catalog's name, not the typed one: two records that read
      // differently are what made the link invisible in the first place.
      name: result.name,
      inventoryItemId: result.id,
      ...(result.trackingType === 'pool' ? { checkType: 'count' as const } : {}),
      ...(hasExpiration ? { hasExpiration: true } : {}),
    });
    inputRef.current?.focus();
  };

  const createAndAdd = async () => {
    const name = value.trim();
    if (!name || submittingRef.current) return;
    submittingRef.current = true;
    reset();
    setCreating(true);
    try {
      // create-if-absent, not create: this bar searches six gear results and
      // cannot see medical stock at all, so "no match" here is not proof the
      // name is free. The server decides, and hands back the existing row when
      // there is one rather than filing a second beside it.
      const { item, created } = await inventoryService.createItemIfAbsent({
        name,
        // Checklist stock is counted, not serialized — a bracket holds four
        // gauze, not gauze #7.
        tracking_type: 'pool',
        quantity: 0,
      });
      // A row handed back rather than created gets exactly what picking it out
      // of the results would have given it. It may be an individual asset, and
      // it may carry dated lots — an existing medication added as a bare count
      // would have its expiry neither shown nor checked. A row created just now
      // has no lots, so that lookup is skipped rather than asked and ignored.
      const hasExpiration = created ? false : await hasDatedStock(item.id, 'gear');
      await onAdd({
        name: item.name,
        inventoryItemId: item.id,
        ...(item.tracking_type === 'pool' ? { checkType: 'count' as const } : {}),
        ...(hasExpiration ? { hasExpiration: true } : {}),
      });
      inputRef.current?.focus();
      toast.success(
        created ? `Added “${item.name}” to inventory` : `“${item.name}” was already in the catalog — linked it`
      );
    } catch (err: unknown) {
      submittingRef.current = false;
      toast.error(getErrorMessage(err, 'Failed to create the inventory item'));
    } finally {
      setCreating(false);
    }
  };

  /** Step one of a medical create: the panel below asks for the category. */
  const startMedicalCreate = () => {
    const name = value.trim();
    if (!name) return;
    reset();
    setMedicalDraft(name);
  };

  const cancelMedicalCreate = () => {
    const name = medicalDraft ?? '';
    setMedicalDraft(null);
    // Hand the name back so it is not retyped to add it another way.
    onChange(name);
    inputRef.current?.focus();
  };

  const finishMedicalCreate = async (item: InventoryItem, created: boolean) => {
    setMedicalDraft(null);
    const hasExpiration = created ? false : await hasDatedStock(item.id, 'medical');
    await onAdd({
      name: item.name,
      inventoryItemId: item.id,
      ...(item.tracking_type === 'pool' ? { checkType: 'count' as const } : {}),
      ...(hasExpiration ? { hasExpiration: true } : {}),
    });
    inputRef.current?.focus();
  };

  const typed = value.trim();
  const hasExactMatch = results.some((r) => r.name.trim().toLowerCase() === typed.toLowerCase());
  // Suppressed on a failed search for the same reason as the picker: the
  // create-if-absent behind it would not duplicate, but offering to add to a
  // catalog we could not reach reads as a promise the next click may not keep.
  const canOfferCreate = typed.length > 0 && !searching && !searchFailed && !hasExactMatch;
  const showCreate = canCreateInventory && canOfferCreate;
  const showCreateMedical = canCreateMedical && searchMedical && canOfferCreate;
  const gearCreateLabel = showCreateMedical
    ? `Create “${typed}” as equipment or gear`
    : `Create “${typed}” in inventory`;

  /**
   * Position the results list against the viewport rather than the input.
   *
   * The list used to be `absolute` inside this component's `relative` wrapper,
   * which sits inside the compartment card — and that card is `overflow-hidden`
   * so it can clip its own rounded corners. An absolutely-positioned descendant
   * is clipped along with everything else, and because the quick-add bar is the
   * **last** element in the card, the list always extended past the bottom edge.
   * A user typing three letters saw a sliver of the first result and could not
   * read the rest, let alone pick one — on the control whose whole purpose is
   * picking a catalog item.
   *
   * `fixed` escapes the clip. The element stays a DOM child of the wrapper, so
   * the click-outside handler above still recognises it.
   */
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const gap = 4;
      const desiredHeight = 256;
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap);
      const spaceAbove = Math.max(0, rect.top - gap);
      const openBelow = spaceBelow >= 128 || spaceBelow >= spaceAbove;
      const maxHeight = Math.min(desiredHeight, openBelow ? spaceBelow : spaceAbove);
      setAnchor({
        top: openBelow ? rect.bottom + gap : Math.max(gap, rect.top - gap - maxHeight),
        left: rect.left,
        width: rect.width,
        maxHeight,
      });
    };
    measure();
    // Capture phase: the builder scrolls the page *and* individual panels, and
    // a bubbling listener on window never hears an inner element's scroll — the
    // list would sit where the input used to be.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, results.length, showCreate, showCreateMedical]);

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex items-center gap-2">
        <div className="card focus-within:ring-theme-focus-ring flex min-w-0 flex-1 items-center gap-2 px-3 py-2 focus-within:ring-2">
          <Search className="text-theme-text-muted h-4 w-4 shrink-0" />
          <input
            ref={inputRef}
            {...(inputId ? { id: inputId } : {})}
            type="text"
            autoFocus={autoFocus}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="text-theme-text-primary placeholder:text-theme-text-muted min-w-0 flex-1 bg-transparent text-sm outline-none"
            placeholder={placeholder}
            value={value}
            disabled={disabled}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && typed.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const highlighted = results[highlightedIndex];
                if (open && highlighted) void addLinked(highlighted);
                else void addAsFreeText();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                if (results.length > 0) setHighlightedIndex((current) => (current + 1) % results.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setOpen(true);
                if (results.length > 0) {
                  setHighlightedIndex((current) => (current <= 0 ? results.length - 1 : current - 1));
                }
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
                setHighlightedIndex(-1);
              }
            }}
          />
          {searching && (
            <Loader2 aria-label="Searching catalog" className="text-theme-text-muted h-4 w-4 animate-spin" />
          )}
        </div>
        <button
          type="button"
          onClick={() => void addAsFreeText()}
          disabled={disabled || !typed}
          className="touch:min-h-[44px] touch:min-w-[44px] flex flex-shrink-0 items-center gap-1 rounded-md bg-red-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-900 disabled:opacity-40"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </div>

      {open && typed.length > 0 && anchor && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Catalog results"
          style={{
            top: anchor.top,
            left: anchor.left,
            width: anchor.width,
            maxHeight: anchor.maxHeight,
          }}
          className="popover-panel fixed z-50 overflow-auto"
        >
          {results.map((r, index) => (
            <button
              key={r.id}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={highlightedIndex === index}
              type="button"
              onClick={() => void addLinked(r)}
              onMouseMove={() => setHighlightedIndex(index)}
              className={`hover:bg-theme-surface-secondary flex w-full items-center gap-2 px-3 py-2 text-left ${
                highlightedIndex === index ? 'bg-theme-surface-secondary' : ''
              }`}
            >
              <Package className="text-theme-text-muted h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="text-theme-text-primary block truncate text-sm">{r.name}</span>
                {r.sub && <span className="text-theme-text-muted block truncate text-xs">{r.sub}</span>}
              </span>
              {r.domain === 'medical' && (
                <span className="badge shrink-0 bg-blue-500/10 text-[10px] text-blue-800 dark:text-blue-300">
                  Medical
                </span>
              )}
              <span className="shrink-0 rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
                Link
              </span>
            </button>
          ))}

          {searching && (
            <p role="status" className="text-theme-text-muted px-3 py-2 text-xs">
              Searching catalog…
            </p>
          )}

          {showCreateMedical && (
            <button
              type="button"
              onClick={startMedicalCreate}
              disabled={creating}
              className="hover:bg-theme-surface-secondary border-theme-surface-border flex w-full items-center gap-2 border-t px-3 py-2 text-left disabled:opacity-50"
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
              onClick={() => void createAndAdd()}
              disabled={creating}
              className="hover:bg-theme-surface-secondary border-theme-surface-border flex w-full items-center gap-2 border-t px-3 py-2 text-left disabled:opacity-50"
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

          {searchFailed && !searching && (
            <p role="status" className="text-theme-text-muted px-3 py-2 text-xs">
              {results.length > 0
                ? 'Part of the catalog couldn’t be searched, so creating a new item is off for now.'
                : `Couldn’t search the catalog. Press Enter to add “${typed}” as a plain checklist item, or try again to link it.`}
            </p>
          )}

          {results.length === 0 && !searching && !searchFailed && !showCreate && !showCreateMedical && (
            <p className="text-theme-text-muted px-3 py-2 text-xs">
              No catalog match. Press Enter to add “{typed}” as a plain checklist item.
            </p>
          )}
        </div>
      )}

      {medicalDraft !== null && (
        <MedicalCreatePanel name={medicalDraft} onCreated={finishMedicalCreate} onCancel={cancelMedicalCreate} />
      )}
    </div>
  );
};

export default CatalogQuickAdd;
