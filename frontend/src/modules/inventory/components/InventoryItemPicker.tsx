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
 * What gets created is a bare name. The position's own numbers — required
 * quantity, critical minimum, min level — are deliberately not copied onto it:
 * one catalog item is stocked in many places (gauze in a jump bag, a cabinet
 * and two rigs), each counted on its own, so a count taken at one spot must
 * never become a department-wide floor. Those numbers live on
 * `check_template_items`; `reorder_point` on the catalog row is the
 * quartermaster's call and stays unset here.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2, Package, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '@/services/inventoryService';
import { getErrorMessage } from '@/utils/errorHandling';

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
}

const InventoryItemPicker: React.FC<InventoryItemPickerProps> = ({
  value,
  onChange,
  placeholder = 'Search inventory to link…',
  canCreateInventory = false,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; sub?: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
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
    void inventoryService
      .getItem(value)
      .then((item) => {
        if (!cancelled) setSelectedName(item.name);
      })
      .catch(() => {
        if (!cancelled) setSelectedName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const runSearch = useCallback((q: string, request: number) => {
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    void inventoryService
      .getItems({ search: q.trim(), limit: 10, active_only: true })
      .then((res) => {
        if (request !== requestRef.current) return;
        setResults(
          res.items.map((i) => {
            const sub = [i.manufacturer, i.model_number || i.serial_number].filter(Boolean).join(' · ');
            return { id: i.id, name: i.name, ...(sub ? { sub } : {}) };
          })
        );
      })
      .catch(() => {
        if (request === requestRef.current) setResults([]);
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  }, []);

  const handleQueryChange = (q: string) => {
    setQuery(q);
    setOpen(true);
    setResults([]);
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
  const showCreate = canCreateInventory && typed.length > 0 && !loading && !hasExactMatch;

  /**
   * Add the typed name to the catalog and link it in one step.
   *
   * Pool-tracked because checklist stock is counted, not serialized, and with
   * nothing on hand: a catalog row born from a checklist knows the item exists,
   * not how many are in the stock room.
   */
  const createAndLink = async () => {
    if (!typed || creating) return;
    setCreating(true);
    try {
      const created = await inventoryService.createItem({
        name: typed,
        tracking_type: 'pool',
        quantity: 0,
      });
      onChange(created.id, created.name);
      setSelectedName(created.name);
      setOpen(false);
      setQuery('');
      setResults([]);
      toast.success(`Added “${created.name}” to inventory`);
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
        <div className="card absolute z-20 mt-1 max-h-56 w-full overflow-auto shadow-lg">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                onChange(r.id, r.name);
                setSelectedName(r.name);
                setOpen(false);
                setQuery('');
                setResults([]);
              }}
              className="hover:bg-theme-surface-secondary block w-full px-3 py-2 text-left"
            >
              <span className="text-theme-text-primary block text-sm">{r.name}</span>
              {r.sub && <span className="text-theme-text-muted block text-xs">{r.sub}</span>}
            </button>
          ))}

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
                <span className="text-theme-text-primary block truncate text-sm">Create “{typed}” in inventory</span>
                <span className="text-theme-text-muted block text-xs">Adds it to the catalog and links this item</span>
              </span>
            </button>
          )}

          {results.length === 0 && !loading && !showCreate && (
            <p className="text-theme-text-muted px-3 py-2 text-xs">No matching items.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default InventoryItemPicker;
