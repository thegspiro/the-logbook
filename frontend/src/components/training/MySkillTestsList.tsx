/**
 * My Skill Tests List
 *
 * The member's own skills-test results, shown on My Training. Covers both
 * official results and practice attempts, including ones still awaiting a
 * training officer's validation — those are listed without their outcome,
 * because until an officer signs a member-run evaluation off, nobody has
 * decided that its result stands.
 *
 * Fetched through the service rather than the shared skills-testing store: that
 * store's `tests` array backs the officer records tab, and an officer viewing
 * their own training page would otherwise overwrite the org-wide list with
 * their personal one.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight, ClipboardCheck } from 'lucide-react';

import { skillsTestingService } from '../../services/api';
import type { SkillTestListItem } from '../../types/skillsTesting';
import { formatDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { getErrorMessage } from '../../utils/errorHandling';
import { Skeleton } from '../ux/Skeleton';

interface MySkillTestsListProps {
  /** The viewing member's user id — scopes the list to tests they took. */
  userId: string;
}

export const MySkillTestsList: React.FC<MySkillTestsListProps> = ({ userId }) => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [tests, setTests] = useState<SkillTestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // candidate_id is required, not merely an optimization: for a user who
      // holds training.manage the list endpoint returns the whole org, so
      // without it an officer would see every member's results here.
      const data = await skillsTestingService.getTests({
        candidate_id: userId,
        include_practice: true,
      });
      setTests(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load your skills tests'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (tests.length === 0) {
    // The API omits tests whose results the department does not disclose, so
    // an empty list does not always mean "none taken" — say so without
    // implying a result is being kept from them, which may not be the case.
    return (
      <p className="text-theme-text-muted text-sm">
        No skills-test results to show. Results your department doesn&apos;t share won&apos;t appear here — ask a
        training officer if you&apos;re expecting one.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {tests.map((test) => {
        const isVoided = test.status === 'voided';
        const isPending = !!test.pending_validation;
        // A pending test is "completed" in status but has no outcome to show:
        // the API withholds the score and reports the result as incomplete, so
        // treating it as scored here would render every one of them as Failed.
        const isComplete = test.status === 'completed' && !isPending;
        return (
          <button
            key={test.id}
            onClick={() => void navigate(`/training/my-skill-tests/${test.id}`)}
            className="bg-theme-surface hover:bg-theme-surface-hover mobile-touch-target flex w-full items-center justify-between rounded-lg p-3 text-left transition-colors"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-theme-text-primary truncate text-sm font-medium">{test.template_name}</p>
                {test.is_practice && (
                  <span className="badge bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                    Practice
                  </span>
                )}
                {isVoided && (
                  <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                    Voided
                  </span>
                )}
                {isPending && (
                  <span className="badge bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">
                    Awaiting validation
                  </span>
                )}
              </div>
              <p className="text-theme-text-muted text-xs">
                Examiner: {test.examiner_name} · {formatDate(test.completed_at ?? test.created_at, tz)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pl-3">
              <div className="text-right">
                {isComplete ? (
                  <p
                    className={`text-sm font-semibold ${
                      test.result === 'pass' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {test.result === 'pass' ? 'Passed' : 'Failed'}
                  </p>
                ) : (
                  <p className="text-theme-text-muted text-sm">
                    {isVoided ? 'Withdrawn' : isPending ? 'Under review' : 'In progress'}
                  </p>
                )}
                {test.overall_score != null && isComplete && (
                  <p className="text-theme-text-muted text-xs">{Math.round(test.overall_score)}%</p>
                )}
              </div>
              <ChevronRight className="text-theme-text-muted h-4 w-4" />
            </div>
          </button>
        );
      })}
    </div>
  );
};

export const MySkillTestsIcon = ClipboardCheck;

export default MySkillTestsList;
