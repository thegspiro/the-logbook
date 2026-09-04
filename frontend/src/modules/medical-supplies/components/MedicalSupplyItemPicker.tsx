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
  // How far into the server's result set we have already read. Tracked apart
  // from `results.length` because deduplication makes the two diverge: if the
  // catalogue gains a row before the page boundary, a page can repeat an item
  // we already hold, and paging on the deduplicated length would ask for an
  // offset we have already consumed -- re-reading the same row while
  // `total > results.length` kept Show more alive on a match it never reached.
  const [consumed, setConsumed] = useState(0);
  // The server answered with a short page, so there is nothing after this
  // offset. Derived from the response rather than from `consumed < total`,
  // because `total` moves under us and arithmetic on a moving total is what
  // lets the end of the list be mis-declared in either direction.
  const [reachedEnd, setReachedEnd] = useState(false);
  // Keyboard position in the list. The native <select> this replaced supported
  // arrow keys and Enter; a combobox that announces itself as one and then
  // ignores them strands keyboard-only users, whose Enter submits the delivery
  // form instead and trips its missing-item validation.
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  // `total` from the previous settled page, to notice the set shrinking.
  const lastTotal = useRef<number | null>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  // Set only by a selection, so focus moves on the officer's own action and
  // not when the row mounts with an item already on it.
  const justChose = useRef(false);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      requestRef.current += 1;
    },
    []
  );

  // Selecting an item unmounts the combobox for the selected-item view. Focus
  // would otherwise fall to the document body, so the next Tab restarts at the
  // dialog's first control instead of continuing to Qty.
  useEffect(() => {
    if (!value || !justChose.current) return;
    justChose.current = false;
    clearRef.current?.focus();
  }, [value]);

  // ArrowDown past the first few rows moved the highlight outside the
  // scrollport -- the list caps at max-h-56 while a page holds 20 options --
  // so a sighted keyboard user could not tell what Enter would select.
  useEffect(() => {
    if (activeIndex < 0) return;
    const option = listboxRef.current?.querySelectorAll('[role="option"]')[activeIndex];
    // jsdom does not implement scrollIntoView, and this is a presentation
    // detail rather than behaviour worth failing a test over.
    if (option instanceof HTMLElement && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const search = useCallback((text: string, request: number, skip: number, reconciled = false) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setResults([]);
      setTotal(0);
      setFailed(false);
      setLoading(false);
      return;
    }
    void medicalSuppliesService
      .getItems({ search: trimmed, active_only: true, skip, limit: PAGE })
      .then((response) => {
        if (request !== requestRef.current) return;

        // A row removed between pages shifts every later row back into a range
        // we have already read, so this page begins past rows we never saw.
        // Offset paging cannot prevent that -- only notice it and go back for
        // what it missed. `reconciled` bounds it to one extra request, so a
        // catalogue being edited continuously cannot spin here.
        const previousTotal = lastTotal.current;
        lastTotal.current = response.total;
        if (!reconciled && skip > 0 && previousTotal !== null && response.total < previousTotal) {
          const corrected = Math.max(0, skip - (previousTotal - response.total));
          if (corrected < skip) {
            search(text, request, corrected, true);
            return;
          }
        }

        const page = response.items.map(({ id, name }) => ({ id, name }));
        setReachedEnd(response.items.length < PAGE);
        // The server's own offset plus what it actually returned, not what
        // survived deduplication.
        setConsumed(response.skip + response.items.length);
        setResults((current) => {
          if (skip === 0) return page;
          // Appended, not replaced: Show more asks for the next page rather
          // than re-requesting the whole set with a bigger limit. Growing the
          // limit walked into the endpoint's own cap (le=500), so the 25th
          // activation returned 422, cleared every result, and left Try again
          // repeating the request that could not succeed.
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...page.filter((item) => !seen.has(item.id))];
        });
        setTotal(response.total);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (request !== requestRef.current) return;
        // A failed *next* page does not invalidate the pages already on
        // screen; only a fresh search starts from nothing. Clearing either way
        // threw away matches the officer could still have picked.
        if (skip === 0) setResults([]);
        setFailed(true);
        toast.error(getErrorMessage(error, 'Failed to search medical supplies'));
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  }, []);

  const runSearch = (text: string, skip: number, delay: number) => {
    setLoading(Boolean(text.trim()));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const request = ++requestRef.current;
    debounceRef.current = setTimeout(() => search(text, request, skip), delay);
  };

  const changeQuery = (text: string) => {
    setQuery(text);
    setOpen(true);
    setResults([]);
    setFailed(false);
    setActiveIndex(-1);
    setConsumed(0);
    setReachedEnd(false);
    lastTotal.current = null;
    runSearch(text, 0, 300);
  };

  const showMore = () => {
    // No debounce: this one is a deliberate activation, not typing.
    runSearch(query, consumed, 0);
  };

  const choose = (item: { id: string; name: string }) => {
    justChose.current = true;
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
          ref={clearRef}
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
        <div
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          className="card absolute z-20 mt-1 max-h-56 w-full overflow-auto shadow-lg"
        >
          {!loading && failed && (
            <div className="px-3 py-2 text-sm">
              <p className="text-theme-text-primary">Could not search the catalog.</p>
              <button
                type="button"
                onClick={() => runSearch(query, consumed, 0)}
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
          {!loading && !failed && !reachedEnd && (
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
