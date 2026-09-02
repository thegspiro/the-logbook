/**
 * The run as a page somebody can hand to a chief.
 *
 * A print view rather than a generated PDF: the report is a screen the app can
 * already render, and the browser's own print-to-PDF turns it into a file
 * without a second rendering stack to keep in step with the first.
 *
 * It renders what the API returned for this account and derives nothing it
 * withheld — a tester who cannot read other testers' marks does not get them
 * here either, and the summary counts say what they are counted from.
 */

import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import PrintPageStyles from '../../../components/print/PrintPageStyles';
import { useAuthStore } from '../../../stores/authStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatDateTime } from '../../../utils/dateFormatting';
import { SEE_ALL_TESTERS_PERMISSION, useTestingChecklist } from '../useTestingChecklist';
import { TESTING_GROUPS } from '../testingRegistry';
import { describeGate } from '../pageAccess';
import { GATE_VERDICT_LABELS, gateVerdict, isGateMismatch, needsGateConfirmation } from '../gateVerdict';
import { flattenRun } from '../exportRun';
import type { TestStatus } from '../useTestingChecklist';

const PAPER: React.CSSProperties = {
  fontFamily: 'Georgia, "Times New Roman", serif',
  color: '#111',
  fontSize: '10pt',
  lineHeight: 1.5,
};

const SECTION: React.CSSProperties = {
  fontSize: '12pt',
  fontWeight: 'bold',
  margin: '14pt 0 6pt 0',
  borderBottom: '1pt solid #111',
  paddingBottom: '2pt',
};

const TABLE: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '9pt' };
const CELL: React.CSSProperties = {
  border: '0.5pt solid #999',
  padding: '3pt 5pt',
  textAlign: 'left',
  verticalAlign: 'top',
};
const HEAD: React.CSSProperties = { ...CELL, fontWeight: 'bold', background: '#eee' };

export const TestingReportPrintPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const tz = useTimezone();
  const canSeeAllTesters = checkPermission(SEE_ALL_TESTERS_PERMISSION);

  const { results, otherMarks, run, summary, testerCount, gateTally, staleCount, isLoading, loadError, viewRun } =
    useTestingChecklist({ includeAllTesters: canSeeAllTesters });

  // `?run=<id>` prints an earlier pass; without it the current one.
  const requestedRunId = searchParams.get('run');
  useEffect(() => {
    if (requestedRunId) viewRun(requestedRunId);
  }, [requestedRunId, viewRun]);

  useEffect(() => {
    if (isLoading) return undefined;
    // Not printed when the run failed to load. An empty `results` renders as a
    // report stating there were no failures and that every gate behaved — the
    // most confident possible reading of "we never got the data" — and the
    // page then sent it to the printer unprompted.
    if (loadError) return undefined;
    // Printed once the run has actually loaded, or the dialog opens over an
    // empty page and the reader prints nothing.
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [isLoading, loadError]);

  const marks = flattenRun({
    run,
    results,
    otherMarks,
    viewerId: user?.id ?? 'me',
    viewerName: user?.full_name || user?.username || 'you',
    viewerPositions: user?.positions ?? [],
    formatTimestamp: (iso) => formatDateTime(iso, tz),
  });

  const recorded = marks.filter((mark) => mark.status !== 'untested');

  /**
   * One status per page, across every tester whose marks this reader can see.
   *
   * Worst wins: a page one tester failed is a failed page even if another
   * passed it, because a report that averaged the two would bury the finding.
   */
  const pageStatus = new Map<string, TestStatus>();
  const RANK: Record<TestStatus, number> = { untested: 0, pass: 1, blocked: 2, fail: 3 };
  for (const mark of recorded) {
    const held = pageStatus.get(mark.page.path) ?? 'untested';
    if (RANK[mark.status] > RANK[held]) pageStatus.set(mark.page.path, mark.status);
  }

  /**
   * The headline counts, over the same marks the rest of the report shows.
   *
   * `summary` from the hook counts only the reader's own marks. On a shared
   * run that produced a report claiming to cover every tester while printing
   * "Failed 0" above a failures table listing another tester's failure.
   */
  const countPages = (status: TestStatus) => [...pageStatus.values()].filter((held) => held === status).length;
  const totals = canSeeAllTesters
    ? {
        checked: pageStatus.size,
        pass: countPages('pass'),
        fail: countPages('fail'),
        blocked: countPages('blocked'),
        untested: summary.total - pageStatus.size,
      }
    : {
        checked: summary.total - summary.untested,
        pass: summary.pass,
        fail: summary.fail,
        blocked: summary.blocked,
        untested: summary.untested,
      };
  const failures = recorded.filter((mark) => mark.status === 'fail');
  const verdictOf = (mark: (typeof recorded)[number]) =>
    gateVerdict({ status: mark.status, ...(mark.expectedAccess ? { expectedAccess: mark.expectedAccess } : {}) });
  // Findings and questions together, told apart by the label on each row: a
  // block on a page the account should open may be a refusal or may be a page
  // the tester could not reach, and only they can say which.
  const gateFindings = recorded.filter(
    (mark) => isGateMismatch(verdictOf(mark)) || needsGateConfirmation(verdictOf(mark))
  );

  if (isLoading) {
    return <p style={{ padding: '2rem' }}>Loading the run…</p>;
  }

  if (loadError) {
    return (
      <div style={{ padding: '2rem' }} role="alert">
        <h1 style={{ fontSize: '18pt', fontWeight: 'bold', margin: '0 0 8pt 0' }}>The run could not be loaded</h1>
        <p style={{ margin: '0 0 8pt 0' }}>{loadError}</p>
        <p style={{ margin: 0 }}>
          Nothing has been printed. Reload the page, or go back to the checklist and try again.
        </p>
      </div>
    );
  }

  return (
    <>
      <PrintPageStyles margin="0.5in 0.6in" />

      <div className="mx-auto my-8 max-w-[8.5in] bg-white shadow-lg print:my-0 print:shadow-none">
        <div className="p-8 print:p-0" style={PAPER}>
          <div style={{ borderBottom: '3px solid #111', paddingBottom: '10pt', marginBottom: '12pt' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ fontSize: '18pt', fontWeight: 'bold', margin: '0 0 2pt 0' }}>
                  Application testing report
                </h1>
                <p style={{ fontSize: '12pt', margin: 0 }}>{run ? run.label : 'No run started yet'}</p>
              </div>
              <div style={{ textAlign: 'right', fontSize: '9pt', color: '#666' }}>
                <p style={{ margin: 0 }}>Printed: {formatDate(new Date().toISOString(), tz)}</p>
                <p style={{ margin: 0 }}>By: {user?.full_name || user?.username || 'unknown'}</p>
                {run?.buildId && <p style={{ margin: 0 }}>Build: {run.buildId}</p>}
              </div>
            </div>
          </div>

          <h2 style={SECTION}>Summary</h2>
          <table style={TABLE}>
            <tbody>
              <tr>
                <td style={CELL}>Pages in the application</td>
                <td style={CELL}>{summary.total}</td>
                <td style={CELL}>Covered by somebody</td>
                <td style={CELL}>{totals.checked}</td>
              </tr>
              <tr>
                <td style={CELL}>Passed</td>
                <td style={CELL}>{totals.pass}</td>
                <td style={CELL}>Failed</td>
                <td style={CELL}>{totals.fail}</td>
              </tr>
              <tr>
                <td style={CELL}>Blocked</td>
                <td style={CELL}>{totals.blocked}</td>
                <td style={CELL}>Not tested</td>
                <td style={CELL}>{totals.untested}</td>
              </tr>
              <tr>
                <td style={CELL}>Gate refusals verified</td>
                <td style={CELL}>{gateTally.verified}</td>
                <td style={CELL}>Gate mismatches</td>
                <td style={CELL}>
                  {gateTally.mismatches}
                  {gateTally.needsConfirmation > 0 && ` (+${gateTally.needsConfirmation} to confirm)`}
                </td>
              </tr>
              <tr>
                <td style={CELL}>Testers</td>
                <td style={CELL}>{canSeeAllTesters ? testerCount : 1}</td>
                <td style={CELL}>Marks on an earlier build</td>
                <td style={CELL}>{staleCount}</td>
              </tr>
            </tbody>
          </table>

          <h2 style={SECTION}>Failures</h2>
          {failures.length === 0 ? (
            <p style={{ margin: 0 }}>No page was recorded as failing.</p>
          ) : (
            <table style={TABLE}>
              <thead>
                <tr>
                  <th style={HEAD}>Page</th>
                  <th style={HEAD}>Route</th>
                  <th style={HEAD}>Tester</th>
                  <th style={HEAD}>What was found</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((mark) => (
                  <tr key={`${mark.page.path}-${mark.testerName}`}>
                    <td style={CELL}>{mark.page.label}</td>
                    <td style={CELL}>{mark.page.path}</td>
                    <td style={CELL}>{mark.testerName}</td>
                    <td style={CELL}>{mark.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2 style={SECTION}>Gate findings</h2>
          {gateFindings.length === 0 ? (
            <p style={{ margin: 0 }}>Every gate behaved as the application predicted.</p>
          ) : (
            <table style={TABLE}>
              <thead>
                <tr>
                  <th style={HEAD}>Page</th>
                  <th style={HEAD}>Gate</th>
                  <th style={HEAD}>Tester</th>
                  <th style={HEAD}>Finding</th>
                </tr>
              </thead>
              <tbody>
                {gateFindings.map((mark) => {
                  const verdict = gateVerdict({
                    status: mark.status,
                    ...(mark.expectedAccess ? { expectedAccess: mark.expectedAccess } : {}),
                  });
                  return (
                    <tr key={`${mark.page.path}-${mark.testerName}`}>
                      <td style={CELL}>{mark.page.label}</td>
                      <td style={CELL}>{describeGate(mark.page) || '—'}</td>
                      <td style={CELL}>
                        {mark.testerName}
                        {mark.testedAs.length > 0 && ` (${mark.testedAs.join(', ')})`}
                      </td>
                      <td style={CELL}>{verdict === 'none' ? '' : GATE_VERDICT_LABELS[verdict]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <h2 style={SECTION}>Coverage by area</h2>
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={HEAD}>Area</th>
                <th style={HEAD}>Pages</th>
                <th style={HEAD}>Checked</th>
                <th style={HEAD}>Passed</th>
                <th style={HEAD}>Failed</th>
                <th style={HEAD}>Blocked</th>
              </tr>
            </thead>
            <tbody>
              {TESTING_GROUPS.map((group) => {
                const statuses = group.pages.map((page) => pageStatus.get(page.path) ?? 'untested');
                const count = (value: string) => statuses.filter((status) => status === value).length;
                return (
                  <tr key={group.id}>
                    <td style={CELL}>{group.label}</td>
                    <td style={CELL}>{group.pages.length}</td>
                    <td style={CELL}>{statuses.filter((status) => status !== 'untested').length}</td>
                    <td style={CELL}>{count('pass')}</td>
                    <td style={CELL}>{count('fail')}</td>
                    <td style={CELL}>{count('blocked')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p style={{ marginTop: '14pt', fontSize: '8pt', color: '#666' }}>
            Counts cover {canSeeAllTesters ? 'every tester in the department' : 'your own marks'}. Pages nobody has
            opened are counted as not tested, not as passing.
          </p>
        </div>
      </div>
    </>
  );
};

export default TestingReportPrintPage;
