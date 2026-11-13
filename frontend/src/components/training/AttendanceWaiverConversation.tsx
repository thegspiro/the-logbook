/**
 * A decider's questions on a waiver request and the member's answers.
 *
 * `AttendanceWaiverConversation` lists every round from the decision log, so
 * an earlier answer stays readable after the next question is asked.
 * `AttendanceWaiverAnswerForm` is the member's reply to the open question.
 * Whether a question is open, and whether the viewer may answer it, are the
 * server's `info_requested_at` and `can_respond` (CLAUDE.md pitfall #29).
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { attendanceWaiverService } from '../../services/attendanceWaiverService';
import { FormField } from '../ux';
import type { AttendanceWaiverActionEntry, AttendanceWaiverRequest } from '../../types/attendanceWaiver';
import { formatDateTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { WAIVER_TEXT_MAX_LENGTH, openQuestion, waiverConversation } from '../../utils/attendanceWaivers';

interface ConversationProps {
  actions: readonly AttendanceWaiverActionEntry[];
  timezone: string;
}

export const AttendanceWaiverConversation: React.FC<ConversationProps> = ({ actions, timezone }) => {
  const entries = waiverConversation(actions);
  if (entries.length === 0) return null;
  return (
    <ol className="space-y-3" aria-label="Questions and answers">
      {entries.map((entry) => {
        const asked = entry.action === 'info_requested';
        return (
          <li
            key={entry.id}
            className={`rounded-lg border p-3 text-sm ${
              asked ? 'border-theme-surface-border' : 'border-theme-surface-border bg-theme-surface-secondary ml-4'
            }`}
          >
            <p className="text-theme-text-secondary text-xs">
              {asked ? 'Question' : 'Answer'}
              {entry.actor_name ? ` from ${entry.actor_name}` : ''} · {formatDateTime(entry.created_at, timezone)}
            </p>
            {entry.note && <p className="text-theme-text-primary mt-1 break-words whitespace-pre-line">{entry.note}</p>}
          </li>
        );
      })}
    </ol>
  );
};

interface AnswerFormProps {
  request: AttendanceWaiverRequest;
  onAnswered: (updated: AttendanceWaiverRequest) => void;
  /** Called after a refusal: the request may have moved on under the member. */
  onRefused?: () => void;
}

export const AttendanceWaiverAnswerForm: React.FC<AnswerFormProps> = ({ request, onAnswered, onRefused }) => {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const question = openQuestion(request);
  const fieldId = `waiver-answer-${request.id}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = answer.trim();
    if (!trimmed) {
      setError('Write your answer.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const updated = await attendanceWaiverService.respond(request.id, trimmed);
      setAnswer('');
      toast.success('Answer sent');
      onAnswered(updated);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Your answer could not be sent. Try again.'));
      onRefused?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={(e) => void handleSubmit(e)} noValidate>
      <div className="alert-info rounded-lg p-3 text-sm" role="status">
        <p className="font-medium">
          {question?.actor_name ?? 'An officer'} asked for more information before deciding:
        </p>
        {question?.note && <p className="mt-1 break-words whitespace-pre-line">{question.note}</p>}
      </div>
      <FormField
        id={fieldId}
        label="Your answer"
        required
        error={error}
        maxLength={WAIVER_TEXT_MAX_LENGTH}
        count={answer.length}
        hint="Only you and the officers who decide your request can read it."
      >
        {(field) => (
          <textarea
            {...field}
            className="form-input"
            rows={3}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={busy}
          />
        )}
      </FormField>
      <button type="submit" disabled={busy} className="btn-primary text-sm font-medium disabled:opacity-50">
        {busy ? 'Sending...' : 'Send answer'}
      </button>
    </form>
  );
};
