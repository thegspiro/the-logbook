/**
 * InventoryItemPicker
 *
 * Compact search-and-select for linking a checklist item to an inventory
 * catalog item. Linking enables ready-stock tracking and lot swaps: once
 * linked, the supply-officer view shows replacement stock and the check form
 * exposes a "swap in newer" action.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2, Package } from 'lucide-react';
import { inventoryService } from '@/services/inventoryService';

interface InventoryItemPickerProps {
  value?: string | undefined;
  onChange: (id: string | undefined, name?: string) => void;
  /** Overrides the link-specific wording for other uses (e.g. receiving stock). */
  placeholder?: string;
}

const InventoryItemPicker: React.FC<InventoryItemPickerProps> = ({
  value,
  onChange,
  placeholder = 'Search inventory to link…',
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; sub?: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cancel any pending debounced search when unmounting.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
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

  const runSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    void inventoryService
      .getItems({ search: q.trim(), limit: 10, active_only: true })
      .then((res) => {
        setResults(
          res.items.map((i) => {
            const sub = [i.manufacturer, i.model_number || i.serial_number].filter(Boolean).join(' · ');
            return { id: i.id, name: i.name, ...(sub ? { sub } : {}) };
          })
        );
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  const handleQueryChange = (q: string) => {
    setQuery(q);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(q), 300);
  };

  if (value) {
    return (
      <div className="border-theme-surface-border bg-theme-surface-secondary flex items-center gap-2 rounded-md border px-3 py-2">
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
      <div className="border-theme-surface-border bg-theme-surface flex items-center gap-2 rounded-md border px-3 py-2">
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
      {open && query.trim() && (
        <div className="border-theme-surface-border bg-theme-surface absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border shadow-lg">
          {results.length === 0 && !loading ? (
            <p className="text-theme-text-muted px-3 py-2 text-xs">No matching items.</p>
          ) : (
            results.map((r) => (
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
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default InventoryItemPicker;
