import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import { getErrorMessage } from '../../../utils/errorHandling';

const PAGE = 20;

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
  // A rejected search is not an empty catalogue. Reporting "No matching items."
  // for a network or auth failure tells an officer the supply does not exist,
  // and the toast that said otherwise is gone seconds later.
  const [failed, setFailed] = useState(false);
  // Item names are not unique -- location- or category-specific records share
  // them -- so a department can legitimately have more matches than one page,
  // and every one of them has to be selectable.
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  // Keyboard position in the list. The native <select> this replaced supported
  // arrow keys and Enter; a combobox that announces itself as one and then
  // ignores them strands keyboard-only users, whose Enter submits the delivery
  // form instead and trips its missing-item validation.
  const [activeIndex, setActiveIndex] = useState(-1);
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

  const search = useCallback((text: string, request: number, take: number) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setResults([]);
      setTotal(0);
      setFailed(false);
      setLoading(false);
      return;
    }
    void medicalSuppliesService
      .getItems({ search: trimmed, active_only: true, limit: take })
      .then((response) => {
        if (request !== requestRef.current) return;
        setResults(response.items.map(({ id, name }) => ({ id, name })));
        setTotal(response.total);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (request !== requestRef.current) return;
        setResults([]);
        setFailed(true);
        toast.error(getErrorMessage(error, 'Failed to search medical supplies'));
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  }, []);

  const runSearch = (text: string, take: number, delay: number) => {
    setLoading(Boolean(text.trim()));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const request = ++requestRef.current;
    debounceRef.current = setTimeout(() => search(text, request, take), delay);
  };

  const changeQuery = (text: string) => {
    setQuery(text);
    setOpen(true);
    setResults([]);
    setFailed(false);
    setActiveIndex(-1);
    setLimit(PAGE);
    runSearch(text, PAGE, 300);
  };

  const showMore = () => {
    const next = limit + PAGE;
    setLimit(next);
    // No debounce: this one is a deliberate activation, not typing.
    runSearch(query, next, 0);
  };

  const choose = (item: { id: string; name: string }) => {
    onChange(item.id, item.name);
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (results.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = current + step;
        if (next < 0) return results.length - 1;
        if (next >= results.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === 'Enter') {
      // Only when a result is highlighted -- otherwise Enter belongs to the
      // surrounding delivery form, and swallowing it would be its own bug.
      const item = activeIndex >= 0 ? results[activeIndex] : undefined;
      if (item) {
        event.preventDefault();
        choose(item);
      }
    }
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
          onKeyDown={onKeyDown}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        />
        {loading && (
          <Loader2 className="text-theme-text-muted absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
        )}
      </div>
      {open && query.trim() && (
        <div id={listboxId} role="listbox" className="card absolute z-20 mt-1 max-h-56 w-full overflow-auto shadow-lg">
          {!loading && failed && (
            <div className="px-3 py-2 text-sm">
              <p className="text-theme-text-primary">Could not search the catalog.</p>
              <button
                type="button"
                onClick={() => runSearch(query, limit, 0)}
                className="text-theme-text-muted underline"
              >
                Try again
              </button>
            </div>
          )}
          {!loading && !failed && results.length === 0 && (
            <p className="text-theme-text-muted px-3 py-2 text-sm">No matching items.</p>
          )}
          {results.map((item, index) => (
            <button
              key={item.id}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`text-theme-text-primary block w-full px-3 py-2 text-left text-sm ${
                index === activeIndex ? 'bg-theme-surface-secondary' : 'hover:bg-theme-surface-secondary'
              }`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(item)}
            >
              {item.name}
            </button>
          ))}
          {!loading && !failed && total > results.length && (
            <button
              type="button"
              onClick={showMore}
              className="text-theme-text-muted block w-full px-3 py-2 text-left text-sm underline"
            >
              Show more ({results.length} of {total})
            </button>
          )}
        </div>
      )}
    </div>
  );
};
