/**
 * Applicants an event brought in, on the event detail page.
 *
 * Guest sign-in at an event with `guest_check_in_creates_prospect` opens a
 * prospective member and links it back here; a pipeline meeting stage links
 * one too. Both wrote a row nobody could see from the event, so the question
 * a recruitment night actually raises — "did anyone come out of this?" — had
 * no answer short of opening the pipeline and reading referral sources.
 *
 * Applicant records are PII, so this renders only for callers who may read the
 * pipeline. Everyone else sees nothing, rather than a card that 403s.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { UserPlus, ArrowRight } from 'lucide-react';
import { applicantService } from '../../modules/prospective-members/services/api';
import type { ApplicantListItem } from '../../modules/prospective-members/types';
import { useAuthStore } from '../../stores/authStore';
import { formatDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';

interface EventProspectsCardProps {
  eventId: string;
  /**
   * Whether this event is configured to open applicants from guest sign-in.
   * An event that is but has produced nobody still shows the card, saying so —
   * that empty state is the useful answer on the morning after an open house,
   * and hiding it would read the same as the feature not existing.
   */
  createsProspects: boolean;
}

const MAX_LISTED = 10;

export const EventProspectsCard: React.FC<EventProspectsCardProps> = ({ eventId, createsProspects }) => {
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canViewProspects = checkPermission('prospective_members.view') || checkPermission('prospective_members.manage');
  const tz = useTimezone();

  const [applicants, setApplicants] = useState<ApplicantListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canViewProspects) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    applicantService
      .getApplicants({ filters: { event_id: eventId }, page: 1, pageSize: MAX_LISTED })
      .then((response) => {
        if (cancelled) return;
        setApplicants(response.items);
        setTotal(response.total);
      })
      .catch(() => {
        // Non-critical: the rest of the event page stands on its own.
        if (!cancelled) {
          setApplicants([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, canViewProspects]);

  if (!canViewProspects || loading) return null;
  if (total === 0 && !createsProspects) return null;

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-theme-text-primary flex items-center gap-2 text-lg font-bold">
          <UserPlus className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          <span>Prospective Members</span>
        </h2>
        {total > 0 && (
          <Link
            to={`/prospective-members?event=${eventId}`}
            className="flex items-center gap-1 text-sm font-medium text-red-700 hover:underline dark:text-red-400"
          >
            View in pipeline
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {total === 0 ? (
        <p className="text-theme-text-muted text-sm">
          Nobody has been added to the pipeline from this event yet. Guests who sign in with an email address will
          appear here.
        </p>
      ) : (
        <>
          <p className="text-theme-text-muted mb-3 text-sm">
            {total} {total === 1 ? 'applicant came' : 'applicants came'} from this event.
          </p>
          <ul className="divide-theme-surface-border divide-y">
            {applicants.map((applicant) => (
              <li key={applicant.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-theme-text-primary truncate text-sm font-medium">
                    {applicant.first_name} {applicant.last_name}
                  </p>
                  <p className="text-theme-text-muted truncate text-xs">{applicant.email}</p>
                </div>
                <div className="text-right">
                  <p className="text-theme-text-secondary text-xs">{applicant.current_stage_name ?? 'No stage'}</p>
                  <p className="text-theme-text-muted text-xs">Added {formatDate(applicant.created_at, tz)}</p>
                </div>
              </li>
            ))}
          </ul>
          {total > applicants.length && (
            <p className="text-theme-text-muted mt-3 text-xs">
              Showing {applicants.length} of {total}.
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default EventProspectsCard;
