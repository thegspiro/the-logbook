import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import { getErrorMessage } from '../../../utils/errorHandling';

interface MedicalSupplyItemPickerProps {
  id: string;
  value: string;
  selectedName?: string | undefined;
  onChange: (id: string, name?: string) => void;
}

/** Server-backed medical catalog picker; table pagination never limits its results. */
export const MedicalSupplyItemPicker: React.FC<MedicalSupplyItemPickerProps> = ({
  id,
  value,
  selectedName,
  onChange,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      requestRef.current += 1;
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const search = useCallback((text: string, request: number) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    void medicalSuppliesService
      .getItems({ search: trimmed, active_only: true, limit: 20 })
      .then((response) => {
        if (request === requestRef.current) setResults(response.items.map(({ id, name }) => ({ id, name })));
      })
      .catch((error: unknown) => {
        if (request === requestRef.current) {
          setResults([]);
          toast.error(getErrorMessage(error, 'Failed to search medical supplies'));
        }
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  }, []);

  const changeQuery = (text: string) => {
    setQuery(text);
    setOpen(true);
    setResults([]);
    setLoading(Boolean(text.trim()));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const request = ++requestRef.current;
    debounceRef.current = setTimeout(() => search(text, request), 300);
  };

  if (value) {
    return (
      <div className="card-secondary flex items-center gap-2 px-3 py-2">
        <span className="text-theme-text-primary min-w-0 flex-1 truncate text-sm">
          {selectedName ?? 'Selected item'}
        </span>
        <button
          type="button"
          onClick={() => onChange('')}
          className="btn-icon"
          aria-label={`Clear ${selectedName ?? 'item'}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const listboxId = `${id}-results`;
  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <input
          id={id}
          type="search"
          role="combobox"
          aria-expanded={open && Boolean(query.trim())}
          aria-controls={listboxId}
          aria-autocomplete="list"
          className="form-input w-full pl-9"
          placeholder="Search medical supplies"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          onFocus={() => setOpen(true)}
        />
        {loading && (
          <Loader2 className="text-theme-text-muted absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
        )}
      </div>
      {open && query.trim() && (
        <div id={listboxId} role="listbox" className="card absolute z-20 mt-1 max-h-56 w-full overflow-auto shadow-lg">
          {!loading && results.length === 0 && (
            <p className="text-theme-text-muted px-3 py-2 text-sm">No matching items.</p>
          )}
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected="false"
              className="hover:bg-theme-surface-secondary text-theme-text-primary block w-full px-3 py-2 text-left text-sm"
              onClick={() => {
                onChange(item.id, item.name);
                setOpen(false);
                setQuery('');
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
