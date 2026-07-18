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
}

const InventoryItemPicker: React.FC<InventoryItemPickerProps> = ({ value, onChange }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<
    { id: string; name: string; sub?: string }[]
  >([]);
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
            const sub = [i.manufacturer, i.model_number || i.serial_number]
              .filter(Boolean)
              .join(' · ');
            return { id: i.id, name: i.name, ...(sub ? { sub } : {}) };
          }),
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
      <div className="flex items-center gap-2 rounded-md border border-theme-surface-border bg-theme-surface-secondary px-3 py-2">
        <Package className="h-4 w-4 text-theme-text-muted shrink-0" />
        <span className="flex-1 min-w-0 truncate text-sm text-theme-text-primary">
          {selectedName ?? 'Linked item'}
        </span>
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
      <div className="flex items-center gap-2 rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2">
        <Search className="h-4 w-4 text-theme-text-muted shrink-0" />
        <input
          type="text"
          className="flex-1 min-w-0 bg-transparent text-sm text-theme-text-primary outline-none placeholder:text-theme-text-muted"
          placeholder="Search inventory to link…"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => setOpen(true)}
        />
        {loading && <Loader2 className="h-4 w-4 animate-spin text-theme-text-muted" />}
      </div>
      {open && query.trim() && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border border-theme-surface-border bg-theme-surface shadow-lg">
          {results.length === 0 && !loading ? (
            <p className="px-3 py-2 text-xs text-theme-text-muted">No matching items.</p>
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
                className="block w-full px-3 py-2 text-left hover:bg-theme-surface-secondary"
              >
                <span className="block text-sm text-theme-text-primary">{r.name}</span>
                {r.sub && (
                  <span className="block text-xs text-theme-text-muted">{r.sub}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default InventoryItemPicker;
