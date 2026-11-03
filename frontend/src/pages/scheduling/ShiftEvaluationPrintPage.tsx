/**
 * Printable Shift Evaluation
 *
 * The evaluation laid out the way the department's paper form is, for a
 * member's file: shift details, statistics, the rating key, each section as a
 * bordered table, and the closing comments.
 *
 * URL: /scheduling/shift-evaluations/print?id=<evaluation_id>
 *
 * The server decides who may read it (training.manage, the evaluator, or the
 * member once it is visible to them) and answers anyone else with a 404.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import PrintPageStyles from '../../components/print/PrintPageStyles';
import { ShiftEvaluationView } from '../../components/training/ShiftEvaluationView';
import { useTimezone } from '../../hooks/useTimezone';
import { shiftEvaluationService } from '../../services/api';
import type { ShiftEvaluationDetail } from '../../types/training';
import { formatCalendarDate, formatDateCustom, formatTime } from '../../utils/dateFormatting';

/** Settle time for layout and webfonts before the print dialog opens. */
const PRINT_DELAY_MS = 600;

const ShiftEvaluationPrintPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const evaluationId = searchParams.get('id') || '';
  const tz = useTimezone();
  const [evaluation, setEvaluation] = useState<ShiftEvaluationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const printedRef = useRef(false);

  useEffect(() => {
    if (!evaluationId) {
      setError('No evaluation ID provided');
      setLoading(false);
      return;
    }
    shiftEvaluationService
      .get(evaluationId)
      .then(setEvaluation)
      .catch(() => setError('Failed to load the evaluation'))
      .finally(() => setLoading(false));
  }, [evaluationId]);

  useEffect(() => {
    if (!evaluation || printedRef.current) return;
    const timer = setTimeout(() => {
      printedRef.current = true;
      window.print();
    }, PRINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [evaluation]);

  // No landmark here: the route renders inside AppLayout's single <main>.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-700" role="status" aria-live="polite">
          Loading evaluation...
        </p>
      </div>
    );
  }

  if (error || !evaluation) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-red-700" role="alert">
          {error || 'Evaluation not found'}
        </p>
      </div>
    );
  }

  const start = evaluation.shift_start ? formatTime(evaluation.shift_start, tz) : '';
  const end = evaluation.shift_end ? formatTime(evaluation.shift_end, tz) : '';

  return (
    <>
      <PrintPageStyles margin="0.6in 0.75in" />
      <div data-page-main className="mx-auto max-w-[8.5in] bg-white p-6 text-black">
        <article aria-labelledby="shift-evaluation-title" className="space-y-4 text-sm">
          <header className="text-center">
            <h1 id="shift-evaluation-title" className="text-xl font-bold">
              {evaluation.template.name}
            </h1>
            {evaluation.program_names.length > 0 && <p>{evaluation.program_names.join(', ')}</p>}
          </header>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
            <div>
              <dt className="inline font-semibold">Member: </dt>
              <dd className="inline">{evaluation.member_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Shift date: </dt>
              <dd className="inline">{formatCalendarDate(evaluation.shift_date)}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Staffing time: </dt>
              <dd className="inline">{start ? `${start} – ${end}` : '—'}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Unit: </dt>
              <dd className="inline">{evaluation.unit_label ?? '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="inline font-semibold">Evaluated by: </dt>
              <dd className="inline">{evaluation.evaluator_name ?? 'A former member'}</dd>
            </div>
          </dl>

          <ShiftEvaluationView evaluation={evaluation} variant="print" />

          <footer className="border-t border-gray-500 pt-2 text-xs text-gray-700">
            {evaluation.status === 'submitted' && evaluation.submitted_at
              ? `Submitted ${formatDateCustom(evaluation.submitted_at, { month: 'short', day: 'numeric', year: 'numeric' }, tz)}`
              : 'Draft — not submitted'}{' '}
            · Printed from The Logbook
          </footer>
        </article>
      </div>
    </>
  );
};

export default ShiftEvaluationPrintPage;
