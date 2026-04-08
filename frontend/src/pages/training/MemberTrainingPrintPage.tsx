/**
 * Printable Member Training Record
 *
 * Paper-formatted training history for a member, designed for
 * letter-size printing. Includes compliance summary, certifications,
 * training hours, and complete course history.
 *
 * URL: /training/print/member?id=<user_id>&name=<name>
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { trainingService, trainingProgramService } from '../../services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateCustom } from '../../utils/dateFormatting';
import type {
  TrainingRecord,
  ComplianceSummary,
  UserTrainingStats,
  ProgramEnrollment,
} from '../../types/training';

const STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In Progress',
  scheduled: 'Scheduled',
  expired: 'Expired',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

const MemberTrainingPrintPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const userId = searchParams.get('id') || '';
  const memberName = searchParams.get('name') || 'Member';
  const tz = useTimezone();

  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [stats, setStats] = useState<UserTrainingStats | null>(null);
  const [compliance, setCompliance] = useState<ComplianceSummary | null>(null);
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) {
      setError('No member ID provided');
      setLoading(false);
      return;
    }
    Promise.all([
      trainingService.getRecords({ user_id: userId }).catch(() => []),
      trainingService.getUserStats(userId).catch(() => null),
      trainingService.getComplianceSummary(userId).catch(() => null),
      trainingProgramService.getUserEnrollments(userId).catch(() => []),
    ])
      .then(([recs, st, comp, enr]) => {
        setRecords(recs as TrainingRecord[]);
        setStats(st as UserTrainingStats | null);
        setCompliance(comp as ComplianceSummary | null);
        setEnrollments(enr as ProgramEnrollment[]);
      })
      .catch(() => setError('Failed to load training data'))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    if (loading || error) return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [loading, error]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-500">Loading training records...</p></div>;
  }
  if (error) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-red-600">{error}</p></div>;
  }

  const certifications = records.filter(r => r.certification_number || r.training_type === 'certification');
  const courseRecords = records.filter(r => r.training_type !== 'certification' || !r.certification_number);
  const fmtDate = (d?: string) => d ? formatDateCustom(d, { month: 'short', day: 'numeric', year: 'numeric' }, tz) : '—';

  const sectionHeading: React.CSSProperties = {
    fontSize: '11pt', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.05em', borderBottom: '1px solid #ddd',
    paddingBottom: '3pt', marginBottom: '6pt', marginTop: '16pt',
  };
  const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '3pt 6pt', fontSize: '9pt', verticalAlign: 'top' };
  const headerCell: React.CSSProperties = { ...cellStyle, fontWeight: 600, backgroundColor: '#f5f5f5', fontSize: '8pt', textTransform: 'uppercase', letterSpacing: '0.03em' };

  return (
    <>
      <style>{`
        @media print { @page { size: letter; margin: 0.5in 0.6in; } body { margin: 0; } }
        @media screen { body { background: #f3f4f6; } }
      `}</style>

      <div className="max-w-[8.5in] mx-auto bg-white print:shadow-none shadow-lg my-8 print:my-0">
        <div className="p-8 print:p-0" style={{ fontFamily: 'Georgia, "Times New Roman", serif', color: '#111', fontSize: '10pt', lineHeight: '1.5' }}>

          {/* Header */}
          <div style={{ borderBottom: '3px solid #111', paddingBottom: '10pt', marginBottom: '14pt' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ fontSize: '18pt', fontWeight: 'bold', margin: '0 0 2pt 0' }}>Training Record</h1>
                <p style={{ fontSize: '14pt', margin: 0 }}>{memberName}</p>
              </div>
              <div style={{ textAlign: 'right', fontSize: '9pt', color: '#666' }}>
                <p style={{ margin: 0 }}>Generated: {new Date().toLocaleDateString()}</p>
                {compliance && (
                  <p style={{ margin: 0, fontWeight: 600, color: compliance.compliance_status === 'green' ? '#166534' : compliance.compliance_status === 'red' ? '#991b1b' : '#92400e' }}>
                    Compliance: {compliance.compliance_label || compliance.compliance_status.toUpperCase()}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          {stats && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14pt' }}>
              <tbody>
                <tr>
                  {[
                    { label: 'Total Hours', value: stats.total_hours },
                    { label: 'Hours This Year', value: stats.hours_this_year },
                    { label: 'Active Certifications', value: stats.active_certifications },
                    { label: 'Completed Courses', value: stats.completed_courses },
                  ].map(({ label, value }) => (
                    <td key={label} style={{ border: '1px solid #ccc', padding: '6pt 8pt', width: '25%', textAlign: 'center' }}>
                      <div style={{ fontSize: '16pt', fontWeight: 'bold' }}>{value}</div>
                      <div style={{ fontSize: '8pt', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#555' }}>{label}</div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}

          {/* Compliance Summary */}
          {compliance && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14pt' }}>
              <tbody>
                <tr>
                  <td style={cellStyle}><strong>Requirements Met:</strong> {compliance.requirements_met} / {compliance.requirements_total}</td>
                  <td style={cellStyle}><strong>Expiring Soon:</strong> {compliance.certs_expiring_soon}</td>
                  <td style={cellStyle}><strong>Expired:</strong> {compliance.certs_expired}</td>
                </tr>
              </tbody>
            </table>
          )}

          {/* Active Program Enrollments */}
          {enrollments.length > 0 && (
            <div>
              <h2 style={sectionHeading}>Program Enrollments</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={headerCell}>Program</th>
                    <th style={headerCell}>Status</th>
                    <th style={headerCell}>Progress</th>
                    <th style={headerCell}>Enrolled</th>
                    <th style={headerCell}>Target Completion</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map(e => (
                    <tr key={e.id}>
                      <td style={cellStyle}>{e.program?.name || '—'}</td>
                      <td style={cellStyle}>{e.status}</td>
                      <td style={cellStyle}>{Math.round(e.progress_percentage)}%</td>
                      <td style={cellStyle}>{fmtDate(e.enrolled_at)}</td>
                      <td style={cellStyle}>{fmtDate(e.target_completion_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Certifications */}
          {certifications.length > 0 && (
            <div>
              <h2 style={sectionHeading}>Certifications</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={headerCell}>Certification</th>
                    <th style={headerCell}>Number</th>
                    <th style={headerCell}>Issuing Agency</th>
                    <th style={headerCell}>Completed</th>
                    <th style={headerCell}>Expires</th>
                    <th style={headerCell}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {certifications.map(r => (
                    <tr key={r.id}>
                      <td style={cellStyle}>{r.course_name}</td>
                      <td style={cellStyle}>{r.certification_number || '—'}</td>
                      <td style={cellStyle}>{r.issuing_agency || '—'}</td>
                      <td style={cellStyle}>{fmtDate(r.completion_date)}</td>
                      <td style={{ ...cellStyle, ...(r.expiration_date && new Date(r.expiration_date) < new Date() ? { color: '#991b1b', fontWeight: 600 } : {}) }}>
                        {fmtDate(r.expiration_date)}
                      </td>
                      <td style={cellStyle}>{STATUS_LABELS[r.status] || r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Training Course History */}
          {courseRecords.length > 0 && (
            <div>
              <h2 style={sectionHeading}>Training History</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={headerCell}>Course</th>
                    <th style={headerCell}>Type</th>
                    <th style={headerCell}>Date</th>
                    <th style={headerCell}>Hours</th>
                    <th style={headerCell}>Instructor</th>
                    <th style={headerCell}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {courseRecords
                    .sort((a, b) => (b.completion_date || b.scheduled_date || '').localeCompare(a.completion_date || a.scheduled_date || ''))
                    .map(r => (
                    <tr key={r.id}>
                      <td style={cellStyle}>{r.course_name}</td>
                      <td style={cellStyle}>{r.training_type?.replace(/_/g, ' ') || '—'}</td>
                      <td style={cellStyle}>{fmtDate(r.completion_date || r.scheduled_date)}</td>
                      <td style={{ ...cellStyle, textAlign: 'center' }}>{r.hours_completed}</td>
                      <td style={cellStyle}>{r.instructor || '—'}</td>
                      <td style={cellStyle}>{STATUS_LABELS[r.status] || r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div style={{ marginTop: '24pt', borderTop: '1px solid #ddd', paddingTop: '6pt', display: 'flex', justifyContent: 'space-between', fontSize: '8pt', color: '#aaa' }}>
            <span>The Logbook — Member Training Record</span>
            <span>Page 1 of 1</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default MemberTrainingPrintPage;
