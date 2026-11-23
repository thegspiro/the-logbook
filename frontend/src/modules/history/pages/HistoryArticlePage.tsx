/**
 * One article. Members read the published article, with only the photos and
 * links they may open; the archive's keepers also get the research notes,
 * publication, clearance and the change history. Anyone who can read it can
 * download it as a PDF or a Word file, which holds the same page they see.
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
import { ArticleDetails } from '../components/ArticleDetails';
import { PublicationBadge } from '../components/PublicationBadge';
import { PublicationPanel } from '../components/PublicationPanel';
import { RevisionList } from '../components/RevisionList';
import { historyArticleService, historyService } from '../services/api';
import type { ArticleExportFormat, ArticleFullView, ArticleView } from '../types';
import { articleFileName } from '../utils/articleCatalogue';

const FORMAT_LABELS: Record<ArticleExportFormat, string> = { pdf: 'PDF', docx: 'Word' };

export const HistoryArticlePage: React.FC = () => {
  const { articleId = '' } = useParams();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const [item, setItem] = useState<ArticleView | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<ArticleExportFormat | null>(null);
  const [revisionKey, setRevisionKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setItem(await historyArticleService.getArticle(articleId));
      setRevisionKey((k) => k + 1);
    } catch (err: unknown) {
      if (toAppError(err).status === 404) setMissing(true);
      else setError(getErrorMessage(err, 'Unable to load this article.'));
    }
  }, [articleId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <EmptyState
          icon={FileText}
          title="Article not found"
          description="This article does not exist or has not been published."
          actions={[{ label: 'Back to the articles', onClick: () => void navigate('/history/articles') }]}
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

  const full: ArticleFullView | null = item.view === 'full' ? item : null;

  const run = async (action: 'submit' | 'members' | 'public' | 'draft') => {
    if (!full) return;
    setBusy(true);
    try {
      if (action === 'submit') await historyService.submitForClearance(full.id, 'public', 'article');
      else if (action === 'draft') await historyArticleService.unpublish(full.id, 'draft');
      else await historyArticleService.publish(full.id, action);
      toast.success(
        action === 'submit' ? 'Submitted for clearance' : action === 'draft' ? 'Returned to draft' : 'Published'
      );
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not change how this article is published'));
    } finally {
      setBusy(false);
    }
  };

  const download = async (format: ArticleExportFormat) => {
    setExporting(format);
    try {
      saveBlob(await historyArticleService.exportArticle(item.id, format), articleFileName(item.title, format));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, `Could not make the ${FORMAT_LABELS[format]} file`));
    } finally {
      setExporting(null);
    }
  };

  const remove = async () => {
    if (!full) return;
    const ok = await confirm({
      title: 'Delete article',
      message: `Delete "${full.title}" and its change history? The photos, people, events, apparatus and documents it shows or links to stay in the archive.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await historyArticleService.deleteArticle(full.id);
      toast.success('Deleted');
      void navigate('/history/articles');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not delete this article'));
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Articles', path: '/history/articles' },
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
        <div className="page-header-actions flex flex-wrap gap-2">
          {(Object.keys(FORMAT_LABELS) as ArticleExportFormat[]).map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => void download(format)}
              disabled={exporting !== null}
              className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {exporting === format ? 'Preparing…' : FORMAT_LABELS[format]}
            </button>
          ))}
          {full?.can_edit && (
            <Link
              to={`/history/articles/${full.id}/edit`}
              className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <Edit2 className="h-4 w-4" aria-hidden="true" />
              Edit
            </Link>
          )}
          {full?.can_edit && full.publication_level === 'draft' && (
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
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="card min-w-0 p-4 sm:p-6">
          <ArticleDetails item={item} />
        </div>

        {full && (
          <aside className="space-y-4">
            {full.photos_not_public.length > 0 && (
              <section aria-labelledby="article-photos-heading" className="alert-warning rounded-md p-3 text-sm">
                <h2 id="article-photos-heading" className="mb-1 font-semibold">
                  Photos not cleared for the public
                </h2>
                <p>
                  Before this article can go for public clearance, clear these photos for the public or take them out of
                  it:
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {full.photos_not_public.map((title) => (
                    <li key={title}>{title}</li>
                  ))}
                </ul>
              </section>
            )}
            {full.research_notes && (
              <section aria-labelledby="article-research-heading" className="card p-4">
                <h2 id="article-research-heading" className="text-theme-text-primary mb-2 font-semibold">
                  Research notes (Historian only)
                </h2>
                <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{full.research_notes}</p>
              </section>
            )}
            <PublicationPanel
              record={full}
              noun="article"
              busy={busy}
              run={(action) => void run(action)}
              headingId="article-publish-heading"
            />
            <section aria-labelledby="article-history-heading" className="card p-4">
              <h2 id="article-history-heading" className="text-theme-text-primary mb-2 font-semibold">
                Change history
              </h2>
              <RevisionList personId={full.id} refreshKey={revisionKey} recordType="article" />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
};

export default HistoryArticlePage;
