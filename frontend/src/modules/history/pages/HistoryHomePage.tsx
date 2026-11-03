/**
 * History home: what is waiting on the caller, the latest records, and the
 * way into the roster, the Honor Roll and the module's settings.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { BookOpen, ClipboardCheck, Landmark, Medal, Settings, Users } from 'lucide-react';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import { PublicationBadge } from '../components/PublicationBadge';
import type { ClearanceRequest, HistoricalMemberSummary } from '../types';

export const HistoryHomePage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('history.manage');
  const canConfigure = canManage || checkPermission('settings.manage');
  const [queue, setQueue] = useState<ClearanceRequest[]>([]);
  const [recent, setRecent] = useState<HistoricalMemberSummary[]>([]);
  const [drafts, setDrafts] = useState<HistoricalMemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [waiting, people, draftList] = await Promise.all([
          historyService.clearanceQueue(),
          historyService.listPeople({ limit: 8 }),
          canManage ? historyService.listPeople({ level: 'draft', limit: 8 }) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setQueue(waiting);
        setRecent(people.items.filter((p) => p.publication_level !== 'draft'));
        setDrafts(draftList ? draftList.items : []);
      } catch (err: unknown) {
        if (!cancelled) setError(getErrorMessage(err, 'Unable to load the department history.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  if (loading) return <SkeletonPage />;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'History' }]} />
      <div className="page-header mb-4 gap-3 sm:items-center">
        <h1 className="page-header-title text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <Landmark className="h-6 w-6 shrink-0" aria-hidden="true" />
          Department History
        </h1>
      </div>

      {error && (
        <div role="alert" className="alert-danger mb-4 rounded-md p-3 text-sm">
          {error}
        </div>
      )}

      <nav aria-label="History sections" className="mb-6 grid gap-3 sm:grid-cols-3">
        <Link to="/history/people" className="card card-hover flex items-center gap-3 p-4">
          <Users className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="text-theme-text-primary font-medium">Past members</span>
        </Link>
        <Link to="/history/honor-roll" className="card card-hover flex items-center gap-3 p-4">
          <Medal className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="text-theme-text-primary font-medium">Honor Roll</span>
        </Link>
        {canConfigure && (
          <Link to="/history/settings" className="card card-hover flex items-center gap-3 p-4">
            <Settings className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="text-theme-text-primary font-medium">Titles and clearance</span>
          </Link>
        )}
      </nav>

      {queue.length > 0 && (
        <section aria-labelledby="awaiting-heading" className="card mb-6 p-4">
          <h2
            id="awaiting-heading"
            className="text-theme-text-primary mb-3 flex items-center gap-2 text-lg font-semibold"
          >
            <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
            Awaiting my clearance
          </h2>
          <ul className="divide-theme-surface-border divide-y">
            {queue.map((request) => (
              <li key={request.id} className="py-2">
                <Link
                  to={`/history/clearance/${request.id}`}
                  className="touch-target-phone link-underline inline-flex items-center font-medium"
                >
                  {request.record_label}
                </Link>
                <span className="text-theme-text-secondary ml-2 text-sm">
                  {request.steps[request.current_step_index]?.name ?? ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage && drafts.length > 0 && (
        <section aria-labelledby="drafts-heading" className="card mb-6 p-4">
          <h2 id="drafts-heading" className="text-theme-text-primary mb-3 text-lg font-semibold">
            Drafts
          </h2>
          <PersonList people={drafts} />
        </section>
      )}

      <section aria-labelledby="recent-heading" className="card p-4">
        <h2 id="recent-heading" className="text-theme-text-primary mb-3 flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="h-5 w-5" aria-hidden="true" />
          From the archive
        </h2>
        {recent.length === 0 ? (
          <p className="text-theme-text-secondary text-sm">Nothing has been published yet.</p>
        ) : (
          <PersonList people={recent} />
        )}
      </section>
    </div>
  );
};

const PersonList: React.FC<{ people: HistoricalMemberSummary[] }> = ({ people }) => (
  <ul className="divide-theme-surface-border divide-y">
    {people.map((person) => (
      <li key={person.id} className="flex flex-wrap items-center gap-2 py-2">
        <Link
          to={`/history/people/${person.id}`}
          className="touch-target-phone link-underline inline-flex items-center font-medium"
        >
          {person.display_name}
        </Link>
        {person.service_years && <span className="text-theme-text-secondary text-sm">{person.service_years}</span>}
        <PublicationBadge level={person.publication_level} />
      </li>
    ))}
  </ul>
);

export default HistoryHomePage;
