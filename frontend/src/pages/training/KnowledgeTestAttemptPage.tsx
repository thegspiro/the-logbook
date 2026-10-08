/**
 * Sitting a knowledge test, and reading the result afterwards.
 *
 * The server drew this paper when the attempt started and keeps the answers
 * to itself until it is submitted; this page only ever sends which options
 * were picked. Answers save as they change, so a dropped connection or a
 * closed tab loses at most the last few seconds, and the timer shown is the
 * server's — the server grades what was saved when it runs out.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { knowledgeTestService } from '../../services/knowledgeTestService';
import { useConfirm } from '../../contexts/ConfirmContext';
import { getErrorMessage, toAppError } from '../../utils/errorHandling';
import type { KnowledgeAttempt, KnowledgeQuestionDelivered } from '../../types/knowledgeTest';

const SAVE_DEBOUNCE_MS = 800;

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const QuestionCard: React.FC<{
  index: number;
  question: KnowledgeQuestionDelivered;
  chosen: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}> = ({ index, question, chosen, disabled, onChange }) => {
  const multiple = question.question_type === 'multiple_choice';
  return (
    <fieldset className="card space-y-3 p-4">
      <legend className="text-theme-text-primary font-medium">
        <span className="text-theme-text-muted mr-2">{index + 1}.</span>
        {question.prompt}
      </legend>
      {multiple && <p className="text-theme-text-muted text-xs">Choose every answer that applies.</p>}
      <div className="space-y-1">
        {question.options.map((option) => {
          const checked = chosen.includes(option.id);
          return (
            <label
              key={option.id}
              className="text-theme-text-primary hover:bg-theme-surface-hover touch:min-h-11 flex items-center gap-3 rounded-md p-2"
            >
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={`q-${question.id}`}
                className="form-checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  if (!multiple) onChange([option.id]);
                  else onChange(checked ? chosen.filter((c) => c !== option.id) : [...chosen, option.id]);
                }}
              />
              {option.text}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};

const ResultView: React.FC<{ attempt: KnowledgeAttempt }> = ({ attempt }) => (
  <div className="space-y-4">
    <div className={`card p-4 ${attempt.passed ? 'alert-success' : 'alert-danger'}`} role="status">
      <div className="flex items-center gap-3">
        {attempt.passed ? (
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        ) : (
          <XCircle className="h-6 w-6" aria-hidden="true" />
        )}
        <div>
          <p className="text-lg font-semibold">
            {attempt.passed ? 'Passed' : 'Not passed'} — {attempt.score ?? 0}%
          </p>
          <p className="text-sm">
            {attempt.points_earned ?? 0} of {attempt.points_possible ?? 0} points. Passing is {attempt.passing_score}%.
          </p>
        </div>
      </div>
    </div>
    {attempt.credited ? (
      <p className="text-theme-text-secondary text-sm">This result was recorded on your training requirement.</p>
    ) : (
      attempt.credit_note && (
        <p className="text-theme-text-secondary text-sm">Not recorded on a requirement: {attempt.credit_note}.</p>
      )
    )}
    {attempt.review ? (
      <ol className="space-y-3">
        {attempt.review.map((q, i) => {
          const chosen = attempt.answers[q.id] ?? [];
          return (
            <li key={q.id} className="card space-y-2 p-4">
              <p className="text-theme-text-primary font-medium">
                <span className="text-theme-text-muted mr-2">{i + 1}.</span>
                {q.prompt}
              </p>
              <p
                className={`text-sm font-medium ${q.correct ? 'text-green-800 dark:text-white' : 'text-red-800 dark:text-white'}`}
              >
                {q.correct ? 'Correct' : 'Incorrect'}
              </p>
              <ul className="space-y-1 text-sm">
                {q.options.map((o) => (
                  <li key={o.id} className="text-theme-text-secondary">
                    {q.correct_option_ids.includes(o.id) ? '✓ ' : '• '}
                    {o.text}
                    {chosen.includes(o.id) && <span className="text-theme-text-muted"> (your answer)</span>}
                  </li>
                ))}
              </ul>
              {q.explanation && <p className="text-theme-text-secondary text-sm">{q.explanation}</p>}
            </li>
          );
        })}
      </ol>
    ) : (
      <p className="text-theme-text-muted text-sm">This test does not show the answers after submission.</p>
    )}
  </div>
);

export const KnowledgeTestAttemptPage: React.FC = () => {
  const { attemptId } = useParams<{ attemptId: string }>();
  const { confirm } = useConfirm();
  const [attempt, setAttempt] = useState<KnowledgeAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, string[]> | null>(null);

  const adopt = useCallback((next: KnowledgeAttempt) => {
    setAttempt(next);
    setAnswers(next.answers ?? {});
    setRemaining(next.seconds_remaining);
  }, []);

  useEffect(() => {
    if (!attemptId) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await knowledgeTestService.getAttempt(attemptId);
        if (!cancelled) adopt(loaded);
      } catch (err: unknown) {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load the test'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptId, adopt]);

  const open = attempt?.status === 'in_progress';

  const flush = useCallback(async () => {
    if (!attemptId || !pending.current) return;
    const toSend = pending.current;
    pending.current = null;
    setSaveState('saving');
    try {
      await knowledgeTestService.saveAnswers(attemptId, toSend);
      setSaveState('saved');
    } catch (err: unknown) {
      setSaveState('failed');
      // 409 means the attempt closed under us (time ran out); the server
      // graded what it had, so show that.
      if (toAppError(err).status === 409) {
        try {
          adopt(await knowledgeTestService.getAttempt(attemptId));
        } catch {
          // The banner below still says the save failed.
        }
        toast.error(getErrorMessage(err, 'This attempt is closed'));
      } else {
        pending.current = pending.current ?? toSend;
      }
    }
  }, [attemptId, adopt]);

  const choose = (questionId: string, ids: string[]) => {
    const next = { ...answers, [questionId]: ids };
    setAnswers(next);
    pending.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  };

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  // Count down locally between server reads; the server's clock decides.
  useEffect(() => {
    if (!open || remaining === null) return;
    if (remaining <= 0) {
      if (attemptId) {
        void knowledgeTestService
          .getAttempt(attemptId)
          .then(adopt)
          .catch(() => undefined);
      }
      return;
    }
    const timer = setTimeout(() => setRemaining((r) => (r === null ? r : r - 1)), 1000);
    return () => clearTimeout(timer);
  }, [open, remaining, attemptId, adopt]);

  const unanswered = (attempt?.questions ?? []).filter((q) => (answers[q.id] ?? []).length === 0).length;

  const submit = async () => {
    if (!attemptId) return;
    const ok = await confirm({
      title: 'Submit your answers?',
      message:
        unanswered > 0
          ? `${unanswered} question${unanswered === 1 ? ' is' : 's are'} unanswered and will be marked wrong. You cannot change your answers after submitting.`
          : 'You cannot change your answers after submitting.',
      confirmLabel: 'Submit',
      cancelLabel: 'Keep working',
      variant: unanswered > 0 ? 'warning' : 'info',
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await flush();
      adopt(await knowledgeTestService.submitAttempt(attemptId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to submit'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center" role="status">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading test</span>
      </div>
    );
  }
  if (error || !attempt) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <p className="alert-danger card p-4">{error ?? 'Test not found'}</p>
        <Link to="/training/knowledge-tests" className="btn-secondary">
          Back to knowledge tests
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link
        to="/training/knowledge-tests"
        className="text-theme-text-secondary touch:min-h-11 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Knowledge tests
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-theme-text-primary text-xl font-semibold">{attempt.test_name}</h1>
        {open && remaining !== null && (
          <span
            className="badge bg-theme-surface-secondary text-theme-text-primary gap-1"
            aria-live={remaining <= 60 ? 'assertive' : 'off'}
          >
            <Clock className="h-4 w-4" aria-hidden="true" />
            {formatClock(remaining)} left
          </span>
        )}
      </div>
      {open && attempt.instructions && <p className="text-theme-text-secondary text-sm">{attempt.instructions}</p>}

      {open ? (
        <>
          <ol className="space-y-3">
            {attempt.questions.map((q, i) => (
              <li key={q.id}>
                <QuestionCard
                  index={i}
                  question={q}
                  chosen={answers[q.id] ?? []}
                  disabled={submitting}
                  onChange={(ids) => choose(q.id, ids)}
                />
              </li>
            ))}
          </ol>
          <div className="action-bar-safe surface-opaque border-theme-surface-border sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t py-3">
            <span className="text-theme-text-muted text-sm" aria-live="polite">
              {
                {
                  idle: 'Answers save as you go',
                  saving: 'Saving…',
                  saved: 'Saved',
                  failed: 'Not saved — check your connection',
                }[saveState]
              }
            </span>
            <button type="button" className="btn-primary" disabled={submitting} onClick={() => void submit()}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Submit answers
            </button>
          </div>
        </>
      ) : (
        <ResultView attempt={attempt} />
      )}
    </div>
  );
};

export default KnowledgeTestAttemptPage;
