/**
 * Preceptor Shift Evaluation Page (Public)
 *
 * What an outside agency's preceptor opens from the QR code a member shows
 * them, or the link they were emailed: one member's evaluation for one shift
 * on the agency's unit, with no sign-in. It shows the member's name, the
 * shift's date and unit and the form, and submits once. The link is closed
 * after that, after its window passes, or when a new one replaces it.
 *
 * URL: /shift-evaluation/:token
 */

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { AlertTriangle, CheckCircle2, Loader2, Send } from 'lucide-react';

import { ShiftEvaluationFields } from '../components/training/ShiftEvaluationFields';
import { useTimezone } from '../hooks/useTimezone';
import { publicShiftEvaluationService } from '../services/publicShiftEvaluationService';
import type { PublicShiftEvaluationView } from '../types/training';
import { formatCalendarDate, formatDateTime, formatTime } from '../utils/dateFormatting';
import { getErrorMessage, toAppError } from '../utils/errorHandling';
import { shiftEvaluationBody, shiftEvaluationProblems, type ShiftEvaluationDraft } from '../utils/shiftEvaluations';

type PageState = 'loading' | 'ready' | 'not_found' | 'unavailable' | 'submitted';

const emptyDraft: ShiftEvaluationDraft = { header_values: {}, statistics: {}, responses: {}, closing_comments: '' };

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <main
    id="main-content"
    className="from-theme-bg-from via-theme-bg-via to-theme-bg-to min-h-screen bg-linear-to-br px-4 py-8 sm:py-12"
  >
    <div className="mx-auto max-w-3xl space-y-4">{children}</div>
  </main>
);

const PreceptorShiftEvaluationPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const tz = useTimezone();
  const [state, setState] = useState<PageState>('loading');
  const [view, setView] = useState<PublicShiftEvaluationView | null>(null);
  const [draft, setDraft] = useState<ShiftEvaluationDraft>(emptyDraft);
  const [preceptorName, setPreceptorName] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState('not_found');
      return;
    }
    let cancelled = false;
    publicShiftEvaluationService
      .get(token)
      .then((loaded) => {
        if (cancelled) return;
        setView(loaded);
        setState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = toAppError(err).status;
        if (status === 409) setState('submitted');
        else if (status === 404 || status === 422) setState('not_found');
        else setState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const problems = (): string[] => {
    if (!view) return [];
    const formProblems = shiftEvaluationProblems(view.template, draft);
    return preceptorName.trim() ? formProblems : ['Enter your name.', ...formProblems];
  };

  const submit = async () => {
    const outstanding = problems();
    if (outstanding.length > 0) {
      setShowErrors(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await publicShiftEvaluationService.submit(token, shiftEvaluationBody(draft, true, null, preceptorName));
      setState('submitted');
    } catch (err: unknown) {
      const status = toAppError(err).status;
      if (status === 409) setState('submitted');
      else if (status === 404) setState('not_found');
      else setSubmitError(getErrorMessage(err, 'The evaluation could not be submitted. Try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'loading') {
    return (
      <Shell>
        <div className="flex justify-center py-16" aria-busy="true">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-label="Loading evaluation" />
        </div>
      </Shell>
    );
  }

  if (state === 'submitted') {
    return (
      <Shell>
        <div className="card space-y-2 p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-700 dark:text-green-400" aria-hidden="true" />
          <h1 className="text-theme-text-primary text-xl font-bold">Evaluation submitted</h1>
          <p className="text-theme-text-secondary">Thank you. You can close this page.</p>
        </div>
      </Shell>
    );
  }

  if (state !== 'ready' || !view) {
    return (
      <Shell>
        <div className="card space-y-2 p-6 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          <h1 className="text-theme-text-primary text-xl font-bold">
            {state === 'not_found' ? 'This link is not available' : 'Something went wrong'}
          </h1>
          <p className="text-theme-text-secondary">
            {state === 'not_found'
              ? 'It may have expired or been replaced. Ask the member for a new link.'
              : 'The evaluation could not be opened. Try again in a moment.'}
          </p>
        </div>
      </Shell>
    );
  }

  const outstanding = showErrors ? problems() : [];
  const times =
    view.shift_start && view.shift_end
      ? ` · ${formatTime(view.shift_start, tz)}–${formatTime(view.shift_end, tz)}`
      : '';

  return (
    <Shell>
      <header className="card space-y-1 p-4">
        <p className="text-theme-text-muted text-sm">{view.organization_name}</p>
        <h1 className="text-theme-text-primary text-xl font-bold">
          {view.template.name} — {view.member_name}
        </h1>
        <p className="text-theme-text-secondary text-sm">
          {formatCalendarDate(view.shift_date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          {times}
          {view.unit_label && ` · ${view.unit_label}`}
        </p>
        <p className="text-theme-text-muted text-xs">
          Submit it once. This link works until {formatDateTime(view.expires_at, tz)}.
        </p>
      </header>

      <div className="card p-4">
        <label htmlFor="pse-preceptor" className="form-label">
          Your name{' '}
          <span aria-hidden="true" className="text-red-700 dark:text-red-400">
            *
          </span>
        </label>
        <input
          id="pse-preceptor"
          className="form-input"
          value={preceptorName}
          maxLength={200}
          autoComplete="name"
          aria-required="true"
          onChange={(e) => setPreceptorName(e.target.value)}
        />
      </div>

      {outstanding.length > 0 && (
        <div role="alert" className="alert-danger text-theme-alert-danger-text text-sm">
          <p className="font-semibold">Before submitting:</p>
          <ul className="ml-5 list-disc">
            {outstanding.slice(0, 8).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <ShiftEvaluationFields form={view.template} draft={draft} onChange={setDraft} showErrors={showErrors} />

      {submitError && (
        <p role="alert" className="alert-danger text-theme-alert-danger-text text-sm">
          {submitError}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-1"
          disabled={submitting}
          onClick={() => void submit()}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Submit evaluation
        </button>
      </div>
    </Shell>
  );
};

export default PreceptorShiftEvaluationPage;
