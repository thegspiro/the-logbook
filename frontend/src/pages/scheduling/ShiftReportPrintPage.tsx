/**
 * Printable Shift Completion Report
 *
 * Paper-formatted shift report designed for letter-size (8.5" x 11")
 * printing. Follows a structured form layout with clear sections,
 * signature lines, and department branding for compliance filing.
 *
 * URL: /scheduling/shift-reports/print?id=<report_id>
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { shiftCompletionService } from '../../services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate, formatDateCustom } from '../../utils/dateFormatting';
import { formatHours } from '../../utils/hoursFormatting';
import type { ShiftCompletionReport } from '../../types/training';
import {
  callTypesAreOrgSlugs,
  useCallTypeLabels,
  useCallTypeLabelsReady,
} from '../../modules/scheduling/hooks/useCallTypeLabels';
import PrintPageStyles from '../../components/print/PrintPageStyles';

/** Settle time for layout and webfonts before the print dialog opens. */
const PRINT_DELAY_MS = 600;
/** How long to wait on the call-type labels before printing without them. */
const LABEL_WAIT_MS = 3000;

const ShiftReportPrintPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const reportId = searchParams.get('id') || '';
  const tz = useTimezone();
  const callTypeLabel = useCallTypeLabels();
  const labelsReady = useCallTypeLabelsReady();
  const [report, setReport] = useState<ShiftCompletionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!reportId) {
      setError('No report ID provided');
      setLoading(false);
      return;
    }
    shiftCompletionService
      .getReport(reportId)
      .then(setReport)
      .catch(() => setError('Failed to load report'))
      .finally(() => setLoading(false));
  }, [reportId]);

  useEffect(() => {
    if (!report) return;
    // The call-type labels arrive on their own request, and printing before
    // they land commits raw slugs to paper — the one output a later re-render
    // cannot repair. So a report that shows call types waits for them.
    //
    // Bounded, though, and that is the important half: `loadSettings`
    // deliberately leaves `settingsLoaded` false when its request fails, so
    // waiting for the flag outright would mean a print view that never prints.
    // A slug on the page beats a blank stare at a dialog that never opens.
    const waitingOnLabels = callTypesAreOrgSlugs(report) && (report.call_types?.length ?? 0) > 0 && !labelsReady;
    const timer = setTimeout(() => window.print(), waitingOnLabels ? LABEL_WAIT_MS : PRINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [report, labelsReady]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500" role="status" aria-live="polite">
          Loading report...
        </p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-red-600" role="alert">
          {error || 'Report not found'}
        </p>
      </div>
    );
  }

  const dateStr = formatDateCustom(
    report.shift_date + 'T12:00:00',
    { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
    tz
  );

  const hasEvaluation =
    report.performance_rating ||
    report.areas_of_strength ||
    report.areas_for_improvement ||
    (report.skills_observed && report.skills_observed.length > 0);

  const filedDate = formatDateCustom(report.created_at, { month: 'short', day: 'numeric', year: 'numeric' }, tz);
  const reviewedDate = report.reviewed_at
    ? formatDateCustom(report.reviewed_at, { month: 'short', day: 'numeric', year: 'numeric' }, tz)
    : null;

  return (
    <>
      <PrintPageStyles margin="0.6in 0.75in" />

      <main className="shift-report-print-shell" id="main-content">
        <article className="shift-report-print" aria-labelledby="shift-report-title">
          <header className="shift-report-print__header">
            <div>
              <h1 id="shift-report-title">Shift Completion Report</h1>
              <p className="shift-report-print__subtitle">End-of-Shift Documentation</p>
            </div>
            <div className="shift-report-print__metadata">
              <p>Report ID: {report.id.slice(0, 8).toUpperCase()}</p>
              <p>Filed: {filedDate}</p>
              {report.review_status === 'approved' && <p className="shift-report-print__status--approved">Approved</p>}
              {report.review_status === 'flagged' && <p className="shift-report-print__status--flagged">Flagged</p>}
            </div>
          </header>

          <dl className="shift-report-print__facts">
            <div>
              <dt>Member</dt>
              <dd>{report.trainee_name || 'Unknown'}</dd>
            </div>
            <div>
              <dt>Shift Date</dt>
              <dd>{dateStr}</dd>
            </div>
            <div>
              <dt>Hours on Shift</dt>
              <dd>{formatHours(report.hours_on_shift)}</dd>
            </div>
            <div>
              <dt>Calls Responded</dt>
              <dd>{report.calls_responded}</dd>
            </div>
            {report.call_types && report.call_types.length > 0 && (
              <div className="shift-report-print__fact-wide">
                <dt>Call Types</dt>
                <dd>
                  {(callTypesAreOrgSlugs(report) ? report.call_types.map(callTypeLabel) : report.call_types).join(', ')}
                </dd>
              </div>
            )}
          </dl>

          {report.performance_rating && (
            <section className="shift-report-print__section" aria-labelledby="performance-rating-heading">
              <h2 id="performance-rating-heading">Performance Rating</h2>
              <p className="shift-report-print__rating">
                <strong>{report.performance_rating}</strong> / 5
              </p>
            </section>
          )}
          {report.areas_of_strength && (
            <section className="shift-report-print__section" aria-labelledby="strengths-heading">
              <h2 id="strengths-heading">Areas of Strength</h2>
              <p>{report.areas_of_strength}</p>
            </section>
          )}
          {report.areas_for_improvement && (
            <section className="shift-report-print__section" aria-labelledby="improvement-heading">
              <h2 id="improvement-heading">Areas for Improvement</h2>
              <p>{report.areas_for_improvement}</p>
            </section>
          )}
          {report.officer_narrative && (
            <section className="shift-report-print__section" aria-labelledby="narrative-heading">
              <h2 id="narrative-heading">Officer Narrative</h2>
              <p>{report.officer_narrative}</p>
            </section>
          )}

          {report.skills_observed && report.skills_observed.length > 0 && (
            <section className="shift-report-print__section" aria-labelledby="skills-heading">
              <h2 id="skills-heading">Skills Observed</h2>
              <div
                className="shift-report-print__table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Skills observed table"
              >
                <table>
                  <caption className="sr-only">Observed skills, scores, and comments</caption>
                  <thead>
                    <tr>
                      <th scope="col">Skill</th>
                      <th scope="col" className="shift-report-print__score">
                        Score
                      </th>
                      <th scope="col">Comments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.skills_observed.map((skill, i) => (
                      <tr key={i}>
                        <td>{skill.skill_name}</td>
                        <td className="shift-report-print__score">{skill.score ? `${skill.score}/5` : '—'}</td>
                        <td className="shift-report-print__muted">{skill.comment || skill.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {report.tasks_performed && report.tasks_performed.length > 0 && (
            <section className="shift-report-print__section" aria-labelledby="tasks-heading">
              <h2 id="tasks-heading">Tasks Performed</h2>
              <div
                className="shift-report-print__table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Tasks performed table"
              >
                <table>
                  <caption className="sr-only">Tasks performed and their descriptions</caption>
                  <thead>
                    <tr>
                      <th scope="col">Task</th>
                      <th scope="col">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.tasks_performed.map((task, i) => (
                      <tr key={i}>
                        <td>{task.task}</td>
                        <td className="shift-report-print__muted">{task.description || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="shift-report-print__signatures" aria-label="Signatures and review">
            <div className="shift-report-print__signature">
              <h2>Filing Officer</h2>
              <p>{report.officer_name || '—'}</p>
              <div className="shift-report-print__signature-line" />
              <span>Signature / Date</span>
            </div>
            {hasEvaluation && (
              <div className="shift-report-print__signature">
                <h2>{report.trainee_acknowledged ? 'Member Acknowledgment' : 'Member Acknowledgment (Pending)'}</h2>
                <p>
                  {report.trainee_acknowledged
                    ? `${report.trainee_name || '—'} — Acknowledged`
                    : report.trainee_name || '—'}
                </p>
                <div className="shift-report-print__signature-line" />
                <span>Signature / Date</span>
              </div>
            )}
            {report.reviewer_name && (
              <p className="shift-report-print__reviewer">
                <strong>Reviewed by:</strong> {report.reviewer_name}
                {reviewedDate && ` on ${reviewedDate}`}
              </p>
            )}
          </section>

          <footer className="shift-report-print__footer">
            <span>The Logbook — Shift Completion Report</span>
            <span>Generated {formatDate(new Date(), tz)}</span>
          </footer>
        </article>
      </main>
    </>
  );
};

export default ShiftReportPrintPage;
