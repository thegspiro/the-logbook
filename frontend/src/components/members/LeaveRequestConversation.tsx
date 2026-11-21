/**
 * The conversation on a leave request: what the request extends, any changed
 * dates waiting on the member, the questions and answers, and the controls to
 * ask, answer, propose or respond.
 *
 * The server decides who may do what (`can_ask`, `can_answer`,
 * `can_respond_to_changes`); nothing here works out who is an approver
 * (CLAUDE.md pitfall #29). The questions and answers are shown to the member
 * and their approvers only, and are never emailed.
 */

import React, { useState } from 'react';
import { formatCalendarDate } from '../../utils/dateFormatting';
import type { LeaveDates, LeaveRequest, LeaveRequestMessage } from '../../types/leaveRequest';

const leaveDates = (d: LeaveDates): string =>
  `${formatCalendarDate(d.start_date)} – ${d.end_date ? formatCalendarDate(d.end_date) : 'no end date'}`;

const MESSAGE_LABELS: Record<LeaveRequestMessage['kind'], string> = {
  question: 'asked',
  answer: 'answered',
  proposal: 'proposed changed dates',
  proposal_accepted: 'accepted the changed dates',
  proposal_declined: 'declined the changed dates',
};

/** What the request extends, what waits on the member, and the thread. */
export const LeaveRequestDetails: React.FC<{ request: LeaveRequest; audience: 'member' | 'approver' }> = ({
  request,
  audience,
}) => {
  const messages = request.messages ?? [];
  return (
    <div className="mt-2 space-y-2 text-sm">
      {request.extends_leave && (
        <p className="text-theme-text-secondary">
          {audience === 'member' ? 'Extends your leave' : 'Extends their leave'} of {leaveDates(request.extends_leave)}.
        </p>
      )}
      {request.awaiting === 'answer' && (
        <p className="font-medium text-amber-800 dark:text-amber-300">
          {audience === 'member'
            ? 'An approver asked you a question. Voting waits for your answer.'
            : 'Waiting on the member to answer a question. Voting resumes once they do.'}
        </p>
      )}
      {request.awaiting === 'proposal' && request.proposal && (
        <p className="font-medium text-amber-800 dark:text-amber-300">
          {request.proposal.proposed_by_name} would approve {leaveDates(request.proposal)} instead.{' '}
          {audience === 'member'
            ? 'Accept or decline these dates. Voting waits for your answer.'
            : 'Waiting on the member to accept or decline.'}
        </p>
      )}
      {messages.length > 0 && (
        <ol className="border-theme-surface-border space-y-1 border-l-2 pl-3 text-xs" aria-label="Conversation">
          {messages.map((m, i) => (
            <li key={`${m.kind}-${i}`} className="text-theme-text-secondary">
              <span className="font-medium">{m.author_name}</span> {MESSAGE_LABELS[m.kind]}
              {m.body ? (
                <>
                  : <span className="whitespace-pre-line">&ldquo;{m.body}&rdquo;</span>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

interface ApproverActionsProps {
  request: LeaveRequest;
  busy: boolean;
  onAsk: (text: string) => Promise<boolean>;
  onPropose: (start: string, end: string | null, note: string) => Promise<boolean>;
}

/** Ask the member a question, or approve with changed dates. */
export const LeaveApproverActions: React.FC<ApproverActionsProps> = ({ request, busy, onAsk, onPropose }) => {
  const [mode, setMode] = useState<'none' | 'ask' | 'change'>('none');
  const [question, setQuestion] = useState('');
  const [start, setStart] = useState(request.start_date);
  const [end, setEnd] = useState(request.end_date ?? '');
  const [openEnded, setOpenEnded] = useState(request.end_date === null);
  const [note, setNote] = useState('');
  const id = request.id;

  if (!request.can_ask) return null;

  if (mode === 'ask') {
    return (
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onAsk(question).then((ok) => {
            if (ok) {
              setQuestion('');
              setMode('none');
            }
          });
        }}
      >
        <label className="form-label" htmlFor={`question-${id}`}>
          Your question to the member
        </label>
        <textarea
          id={`question-${id}`}
          className="form-input"
          rows={2}
          maxLength={2000}
          required
          aria-describedby={`question-help-${id}`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <p id={`question-help-${id}`} className="text-theme-text-muted text-xs">
          Voting pauses until they answer. The question is not emailed; they read it here.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={busy || !question.trim()}>
            Send question
          </button>
          <button type="button" className="btn-secondary" onClick={() => setMode('none')}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  if (mode === 'change') {
    return (
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onPropose(start, openEnded ? null : end, note).then((ok) => {
            if (ok) setMode('none');
          });
        }}
      >
        <p className="text-theme-text-secondary text-xs">
          The member accepts or declines these dates. If they accept, voting starts again on them with your approval
          counted.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label" htmlFor={`change-start-${id}`}>
              First day
            </label>
            <input
              id={`change-start-${id}`}
              type="date"
              className="form-input"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          {!openEnded && (
            <div>
              <label className="form-label" htmlFor={`change-end-${id}`}>
                Last day
              </label>
              <input
                id={`change-end-${id}`}
                type="date"
                className="form-input"
                required
                min={start || undefined}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={openEnded}
            onChange={(e) => setOpenEnded(e.target.checked)}
          />
          No end date
        </label>
        <label className="form-label" htmlFor={`change-note-${id}`}>
          Note to the member (optional)
        </label>
        <textarea
          id={`change-note-${id}`}
          className="form-input"
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={busy || !start || (!openEnded && !end)}>
            Send changed dates
          </button>
          <button type="button" className="btn-secondary" onClick={() => setMode('none')}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => setMode('ask')}>
        Ask a question
      </button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => setMode('change')}>
        Approve with changes
      </button>
    </div>
  );
};

interface MemberActionsProps {
  request: LeaveRequest;
  busy: boolean;
  onAnswer: (text: string) => Promise<boolean>;
  onRespond: (accept: boolean) => Promise<boolean>;
}

/** Answer an approver's question, or accept or decline changed dates. */
export const LeaveMemberActions: React.FC<MemberActionsProps> = ({ request, busy, onAnswer, onRespond }) => {
  const [answer, setAnswer] = useState('');
  const id = request.id;

  if (request.can_answer) {
    return (
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onAnswer(answer).then((ok) => {
            if (ok) setAnswer('');
          });
        }}
      >
        <label className="form-label" htmlFor={`answer-${id}`}>
          Your answer
        </label>
        <textarea
          id={`answer-${id}`}
          className="form-input"
          rows={2}
          maxLength={2000}
          required
          aria-describedby={`answer-help-${id}`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
        <p id={`answer-help-${id}`} className="text-theme-text-muted text-xs">
          Only your approvers read this, after signing in. It is never emailed.
        </p>
        <button type="submit" className="btn-primary" disabled={busy || !answer.trim()}>
          Send answer
        </button>
      </form>
    );
  }

  if (request.can_respond_to_changes) {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void onRespond(true)}>
          Accept these dates
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void onRespond(false)}>
          Keep my dates
        </button>
      </div>
    );
  }

  return null;
};
