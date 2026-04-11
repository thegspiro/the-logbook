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
import { useSearchParams } from 'react-router-dom';
import { shiftCompletionService } from '../../services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate, formatDateCustom } from '../../utils/dateFormatting';
import type { ShiftCompletionReport } from '../../types/training';

const ShiftReportPrintPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const reportId = searchParams.get('id') || '';
  const tz = useTimezone();
  const [report, setReport] = useState<ShiftCompletionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!reportId) {
      setError('No report ID provided');
      setLoading(false);
      return;
    }
    shiftCompletionService.getReport(reportId)
      .then(setReport)
      .catch(() => setError('Failed to load report'))
      .finally(() => setLoading(false));
  }, [reportId]);

  useEffect(() => {
    if (!report) return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [report]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading report...</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-600">{error || 'Report not found'}</p>
      </div>
    );
  }

  const dateStr = formatDateCustom(
    report.shift_date + 'T12:00:00',
    { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
    tz,
  );

  const hasEvaluation = report.performance_rating
    || report.areas_of_strength
    || report.areas_for_improvement
    || (report.skills_observed && report.skills_observed.length > 0);

  return (
    <>
      <style>{`
        @media print {
          @page { size: letter; margin: 0.6in 0.75in; }
          body { margin: 0; padding: 0; }
        }
        @media screen {
          body { background: #f3f4f6; }
        }
      `}</style>

      <div className="max-w-[8.5in] mx-auto bg-white print:shadow-none shadow-lg my-8 print:my-0">
        <div className="p-8 print:p-0" style={{ fontFamily: 'Georgia, "Times New Roman", serif', color: '#111', fontSize: '11pt', lineHeight: '1.6' }}>

          {/* Header */}
          <div style={{ borderBottom: '3px solid #111', paddingBottom: '12pt', marginBottom: '16pt' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ fontSize: '18pt', fontWeight: 'bold', margin: '0 0 2pt 0', letterSpacing: '-0.01em' }}>
                  Shift Completion Report
                </h1>
                <p style={{ fontSize: '10pt', color: '#555', margin: 0 }}>
                  End-of-Shift Documentation
                </p>
              </div>
              <div style={{ textAlign: 'right', fontSize: '9pt', color: '#666' }}>
                <p style={{ margin: 0 }}>Report ID: {report.id.slice(0, 8).toUpperCase()}</p>
                <p style={{ margin: 0 }}>Filed: {formatDateCustom(report.created_at, { month: 'short', day: 'numeric', year: 'numeric' }, tz)}</p>
                {report.review_status === 'approved' && (
                  <p style={{ margin: 0, color: '#166534', fontWeight: 600 }}>APPROVED</p>
                )}
                {report.review_status === 'flagged' && (
                  <p style={{ margin: 0, color: '#991b1b', fontWeight: 600 }}>FLAGGED</p>
                )}
              </div>
            </div>
          </div>

          {/* Shift Information Grid */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16pt', fontSize: '10pt' }}>
            <tbody>
              <tr>
                <td style={{ border: '1px solid #ccc', padding: '6pt 8pt', width: '50%', verticalAlign: 'top' }}>
                  <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '8pt', letterSpacing: '0.05em', color: '#555', display: 'block' }}>Member</span>
                  {report.trainee_name || 'Unknown'}
                </td>
                <td style={{ border: '1px solid #ccc', padding: '6pt 8pt', width: '50%', verticalAlign: 'top' }}>
                  <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '8pt', letterSpacing: '0.05em', color: '#555', display: 'block' }}>Shift Date</span>
                  {dateStr}
                </td>
              </tr>
              <tr>
                <td style={{ border: '1px solid #ccc', padding: '6pt 8pt', verticalAlign: 'top' }}>
                  <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '8pt', letterSpacing: '0.05em', color: '#555', display: 'block' }}>Hours on Shift</span>
                  {report.hours_on_shift}
                </td>
                <td style={{ border: '1px solid #ccc', padding: '6pt 8pt', verticalAlign: 'top' }}>
                  <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '8pt', letterSpacing: '0.05em', color: '#555', display: 'block' }}>Calls Responded</span>
                  {report.calls_responded}
                </td>
              </tr>
              {report.call_types && report.call_types.length > 0 && (
                <tr>
                  <td colSpan={2} style={{ border: '1px solid #ccc', padding: '6pt 8pt', verticalAlign: 'top' }}>
                    <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '8pt', letterSpacing: '0.05em', color: '#555', display: 'block' }}>Call Types</span>
                    {report.call_types.join(', ')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Performance Rating */}
          {report.performance_rating && (
            <div style={{ marginBottom: '14pt' }}>
              <h2 style={{ fontSize: '11pt', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #ddd', paddingBottom: '3pt', marginBottom: '6pt' }}>
                Performance Rating
              </h2>
              <p style={{ margin: 0, fontSize: '12pt' }}>
                <strong>{report.performance_rating}</strong> / 5
              </p>
            </div>
          )}

          {/* Narrative Sections */}
          {report.areas_of_strength && (
            <div style={{ marginBottom: '14pt' }}>
              <h2 style={{ fontSize: '11pt', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #ddd', paddingBottom: '3pt', marginBottom: '6pt' }}>
                Areas of Strength
              </h2>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{report.areas_of_strength}</p>
            </div>
          )}

          {report.areas_for_improvement && (
            <div style={{ marginBottom: '14pt' }}>
              <h2 style={{ fontSize: '11pt', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #ddd', paddingBottom: '3pt', marginBottom: '6pt' }}>
                Areas for Improvement
              </h2>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{report.areas_for_improvement}</p>
            </div>
          )}

          {report.officer_narrative && (
            <div style={{ marginBottom: '14pt' }}>
              <h2 style={{ fontSize: '11pt', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #ddd', paddingBottom: '3pt', marginBottom: '6pt' }}>
                Officer Narrative
              </h2>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{report.officer_narrative}</p>
            </div>
          )}

          {/* Skills Observed Table */}
          {report.skills_observed && report.skills_observed.length > 0 && (
            <div style={{ marginBottom: '14pt' }}>
              <h2 style={{ fontSize: '11pt', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #ddd', paddingBottom: '3pt', marginBottom: '6pt' }}>
                Skills Observed
              </h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f5f5f5' }}>
                    <th style={{ border: '1px solid #ccc', padding: '4pt 8pt', textAlign: 'left', fontWeight: 600 }}>Skill</th>
                    <th style={{ border: '1px solid #ccc', padding: '4pt 8pt', textAlign: 'center', fontWeight: 600, width: '80pt' }}>Score</th>
                    <th style={{ border: '1px solid #ccc', padding: '4pt 8pt', textAlign: 'left', fontWeight: 600 }}>Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {report.skills_observed.map((skill, i) => (
                    <tr key={i}>
                      <td style={{ border: '1px solid #ccc', padding: '4pt 8pt' }}>{skill.skill_name}</td>
                      <td style={{ border: '1px solid #ccc', padding: '4pt 8pt', textAlign: 'center' }}>
                        {skill.score ? `${skill.score}/5` : '—'}
                      </td>
                      <td style={{ border: '1px solid #ccc', padding: '4pt 8pt', color: '#555' }}>
                        {skill.comment || skill.notes || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tasks Performed Table */}
          {report.tasks_performed && report.tasks_performed.length > 0 && (
            <div style={{ marginBottom: '14pt' }}>
              <h2 style={{ fontSize: '11pt', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #ddd', paddingBottom: '3pt', marginBottom: '6pt' }}>
                Tasks Performed
              </h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f5f5f5' }}>
                    <th style={{ border: '1px solid #ccc', padding: '4pt 8pt', textAlign: 'left', fontWeight: 600 }}>Task</th>
                    <th style={{ border: '1px solid #ccc', padding: '4pt 8pt', textAlign: 'left', fontWeight: 600 }}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {report.tasks_performed.map((task, i) => (
                    <tr key={i}>
                      <td style={{ border: '1px solid #ccc', padding: '4pt 8pt' }}>{task.task}</td>
                      <td style={{ border: '1px solid #ccc', padding: '4pt 8pt', color: '#555' }}>
                        {task.description || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Signature Block */}
          <div style={{ marginTop: '28pt', pageBreakInside: 'avoid' }}>
            <div style={{ borderTop: '2px solid #111', paddingTop: '12pt' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '50%', paddingRight: '20pt', verticalAlign: 'bottom' }}>
                      <p style={{ margin: '0 0 4pt 0', fontWeight: 600, textTransform: 'uppercase', fontSize: '8pt', letterSpacing: '0.05em', color: '#555' }}>Filing Officer</p>
                      <p style={{ margin: '0 0 24pt 0' }}>{report.officer_name || '—'}</p>
                      <div style={{ borderBottom: '1px solid #999', marginBottom: '4pt' }} />
                      <p style={{ margin: 0, fontSize: '8pt', color: '#999' }}>Signature / Date</p>
                    </td>
                    <td style={{ width: '50%', paddingLeft: '20pt', verticalAlign: 'bottom' }}>
                      {hasEvaluation && (
                        <>
                          <p style={{ margin: '0 0 4pt 0', fontWeight: 600, textTransform: 'uppercase', fontSize: '8pt', letterSpacing: '0.05em', color: '#555' }}>
                            {report.trainee_acknowledged ? 'Member Acknowledgment' : 'Member Acknowledgment (Pending)'}
                          </p>
                          <p style={{ margin: '0 0 24pt 0' }}>
                            {report.trainee_acknowledged
                              ? `${report.trainee_name || '—'} — Acknowledged`
                              : report.trainee_name || '—'}
                          </p>
                          <div style={{ borderBottom: '1px solid #999', marginBottom: '4pt' }} />
                          <p style={{ margin: 0, fontSize: '8pt', color: '#999' }}>Signature / Date</p>
                        </>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>

              {report.reviewer_name && (
                <div style={{ marginTop: '16pt' }}>
                  <p style={{ margin: 0, fontSize: '9pt', color: '#666' }}>
                    <strong>Reviewed by:</strong> {report.reviewer_name}
                    {report.reviewed_at && ` on ${formatDateCustom(report.reviewed_at, { month: 'short', day: 'numeric', year: 'numeric' }, tz)}`}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={{ marginTop: '24pt', borderTop: '1px solid #ddd', paddingTop: '6pt', display: 'flex', justifyContent: 'space-between', fontSize: '8pt', color: '#aaa' }}>
            <span>The Logbook — Shift Completion Report</span>
            <span>Generated {formatDate(new Date(), tz)}</span>
          </div>

        </div>
      </div>
    </>
  );
};

export default ShiftReportPrintPage;
