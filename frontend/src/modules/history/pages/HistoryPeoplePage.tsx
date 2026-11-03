/**
 * The roster of past members: search, filter by decade, title and memorial,
 * and — for the archive's keepers — by publication level.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Search, Users } from 'lucide-react';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { Pagination } from '../../../components/ux/Pagination';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import { PublicationBadge } from '../components/PublicationBadge';
import {
  PUBLICATION_LEVEL_LABELS,
  type HistoricalMemberSummary,
  type HistoryTitle,
  type PublicationLevel,
} from '../types';

const PAGE_SIZE = 50;
const DECADES = Array.from({ length: 21 }, (_, i) => 1830 + i * 10).reverse();

export const HistoryPeoplePage: React.FC = () => {
  const navigate = useNavigate();
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('history.manage');
  const canSeeDrafts = canManage || checkPermission('history.view') || checkPermission('history.publish');

  const [people, setPeople] = useState<HistoricalMemberSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [titles, setTitles] = useState<HistoryTitle[]>([]);
  const [search, setSearch] = useState('');
  const [decade, setDecade] = useState('');
  const [titleId, setTitleId] = useState('');
  const [memorialOnly, setMemorialOnly] = useState(false);
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void historyService
      .listTitles()
      .then(setTitles)
      .catch(() => setTitles([]));
  }, []);

  const query = useMemo(
    () => ({
      search: search.trim() || undefined,
      decade: decade ? Number(decade) : undefined,
      title_id: titleId || undefined,
      memorial: memorialOnly ? true : undefined,
      level: (level || undefined) as PublicationLevel | undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [search, decade, titleId, memorialOnly, level, page]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      historyService
        .listPeople(query)
        .then((result) => {
          if (cancelled) return;
          setPeople(result.items);
          setTotal(result.total);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(getErrorMessage(err, 'Unable to load the roster.'));
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
  }, [search, decade, titleId, memorialOnly, level]);

  const narrowed = Boolean(search || decade || titleId || memorialOnly || level);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'History', path: '/history' }, { label: 'Past members' }]} />
      <div className="page-header mb-4 gap-3 sm:items-center">
        <h1 className="page-header-title text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <Users className="h-6 w-6 shrink-0" aria-hidden="true" />
          Past Members
        </h1>
        {canManage && (
          <div className="page-header-actions">
            <Link
              to="/history/people/new"
              className="btn-primary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add person
            </Link>
          </div>
        )}
      </div>

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative sm:col-span-2">
          <span className="form-label">Search</span>
          <Search
            className="text-theme-text-muted pointer-events-none absolute bottom-3 left-3 h-4 w-4"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, nickname or badge number"
            className="form-input pl-9"
          />
        </label>
        <label>
          <span className="form-label">Decade served</span>
          <select value={decade} onChange={(e) => setDecade(e.target.value)} className="form-input">
            <option value="">Any decade</option>
            {DECADES.map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="form-label">Title</span>
          <select value={titleId} onChange={(e) => setTitleId(e.target.value)} className="form-input">
            <option value="">Any title</option>
            {titles.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
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
        <label className="flex items-center gap-2 self-end pb-2">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={memorialOnly}
            onChange={(e) => setMemorialOnly(e.target.checked)}
          />
          <span className="text-theme-text-primary text-sm">Memorials only</span>
        </label>
      </div>

      {error && (
        <div role="alert" className="alert-danger mb-4 rounded-md p-3 text-sm">
          {error}
        </div>
      )}

      {!loading && people.length === 0 ? (
        <EmptyState
          icon={Users}
          title={narrowed ? 'No one matches' : 'No past members yet'}
          description={
            narrowed
              ? 'Try a different search or filter.'
              : canManage
                ? 'Add the first person to start the archive.'
                : 'Nothing has been published yet.'
          }
          {...(canManage && !narrowed
            ? { actions: [{ label: 'Add person', onClick: () => void navigate('/history/people/new') }] }
            : {})}
        />
      ) : (
        <ul className="card divide-theme-surface-border divide-y" aria-busy={loading}>
          {people.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
              <Link
                to={`/history/people/${person.id}`}
                className="touch-target-phone link-underline inline-flex items-center font-medium"
              >
                {person.display_name}
              </Link>
              {person.service_years && (
                <span className="text-theme-text-secondary text-sm">{person.service_years}</span>
              )}
              {person.titles.length > 0 && (
                <span className="text-theme-text-secondary text-sm">{person.titles.join(', ')}</span>
              )}
              {person.is_line_of_duty_death && (
                <span className="badge rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-white">
                  Line of duty
                </span>
              )}
              {canSeeDrafts && <PublicationBadge level={person.publication_level} />}
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

export default HistoryPeoplePage;
