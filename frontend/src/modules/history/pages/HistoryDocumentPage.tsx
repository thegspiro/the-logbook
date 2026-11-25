/**
 * One document. Members see the published document; the archive's keepers also
 * get the research notes, the original download, publication, clearance and
 * the change history.
 *
 * Whether the document may go public is the server's answer
 * (`cleared_for_public`, CLAUDE.md pitfall #29). There is no consent warning:
 * a letter naming someone is not a photo of them (owner decision).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Download, Edit2, FileText, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { getErrorMessage, toAppError } from '../../../utils/errorHandling';
import { saveBlob } from '../../../utils/saveBlob';
import { ClearanceSteps } from '../components/ClearanceSteps';
import { DocumentDetails } from '../components/DocumentDetails';
import { PublicationBadge } from '../components/PublicationBadge';
import { RelatedArticles } from '../components/RelatedArticles';
import { RevisionList } from '../components/RevisionList';
import { historyDocumentService, historyService } from '../services/api';
import type { DocumentFullView, DocumentView } from '../types';

const formatBytes = (bytes: number | null): string => {
  if (bytes === null) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const HistoryDocumentPage: React.FC = () => {
  const { documentId = '' } = useParams();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const [item, setItem] = useState<DocumentView | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revisionKey, setRevisionKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setItem(await historyDocumentService.getDocument(documentId));
      setRevisionKey((k) => k + 1);
    } catch (err: unknown) {
      if (toAppError(err).status === 404) setMissing(true);
      else setError(getErrorMessage(err, 'Unable to load this document.'));
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <EmptyState
          icon={FileText}
          title="Document not found"
          description="This document does not exist or has not been published."
          actions={[{ label: 'Back to the documents', onClick: () => void navigate('/history/documents') }]}
        />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div role="alert" className="alert-danger rounded-md p-3 text-sm">
          {error}
        </div>
      </div>
    );
  }
  if (!item) return <SkeletonPage />;

  const full: DocumentFullView | null = item.view === 'full' ? item : null;

  const run = async (action: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!full) return;
    const ok = await confirm({
      title: 'Delete document',
      message: `Delete "${full.title}", its file in the History folder, its copies and its change history? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await historyDocumentService.deleteDocument(full.id);
      toast.success('Deleted');
      void navigate('/history/documents');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not delete this document'));
    }
  };

  const downloadOriginal = async () => {
    if (!full) return;
    try {
      saveBlob(await historyDocumentService.downloadOriginal(full.id), full.original_filename);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not download the original'));
    }
  };

  const latest = full?.clearance ?? null;
  const pendingReview = latest?.status === 'pending';

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Documents', path: '/history/documents' },
          { label: item.title },
        ]}
      />
      <div className="page-header mb-4 gap-3 sm:items-center">
        <div>
          <h1 className="page-header-title text-theme-text-primary text-2xl font-bold">{item.title}</h1>
          {full && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <PublicationBadge level={full.publication_level} />
              {full.public_changes_pending && (
                <span className="text-theme-text-secondary text-sm">Changes awaiting public clearance</span>
              )}
            </div>
          )}
        </div>
        {full?.can_edit && (
          <div className="page-header-actions flex flex-wrap gap-2">
            <Link
              to={`/history/documents/${full.id}/edit`}
              className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <Edit2 className="h-4 w-4" aria-hidden="true" />
              Edit
            </Link>
            <button
              type="button"
              onClick={() => void downloadOriginal()}
              className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Original
            </button>
            {full.publication_level === 'draft' && (
              <button
                type="button"
                onClick={() => void remove()}
                className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="card p-4">
          <DocumentDetails item={item} />
          <RelatedArticles query={{ document_id: item.id }} headingId="document-articles-heading" className="mt-6" />
          {item.text_truncated && (
            <p className="text-theme-text-secondary mt-3 text-xs">
              This document is long: search covers its first pages, not all of it.
            </p>
          )}
        </div>

        {full && (
          <aside className="space-y-4">
            <section aria-labelledby="document-research-heading" className="card p-4">
              <h2 id="document-research-heading" className="text-theme-text-primary mb-2 font-semibold">
                Historian only
              </h2>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-theme-text-secondary">Original file</dt>
                  <dd className="text-theme-text-primary break-all">
                    {full.original_filename} · {formatBytes(full.original_size_bytes)}
                  </dd>
                </div>
                {full.research_notes && (
                  <div>
                    <dt className="text-theme-text-secondary">Research notes</dt>
                    <dd className="text-theme-text-primary whitespace-pre-wrap">{full.research_notes}</dd>
                  </div>
                )}
              </dl>
              <p className="text-theme-text-secondary mt-3 text-xs">
                The original is kept in the History folder in Documents, which only the archive&apos;s keepers can open.
              </p>
            </section>

            <section aria-labelledby="document-publish-heading" className="card space-y-3 p-4">
              <h2 id="document-publish-heading" className="text-theme-text-primary font-semibold">
                Publication
              </h2>
              {latest && <ClearanceSteps request={latest} />}
              {latest?.can_decide && (
                <Link to={`/history/clearance/${latest.id}`} className="btn-info btn-sm inline-block rounded-md">
                  Review this document
                </Link>
              )}
              {full.can_edit && full.clearance_required && !pendingReview && !full.cleared_for_public && (
                <button
                  type="button"
                  disabled={busy}
                  className="btn-secondary btn-sm rounded-md"
                  onClick={() =>
                    void run(
                      () => historyService.submitForClearance(full.id, 'public', 'document'),
                      'Submitted for clearance',
                      'Could not submit this document'
                    )
                  }
                >
                  Submit for public clearance
                </button>
              )}
              {full.can_publish && (
                <div className="flex flex-wrap gap-2">
                  {full.publication_level === 'draft' && (
                    <button
                      type="button"
                      disabled={busy}
                      className="btn-primary btn-sm rounded-md"
                      onClick={() =>
                        void run(
                          () => historyDocumentService.publish(full.id, 'members'),
                          'Published to members',
                          'Could not publish this document'
                        )
                      }
                    >
                      Publish to members
                    </button>
                  )}
                  {(full.publication_level !== 'public' || full.public_changes_pending) && (
                    <button
                      type="button"
                      disabled={busy || (full.clearance_required && !full.cleared_for_public)}
                      className="btn-secondary btn-sm rounded-md"
                      onClick={() =>
                        void run(
                          () => historyDocumentService.publish(full.id, 'public'),
                          'Published to the public',
                          'Could not publish this document'
                        )
                      }
                    >
                      Publish to the public
                    </button>
                  )}
                  {full.publication_level !== 'draft' && (
                    <button
                      type="button"
                      disabled={busy}
                      className="btn-secondary btn-sm rounded-md"
                      onClick={() =>
                        void run(
                          () => historyDocumentService.unpublish(full.id, 'draft'),
                          'Returned to draft',
                          'Could not unpublish this document'
                        )
                      }
                    >
                      Return to draft
                    </button>
                  )}
                </div>
              )}
              {full.publication_level === 'public' && (
                <p className="text-theme-text-secondary text-xs">
                  Public documents appear on the department&apos;s own website when History → Titles, lists and
                  clearance → Public website shows documents.
                </p>
              )}
            </section>

            <section aria-labelledby="document-history-heading" className="card p-4">
              <h2 id="document-history-heading" className="text-theme-text-primary mb-2 font-semibold">
                Change history
              </h2>
              <RevisionList personId={full.id} refreshKey={revisionKey} recordType="document" />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
};

export default HistoryDocumentPage;
