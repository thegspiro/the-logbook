/**
 * The archive's documents: previews with search and filters. Search covers the
 * title, description, author, recipient, transcription and the text a PDF
 * carries. Members see what is published; the archive's keepers also see
 * drafts.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { FileText, Search, Upload } from 'lucide-react';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { Pagination } from '../../../components/ux/Pagination';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { DocumentTile } from '../components/DocumentDetails';
import { historyDocumentService } from '../services/api';
import {
  PUBLICATION_LEVEL_LABELS,
  type DocumentSummary,
  type HistoryDocumentType,
  type PublicationLevel,
} from '../types';

const PAGE_SIZE = 60;
const DECADES = Array.from({ length: 21 }, (_, i) => 1830 + i * 10).reverse();

export const HistoryDocumentsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('history.manage');
  const canSeeDrafts = canManage || checkPermission('history.view') || checkPermission('history.publish');

  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [types, setTypes] = useState<HistoryDocumentType[]>([]);
  const [search, setSearch] = useState('');
  const [typeId, setTypeId] = useState('');
  const [decade, setDecade] = useState('');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void historyDocumentService
      .listTypes()
      .then(setTypes)
      .catch(() => setTypes([]));
  }, []);

  const query = useMemo(
    () => ({
      search: search.trim() || undefined,
      document_type_id: typeId || undefined,
      decade: decade ? Number(decade) : undefined,
      level: (level || undefined) as PublicationLevel | undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [search, typeId, decade, level, page]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      historyDocumentService
        .listDocuments(query)
        .then((result) => {
          if (cancelled) return;
          setItems(result.items);
          setTotal(result.total);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(getErrorMessage(err, 'Unable to load the documents.'));
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
  }, [search, typeId, decade, level]);

  const narrowed = Boolean(search || typeId || decade || level);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'History', path: '/history' }, { label: 'Documents' }]} />
      <div className="page-header mb-4 gap-3 sm:items-center">
        <h1 className="page-header-title text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <FileText className="h-6 w-6 shrink-0" aria-hidden="true" />
          Documents
        </h1>
        {canManage && (
          <div className="page-header-actions flex flex-wrap gap-2">
            <Link
              to="/history/documents/upload"
              className="btn-primary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Upload
            </Link>
          </div>
        )}
      </div>

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
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
            placeholder="Words in the document, a name"
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
          icon={FileText}
          title={narrowed ? 'Nothing matches' : 'No documents yet'}
          description={
            narrowed
              ? 'Try a different search or filter.'
              : canManage
                ? 'Upload the first letters, minutes or clippings to start the collection.'
                : 'Nothing has been published yet.'
          }
        />
      ) : (
        <ul className="thumb-grid" aria-busy={loading}>
          {items.map((item) => (
            <li key={item.id}>
              <DocumentTile item={item} />
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

export default HistoryDocumentsPage;
