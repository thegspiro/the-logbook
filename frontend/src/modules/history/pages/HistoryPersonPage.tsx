/**
 * One person. Members read the published view; the archive's keepers also get
 * the research fields, publication, clearance, family editing and the change
 * history.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Edit2, GitMerge, Landmark, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { getErrorMessage, toAppError } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import { ClearanceSteps } from '../components/ClearanceSteps';
import { PersonDetails } from '../components/PersonDetails';
import { PersonMediaStrip } from '../components/PersonMediaStrip';
import { PublicationBadge } from '../components/PublicationBadge';
import { RelationsEditor } from '../components/RelationsEditor';
import { RevisionList } from '../components/RevisionList';
import { ServicePeriodsEditor } from '../components/ServicePeriodsEditor';
import {
  FIELD_VISIBILITY_LABELS,
  type HistoricalMemberFullView,
  type HistoricalMemberView,
  type HistoryTitle,
} from '../types';
import { formatPartialDate } from '../utils/historyFormat';

export const HistoryPersonPage: React.FC = () => {
  const { personId = '' } = useParams();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const [person, setPerson] = useState<HistoricalMemberView | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titles, setTitles] = useState<HistoryTitle[]>([]);
  const [editingPeriods, setEditingPeriods] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revisionKey, setRevisionKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const loaded = await historyService.getPerson(personId);
      if (loaded.redirected_from && loaded.id !== personId) {
        // A record merged into another: the server forwarded the old address,
        // so show the kept record under its own address.
        void navigate(`/history/people/${loaded.id}`, { replace: true });
        return;
      }
      setPerson(loaded);
      setRevisionKey((k) => k + 1);
      if (loaded.view === 'full') {
        setTitles(await historyService.listTitles(true));
      }
    } catch (err: unknown) {
      if (toAppError(err).status === 404) setMissing(true);
      else setError(getErrorMessage(err, 'Unable to load this person.'));
    }
  }, [personId, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <EmptyState
          icon={Landmark}
          title="Person not found"
          description="This record does not exist or has not been published."
          actions={[{ label: 'Back to past members', onClick: () => void navigate('/history/people') }]}
        />
      </div>
    );
  }
  if (!person) {
    return error ? (
      <div role="alert" className="alert-danger m-4 rounded-md p-3 text-sm">
        {error}
      </div>
    ) : (
      <SkeletonPage />
    );
  }

  const full: HistoricalMemberFullView | null = person.view === 'full' ? person : null;

  const run = async (action: () => Promise<unknown>, success: string, fallback: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!full) return;
    const ok = await confirm({
      title: 'Delete person',
      message: `Delete ${full.display_name} and their change history? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await historyService.deletePerson(full.id);
      toast.success('Deleted');
      void navigate('/history/people');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not delete this person'));
    }
  };

  const latest = full?.clearance ?? null;
  const pendingReview = latest?.status === 'pending';
  // The server decides whether the record may go public (pitfall #29).
  const clearedForPublic = full?.cleared_for_public ?? false;

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Past members', path: '/history/people' },
          { label: person.display_name },
        ]}
      />
      <div className="page-header mb-4 gap-3 sm:items-center">
        <div>
          <h1 className="page-header-title text-theme-text-primary text-2xl font-bold">{person.display_name}</h1>
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
              to={`/history/people/${full.id}/edit`}
              className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <Edit2 className="h-4 w-4" aria-hidden="true" />
              Edit
            </Link>
            <Link
              to={`/history/people/${full.id}/merge`}
              className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <GitMerge className="h-4 w-4" aria-hidden="true" />
              Merge with…
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
        <div className="card space-y-6 p-4">
          <PersonDetails person={person} />
          <PersonMediaStrip personId={person.id} />

          {full?.can_edit && (
            <section aria-labelledby="edit-service-heading" className="border-theme-surface-border border-t pt-4">
              <h2 id="edit-service-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
                Edit service
              </h2>
              {editingPeriods ? (
                <ServicePeriodsEditor
                  person={full}
                  titles={titles}
                  onTitleAdded={(title) => setTitles((current) => [...current, title])}
                  onSaved={() => {
                    setEditingPeriods(false);
                    void load();
                  }}
                  onCancel={() => setEditingPeriods(false)}
                />
              ) : (
                <button
                  type="button"
                  className="btn-secondary btn-sm rounded-md"
                  onClick={() => setEditingPeriods(true)}
                >
                  Edit periods of service and titles
                </button>
              )}
            </section>
          )}

          {full?.can_edit && (
            <section aria-labelledby="edit-family-heading" className="border-theme-surface-border border-t pt-4">
              <h2 id="edit-family-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
                Family links
              </h2>
              <RelationsEditor person={full} onChanged={() => void load()} />
            </section>
          )}
        </div>

        {full && (
          <aside className="space-y-4">
            <section aria-labelledby="research-heading" className="card p-4">
              <h2 id="research-heading" className="text-theme-text-primary mb-2 font-semibold">
                Historian only
              </h2>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-theme-text-secondary">Born</dt>
                  <dd className="text-theme-text-primary">
                    {formatPartialDate(full.birth_date, full.birth_date_precision, full.birth_date_circa) || '—'}
                  </dd>
                </div>
                {full.linked_member_name && (
                  <div>
                    <dt className="text-theme-text-secondary">Linked account</dt>
                    <dd className="text-theme-text-primary">{full.linked_member_name}</dd>
                  </div>
                )}
                {full.addresses && (
                  <div>
                    <dt className="text-theme-text-secondary">Addresses</dt>
                    <dd className="text-theme-text-primary whitespace-pre-wrap">{full.addresses}</dd>
                  </div>
                )}
                {full.verification_sources && (
                  <div>
                    <dt className="text-theme-text-secondary">Verified from</dt>
                    <dd className="text-theme-text-primary whitespace-pre-wrap">{full.verification_sources}</dd>
                  </div>
                )}
                {full.research_notes && (
                  <div>
                    <dt className="text-theme-text-secondary">Research notes</dt>
                    <dd className="text-theme-text-primary whitespace-pre-wrap">{full.research_notes}</dd>
                  </div>
                )}
                {full.is_memorial && (
                  <div>
                    <dt className="text-theme-text-secondary">Memorial details shown to</dt>
                    <dd className="text-theme-text-primary">
                      Date: {FIELD_VISIBILITY_LABELS[full.death_date_visibility]} · Circumstances:{' '}
                      {FIELD_VISIBILITY_LABELS[full.death_circumstances_visibility]} · Resting place:{' '}
                      {FIELD_VISIBILITY_LABELS[full.burial_location_visibility]}
                    </dd>
                  </div>
                )}
              </dl>
            </section>

            <section aria-labelledby="publish-heading" className="card space-y-3 p-4">
              <h2 id="publish-heading" className="text-theme-text-primary font-semibold">
                Publication
              </h2>
              {latest && <ClearanceSteps request={latest} />}
              {latest?.can_decide && (
                <Link to={`/history/clearance/${latest.id}`} className="btn-info btn-sm inline-block rounded-md">
                  Review this record
                </Link>
              )}
              {full.can_edit && full.clearance_required && !pendingReview && (
                <div className="flex flex-wrap gap-2">
                  {!clearedForPublic && (
                    <button
                      type="button"
                      disabled={busy}
                      className="btn-secondary btn-sm rounded-md"
                      onClick={() =>
                        void run(
                          () => historyService.submitForClearance(full.id, 'public'),
                          'Submitted for clearance',
                          'Could not submit this record'
                        )
                      }
                    >
                      Submit for public clearance
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    className="btn-secondary btn-sm rounded-md"
                    onClick={() =>
                      void run(
                        () => historyService.submitForClearance(full.id, 'review'),
                        'Sent for review',
                        'Could not submit this record'
                      )
                    }
                  >
                    Ask for a review
                  </button>
                </div>
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
                          () => historyService.publish(full.id, 'members'),
                          'Published to members',
                          'Could not publish this record'
                        )
                      }
                    >
                      Publish to members
                    </button>
                  )}
                  {(full.publication_level !== 'public' || full.public_changes_pending) && (
                    <button
                      type="button"
                      disabled={busy || !clearedForPublic}
                      className="btn-primary btn-sm rounded-md"
                      title={clearedForPublic ? undefined : 'Clear this record through the clearance list first'}
                      onClick={() =>
                        void run(
                          () => historyService.publish(full.id, 'public'),
                          'Published to the public',
                          'Could not publish this record'
                        )
                      }
                    >
                      {full.public_changes_pending ? 'Publish changes to the public' : 'Publish to the public'}
                    </button>
                  )}
                  {full.publication_level !== 'draft' && (
                    <button
                      type="button"
                      disabled={busy}
                      className="btn-secondary btn-sm rounded-md"
                      onClick={() =>
                        void run(
                          () =>
                            historyService.unpublish(
                              full.id,
                              full.publication_level === 'public' ? 'members' : 'draft'
                            ),
                          'Unpublished',
                          'Could not unpublish this record'
                        )
                      }
                    >
                      {full.publication_level === 'public' ? 'Members only' : 'Return to draft'}
                    </button>
                  )}
                </div>
              )}
              <p className="text-theme-text-secondary text-xs">
                Public records go live on the department&rsquo;s website when the public feed is turned on. It is not
                connected yet.
              </p>
            </section>

            <section aria-labelledby="history-heading" className="card p-4">
              <h2 id="history-heading" className="text-theme-text-primary mb-2 font-semibold">
                Change history
              </h2>
              <RevisionList personId={full.id} refreshKey={revisionKey} />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
};

export default HistoryPersonPage;
