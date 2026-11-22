/**
 * The archive's events, oldest first, with search and filters. Search covers
 * the title, description and place. Members see what is published; the
 * archive's keepers also see drafts.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Calendar, Plus, Search } from 'lucide-react';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { Pagination } from '../../../components/ux/Pagination';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { PublicationBadge } from '../components/PublicationBadge';
import { historyEventService, historyListService } from '../services/api';
import { PUBLICATION_LEVEL_LABELS, type EventSummary, type HistoryListEntry, type PublicationLevel } from '../types';
import { formatDateSpan } from '../utils/historyFormat';

const PAGE_SIZE = 60;
const DECADES = Array.from({ length: 21 }, (_, i) => 1830 + i * 10).reverse();

export const HistoryEventsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('history.manage');
  const canSeeDrafts = canManage || checkPermission('history.view') || checkPermission('history.publish');

  const [items, setItems] = useState<EventSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [types, setTypes] = useState<HistoryListEntry[]>([]);
  const [stations, setStations] = useState<HistoryListEntry[]>([]);
  const [search, setSearch] = useState('');
  const [typeId, setTypeId] = useState('');
  const [stationId, setStationId] = useState('');
  const [decade, setDecade] = useState('');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void historyListService
      .list('event-types')
      .then(setTypes)
      .catch(() => setTypes([]));
    void historyListService
      .list('stations')
      .then(setStations)
      .catch(() => setStations([]));
  }, []);

  const query = useMemo(
    () => ({
      search: search.trim() || undefined,
      event_type_id: typeId || undefined,
      station_id: stationId || undefined,
      decade: decade ? Number(decade) : undefined,
      level: (level || undefined) as PublicationLevel | undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [search, typeId, stationId, decade, level, page]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      historyEventService
        .listEvents(query)
        .then((result) => {
          if (cancelled) return;
          setItems(result.items);
          setTotal(result.total);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(getErrorMessage(err, 'Unable to load the events.'));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [search, typeId, stationId, decade, level]);

  const narrowed = Boolean(search || typeId || stationId || decade || level);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'History', path: '/history' }, { label: 'Events' }]} />
      <div className="page-header mb-4 gap-3 sm:items-center">
        <h1 className="page-header-title text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <Calendar className="h-6 w-6 shrink-0" aria-hidden="true" />
          Events
        </h1>
        {canManage && (
          <div className="page-header-actions flex flex-wrap gap-2">
            <Link
              to="/history/events/new"
              className="btn-primary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add an event
            </Link>
          </div>
        )}
      </div>

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="relative sm:col-span-2 lg:col-span-1">
          <span className="form-label">Search</span>
          <Search
            className="text-theme-text-muted pointer-events-none absolute bottom-3 left-3 h-4 w-4"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title, place, a word"
            className="form-input pl-9"
          />
        </label>
        <label>
          <span className="form-label">Type</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="form-input">
            <option value="">Every type</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="form-label">Station</span>
          <select value={stationId} onChange={(e) => setStationId(e.target.value)} className="form-input">
            <option value="">Any station</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="form-label">Decade</span>
          <select value={decade} onChange={(e) => setDecade(e.target.value)} className="form-input">
            <option value="">Any decade</option>
            {DECADES.map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </select>
        </label>
        {canSeeDrafts && (
          <label>
            <span className="form-label">Publication</span>
            <select value={level} onChange={(e) => setLevel(e.target.value)} className="form-input">
              <option value="">All</option>
              {(Object.keys(PUBLICATION_LEVEL_LABELS) as PublicationLevel[]).map((l) => (
                <option key={l} value={l}>
                  {PUBLICATION_LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <div role="alert" className="alert-danger mb-4 rounded-md p-3 text-sm">
          {error}
        </div>
      )}

      {!loading && items.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title={narrowed ? 'Nothing matches' : 'No events yet'}
          description={
            narrowed
              ? 'Try a different search or filter.'
              : canManage
                ? 'Add the first fire, opening or celebration to start the timeline.'
                : 'Nothing has been published yet.'
          }
        />
      ) : (
        <ul className="card divide-theme-surface-border divide-y" aria-busy={loading}>
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
              <span className="text-theme-text-secondary w-full text-sm sm:w-40 sm:shrink-0">
                {formatDateSpan(item)}
              </span>
              <Link
                to={`/history/events/${item.id}`}
                className="touch-target-phone link-underline text-theme-text-primary inline-flex min-w-0 items-center font-medium break-words"
              >
                {item.title}
              </Link>
              {item.event_type_name && <span className="badge text-xs">{item.event_type_name}</span>}
              {item.place && <span className="text-theme-text-secondary text-sm">{item.place}</span>}
              {canSeeDrafts && item.publication_level !== 'members' && (
                <PublicationBadge level={item.publication_level} />
              )}
            </li>
          ))}
        </ul>
      )}
      {total > PAGE_SIZE && (
        <div className="mt-4">
          <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
};

export default HistoryEventsPage;
