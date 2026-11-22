/**
 * One event and what it links to. Members see the published event, with only
 * the people, apparatus, photos and documents they may open; the archive's
 * keepers also get the research notes, publication, clearance and the change
 * history.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Calendar, Edit2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { getErrorMessage, toAppError } from '../../../utils/errorHandling';
import { EventDetails } from '../components/EventDetails';
import { PublicationBadge } from '../components/PublicationBadge';
import { PublicationPanel } from '../components/PublicationPanel';
import { RevisionList } from '../components/RevisionList';
import { historyEventService, historyService } from '../services/api';
import type { EventFullView, EventView } from '../types';

export const HistoryEventPage: React.FC = () => {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const [item, setItem] = useState<EventView | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revisionKey, setRevisionKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setItem(await historyEventService.getEvent(eventId));
      setRevisionKey((k) => k + 1);
    } catch (err: unknown) {
      if (toAppError(err).status === 404) setMissing(true);
      else setError(getErrorMessage(err, 'Unable to load this event.'));
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <EmptyState
          icon={Calendar}
          title="Event not found"
          description="This event does not exist or has not been published."
          actions={[{ label: 'Back to the events', onClick: () => void navigate('/history/events') }]}
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

  const full: EventFullView | null = item.view === 'full' ? item : null;

  const run = async (action: 'submit' | 'members' | 'public' | 'draft') => {
    if (!full) return;
    setBusy(true);
    try {
      if (action === 'submit') await historyService.submitForClearance(full.id, 'public', 'event');
      else if (action === 'draft') await historyEventService.unpublish(full.id, 'draft');
      else await historyEventService.publish(full.id, action);
      toast.success(
        action === 'submit' ? 'Submitted for clearance' : action === 'draft' ? 'Returned to draft' : 'Published'
      );
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not change how this event is published'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!full) return;
    const ok = await confirm({
      title: 'Delete event',
      message: `Delete "${full.title}" and its change history? The people, apparatus, photos and documents it links to stay in the archive.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await historyEventService.deleteEvent(full.id);
      toast.success('Deleted');
      void navigate('/history/events');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not delete this event'));
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Events', path: '/history/events' },
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
              to={`/history/events/${full.id}/edit`}
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
        <div className="card p-4">
          <EventDetails item={item} />
        </div>

        {full && (
          <aside className="space-y-4">
            {full.research_notes && (
              <section aria-labelledby="event-research-heading" className="card p-4">
                <h2 id="event-research-heading" className="text-theme-text-primary mb-2 font-semibold">
                  Research notes (Historian only)
                </h2>
                <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{full.research_notes}</p>
              </section>
            )}
            <PublicationPanel
              record={full}
              noun="event"
              busy={busy}
              run={(action) => void run(action)}
              headingId="event-publish-heading"
            />
            <section aria-labelledby="event-history-heading" className="card p-4">
              <h2 id="event-history-heading" className="text-theme-text-primary mb-2 font-semibold">
                Change history
              </h2>
              <RevisionList personId={full.id} refreshKey={revisionKey} recordType="event" />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
};

export default HistoryEventPage;
