/**
 * The knowledge tests a member can sit, with their own latest result.
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BookOpenCheck, Clock, Loader2, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import { knowledgeTestService } from '../../services/knowledgeTestService';
import { EmptyState } from '../../components/ux/EmptyState';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import type { KnowledgeTest } from '../../types/knowledgeTest';

export const MyKnowledgeTestsPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [tests, setTests] = useState<KnowledgeTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setTests(await knowledgeTestService.list());
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load knowledge tests'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const start = async (test: KnowledgeTest) => {
    setStarting(test.id);
    try {
      const attempt = await knowledgeTestService.startAttempt(test.id);
      void navigate(`/training/knowledge-tests/attempts/${attempt.id}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not start the test'));
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-theme-text-primary text-xl font-semibold">Knowledge Tests</h1>
        <p className="text-theme-text-secondary text-sm">
          Written tests you can take here. They are graded as soon as you submit.
        </p>
      </div>
      {loading ? (
        <div className="flex h-32 items-center justify-center" role="status">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading</span>
        </div>
      ) : tests.length === 0 ? (
        <EmptyState
          icon={BookOpenCheck}
          title="No knowledge tests yet"
          description="Your training officer has not published any."
        />
      ) : (
        <ul className="card-grid">
          {tests.map((test) => {
            const latest = test.my_latest_attempt;
            const open = latest?.status === 'in_progress';
            return (
              <li key={test.id} className="card flex flex-col gap-2 p-4">
                <h2 className="text-theme-text-primary font-semibold">{test.name}</h2>
                {test.description && <p className="text-theme-text-secondary text-sm">{test.description}</p>}
                <p className="text-theme-text-secondary text-sm">
                  {test.active_question_count} question{test.active_question_count === 1 ? '' : 's'} · pass at{' '}
                  {test.effective_passing_score}%
                  {test.time_limit_minutes ? (
                    <>
                      {' · '}
                      <Clock className="inline h-3.5 w-3.5" aria-hidden="true" /> {test.time_limit_minutes} min
                    </>
                  ) : null}
                </p>
                {test.requirement_name && (
                  <p className="text-theme-text-muted text-xs">Counts toward: {test.requirement_name}</p>
                )}
                {latest && latest.status === 'submitted' && (
                  <p className="text-theme-text-secondary text-sm">
                    Last result: {latest.passed ? 'Passed' : 'Not passed'} ({latest.score ?? 0}%)
                    {latest.submitted_at ? ` on ${formatDate(latest.submitted_at, tz)}` : ''} ·{' '}
                    <Link className="underline" to={`/training/knowledge-tests/attempts/${latest.id}`}>
                      View
                    </Link>
                  </p>
                )}
                <div className="mt-auto pt-2">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={starting !== null}
                    onClick={() => void start(test)}
                  >
                    {starting === test.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Play className="h-4 w-4" aria-hidden="true" />
                    )}
                    {open ? 'Continue' : latest ? 'Take again' : 'Start'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default MyKnowledgeTestsPage;
