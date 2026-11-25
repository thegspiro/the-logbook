/**
 * The archive's articles, most recently updated first or A to Z, with search.
 * Search covers the title, subtitle, summary and text. Members see what is
 * published; the archive's keepers also see drafts.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { FileText, Plus, Search } from 'lucide-react';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { Pagination } from '../../../components/ux/Pagination';
import { useTimezone } from '../../../hooks/useTimezone';
import { useAuthStore } from '../../../stores/authStore';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { PublicationBadge } from '../components/PublicationBadge';
import { historyArticleService, mediaFileUrl } from '../services/api';
import { PUBLICATION_LEVEL_LABELS, type ArticleSort, type ArticleSummary, type PublicationLevel } from '../types';

const PAGE_SIZE = 30;

export const HistoryArticlesPage: React.FC = () => {
  const tz = useTimezone();
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('history.manage');
  const canSeeDrafts = canManage || checkPermission('history.view') || checkPermission('history.publish');

  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ArticleSort>('updated');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () => ({
      search: search.trim() || undefined,
      sort,
      level: (level || undefined) as PublicationLevel | undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [search, sort, level, page]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      historyArticleService
        .listArticles(query)
        .then((result) => {
          if (cancelled) return;
          setItems(result.items);
          setTotal(result.total);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(getErrorMessage(err, 'Unable to load the articles.'));
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
  }, [search, sort, level]);

  const narrowed = Boolean(search || level);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'History', path: '/history' }, { label: 'Articles' }]} />
      <div className="page-header mb-4 gap-3 sm:items-center">
        <h1 className="page-header-title text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <FileText className="h-6 w-6 shrink-0" aria-hidden="true" />
          Articles
        </h1>
        {canManage && (
          <div className="page-header-actions flex flex-wrap gap-2">
            <Link
              to="/history/articles/new"
              className="btn-primary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Write an article
            </Link>
          </div>
        )}
      </div>

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-3">
        <label className="relative">
          <span className="form-label">Search</span>
          <Search
            className="text-theme-text-muted pointer-events-none absolute bottom-3 left-3 h-4 w-4"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title or a word in the text"
            className="form-input pl-9"
          />
        </label>
        <label>
          <span className="form-label">Order</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value === 'title' ? 'title' : 'updated')}
            className="form-input"
          >
            <option value="updated">Recently updated</option>
            <option value="title">A to Z</option>
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
          icon={FileText}
          title={narrowed ? 'Nothing matches' : 'No articles yet'}
          description={
            narrowed
              ? 'Try a different search or filter.'
              : canManage
                ? 'Write the first piece: a station’s story, a past chief, a fire the department remembers.'
                : 'Nothing has been published yet.'
          }
        />
      ) : (
        <ul className="card divide-theme-surface-border divide-y" aria-busy={loading}>
          {items.map((item) => (
            <li key={item.id} className="flex gap-3 p-3">
              {item.cover?.has_thumbnail && (
                <img
                  src={mediaFileUrl(item.cover.id, 'thumbnail')}
                  alt=""
                  loading="lazy"
                  className="h-16 w-16 shrink-0 rounded-md object-cover"
                />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/history/articles/${item.id}`}
                    className="touch-target-phone link-underline text-theme-text-primary inline-flex min-w-0 items-center font-medium break-words"
                  >
                    {item.title}
                  </Link>
                  {canSeeDrafts && item.publication_level !== 'members' && (
                    <PublicationBadge level={item.publication_level} />
                  )}
                </div>
                {item.subtitle && <p className="text-theme-text-secondary text-sm">{item.subtitle}</p>}
                {item.summary && <p className="text-theme-text-primary line-clamp-2 text-sm">{item.summary}</p>}
                <p className="text-theme-text-secondary text-xs">
                  {[item.byline ? `By ${item.byline}` : null, `Updated ${formatDate(item.updated_at, tz)}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
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

export default HistoryArticlesPage;
