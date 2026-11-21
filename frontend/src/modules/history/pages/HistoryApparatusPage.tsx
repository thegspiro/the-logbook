/**
 * One historical apparatus: its catalogue and unit numbers, its timeline (in
 * and out of service, changes of unit number, the events it took part in),
 * and the photos and documents it is tagged in. The archive's keepers also
 * get the research notes, where the record came from, publication,
 * clearance and the change history.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Edit2, Trash2, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { getErrorMessage, toAppError } from '../../../utils/errorHandling';
import { ApparatusDetails } from '../components/ApparatusDetails';
import { DocumentTile } from '../components/DocumentDetails';
import { MediaTile } from '../components/MediaDetails';
import { PublicationBadge } from '../components/PublicationBadge';
import { PublicationPanel } from '../components/PublicationPanel';
import { RevisionList } from '../components/RevisionList';
import { TimelineList } from '../components/TimelineList';
import { historyApparatusService, historyDocumentService, historyMediaService, historyService } from '../services/api';
import type { ApparatusFullView, ApparatusView, DocumentSummary, MediaSummary, TimelineEntry } from '../types';

export const HistoryApparatusPage: React.FC = () => {
  const { apparatusId = '' } = useParams();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const [item, setItem] = useState<ApparatusView | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [media, setMedia] = useState<MediaSummary[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revisionKey, setRevisionKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setItem(await historyApparatusService.getApparatus(apparatusId));
      setRevisionKey((k) => k + 1);
    } catch (err: unknown) {
      if (toAppError(err).status === 404) setMissing(true);
      else setError(getErrorMessage(err, 'Unable to load this apparatus.'));
      return;
    }
    // The rest is extra: a part that cannot load is left empty, not fatal.
    const [entries, photos, papers] = await Promise.allSettled([
      historyApparatusService.timeline(apparatusId),
      historyMediaService.listMedia({ apparatus_id: apparatusId, limit: 24 }),
      historyDocumentService.listDocuments({ apparatus_id: apparatusId, limit: 24 }),
    ]);
    setTimeline(entries.status === 'fulfilled' ? entries.value : []);
    setMedia(photos.status === 'fulfilled' ? photos.value.items : []);
    setDocuments(papers.status === 'fulfilled' ? papers.value.items : []);
  }, [apparatusId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <EmptyState
          icon={Truck}
          title="Apparatus not found"
          description="This apparatus does not exist or has not been published."
          actions={[{ label: 'Back to the apparatus', onClick: () => void navigate('/history/apparatus') }]}
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

  const full: ApparatusFullView | null = item.view === 'full' ? item : null;

  const run = async (action: 'submit' | 'members' | 'public' | 'draft') => {
    if (!full) return;
    setBusy(true);
    try {
      if (action === 'submit') await historyService.submitForClearance(full.id, 'public', 'apparatus');
      else if (action === 'draft') await historyApparatusService.unpublish(full.id, 'draft');
      else await historyApparatusService.publish(full.id, action);
      toast.success(
        action === 'submit' ? 'Submitted for clearance' : action === 'draft' ? 'Returned to draft' : 'Published'
      );
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not change how this apparatus is published'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!full) return;
    const ok = await confirm({
      title: 'Delete apparatus',
      message: `Delete "${full.name}", its unit numbers and its change history? Photos, documents and events stay in the archive; their links to it go.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await historyApparatusService.deleteApparatus(full.id);
      toast.success('Deleted');
      void navigate('/history/apparatus');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not delete this apparatus'));
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Apparatus', path: '/history/apparatus' },
          { label: item.name },
        ]}
      />
      <div className="page-header mb-4 gap-3 sm:items-center">
        <div>
          <h1 className="page-header-title text-theme-text-primary text-2xl font-bold">{item.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {item.service_span && <span className="text-theme-text-secondary text-sm">{item.service_span}</span>}
            {full && <PublicationBadge level={full.publication_level} />}
            {full?.public_changes_pending && (
              <span className="text-theme-text-secondary text-sm">Changes awaiting public clearance</span>
            )}
          </div>
        </div>
        {full?.can_edit && (
          <div className="page-header-actions flex flex-wrap gap-2">
            <Link
              to={`/history/apparatus/${full.id}/edit`}
              className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <Edit2 className="h-4 w-4" aria-hidden="true" />
              Edit
            </Link>
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
        <div className="space-y-6">
          <div className="card p-4">
            <ApparatusDetails item={item} />
          </div>
          <section aria-labelledby="apparatus-timeline-heading" className="card p-4">
            <h2 id="apparatus-timeline-heading" className="text-theme-text-primary mb-3 text-lg font-semibold">
              Timeline
            </h2>
            <TimelineList entries={timeline} emptyText="No dates or events recorded yet." />
          </section>
          {media.length > 0 && (
            <section aria-labelledby="apparatus-media-heading" className="card p-4">
              <h2 id="apparatus-media-heading" className="text-theme-text-primary mb-3 text-lg font-semibold">
                Photos and media
              </h2>
              <ul className="thumb-grid">
                {media.map((photo) => (
                  <li key={photo.id}>
                    <MediaTile item={photo} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {documents.length > 0 && (
            <section aria-labelledby="apparatus-documents-heading" className="card p-4">
              <h2 id="apparatus-documents-heading" className="text-theme-text-primary mb-3 text-lg font-semibold">
                Documents
              </h2>
              <ul className="thumb-grid">
                {documents.map((paper) => (
                  <li key={paper.id}>
                    <DocumentTile item={paper} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {full && (
          <aside className="space-y-4">
            {(full.research_notes || full.fleet_apparatus_id) && (
              <section aria-labelledby="apparatus-research-heading" className="card space-y-2 p-4">
                <h2 id="apparatus-research-heading" className="text-theme-text-primary font-semibold">
                  Historian only
                </h2>
                {full.fleet_apparatus_id && (
                  <p className="text-theme-text-secondary text-sm">
                    Started from {full.fleet_label ?? 'a truck'} in the Apparatus module. Nothing syncs from it.
                  </p>
                )}
                {full.research_notes && (
                  <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{full.research_notes}</p>
                )}
              </section>
            )}
            <PublicationPanel
              record={full}
              noun="apparatus record"
              busy={busy}
              run={(action) => void run(action)}
              headingId="apparatus-publish-heading"
            />
            <section aria-labelledby="apparatus-history-heading" className="card p-4">
              <h2 id="apparatus-history-heading" className="text-theme-text-primary mb-2 font-semibold">
                Change history
              </h2>
              <RevisionList personId={full.id} refreshKey={revisionKey} recordType="apparatus" />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
};

export default HistoryApparatusPage;
