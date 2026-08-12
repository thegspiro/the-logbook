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
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Package, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '@/services/inventoryService';
import { getErrorMessage } from '@/utils/errorHandling';

export interface CatalogAddPayload {
  name: string;
  inventoryItemId?: string | undefined;
  /** Pool-tracked catalog items are counted, so the position should be too. */
  checkType?: 'quantity' | undefined;
  /** True when the catalog item carries dated stock. */
  hasExpiration?: boolean | undefined;
}

interface CatalogResult {
  id: string;
  name: string;
  sub?: string;
  trackingType: string;
}

interface CatalogQuickAddProps {
  value: string;
  onChange: (value: string) => void;
  onAdd: (payload: CatalogAddPayload) => void | Promise<void>;
  /** Whether the viewer may write to the catalog (inventory.manage). */
  canCreateInventory: boolean;
  disabled?: boolean;
}

const CatalogQuickAdd: React.FC<CatalogQuickAddProps> = ({
  value,
  onChange,
  onAdd,
  canCreateInventory,
  disabled = false,
}) => {
  const [results, setResults] = useState<CatalogResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
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

  const runSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    void inventoryService
      .getItems({ search: q.trim(), limit: 6, active_only: true })
      .then((res) => {
        setResults(
          res.items.map((i) => {
            const sub = [i.category_name, i.unit_of_measure].filter(Boolean).join(' · ');
            return { id: i.id, name: i.name, trackingType: i.tracking_type, ...(sub ? { sub } : {}) };
          })
        );
      })
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, []);

  const handleChange = (q: string) => {
    onChange(q);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(q), 300);
  };

  const reset = () => {
    onChange('');
    setResults([]);
    setOpen(false);
  };

  /** Add exactly what was typed, with no catalog link. */
  const addAsFreeText = async () => {
    const name = value.trim();
    if (!name) return;
    await onAdd({ name });
    reset();
  };

  /**
   * Whether the catalog item carries dated stock.
   *
   * Asked only once the crew has actually chosen an item, so the round trip
   * lands on a deliberate act rather than on every keystroke. A failed lookup
   * answers "no" rather than propagating: expiration can be switched on by
   * hand afterwards, but an item that never got added cannot.
   */
  const hasDatedStock = async (itemId: string): Promise<boolean> => {
    try {
      const lots = await inventoryService.getItemLots(itemId);
      return lots.some((lot) => Boolean(lot.expiration_date));
    } catch {
      return false;
    }
  };

  const addLinked = async (result: CatalogResult) => {
    const hasExpiration = await hasDatedStock(result.id);

    await onAdd({
      // The catalog's name, not the typed one: two records that read
      // differently are what made the link invisible in the first place.
      name: result.name,
      inventoryItemId: result.id,
      ...(result.trackingType === 'pool' ? { checkType: 'quantity' as const } : {}),
      ...(hasExpiration ? { hasExpiration: true } : {}),
    });
    reset();
  };

  const createAndAdd = async () => {
    const name = value.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created = await inventoryService.createItem({
        name,
        // Checklist stock is counted, not serialized — a bracket holds four
        // gauze, not gauze #7.
        tracking_type: 'pool',
        quantity: 0,
      });
      await onAdd({ name: created.name, inventoryItemId: created.id, checkType: 'quantity' });
      toast.success(`Added “${created.name}” to inventory`);
      reset();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create the inventory item'));
    } finally {
      setCreating(false);
    }
  };

  const typed = value.trim();
  const hasExactMatch = results.some((r) => r.name.trim().toLowerCase() === typed.toLowerCase());
  const showCreate = canCreateInventory && typed.length > 0 && !searching && !hasExactMatch;

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
      setAnchor({ top: rect.bottom + 4, left: rect.left, width: rect.width });
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
  }, [open, results.length, showCreate]);

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex items-center gap-2">
        <div className="border-theme-surface-border bg-theme-surface focus-within:ring-theme-focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2 focus-within:ring-2">
          <Search className="text-theme-text-muted h-4 w-4 shrink-0" />
          <input
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="text-theme-text-primary placeholder:text-theme-text-muted min-w-0 flex-1 bg-transparent text-sm outline-none"
            placeholder="Search inventory or type a new item name…"
            value={value}
            disabled={disabled}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addAsFreeText();
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          {searching && <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" />}
        </div>
        <button
          type="button"
          onClick={() => void addAsFreeText()}
          disabled={disabled || !typed}
          className="flex flex-shrink-0 items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </div>

      {open && typed.length > 0 && anchor && (
        <div
          style={{ top: anchor.top, left: anchor.left, width: anchor.width }}
          className="border-theme-surface-border bg-theme-surface fixed z-50 max-h-64 overflow-auto rounded-md border shadow-lg"
        >
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => void addLinked(r)}
              className="hover:bg-theme-surface-secondary flex w-full items-center gap-2 px-3 py-2 text-left"
            >
              <Package className="text-theme-text-muted h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="text-theme-text-primary block truncate text-sm">{r.name}</span>
                {r.sub && <span className="text-theme-text-muted block truncate text-xs">{r.sub}</span>}
              </span>
              <span className="shrink-0 rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
                Link
              </span>
            </button>
          ))}

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
                <span className="text-theme-text-primary block truncate text-sm">Create “{typed}” in inventory</span>
                <span className="text-theme-text-muted block text-xs">Adds it to the catalog and links this item</span>
              </span>
            </button>
          )}

          {results.length === 0 && !searching && !showCreate && (
            <p className="text-theme-text-muted px-3 py-2 text-xs">
              No catalog match. Press Enter to add “{typed}” as a plain checklist item.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default CatalogQuickAdd;
