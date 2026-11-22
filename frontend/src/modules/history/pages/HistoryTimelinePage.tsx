/**
 * The department timeline: events, plus milestones read from the records they
 * come from — apparatus entering and leaving service, line-of-duty deaths and
 * the titles the Historian chose to show. The server decides what each caller
 * receives (CLAUDE.md pitfall #29); this page only asks for it.
 *
 * A decade loads when it is opened, so a long history does not load at once.
 * The viewer's filter choices are remembered in their browser.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { getErrorMessage } from '../../../utils/errorHandling';
import { TimelineList } from '../components/TimelineList';
import { historyListService, historyTimelineService } from '../services/api';
import {
  MILESTONE_KINDS,
  TIMELINE_KIND_LABELS,
  type HistoryListEntry,
  type TimelineDecade,
  type TimelineEntry,
  type TimelineKind,
} from '../types';

const STORAGE_KEY = 'history.timeline.filters';

interface Filters {
  milestones: boolean;
  kinds: TimelineKind[];
  eventTypeId: string;
}

const DEFAULT_FILTERS: Filters = { milestones: true, kinds: MILESTONE_KINDS, eventTypeId: '' };

// A viewer's own convenience only: private windows and blocked storage throw,
// and the page works the same without it.
const readFilters = (): Filters => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<Filters>;
    return {
      milestones: typeof parsed.milestones === 'boolean' ? parsed.milestones : true,
      kinds: Array.isArray(parsed.kinds)
        ? MILESTONE_KINDS.filter((kind) => parsed.kinds?.includes(kind))
        : MILESTONE_KINDS,
      eventTypeId: typeof parsed.eventTypeId === 'string' ? parsed.eventTypeId : '',
    };
  } catch {
    return DEFAULT_FILTERS;
  }
};

const writeFilters = (filters: Filters) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Not remembered; nothing else depends on it.
  }
};

export const HistoryTimelinePage: React.FC = () => {
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [eventTypes, setEventTypes] = useState<HistoryListEntry[]>([]);
  const [decades, setDecades] = useState<TimelineDecade[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [entries, setEntries] = useState<Record<number, TimelineEntry[]>>({});
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () => ({
      kinds: ['event', ...(filters.milestones ? filters.kinds : [])] satisfies TimelineKind[],
      event_type_id: filters.eventTypeId || undefined,
    }),
    [filters]
  );

  useEffect(() => {
    void historyListService
      .list('event-types')
      .then(setEventTypes)
      .catch(() => setEventTypes([]));
  }, []);

  useEffect(() => {
    writeFilters(filters);
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    setDecades(null);
    setEntries({});
    historyTimelineService
      .decades(query)
      .then((list) => {
        if (cancelled) return;
        setDecades(list);
        setError(null);
        // The latest decade opens first; the rest load when opened.
        setOpen(list.length > 0 ? (list[list.length - 1]?.decade ?? null) : null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Unable to load the timeline.'));
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const loadDecade = useCallback(
    (decade: number) => {
      historyTimelineService
        .decade(decade, query)
        .then((list) => setEntries((current) => ({ ...current, [decade]: list })))
        .catch((err: unknown) => setError(getErrorMessage(err, 'Unable to load this decade.')));
    },
    [query]
  );

  useEffect(() => {
    if (open !== null && entries[open] === undefined) loadDecade(open);
  }, [open, entries, loadDecade]);

  const toggleKind = (kind: TimelineKind) =>
    setFilters((current) => ({
      ...current,
      kinds: current.kinds.includes(kind) ? current.kinds.filter((k) => k !== kind) : [...current.kinds, kind],
    }));

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'History', path: '/history' }, { label: 'Timeline' }]} />
      <div className="page-header mb-4 gap-3 sm:items-center">
        <h1 className="page-header-title text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <History className="h-6 w-6 shrink-0" aria-hidden="true" />
          Timeline
        </h1>
      </div>

      <section aria-label="Timeline filters" className="card mb-4 space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="form-label">Event type</span>
            <select
              value={filters.eventTypeId}
              onChange={(e) => setFilters((current) => ({ ...current, eventTypeId: e.target.value }))}
              className="form-input"
            >
              <option value="">Every type</option>
              {eventTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={filters.milestones}
              onChange={(e) => setFilters((current) => ({ ...current, milestones: e.target.checked }))}
            />
            <span className="text-theme-text-primary">Show milestones as well as events</span>
          </label>
        </div>
        {filters.milestones && (
          <fieldset>
            <legend className="form-label">Milestones</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {MILESTONE_KINDS.map((kind) => (
                <label key={kind} className="touch-target-phone flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={filters.kinds.includes(kind)}
                    onChange={() => toggleKind(kind)}
                  />
                  <span className="text-theme-text-primary">{TIMELINE_KIND_LABELS[kind]}</span>
                </label>
              ))}
            </div>
            <p className="text-theme-text-secondary mt-1 text-xs">
              A title appears only when it is set to show on the timeline in settings and the date it began is recorded.
            </p>
          </fieldset>
        )}
      </section>

      {error && (
        <div role="alert" className="alert-danger mb-4 rounded-md p-3 text-sm">
          {error}
        </div>
      )}

      {decades !== null && decades.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nothing on the timeline yet"
          description="Events and dated records appear here once they are published."
        />
      ) : (
        <ol className="space-y-3" aria-busy={decades === null}>
          {(decades ?? []).map(({ decade, count }) => {
            const isOpen = open === decade;
            const panelId = `timeline-decade-${decade}`;
            return (
              <li key={decade} className="card p-3">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpen(isOpen ? null : decade)}
                  className="touch-target-phone flex w-full items-center justify-between gap-2 text-left"
                >
                  <span className="text-theme-text-primary text-lg font-semibold">{decade}s</span>
                  <span className="text-theme-text-secondary flex items-center gap-1 text-sm">
                    {count} {count === 1 ? 'entry' : 'entries'}
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div id={panelId} className="mt-3 pl-3">
                    {entries[decade] === undefined ? (
                      <p className="text-theme-text-secondary text-sm">Loading…</p>
                    ) : (
                      <TimelineList entries={entries[decade] ?? []} emptyText="Nothing in this decade." />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};

export default HistoryTimelinePage;
