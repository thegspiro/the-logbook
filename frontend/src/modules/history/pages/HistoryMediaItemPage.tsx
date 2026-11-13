/**
 * One photo, recording or video. Members see the published item; the
 * archive's keepers also get the research notes, the original download, each
 * tagged person's photo-use answer, publication, clearance and the change
 * history.
 *
 * Whether the item may go public is the server's answer (`cleared_for_public`,
 * CLAUDE.md pitfall #29). A consent warning is shown before publishing and
 * never stops it (owner decision).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AlertTriangle, Download, Edit2, Images, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { getErrorMessage, toAppError } from '../../../utils/errorHandling';
import { saveBlob } from '../../../utils/saveBlob';
import { ClearanceSteps } from '../components/ClearanceSteps';
import { MediaDetails } from '../components/MediaDetails';
import { PublicationBadge } from '../components/PublicationBadge';
import { RevisionList } from '../components/RevisionList';
import { historyMediaService, historyService } from '../services/api';
import { CONSENT_STATE_LABELS, type MediaFullView, type MediaView } from '../types';

const formatBytes = (bytes: number | null): string => {
  if (bytes === null) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const HistoryMediaItemPage: React.FC = () => {
  const { mediaId = '' } = useParams();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const [item, setItem] = useState<MediaView | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revisionKey, setRevisionKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setItem(await historyMediaService.getMedia(mediaId));
      setRevisionKey((k) => k + 1);
    } catch (err: unknown) {
      if (toAppError(err).status === 404) setMissing(true);
      else setError(getErrorMessage(err, 'Unable to load this item.'));
    }
  }, [mediaId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <EmptyState
          icon={Images}
          title="Item not found"
          description="This item does not exist or has not been published."
          actions={[{ label: 'Back to the gallery', onClick: () => void navigate('/history/media') }]}
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

  const full: MediaFullView | null = item.view === 'full' ? item : null;

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

  const unconsented = full?.tags.filter((t) => t.consent === 'declined' || t.consent === 'not_answered') ?? [];

  const publish = async (level: 'members' | 'public') => {
    if (!full) return;
    const warnings: string[] = [];
    if (unconsented.length > 0) {
      warnings.push(
        `Tagged without photo-use consent: ${unconsented
          .map((t) => `${t.display_name} (${CONSENT_STATE_LABELS[t.consent].toLowerCase()})`)
          .join(', ')}.`
      );
    }
    if (full.kind !== 'photo') {
      warnings.push(
        'This recording is shown exactly as uploaded. One made on a phone can carry the place it was made.'
      );
    }
    if (warnings.length > 0) {
      const ok = await confirm({
        title: level === 'public' ? 'Publish to the public' : 'Publish to members',
        message: `${warnings.join(' ')} Publish anyway?`,
        confirmLabel: 'Publish',
        cancelLabel: 'Not yet',
        variant: 'warning',
      });
      if (!ok) return;
    }
    await run(
      () => historyMediaService.publish(full.id, level),
      level === 'public' ? 'Published to the public' : 'Published to members',
      'Could not publish this item'
    );
  };

  const remove = async () => {
    if (!full) return;
    const ok = await confirm({
      title: 'Delete item',
      message: `Delete "${full.title}", its stored files and its change history? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await historyMediaService.deleteMedia(full.id);
      toast.success('Deleted');
      void navigate('/history/media');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not delete this item'));
    }
  };

  const downloadOriginal = async () => {
    if (!full) return;
    try {
      saveBlob(await historyMediaService.downloadOriginal(full.id), full.original_filename);
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
          { label: 'Photos and media', path: '/history/media' },
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
              to={`/history/media/${full.id}/edit`}
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
          <MediaDetails item={item} />
        </div>

        {full && (
          <aside className="space-y-4">
            <section aria-labelledby="media-research-heading" className="card p-4">
              <h2 id="media-research-heading" className="text-theme-text-primary mb-2 font-semibold">
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
              {full.tags.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-theme-text-primary mb-1 text-sm font-semibold">Photo-use consent</h3>
                  <ul className="space-y-1 text-sm">
                    {full.tags.map((tag) => {
                      const warn = tag.consent === 'declined' || tag.consent === 'not_answered';
                      return (
                        <li key={tag.member_id} className="flex items-start gap-1">
                          {warn && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                          <span className="text-theme-text-primary">
                            {tag.display_name}:{' '}
                            <span className={warn ? 'font-medium' : 'text-theme-text-secondary'}>
                              {CONSENT_STATE_LABELS[tag.consent]}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>

            <section aria-labelledby="media-publish-heading" className="card space-y-3 p-4">
              <h2 id="media-publish-heading" className="text-theme-text-primary font-semibold">
                Publication
              </h2>
              {full.kind !== 'photo' && (
                <p className="alert-warning flex items-start gap-2 rounded-md p-2 text-xs">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  Shown to members exactly as uploaded, including anything the recording device stored in the file.
                </p>
              )}
              {latest && <ClearanceSteps request={latest} />}
              {latest?.can_decide && (
                <Link to={`/history/clearance/${latest.id}`} className="btn-info btn-sm inline-block rounded-md">
                  Review this item
                </Link>
              )}
              {full.can_edit && full.clearance_required && !pendingReview && !full.cleared_for_public && (
                <button
                  type="button"
                  disabled={busy}
                  className="btn-secondary btn-sm rounded-md"
                  onClick={() =>
                    void run(
                      () => historyService.submitForClearance(full.id, 'public', 'media'),
                      'Submitted for clearance',
                      'Could not submit this item'
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
                      onClick={() => void publish('members')}
                    >
                      Publish to members
                    </button>
                  )}
                  {(full.publication_level !== 'public' || full.public_changes_pending) && (
                    <button
                      type="button"
                      disabled={busy || (full.clearance_required && !full.cleared_for_public)}
                      className="btn-secondary btn-sm rounded-md"
                      onClick={() => void publish('public')}
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
                          () => historyMediaService.unpublish(full.id, 'draft'),
                          'Returned to draft',
                          'Could not unpublish this item'
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
                  Public items are stored now and appear on the department&apos;s website once the public feed is turned
                  on.
                </p>
              )}
            </section>

            <section aria-labelledby="media-history-heading" className="card p-4">
              <h2 id="media-history-heading" className="text-theme-text-primary mb-2 font-semibold">
                Change history
              </h2>
              <RevisionList personId={full.id} refreshKey={revisionKey} recordType="media" />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
};

export default HistoryMediaItemPage;
