/**
 * Course Cohorts
 *
 * Lists every run of a multi-class course — "Recruit School — Fall 2026" and
 * its siblings — and launches the wizard that generates a new one.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { CalendarRange, GraduationCap, Plus, Users } from 'lucide-react';
import { courseCohortService } from '../../services/api';
import { CohortWizard } from '../../components/training/CohortWizard';
import { SkeletonCardGrid } from '../../components/ux/Skeleton';
import { EmptyState } from '../../components/ux/EmptyState';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate } from '../../utils/dateFormatting';
import { COHORT_STATUS_COLORS, COHORT_STATUS_LABELS } from '../../constants/enums';
import { getErrorMessage } from '../../utils/errorHandling';
import type { CourseCohort } from '../../types/training';

interface CohortsPageProps {
  embedded?: boolean;
}

export const CohortsPage: React.FC<CohortsPageProps> = ({
  embedded = false,
}) => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [cohorts, setCohorts] = useState<CourseCohort[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCohorts(await courseCohortService.getCohorts());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load cohorts'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (showWizard) {
    return (
      <div className={embedded ? '' : 'mx-auto max-w-4xl px-4 py-8'}>
        <h2 className="mb-6 text-xl font-semibold text-theme-text-primary">
          New cohort
        </h2>
        <CohortWizard
          onCancel={() => setShowWizard(false)}
          onComplete={(cohort) => {
            setShowWizard(false);
            void navigate(`/training/cohorts/${cohort.id}`);
          }}
        />
      </div>
    );
  }

  return (
    <div className={embedded ? '' : 'min-h-screen'}>
      <main
        className={embedded ? '' : 'mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8'}
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            {!embedded && (
              <h1 className="flex items-center gap-3 text-3xl font-bold text-theme-text-primary">
                <GraduationCap className="h-8 w-8 text-red-700 dark:text-red-500" />
                <span>Course Cohorts</span>
              </h1>
            )}
            <p className="text-sm text-theme-text-muted">
              Scheduled runs of your multi-class courses
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowWizard(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="h-5 w-5" />
            <span>New cohort</span>
          </button>
        </div>

        {loading ? (
          <SkeletonCardGrid count={3} />
        ) : cohorts.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title="No cohorts yet"
            description="A cohort is one run of a multi-class course. Build a course syllabus first, then generate a cohort to turn it into dated training events your members can sign in to."
            actions={[
              { label: 'New cohort', onClick: () => setShowWizard(true) },
            ]}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {cohorts.map((cohort) => (
              <button
                key={cohort.id}
                type="button"
                onClick={() => { void navigate(`/training/cohorts/${cohort.id}`); }}
                className="card-secondary p-5 text-left transition-colors hover:bg-theme-surface-hover"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-theme-text-primary">
                    {cohort.name}
                  </h3>
                  <span
                    className={`badge shrink-0 ${COHORT_STATUS_COLORS[cohort.status] ?? ''}`}
                  >
                    {COHORT_STATUS_LABELS[cohort.status] ?? cohort.status}
                  </span>
                </div>

                {cohort.course_name && (
                  <p className="mb-3 text-sm text-theme-text-muted">
                    {cohort.course_name}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-text-muted">
                  <span className="flex items-center gap-1">
                    <CalendarRange className="h-3 w-3" />
                    {formatDate(cohort.start_date, tz)}
                    {cohort.end_date
                      ? ` – ${formatDate(cohort.end_date, tz)}`
                      : ''}
                  </span>
                  <span>
                    {cohort.class_count} class
                    {cohort.class_count === 1 ? '' : 'es'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {cohort.member_count}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default CohortsPage;
