/**
 * Printable Completed Scorecard
 *
 * A finished skills evaluation as a paper record: what was marked against each
 * step, the arithmetic behind the percentage, and who signed it off. The
 * counterpart to `SkillSheetPrintPage`, which prints the same sheet blank.
 *
 * It exists for the two places a screen cannot go — a candidate's paper
 * training file, and a state or ISO audit packet. Emailing results already
 * works (`/tests/{id}/email-results`); neither of those accepts an email.
 *
 * **Disclosure is enforced server-side, and this page must keep it that way.**
 * `GET /tests/{id}` runs the test → template → organization inheritance chain
 * and redacts what the reader may not see: an officer receives the full
 * scorecard, a candidate under `scores` disclosure receives per-criterion
 * marks with the examiner's notes stripped, and a result still awaiting
 * validation arrives with no outcome at all. This page renders exactly what
 * that response contained and derives nothing the API withheld — so printing
 * cannot become a way around the policy.
 *
 * URL: /training/skills-testing/print/scorecard?id=<test_id>
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { skillsTestingService } from '../../services/trainingServices';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate, formatDateTime } from '../../utils/dateFormatting';
import { hydrateTemplateSections } from '../../utils/skillTemplateSections';
import type { CriterionResult, SkillCriterion, SkillTest } from '../../types/skillsTesting';

const cellStyle: React.CSSProperties = {
  border: '1px solid #ccc',
  padding: '4pt 6pt',
  fontSize: '9pt',
  verticalAlign: 'top',
};

const headerCell: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  backgroundColor: '#f5f5f5',
  fontSize: '8pt',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const sectionHeading: React.CSSProperties = {
  fontSize: '11pt',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid #ddd',
  paddingBottom: '3pt',
  marginBottom: '6pt',
  marginTop: '16pt',
};

/** What the examiner recorded against one step, rendered per type.
 *
 *  Mirrors `iter_criterion_rows` on the backend: a statement is read aloud
 *  rather than judged, and a non-critical scored step shows its points rather
 *  than a verdict — it is stamped passed whatever number it carries, so
 *  printing "Pass" beside a 0 of 5 would be actively misleading. */
const RecordedMark: React.FC<{ criterion: SkillCriterion; result: CriterionResult | undefined }> = ({
  criterion,
  result,
}) => {
  if (criterion.type === 'statement') {
    return <span style={{ fontSize: '8pt', color: '#888' }}>read aloud</span>;
  }
  if (!result) {
    return <span style={{ fontSize: '8.5pt', color: '#b00' }}>not scored</span>;
  }

  if (criterion.type === 'score') {
    if (result.score == null) {
      return <span style={{ fontSize: '8.5pt', color: '#b00' }}>not scored</span>;
    }
    return (
      <span style={{ fontSize: '9pt', whiteSpace: 'nowrap' }}>
        {result.score}
        {criterion.max_score != null && ` / ${criterion.max_score}`}
      </span>
    );
  }

  if (criterion.type === 'time_limit' && result.time_seconds != null) {
    return (
      <span style={{ fontSize: '9pt', whiteSpace: 'nowrap' }}>
        {result.time_seconds}s{' '}
        <strong style={{ color: result.passed ? '#060' : '#b00' }}>{result.passed ? 'PASS' : 'FAIL'}</strong>
      </span>
    );
  }

  if (criterion.type === 'checklist' && result.checklist_completed) {
    const ticked = result.checklist_completed.filter(Boolean).length;
    return (
      <span style={{ fontSize: '9pt', whiteSpace: 'nowrap' }}>
        {ticked}/{result.checklist_completed.length}{' '}
        <strong style={{ color: result.passed ? '#060' : '#b00' }}>{result.passed ? 'PASS' : 'FAIL'}</strong>
      </span>
    );
  }

  if (result.passed == null) {
    return <span style={{ fontSize: '8.5pt', color: '#b00' }}>not scored</span>;
  }
  return (
    <strong style={{ fontSize: '9pt', color: result.passed ? '#060' : '#b00' }}>
      {result.passed ? 'PASS' : 'FAIL'}
    </strong>
  );
};

const SkillTestScorecardPrintPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const testId = searchParams.get('id') || '';
  const tz = useTimezone();

  const [test, setTest] = useState<SkillTest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!testId) {
      setError('No test ID provided');
      setLoading(false);
      return;
    }
    skillsTestingService
      .getTest(testId)
      .then(setTest)
      .catch(() => setError('Failed to load scorecard'))
      .finally(() => setLoading(false));
  }, [testId]);

  // A result nobody has signed off carries no outcome — the API withholds the
  // score and reports it as incomplete. Printing it would hand the candidate a
  // document that reads as a failure the officer never recorded, so the print
  // dialog is deliberately not opened for one.
  const pending = !!test?.pending_validation;

  useEffect(() => {
    if (loading || error || pending) return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [loading, error, pending]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading scorecard...</p>
      </div>
    );
  }
  if (error || !test) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-red-600">{error || 'Scorecard not found'}</p>
      </div>
    );
  }
  if (pending) {
    return (
      <div className="mx-auto mt-16 max-w-md px-6 text-center">
        <p className="text-theme-text-primary font-semibold">Not ready to print</p>
        <p className="text-theme-text-muted mt-2 text-sm">
          This result is still waiting for a training officer to sign it off. Until it is validated it credits nothing
          and has no outcome to record, so there is no scorecard to print yet.
        </p>
      </div>
    );
  }

  const sections = hydrateTemplateSections(test.template_sections as Record<string, unknown>[] | undefined);
  const breakdown = test.score_breakdown;
  const resultFor = (sectionId: string, criterion: SkillCriterion): CriterionResult | undefined => {
    const section = test.section_results?.find((s) => s.section_id === sectionId);
    return section?.criteria_results.find(
      (r) => r.criterion_id === criterion.id || r.criterion_label === criterion.label
    );
  };

  const outcome = test.result === 'pass' ? 'PASS' : test.result === 'fail' ? 'FAIL' : 'INCOMPLETE';
  const voided = test.status === 'voided';

  return (
    <>
      <style>{`
        @page { size: letter; margin: 0.5in 0.6in; }
        @media print { body { margin: 0; } }
        @media screen { body { background: #f3f4f6; } }
      `}</style>

      <div className="mx-auto my-8 max-w-[8.5in] bg-white shadow-lg print:my-0 print:shadow-none">
        <div
          className="p-8 print:p-0"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif', color: '#111', fontSize: '10pt', lineHeight: 1.5 }}
        >
          {/* Header */}
          <div style={{ borderBottom: '3px solid #111', paddingBottom: '10pt', marginBottom: '12pt' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ fontSize: '18pt', fontWeight: 'bold', margin: '0 0 2pt 0' }}>Skill Evaluation Record</h1>
                <p style={{ fontSize: '14pt', margin: 0 }}>{test.template_name}</p>
              </div>
              <div style={{ textAlign: 'right', fontSize: '9pt', color: '#666' }}>
                <p style={{ margin: 0 }}>Printed: {formatDate(new Date(), tz)}</p>
                <p style={{ margin: 0 }}>Record: {test.id}</p>
              </div>
            </div>
          </div>

          {/* A practice run is not part of anyone's training history, and a
              printed page outlives the screen that said so. */}
          {test.is_practice && (
            <div style={{ border: '1pt solid #333', padding: '5pt 8pt', marginBottom: '8pt', fontSize: '9pt' }}>
              <strong>Practice attempt — not an official record.</strong> This run was not recorded against the
              candidate, credits no requirement, and forms no part of their training history.
            </div>
          )}

          {voided && (
            <div
              style={{
                border: '2pt solid #b00',
                color: '#b00',
                padding: '5pt 8pt',
                marginBottom: '8pt',
                fontSize: '9pt',
              }}
            >
              <strong>VOIDED — this result was withdrawn and no longer counts.</strong>
              {test.void_reason && <div style={{ marginTop: '2pt' }}>Reason: {test.void_reason}</div>}
              {test.voided_by_name && test.voided_at && (
                <div>
                  Voided by {test.voided_by_name} on {formatDateTime(test.voided_at, tz)}
                </div>
              )}
            </div>
          )}

          {/* Who, when, and the verdict */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10pt' }}>
            <tbody>
              <tr>
                <td style={{ ...cellStyle, width: '50%' }}>
                  <strong>Candidate:</strong> {test.candidate_name || '—'}
                </td>
                <td style={cellStyle}>
                  <strong>Examiner:</strong> {test.examiner_name || '—'}
                </td>
              </tr>
              <tr>
                <td style={cellStyle}>
                  <strong>Completed:</strong> {test.completed_at ? formatDateTime(test.completed_at, tz) : '—'}
                </td>
                <td style={cellStyle}>
                  <strong>Elapsed:</strong>{' '}
                  {test.elapsed_seconds != null
                    ? `${Math.floor(test.elapsed_seconds / 60)}m ${test.elapsed_seconds % 60}s`
                    : '—'}
                  {/* A resumed test's clock carried on from the last save, so
                      the figure is not a stopwatch reading. Marked rather than
                      corrected: there is no honest way to reconstruct what the
                      stopwatch would have shown, and a corrected-looking number
                      is worse than one openly uncertain. */}
                  {test.timing_verified === false && (
                    <span style={{ color: '#b00', fontSize: '8pt' }}> — not verified</span>
                  )}
                </td>
              </tr>
              <tr>
                <td style={cellStyle}>
                  <strong>Result:</strong>{' '}
                  <strong style={{ color: outcome === 'PASS' ? '#060' : outcome === 'FAIL' ? '#b00' : '#666' }}>
                    {outcome}
                  </strong>
                </td>
                <td style={cellStyle}>
                  <strong>Score:</strong> {test.overall_score != null ? `${test.overall_score}%` : '—'}
                  {breakdown?.passing_percentage != null && (
                    <span style={{ color: '#666' }}> (pass mark {breakdown.passing_percentage}%)</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          {test.timing_verified === false && (
            <div
              style={{
                border: '1pt solid #333',
                padding: '5pt 8pt',
                marginBottom: '10pt',
                fontSize: '9pt',
                background: '#fafafa',
              }}
            >
              <strong>Timing not verified.</strong> Scoring was picked up again after the screen was left
              {test.resume_count && test.resume_count > 1 ? ` (${test.resume_count} times)` : ''}, so the clock carried
              on from the last save rather than running continuously. Treat the elapsed time as approximate — and, on a
              timed evolution, as not evidence of the time limit being met.
            </div>
          )}

          {/* The arithmetic, section by section. Printed from the server's own
              breakdown rather than recomputed, so the working on paper is the
              working that produced the number. */}
          {breakdown && breakdown.sections.length > 0 && (
            <div>
              <h2 style={sectionHeading}>Score Breakdown</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={headerCell}>Section</th>
                    <th style={{ ...headerCell, width: '60pt', textAlign: 'center' }}>Points</th>
                    <th style={{ ...headerCell, width: '48pt', textAlign: 'center' }}>Passed</th>
                    <th style={{ ...headerCell, width: '48pt', textAlign: 'center' }}>Failed</th>
                    <th style={{ ...headerCell, width: '64pt', textAlign: 'center' }}>Not scored</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.sections.map((s) => (
                    <tr key={s.section_id}>
                      <td style={cellStyle}>
                        {s.section_name}
                        {!s.counts_toward_score && (
                          <span style={{ color: '#666', fontSize: '8pt' }}> — carried no points</span>
                        )}
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'center' }}>
                        {s.counts_toward_score ? `${s.earned ?? 0} / ${s.available ?? 0}` : '—'}
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'center' }}>{s.passed}</td>
                      <td style={{ ...cellStyle, textAlign: 'center' }}>{s.failed}</td>
                      <td style={{ ...cellStyle, textAlign: 'center' }}>{s.not_scored}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* The reason a test with a passing percentage can still read
                  Failed. Without it the outcome looks like an arithmetic error. */}
              {breakdown.critical_failures.length > 0 && (
                <div style={{ marginTop: '6pt', border: '1pt solid #b00', padding: '5pt 8pt', fontSize: '9pt' }}>
                  <strong style={{ color: '#b00' }}>Critical steps not passed</strong>
                  <ul style={{ margin: '3pt 0 0 0', paddingLeft: '16pt' }}>
                    {breakdown.critical_failures.map((f, i) => (
                      <li key={i}>
                        {f.section_name} — {f.criterion_label}
                        {f.reason === 'not_scored' && ' (left unscored)'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Per-step record */}
          {sections.map((section, index) => (
            <div key={section.id} style={{ pageBreakInside: 'avoid' }}>
              <h2 style={sectionHeading}>
                Section {index + 1} of {sections.length} — {section.name}
              </h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...headerCell, width: '22pt' }}>#</th>
                    <th style={headerCell}>Step</th>
                    <th style={{ ...headerCell, width: '74pt', textAlign: 'center' }}>Recorded</th>
                    <th style={{ ...headerCell, width: '150pt' }}>Examiner notes</th>
                  </tr>
                </thead>
                <tbody>
                  {section.criteria.map((criterion, ci) => {
                    const result = resultFor(section.id, criterion);
                    return (
                      <tr key={criterion.id} style={{ pageBreakInside: 'avoid' }}>
                        <td style={{ ...cellStyle, width: '22pt', textAlign: 'center', color: '#666' }}>{ci + 1}</td>
                        <td style={cellStyle}>
                          <span style={{ fontWeight: criterion.required ? 600 : 400 }}>{criterion.label}</span>
                          {criterion.required && (
                            <span style={{ color: '#b00', fontWeight: 700, fontSize: '8pt' }}> ★ CRITICAL</span>
                          )}
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'center' }}>
                          <RecordedMark criterion={criterion} result={result} />
                        </td>
                        {/* Blank under `scores` disclosure — the API strips
                            examiner notes for a candidate at that level, and
                            this column simply shows what arrived. */}
                        <td style={cellStyle}>{result?.notes || ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {test.notes && (
            <div style={{ marginTop: '14pt' }}>
              <h2 style={sectionHeading}>Overall Notes</h2>
              <p style={{ fontSize: '9pt', margin: 0, whiteSpace: 'pre-wrap' }}>{test.notes}</p>
            </div>
          )}

          {/* The sign-off. An official result counts only once an officer has
              validated it, so the record has to say who did and when. */}
          <div style={{ marginTop: '18pt', pageBreakInside: 'avoid' }}>
            <h2 style={sectionHeading}>Validation</h2>
            {test.is_practice ? (
              <p style={{ fontSize: '9pt', margin: 0, color: '#666' }}>
                Practice attempts are not validated — there is nothing to credit.
              </p>
            ) : test.validated_at ? (
              <p style={{ fontSize: '9pt', margin: 0 }}>
                Validated by <strong>{test.validated_by_name || 'a training officer'}</strong> on{' '}
                {formatDateTime(test.validated_at, tz)}.
              </p>
            ) : (
              <p style={{ fontSize: '9pt', margin: 0, color: '#b00' }}>Not validated.</p>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              marginTop: '16pt',
              borderTop: '1px solid #ddd',
              paddingTop: '6pt',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '8pt',
              color: '#aaa',
            }}
          >
            <span>The Logbook — Skill Evaluation Record</span>
            <span>
              {test.candidate_name} — printed {formatDate(new Date(), tz)}
            </span>
          </div>
        </div>
      </div>
    </>
  );
};

export default SkillTestScorecardPrintPage;
